import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess, isRateLimitError, isQuotaExhaustedError } from "@workspace/integrations-openai-ai-server/batch";
import { logger } from "../../lib/logger";

/**
 * Task #63 / Task #20: reads a matchup screenshot (bracket, schedule, or another app's matchup
 * card) and extracts ALL visible player matchups plus the event/tournament name, using a vision-
 * capable model. Supports long screenshots with multiple match cards, dark/light mode, partial
 * cards, and varying font sizes.
 *
 * This module ONLY does raw extraction from the image -- it never looks anything up against real
 * player/tournament data itself (see screenshotMatchupResolver.ts for that), so a misread name
 * surfaces as a wrong string here rather than a wrong resolved player there.
 *
 * "Absent, not faked": any field the model isn't confident about comes back null rather than a
 * guess -- the prompt explicitly tells the model to prefer null over guessing. A malformed or
 * unparseable model response is treated as "found nothing" rather than thrown as a hard error,
 * so an unrelated/unreadable image degrades gracefully into "fill this in manually" instead of a
 * confusing failure.
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

function toImageDataUrl(imageBase64: string): string {
  return imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;
}

function cleanEntry(obj: unknown): RawMatchupEntry | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const clean = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  const player1Name = clean(o.player1Name);
  const player2Name = clean(o.player2Name);
  // Skip entries where both player names are null — nothing useful to resolve.
  if (player1Name === null && player2Name === null) return null;
  return { player1Name, player2Name, eventName: clean(o.eventName) };
}

function parseRecognitionResponse(raw: string | null | undefined): RawScreenshotRecognition {
  if (!raw) return EMPTY_RECOGNITION;

  // Models occasionally wrap JSON in a code fence despite instructions -- strip defensively.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);

    // New format: array of matchup entries
    if (Array.isArray(parsed)) {
      const matchups: RawMatchupEntry[] = [];
      for (const item of parsed) {
        const entry = cleanEntry(item);
        if (entry) matchups.push(entry);
      }
      return { matchups };
    }

    // Legacy / fallback: single object format (older model outputs). Treat as one-element array.
    if (parsed && typeof parsed === "object") {
      const entry = cleanEntry(parsed);
      return { matchups: entry ? [entry] : [] };
    }
  } catch (err) {
    logger.warn({ err, raw }, "Screenshot recognition model returned unparseable JSON -- treating as nothing recognized");
  }

  return EMPTY_RECOGNITION;
}

export class ScreenshotRecognitionUnavailableError extends Error {}

/**
 * Calls the vision model on the uploaded image. Returns all matchups found. Throws
 * ScreenshotRecognitionUnavailableError only for genuine provider/network failures (worth a 502)
 * -- a low-confidence or empty read from a real response is NOT an error, it's a valid "found
 * nothing" result (empty matchups array).
 *
 * Task: a bulk upload (up to 20 screenshots) fires one of these per screenshot as a separate HTTP
 * request. `batchProcess` wraps the single call with retry+backoff for rate-limit errors, so a
 * 429 here is retried transparently instead of surfacing as a failure.
 */
export async function recognizeMatchupScreenshot(imageBase64: string): Promise<RawScreenshotRecognition> {
  let response;
  try {
    [response] = await batchProcess(
      [imageBase64],
      (image) =>
        openai.chat.completions.create({
          model: "gpt-4o",
          max_completion_tokens: 800,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all matchups from this screenshot." },
                { type: "image_url", image_url: { url: toImageDataUrl(image) } },
              ],
            },
          ],
        }),
      { concurrency: 1, retries: 5 },
    );
  } catch (err) {
    const rateLimited = isRateLimitError(err);
    const quotaExhausted = isQuotaExhaustedError(err);
    logger.error({ err, rateLimited, quotaExhausted }, "Vision AI provider call failed for screenshot matchup recognition");
    const detail = quotaExhausted
      ? "Vision AI quota exhausted — check OpenAI billing"
      : "Vision AI provider unavailable";
    throw new ScreenshotRecognitionUnavailableError(detail);
  }

  return parseRecognitionResponse(response.choices[0]?.message?.content);
}
