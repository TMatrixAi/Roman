import type { PlayerSummary, TennisDataProvider } from "./types";
import { searchKnownPlayers } from "./playerIdentity";
import { inferSurfaceAndLevel } from "./surfaceMap";
import type { RawScreenshotRecognition, RawMatchupEntry } from "./screenshotRecognition";

/**
 * Task #63 / Task #20: resolves the raw names/event read off a screenshot
 * (screenshotRecognition.ts) against real, already-trusted sources -- the same player search
 * the manual "Search Players" flow uses, and the same tournament-name -> surface/level table the
 * rest of the prediction engine relies on (surfaceMap.ts).
 *
 * Supports images containing multiple matchups (long screenshots, bracket pages): each entry in
 * the input recognition is resolved independently so that a single unresolvable matchup never
 * blocks the rest.
 *
 * Never fabricates a match: a recognized name only resolves to a player when exactly one
 * confident candidate exists; ambiguous or absent matches come back null with an explanatory
 * warning instead of guessing.
 */

export interface ScreenshotPlayerMatch {
  recognizedName: string | null;
  player: PlayerSummary | null;
}

export interface ScreenshotEventMatch {
  recognizedName: string | null;
  surface: import("./types").Surface | null;
  level: import("./types").TournamentLevel | null;
}

export interface ScreenshotMatchupEntry {
  player1: ScreenshotPlayerMatch;
  player2: ScreenshotPlayerMatch;
  event: ScreenshotEventMatch;
  /** True when both players were confidently resolved to real players. */
  resolved: boolean;
  /** Per-matchup warnings for anything not confidently resolved in this specific entry. */
  warnings: string[];
}

export interface ScreenshotMatchupResult {
  /** Primary matchup (first recognized entry, or the only one). Kept for backward compatibility. */
  player1: ScreenshotPlayerMatch;
  player2: ScreenshotPlayerMatch;
  event: ScreenshotEventMatch;
  warnings: string[];
  /**
   * All matchups extracted from the screenshot. Includes the primary player1/player2/event as
   * matchups[0]. Present only when the image contained at least one matchup (may be length 1 for
   * a single-matchup image).
   */
  matchups?: ScreenshotMatchupEntry[];
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents so "Alcaraz" matches "Alcaráz"-style OCR variance
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when word `a` can be considered a match for word `b` using one of:
 *   - exact equality
 *   - `a` is a single-letter initial that is the first letter of `b`  (e.g. "p" matches "paula")
 *   - `b` is a single-letter initial that is the first letter of `a`  (e.g. "paula" matches "p")
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 && b.length > 1 && b[0] === a) return true; // a is initial of b
  if (b.length === 1 && a.length > 1 && a[0] === b) return true; // b is initial of a
  return false;
}

/**
 * A candidate is a confident match in two complementary directions:
 *
 * Forward (recognized ⊆ candidate, with initial expansion):
 *   Every word in the recognized name matches some word in the candidate. Handles a screenshot
 *   showing only a surname ("Alcaraz" → "Carlos Alcaraz") and also handles the case where the
 *   DB stores an abbreviated initial that the OCR read as a full first name ("paula" matches "p").
 *
 * Reverse (candidate ⊆ recognized, with initial expansion):
 *   Every word in the candidate matches some word in the recognized name. Handles OCR reading the
 *   player's full formal name while the DB stores an abbreviated version ("P. Badosa" ←
 *   "Paula Badosa", "M. Sherif" ← "Maiar Sherif Ahmed Abdelaziz"). Only applied when the
 *   recognized name is at least as long as the candidate, so we never loosen a shorter OCR read.
 */
function isConfidentMatch(recognizedNorm: string, candidateNorm: string): boolean {
  if (!recognizedNorm) return false;
  if (recognizedNorm === candidateNorm) return true;

  const rWords = recognizedNorm.split(" ").filter(Boolean);
  const cWords = candidateNorm.split(" ").filter(Boolean);
  if (rWords.length === 0 || cWords.length === 0) return false;

  // Forward: every recognized word matches some candidate word
  if (rWords.every((rw) => cWords.some((cw) => wordsMatch(rw, cw)))) return true;

  // Reverse: every candidate word matches some recognized word (recognized is longer or equal)
  if (rWords.length >= cWords.length && cWords.every((cw) => rWords.some((rw) => wordsMatch(cw, rw)))) return true;

  return false;
}

/**
 * Search for players matching recognizedName.
 *
 * Primary: search by the full name (handles exact DB entries and live standings).
 * Fallback: when the primary returns no confident matches, retry searching by each word of the
 *   recognized name in reverse order (surname first). This handles abbreviated DB entries like
 *   "P. Badosa" when the OCR read "Paula Badosa": searching "Badosa" finds "P. Badosa", then
 *   isConfidentMatch verifies it via the reverse-initial path.
 */
