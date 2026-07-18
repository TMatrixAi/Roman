import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../lib/logger";

/**
 * Task #63 / Task #20: reads a matchup screenshot (bracket, schedule, or another app's matchup
 * card) and extracts ALL visible player matchups plus the event/tournament name, using a vision-
 * capable model. Supports long screenshots with multiple match cards, dark/light mode, partial
 * cards, and varying font sizes.
 *
 * Key selection order (first that resolves wins):
 *   1. SCREENSHOT_AI_KEY (dedicated override — any provider, auto-detected by prefix)
 *   2. ANTHROPIC_API_KEY (user-provided — auto-detected by prefix)
 *   3. AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL (Replit integration)
 *
 * "Absent, not faked": any field the model isn't confident about comes back null rather than a
 * guess. A malformed or unparseable model response degrades gracefully into "found nothing".
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

const EMPTY_RECOGNITION: RawScreenshotRecognition = { matchups: [] };

const SYSTEM_PROMPT = `You read screenshots of tennis fixtures, schedules, brackets, or match-listing apps.

Extract ALL distinct matchups (pairs of tennis players facing each other) visible in the image.

For each matchup, extract:
- player1Name: first tennis player name in that pair (topmost or leftmost if side-by-side)
- player2Name: second tennis player name in that pair
- eventName: tournament or event name for that matchup (null if not visible; use the same event name for all matchups if they share one card/image)

Rules:
- Ignore betting odds, probability percentages, prices, team logos, country flags, decorative elements, and sponsored content. Extract player names only.
- If the image shows a full bracket or schedule, return EACH individual matchup row/card as a separate entry.
- For long scroll-images with multiple match cards stacked vertically, return each card as a separate entry.
- Only include entries where you can read at least one player name. Set unreadable fields to null.
- If both players in a matchup are unclear or unreadable, omit that matchup from the array.
- If the image is unrelated to tennis or completely unreadable, return an empty array.
- Prefer null over guessing for any field you cannot confidently read.

Respond with ONLY a strict JSON array, no markdown, no other text:
[{"player1Name": string|null, "player2Name": string|null, "eventName": string|null}, ...]`;

// ---------------------------------------------------------------------------
// Key / provider detection
// ---------------------------------------------------------------------------

type Provider = "openai" | "anthropic";

function detectProvider(key: string): Provider {
  return key.startsWith("sk-ant-") ? "anthropic" : "openai";
}

interface ResolvedKey {
  key: string;
  provider: Provider;
  /** For OpenAI: override base URL (Replit proxy). Undefined = use api.openai.com directly. */
  baseUrl?: string;
}

function resolveKey(): ResolvedKey | null {
  // 1. Dedicated override key (any provider)
  const dedicated = process.env.SCREENSHOT_AI_KEY;
  if (dedicated) return { key: dedicated, provider: detectProvider(dedicated) };

  // 2. User-provided key stored as ANTHROPIC_API_KEY (may actually be OpenAI sk-proj-)
  const userKey = process.env.ANTHROPIC_API_KEY;
  if (userKey) return { key: userKey, provider: detectProvider(userKey) };

  // 3. Replit OpenAI integration proxy
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const replitBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (replitKey && replitBase) return { key: replitKey, provider: "openai", baseUrl: replitBase };

  return null;
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
    logger.warn({ err, raw }, "Screenshot recognition model returned unparseable JSON -- treating as nothing recognized");
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
// Public API
// ---------------------------------------------------------------------------

export class ScreenshotRecognitionUnavailableError extends Error {}

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: string };
  // Quota exhaustion is a permanent billing error — never retry it.
  if (e?.code === "insufficient_quota") return false;
  const status = e?.status ?? 0;
  return status === 429 || status >= 500;
}

export async function recognizeMatchupScreenshot(imageBase64: string): Promise<RawScreenshotRecognition> {
  const resolved = resolveKey();
  if (!resolved) {
    throw new ScreenshotRecognitionUnavailableError("No vision AI key configured (set SCREENSHOT_AI_KEY, ANTHROPIC_API_KEY, or the Replit OpenAI integration)");
  }

  const { data, mediaType, dataUrl } = parseImageBase64(imageBase64);
  const RETRIES = 3;
  let lastErr: unknown;

  logger.info({ provider: resolved.provider, hasBaseUrl: !!resolved.baseUrl }, "Screenshot recognition starting");

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const rawText = resolved.provider === "anthropic"
        ? await callAnthropic(resolved, data, mediaType)
        : await callOpenAI(resolved, dataUrl);

      logger.info({ attempt, provider: resolved.provider }, "Screenshot recognition succeeded");
      return parseRecognitionResponse(rawText);
    } catch (err: unknown) {
      lastErr = err;
      if (!isRetryable(err)) break; // auth, bad request, etc — bail immediately
      if (attempt < RETRIES) {
        const delayMs = Math.min(1000 * 2 ** attempt, 10000);
        logger.warn({ err, attempt, delayMs, provider: resolved.provider }, "Screenshot recognition rate-limited, retrying");
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  logger.error({ err: lastErr, provider: resolved.provider }, "Vision AI provider call failed for screenshot matchup recognition");
  throw new ScreenshotRecognitionUnavailableError("Vision AI provider unavailable");
}
