import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../lib/logger";

/**
 * Reads a matchup screenshot (bracket, schedule, or another app's matchup card) and extracts
 * ALL visible player matchups plus the event/tournament name, using a vision-capable model.
 *
 * Provider selection — ALL configured keys are tried in priority order; if an earlier key
 * fails with a permanent error (quota exhaustion, invalid key, 401/403) the next configured
 * key is tried automatically rather than failing the whole request:
 *   1. SCREENSHOT_AI_KEY  (dedicated override — any provider, auto-detected by prefix)
 *   2. ANTHROPIC_API_KEY  (user-provided — auto-detected by prefix; may actually be an OpenAI key)
 *   3. AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL  (Replit proxy)
 *
 * "Absent, not faked": any field the model isn't confident about comes back null rather than a
 * guess. A malformed or unparseable model response degrades gracefully into "found nothing".
 *
 * The returned object includes a `debugLog` array tracing every stage and, on success, the
 * `rawText` the model returned before parsing — both are passed through to the API response
 * so the frontend can show a real failure reason and the raw extracted text.
 */

export interface RawMatchupEntry {
  player1Name: string | null;
  player2Name: string | null;
  eventName: string | null;
}

export interface RawScreenshotRecognition {
  /** Every matchup extracted from the image. Empty array when nothing could be read. */
  matchups: RawMatchupEntry[];
}

export interface RawScreenshotRecognitionWithDebug extends RawScreenshotRecognition {
  /** Stage-by-stage diagnostic log for every step of the recognition pipeline. */
  debugLog: string[];
  /** The raw text string the vision model returned before JSON parsing. Useful when the model
   *  found something but the JSON was malformed or the player names weren't resolved. */
  rawText?: string;
}

const EMPTY_RECOGNITION: RawScreenshotRecognition = { matchups: [] };

const SYSTEM_PROMPT = `You read screenshots of tennis fixtures, schedules, brackets, or match-listing apps.

Extract ALL distinct matchups (pairs of tennis players facing each other) visible in the image.

For each matchup, extract:
- player1Name: first tennis player name in that pair (topmost or leftmost if side-by-side)
- player2Name: second tennis player name in that pair
- eventName: tournament or event name for that matchup (null if not visible; use the same event name for all matchups if they share one card/image)

Rules:
- Ignore betting odds, probability percentages, prices, team logos, country flags, decorative elements, and sponsored content. Extract player names only.
- Ignore match times, court numbers, seed numbers in brackets (e.g. "(1)"), rankings, scores, and score-related numbers.
- If the image shows a full bracket or schedule, return EACH individual matchup row/card as a separate entry.
- For long scroll-images with multiple match cards stacked vertically, return each card as a separate entry.
- Player names may appear on separate lines (e.g. one player above the other, separated by a divider, "vs", "v", or a dash). Treat consecutive player names as a pair.
- Only include entries where you can read at least one player name. Set unreadable fields to null.
- If both players in a matchup are unclear or unreadable, omit that matchup from the array.
- If the image is unrelated to tennis or completely unreadable, return an empty array.
- Prefer null over guessing for any field you cannot confidently read.

Respond with ONLY a strict JSON array, no markdown, no other text:
[{"player1Name": string|null, "player2Name": string|null, "eventName": string|null}, ...]`;

// ---------------------------------------------------------------------------
// Key / provider detection
// ---------------------------------------------------------------------------

type Provider = "openai" | "anthropic" | "gemini";

/**
 * Detect provider from key prefix for keys that aren't coming from a named Gemini env var.
 * sk-ant-* → Anthropic; everything else → OpenAI.
 * Gemini keys MUST be registered via GEMINI_API_KEY / GOOGLE_API_KEY in resolveAllKeys()
 * where the env var name is authoritative — never inferred from key prefix.
 */
function detectProviderFromPrefix(key: string): "openai" | "anthropic" {
  return key.startsWith("sk-ant-") ? "anthropic" : "openai";
}

interface ResolvedKey {
  key: string;
  provider: Provider;
  /** For OpenAI: override base URL (Replit proxy). Undefined = use api.openai.com directly. */
  baseUrl?: string;
  /** Human-readable label for debug logging (never includes the key value). */
  label: string;
}

/**
 * Returns ALL configured providers in priority order, deduplicating by key value so the same
 * key is never tried twice even if it appears under multiple env variable names.
 */
