import type { PlayerSummary, TennisDataProvider } from "./types";
import { searchKnownPlayers } from "./playerIdentity";
import { inferSurfaceAndLevel } from "./surfaceMap";
import type { RawScreenshotRecognition } from "./screenshotRecognition";

/**
 * Task #63: resolves the raw names/event read off a screenshot (screenshotRecognition.ts) against
 * real, already-trusted sources -- the same player search the manual "Search Players" flow uses,
 * and the same tournament-name -> surface/level table the rest of the prediction engine relies on
 * (surfaceMap.ts). Never fabricates a match: a recognized name only resolves to a player when
 * exactly one confident candidate exists; ambiguous or absent matches come back null with an
 * explanatory warning instead of guessing.
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

export interface ScreenshotMatchupResult {
  player1: ScreenshotPlayerMatch;
  player2: ScreenshotPlayerMatch;
  event: ScreenshotEventMatch;
  warnings: string[];
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
 * A candidate is a confident match when every word in the recognized name appears somewhere in
 * the candidate's full name -- handles a screenshot showing only a surname ("Alcaraz" ->
 * "Carlos Alcaraz") without requiring the reverse (a search result can have more words than the
 * screenshot showed).
 */
function isConfidentMatch(recognizedNorm: string, candidateNorm: string): boolean {
  if (!recognizedNorm) return false;
  if (recognizedNorm === candidateNorm) return true;
  const recognizedWords = recognizedNorm.split(" ").filter(Boolean);
  const candidateWords = new Set(candidateNorm.split(" ").filter(Boolean));
  return recognizedWords.length > 0 && recognizedWords.every((w) => candidateWords.has(w));
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

  const candidates = await searchKnownPlayers(provider, recognizedName);
  const norm = normalizeName(recognizedName);
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

export async function resolveScreenshotMatchup(
  provider: TennisDataProvider,
  raw: RawScreenshotRecognition,
): Promise<ScreenshotMatchupResult> {
  const warnings: string[] = [];

  const [player1, player2Initial] = await Promise.all([
    resolvePlayerMatch(provider, raw.player1Name, warnings, "Player 1"),
    resolvePlayerMatch(provider, raw.player2Name, warnings, "Player 2"),
  ]);

  // Guard against the same real player resolving for both slots (e.g. the screenshot's second
  // name was OCR'd to the same person, or the image only actually showed one player) -- never
  // silently duplicate one player into both slots.
  let player2 = player2Initial;
  if (player1.player && player2.player && player1.player.id === player2.player.id) {
    warnings.push(`Player 2 resolved to the same player as Player 1 -- please pick Player 2 manually from Search Players.`);
    player2 = { recognizedName: player2.recognizedName, player: null };
  }

  let { surface, level } = inferSurfaceAndLevel(raw.eventName);

  // The named table above deliberately never resolves Challenger/ITF-level events by name (see
  // surfaceMap.ts) because live fixtures get a much more reliable tournament_key -> surface
  // lookup instead. A screenshot import has no tournament_key at all -- only OCR'd text -- so
  // that reliable path is unavailable here. Fall back to a real name search against the
  // provider's own tournament data before giving up, rather than leaving every Challenger/ITF
  // screenshot import surface-less.
  if (raw.eventName && surface === null && provider.findTournamentSurfaceByName) {
    const found = await provider.findTournamentSurfaceByName(raw.eventName);
    if (found) {
      surface = found.surface;
      level = found.level ?? level;
    }
  }

  if (raw.eventName && surface === null) {
    warnings.push(`Read event "${raw.eventName}", but couldn't determine its surface -- please set surface/level manually.`);
  } else if (!raw.eventName) {
    warnings.push(`No event/tournament name could be read from the screenshot -- surface was not auto-detected.`);
  }

  return {
    player1,
    player2,
    event: { recognizedName: raw.eventName, surface, level },
    warnings,
  };
}