async function gatherCandidates(provider: TennisDataProvider, recognizedName: string): Promise<PlayerSummary[]> {
  const norm = normalizeName(recognizedName);

  // Primary search
  const primary = await searchKnownPlayers(provider, recognizedName);
  const primaryConfident = primary.filter((c) => isConfidentMatch(norm, normalizeName(c.name)));
  if (primaryConfident.length > 0) return primary; // primary found at least one confident match

  // Word-by-word fallback (surname first — most distinctive, fewest false positives)
  const words = recognizedName.trim().split(/\s+/).filter((w) => w.length >= 3).reverse();
  const accumulated = new Map<string, PlayerSummary>();
  for (const p of primary) accumulated.set(p.id, p); // keep primary results too

  for (const word of words) {
    const wordResults = await searchKnownPlayers(provider, word);
    for (const c of wordResults) {
      if (!accumulated.has(c.id)) accumulated.set(c.id, c);
    }
    // Stop as soon as we have at least one confident match in the accumulated set
    const hasConfident = Array.from(accumulated.values()).some((c) => isConfidentMatch(norm, normalizeName(c.name)));
    if (hasConfident) break;
  }

  return Array.from(accumulated.values());
}

async function resolvePlayerMatch(
  provider: TennisDataProvider,
  recognizedName: string | null,
  warnings: string[],
  label: "Player 1" | "Player 2",
): Promise<ScreenshotPlayerMatch> {
  if (!recognizedName) {
    warnings.push(`${label} could not be read from the screenshot -- use Search Players to add them manually.`);
    return { recognizedName: null, player: null };
  }

  const norm = normalizeName(recognizedName);
  const candidates = await gatherCandidates(provider, recognizedName);
  const confident = candidates.filter((c) => isConfidentMatch(norm, normalizeName(c.name)));

  if (confident.length === 1) {
    return { recognizedName, player: confident[0] };
  }

  if (confident.length > 1) {
    warnings.push(`Read "${recognizedName}" for ${label}, but multiple matching players were found -- please select the right one from Search Players.`);
  } else {
    warnings.push(`Read "${recognizedName}" for ${label}, but couldn't confidently match them to a known player -- please use Search Players.`);
  }
  return { recognizedName, player: null };
}

async function resolveEventMatch(
  provider: TennisDataProvider,
  eventName: string | null,
  warnings: string[],
): Promise<ScreenshotEventMatch> {
  let { surface, level } = inferSurfaceAndLevel(eventName);

  // The named table deliberately never resolves Challenger/ITF-level events by name (see
  // surfaceMap.ts) because live fixtures get a tournament_key -> surface lookup instead. A
  // screenshot import has no tournament_key, so fall back to a real name search before giving up.
  if (eventName && surface === null && provider.findTournamentSurfaceByName) {
    const found = await provider.findTournamentSurfaceByName(eventName);
    if (found) {
      surface = found.surface;
      level = found.level ?? level;
    }
  }

  if (eventName && surface === null) {
    warnings.push(`Read event "${eventName}", but couldn't determine its surface -- please set surface/level manually.`);
  } else if (!eventName) {
    warnings.push(`No event/tournament name could be read from the screenshot -- surface was not auto-detected.`);
  }

  return { recognizedName: eventName, surface, level };
}

/** Resolves one raw matchup entry to real players and event info. */
async function resolveOneMatchup(
  provider: TennisDataProvider,
  entry: RawMatchupEntry,
): Promise<ScreenshotMatchupEntry> {
  const warnings: string[] = [];

  const [player1, player2Initial] = await Promise.all([
    resolvePlayerMatch(provider, entry.player1Name, warnings, "Player 1"),
    resolvePlayerMatch(provider, entry.player2Name, warnings, "Player 2"),
  ]);

  // Guard against the same real player resolving for both slots.
  let player2 = player2Initial;
  if (player1.player && player2.player && player1.player.id === player2.player.id) {
    warnings.push(`Player 2 resolved to the same player as Player 1 -- please pick Player 2 manually from Search Players.`);
    player2 = { recognizedName: player2.recognizedName, player: null };
  }

  const event = await resolveEventMatch(provider, entry.eventName, warnings);

  const resolved = !!player1.player && !!player2.player;
  return { player1, player2, event, resolved, warnings };
}

export async function resolveScreenshotMatchup(
  provider: TennisDataProvider,
  raw: RawScreenshotRecognition,
): Promise<ScreenshotMatchupResult> {
  if (raw.matchups.length === 0) {
    // Nothing recognized -- return a result with empty/null fields and a single warning.
    const noData: ScreenshotPlayerMatch = { recognizedName: null, player: null };
    const noEvent: ScreenshotEventMatch = { recognizedName: null, surface: null, level: null };
    return {
      player1: noData,
      player2: noData,
      event: noEvent,
      warnings: ["No matchups could be read from this screenshot -- use Search Players to add them manually."],
      matchups: [],
    };
  }

  // Resolve each matchup concurrently (capped: each already fans out to 2-3 provider calls).
  const resolvedEntries = await Promise.all(
    raw.matchups.map((entry) => resolveOneMatchup(provider, entry)),
  );

  // Primary slot: the first resolved entry (for backward compatibility with existing callers
  // that only look at player1/player2/event/warnings at the top level).
  const primary = resolvedEntries[0];

  // Aggregate top-level warnings: primary entry's warnings, plus a summary for unresolved extras.
  const topWarnings = [...primary.warnings];
  const unresolvedCount = resolvedEntries.slice(1).filter((e) => !e.resolved).length;
  if (unresolvedCount > 0) {
    topWarnings.push(
      `${unresolvedCount} additional matchup${unresolvedCount === 1 ? "" : "s"} from this screenshot could not be fully resolved -- check the items below.`,
    );
  }

  return {
    player1: primary.player1,
    player2: primary.player2,
    event: primary.event,
    warnings: topWarnings,
    matchups: resolvedEntries,
  };
}