function resolveAllKeys(): ResolvedKey[] {
  const keys: ResolvedKey[] = [];
  const seen = new Set<string>();

  function add(k: ResolvedKey) {
    if (!seen.has(k.key)) {
      seen.add(k.key);
      keys.push(k);
    }
  }

  // 1. Dedicated override key (any provider, detected by prefix — NOT Gemini, which needs named env var)
  const dedicated = process.env.SCREENSHOT_AI_KEY;
  if (dedicated) add({ key: dedicated, provider: detectProviderFromPrefix(dedicated), label: "SCREENSHOT_AI_KEY" });

  // 2. User-provided key stored as ANTHROPIC_API_KEY (may actually be OpenAI sk-proj-)
  const userKey = process.env.ANTHROPIC_API_KEY;
  if (userKey) add({ key: userKey, provider: detectProviderFromPrefix(userKey), label: "ANTHROPIC_API_KEY" });

  // 3. Replit OpenAI integration proxy
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const replitBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (replitKey && replitBase) {
    add({ key: replitKey, provider: "openai", baseUrl: replitBase, label: "AI_INTEGRATIONS_OPENAI" });
  }

  // 4. Google Gemini (free tier available at aistudio.google.com; keys start with "AIza")
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (geminiKey) add({ key: geminiKey, provider: "gemini", label: "GEMINI_API_KEY" });

  return keys;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function parseImageBase64(imageBase64: string): {
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  dataUrl: string;
} {
  if (imageBase64.startsWith("data:")) {
    const semi = imageBase64.indexOf(";");
    const comma = imageBase64.indexOf(",");
    const mimeRaw = semi > 0 ? imageBase64.slice(5, semi) : "image/jpeg";
    const mediaType = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeRaw)
      ? mimeRaw
      : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    return { data: imageBase64.slice(comma + 1), mediaType, dataUrl: imageBase64 };
  }
  const data = imageBase64;
  return { data, mediaType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${data}` };
}

// ---------------------------------------------------------------------------
// Response parsing (shared)
// ---------------------------------------------------------------------------

function cleanEntry(obj: unknown): RawMatchupEntry | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const clean = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  const player1Name = clean(o.player1Name);
  const player2Name = clean(o.player2Name);
  if (player1Name === null && player2Name === null) return null;
  return { player1Name, player2Name, eventName: clean(o.eventName) };
}

function parseRecognitionResponse(raw: string | null | undefined): RawScreenshotRecognition {
  if (!raw) return EMPTY_RECOGNITION;
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const matchups: RawMatchupEntry[] = [];
      for (const item of parsed) {
        const entry = cleanEntry(item);
        if (entry) matchups.push(entry);
      }
      return { matchups };
    }
    if (parsed && typeof parsed === "object") {
      const entry = cleanEntry(parsed);
      return { matchups: entry ? [entry] : [] };
    }
  } catch (err) {
    logger.warn({ err, rawPreview: raw.slice(0, 200) }, "Screenshot recognition model returned unparseable JSON -- treating as nothing recognized");
  }
  return EMPTY_RECOGNITION;
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

async function callOpenAI(resolved: ResolvedKey, imageDataUrl: string): Promise<string | null> {
  const client = new OpenAI({ apiKey: resolved.key, ...(resolved.baseUrl ? { baseURL: resolved.baseUrl } : {}) });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 800,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all matchups from this screenshot." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content ?? null;
}

/**
 * Google Gemini vision call using direct REST (no SDK needed).
 * Key format from Google AI Studio is NOT required to start with "AIza" — accept any format.
 *
 * Model fallback chain: tries each model in order; on RESOURCE_EXHAUSTED moves to next model.
 * Returns retryAfterMs on the thrown error so the caller can decide retryable vs permanent:
 *   - retryAfterMs < 30 000 → transient rate-limit, outer loop will retry with backoff
 *   - retryAfterMs >= 30 000 (or undefined) → daily quota exhausted, skip to next provider
 */
async function callGemini(resolved: ResolvedKey, data: string, mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<string | null> {
  const GEMINI_MODELS = [
    "gemini-flash-latest",      // alias — always points to the current stable flash
    "gemini-flash-lite-latest", // lighter alias — separate quota bucket
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-001",
  ];

  let lastErr: unknown;

  for (const model of GEMINI_MODELS) {
    // All Gemini API key formats (AIza*, AQ.*, etc.) use ?key= URL parameter auth.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${resolved.key}`;

    const body = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mediaType, data } },
          { text: "Extract all matchups from this screenshot." },
        ],
      }],
      generationConfig: { maxOutputTokens: 800 },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? null;
    }

    const errBody = await res.json().catch(() => ({})) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
        details?: Array<{ retryDelay?: string; [k: string]: unknown }>;
      }
    };
    const gStatus = errBody.error?.status ?? "";
    const httpStatus = res.status;

    // Parse retry delay hint from Gemini error (e.g. "155.278535ms", "2s")
    let retryAfterMs: number | undefined;
    for (const detail of errBody.error?.details ?? []) {
      if (typeof detail.retryDelay === "string") {
        const ms = detail.retryDelay.endsWith("ms")
          ? parseFloat(detail.retryDelay)
          : detail.retryDelay.endsWith("s")
            ? parseFloat(detail.retryDelay) * 1000
            : undefined;
        if (ms !== undefined && !isNaN(ms)) { retryAfterMs = ms; break; }
      }
    }
    // Also check the message text: "retry in Xs" / "retry in Xms"
    if (retryAfterMs === undefined) {
      const m = errBody.error?.message?.match(/retry in ([\d.]+)(m?s)/i);
      if (m) retryAfterMs = m[2].toLowerCase() === "ms" ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = new Error(`Gemini API error ${httpStatus} (${model}): ${errBody.error?.message ?? res.statusText}`);
    err.status = httpStatus;
    err.geminiStatus = gStatus;
    err.model = model;
    err.retryAfterMs = retryAfterMs;

    // Permanent auth failures — no point trying other models
    if (gStatus === "PERMISSION_DENIED" || httpStatus === 403) { err.status = 403; throw err; }
    if (gStatus === "UNAUTHENTICATED" || httpStatus === 401) { err.status = 401; throw err; }
    // 404 = model not found — try next model in the chain
    if (httpStatus === 404) { lastErr = err; continue; }
    // RESOURCE_EXHAUSTED with a very short retry hint = transient RPM limit, NOT quota exhaustion
    if (gStatus === "RESOURCE_EXHAUSTED" || httpStatus === 429) {
      const isTransient = retryAfterMs !== undefined && retryAfterMs < 30_000;
      if (isTransient) {
        // Let outer retry loop handle it — do NOT mark as insufficient_quota
        throw err;
      }
      // Long or unknown delay = likely daily quota exhausted for this model; try next model
      lastErr = err;
      continue;
    }

    throw err;
  }

  // All models in the chain exhausted with long/unknown quota delays — mark as permanent so
  // the outer provider loop skips to the next provider rather than pointlessly retrying.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (lastErr) (lastErr as any).code = "quota_exhausted";
  throw lastErr ?? new Error("Gemini: all models in fallback chain failed");
}

