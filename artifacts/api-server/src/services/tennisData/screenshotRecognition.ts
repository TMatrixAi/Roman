import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";

/**
 * Task #63: reads a matchup screenshot (bracket, schedule, or another app's matchup card) and
 * extracts up to two distinct player names plus an event/tournament name, using a vision-capable
 * model. This module ONLY does raw extraction from the image -- it never looks anything up
 * against real player/tournament data itself (see screenshotMatchupResolver.ts for that), so a
 * misread name surfaces as a wrong string here rather than a wrong resolved player there.
 *
 * "Absent, not faked": any field the model isn't confident about comes back null rather than a
 * guess -- the prompt explicitly tells the model to prefer null over guessing, and a malformed or
 * unparseable model response is treated as "found nothing" rather than thrown as a hard error,
 * so an unrelated/unreadable image degrades gracefully into "fill this in manually" instead of a
 * confusing failure.
 */

export interface RawScreenshotRecognition {
  player1Name: string | null;
  player2Name: string | null;
  eventName: string | null;
}

const EMPTY_RECOGNITION: RawScreenshotRecognition = { player1Name: null, player2Name: null, eventName: null };

const SYSTEM_PROMPT = `You read screenshots of tennis matchups (brackets, schedules, or another app's matchup card).
From the image, extract:
- player1Name: the first (topmost, or left-most if side-by-side) of up to two distinct tennis PLAYER names visible.
- player2Name: the second distinct tennis PLAYER name, if a second one is clearly visible.
- eventName: the tournament/event name, if visible (e.g. "Wimbledon", "Miami Open", "ATP Finals"). This is NEVER a player's name.

Rules:
- Player names and the event name are different things. Never put a tournament/event name in a player field, and never put a player's name in the event field.
- If you cannot confidently read a field, or the image does not clearly show it, set that field to null. Do not guess.
- If the image shows more than two players (e.g. a full bracket), only extract the two players who are directly matched against each other in the specific matchup being highlighted; if that's ambiguous, return null for both player fields.
- If the image is unrelated to tennis or unreadable, return null for all three fields.

Respond with ONLY strict JSON, no other text, in exactly this shape:
{"player1Name": string|null, "player2Name": string|null, "eventName": string|null}`;

function toImageDataUrl(imageBase64: string): string {
  return imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;
}

function parseRecognitionResponse(raw: string | null | undefined): RawScreenshotRecognition {
  if (!raw) return EMPTY_RECOGNITION;

  // Models occasionally wrap JSON in a code fence despite instructions -- strip it defensively
  // rather than failing the whole request over formatting.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<RawScreenshotRecognition>;
    const clean = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
    return {
      player1Name: clean(parsed.player1Name),
      player2Name: clean(parsed.player2Name),
      eventName: clean(parsed.eventName),
    };
  } catch (err) {
    logger.warn({ err, raw }, "Screenshot recognition model returned unparseable JSON -- treating as nothing recognized");
    return EMPTY_RECOGNITION;
  }
}

export class ScreenshotRecognitionUnavailableError extends Error {}

/**
 * Calls the vision model on the uploaded image. Throws ScreenshotRecognitionUnavailableError only
 * for genuine provider/network failures (worth a 502) -- a low-confidence or empty read from a
 * real response is NOT an error, it's a valid "found nothing" result.
 */
export async function recognizeMatchupScreenshot(imageBase64: string): Promise<RawScreenshotRecognition> {
  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the player names and event name from this screenshot." },
            { type: "image_url", image_url: { url: toImageDataUrl(imageBase64) } },
          ],
        },
      ],
    });
  } catch (err) {
    logger.error({ err }, "Vision AI provider call failed for screenshot matchup recognition");
    throw new ScreenshotRecognitionUnavailableError("Vision AI provider unavailable");
  }

  return parseRecognitionResponse(response.choices[0]?.message?.content);
}