async function callAnthropic(resolved: ResolvedKey, data: string, mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<string | null> {
  const client = new Anthropic({ apiKey: resolved.key });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: "Extract all matchups from this screenshot." },
        ],
      },
    ],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : null;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * A permanent error means: this provider will never succeed on retry, AND we should try the
 * next configured provider. Quota exhaustion and auth errors are permanent; rate limits are not.
 *
 * For Gemini: a 429 with a short retryAfterMs is a transient RPM rate-limit (retryable).
 * A 429 where callGemini exhausted all models in its chain arrives with code="quota_exhausted"
 * and IS permanent for this provider slot.
 */
function isPermanentProviderError(err: unknown): boolean {
  const e = err as { status?: number; code?: string; retryAfterMs?: number };
  // Permanent quota/auth codes
  if (e?.code === "insufficient_quota" || e?.code === "quota_exhausted" || e?.code === "invalid_api_key") return true;
  if (e?.status === 401 || e?.status === 403) return true;
  // Gemini transient RPM rate-limit: has a short retry hint — NOT permanent
  if (e?.status === 429 && e?.retryAfterMs !== undefined && e.retryAfterMs < 30_000) return false;
  return false;
}

function isRateLimitError(err: unknown): boolean {
  const e = err as { status?: number; retryAfterMs?: number };
  // 429 is only retryable when it's a short transient delay (Gemini RPM) or standard rate limit
  if (e?.status === 429) return true;
  return (e?.status ?? 0) >= 500;
}

/** Return the delay to wait before the next retry attempt (ms). Uses provider hint when available. */
function retryDelayMs(err: unknown, attempt: number): number {
  const hint = (err as { retryAfterMs?: number })?.retryAfterMs;
  if (hint !== undefined && hint > 0 && hint < 30_000) {
    // Add a small buffer on top of the provider's own hint
    return Math.ceil(hint) + 200;
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class ScreenshotRecognitionUnavailableError extends Error {
  debugLog?: string[];
  constructor(message: string, debugLog?: string[]) {
    super(message);
    this.debugLog = debugLog;
  }
}

export async function recognizeMatchupScreenshot(imageBase64: string): Promise<RawScreenshotRecognitionWithDebug> {
  const providers = resolveAllKeys();
  const debugLog: string[] = [];

  const providerLabels = providers.map((p) => `${p.label}(${p.provider})`).join(", ");
  debugLog.push(`[INIT] ${providers.length} provider(s): ${providerLabels || "NONE"}`);

  if (providers.length === 0) {
    const msg = "No vision AI key configured (set SCREENSHOT_AI_KEY, ANTHROPIC_API_KEY, or the Replit OpenAI integration)";
    debugLog.push(`[ERROR] ${msg}`);
    throw new ScreenshotRecognitionUnavailableError(msg, debugLog);
  }

  const { data, mediaType, dataUrl } = parseImageBase64(imageBase64);
  const imageSizeKb = Math.round((data.length * 0.75) / 1024);
  debugLog.push(`[IMAGE] mediaType=${mediaType} estimatedSize≈${imageSizeKb}KB`);
  logger.info({ mediaType, imageSizeKb, providerCount: providers.length }, "Screenshot recognition starting");

  for (const resolved of providers) {
    debugLog.push(`[TRY] ${resolved.label} provider=${resolved.provider}${resolved.baseUrl ? " (proxy)" : ""}`);
    logger.info({ provider: resolved.provider, label: resolved.label, hasProxy: !!resolved.baseUrl }, "Screenshot recognition: trying provider");

    const RETRIES = 2;
    let lastErr: unknown;
    let triedAttempts = 0;

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      triedAttempts = attempt;
      try {
        const rawText =
          resolved.provider === "anthropic"
            ? await callAnthropic(resolved, data, mediaType)
            : resolved.provider === "gemini"
              ? await callGemini(resolved, data, mediaType)
              : await callOpenAI(resolved, dataUrl);

        const preview = rawText ? rawText.slice(0, 300).replace(/\n/g, "\\n") : "(null)";
        debugLog.push(`[RAW] attempt=${attempt} rawText="${preview}"`);
        logger.info({ attempt, provider: resolved.provider, label: resolved.label, rawPreview: preview }, "Screenshot recognition API call succeeded");

        const result = parseRecognitionResponse(rawText);
        debugLog.push(`[PARSED] matchups=${result.matchups.length} entries parsed from rawText`);
        for (const m of result.matchups) {
          debugLog.push(`  • player1="${m.player1Name}" player2="${m.player2Name}" event="${m.eventName}"`);
        }

        return { ...result, debugLog, rawText: rawText ?? undefined };
      } catch (err: unknown) {
        lastErr = err;
        const e = err as { status?: number; code?: string; message?: string };
        const errDesc = `status=${e?.status ?? "?"} code=${e?.code ?? "?"} msg="${String(e?.message ?? err).slice(0, 120)}"`;
        debugLog.push(`[FAIL] ${resolved.label} attempt=${attempt} ${errDesc}`);
        logger.warn({ err, attempt, provider: resolved.provider, label: resolved.label }, "Screenshot recognition attempt failed");

        if (isPermanentProviderError(err)) {
          debugLog.push(`[SKIP] ${resolved.label}: permanent error (quota/auth) — trying next provider`);
          break;
        }
        if (!isRateLimitError(err)) {
          debugLog.push(`[SKIP] ${resolved.label}: non-retryable error — trying next provider`);
          break;
        }
        if (attempt < RETRIES) {
          const delayMs = retryDelayMs(err, attempt);
          debugLog.push(`[RETRY] waiting ${delayMs}ms before retry ${attempt + 1}`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    debugLog.push(`[NEXT] exhausted ${resolved.label} after ${triedAttempts + 1} attempt(s), trying next provider`);
    void lastErr; // suppress unused-variable warning
  }

  logger.error({ providers: providers.map((p) => p.label), debugLog }, "All vision AI providers failed for screenshot recognition");
  const msg = `All ${providers.length} configured vision AI provider(s) failed — check debug log for details`;
  throw new ScreenshotRecognitionUnavailableError(msg, debugLog);
}
