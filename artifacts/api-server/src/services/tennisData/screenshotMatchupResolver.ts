import type { PlayerSummary, TennisDataProvider } from "./types";
import { searchKnownPlayers } from "./playerIdentity";
import { inferSurfaceAndLevel } from "./surfaceMap";
import type { RawScreenshotRecognition, RawMatchupEntry } from "./screenshotRecognition";

/**
 * Resolves raw names/event read off a screenshot against real trusted sources --
 * the same player search the manual "Search Players" flow uses.
 *
 * Supports images containing multiple matchups (long screenshots, bracket pages):
 * each entry is resolved independently so a single unresolvable matchup never
 * blocks the rest.
 *
 * Never fabricates a match: a recognized name only resolves to a player when
 * exactly one confident candidate exists; ambiguous or absent matches come back
 * null with an explanatory warning instead of guessing.
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
  /** Per-matchup warnings for anything not confidently resolved in this entry. */
  warnings: string[];
}

export interface ScreenshotMatchupResult {
  /** Primary matchup (first recognized entry). Kept for backward compatibility. */
  player1: ScreenshotPlayerMatch;
  player2: ScreenshotPlayerMatch;
  event: ScreenshotEventMatch;
  warnings: string[];
  /**
   * All matchups extracted from the screenshot. Includes the primary as matchups[0].
   */
  matchups?: ScreenshotMatchupEntry[];
}

// ── OCR metadata stripping ────────────────────────────────────────────────
//
// Draw sheets attach tokens to player names that are NOT part of the name:
//   - Draw status:   (WC) (Q) (LL) (ALT) (SE) (PR)  — wild card, qualifier, etc.
//   - Seed:          #3   [12]
//   - Birth year:    2004  (for juniors)
//   - Name suffixes: Jr.  Sr.  II  III  IV
//   - Trailing initial: "Tom Miyoshi B."
//   - OCR noise:     zero-width spaces, emoji, control chars
//
// stripOcrMetadata removes these before any matching attempt, while
// resolvePlayerMatch preserves the ORIGINAL OCR text for display and debugging.

const DRAW_STATUS_TOKENS = ["WC", "Q", "LL", "ALT", "SE", "PR", "ITR", "PTR", "IDP"];
const DRAW_STATUS_SET = new Set(DRAW_STATUS_TOKENS.map((t) => t.toLowerCase()));

function stripOcrMetadata(raw: string): string {
  // 1. Remove invisible / control / zero-width characters
  let s = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\ufeff]/g, " ")
    // Emoji and misc BMP symbols (keep letters, digits, spaces, and common name punctuation).
    // NOTE: \uXXXX notation only supports 4-digit code points; supplementary-plane emoji
    // (U+1F000+) are not listed here because \u1F000 without braces would create a
    // broken character range covering ASCII. normalizeName() strips any remaining
    // non-ASCII noise after this step.
    .replace(/[\u2600-\u27FF\u2B00-\u2BFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 2. Parenthesized/bracketed draw-status tokens: (WC) [Q] (LL) (ALT) (SE) (PR)
  s = s.replace(/\s*[\[(]\s*([A-Za-z]{1,5})\s*[\])]\s*/g, (match, token) => {
    return DRAW_STATUS_SET.has(token.toLowerCase()) ? " " : match;
  });

  // 3. Trailing birth year (realistic range for tennis players: 1960–2015)
  s = s.replace(/\s+\b(19[6-9]\d|200\d|201[0-5])\b\s*$/, "");

  // 4. Trailing seed/draw-position: #3  #12
  s = s.replace(/\s+#\d{1,3}\s*$/, "");

  // 5. Trailing standalone draw-status tokens (not in parens)
  const statusPattern = new RegExp(`\\s+\\b(${DRAW_STATUS_TOKENS.join("|")})\\b\\s*$`, "i");
  s = s.replace(statusPattern, "");

  // 6. Trailing name suffixes: Jr Jr. Sr Sr. II III IV V VI VII VIII IX
  //    Roman numerals are almost never part of a player's competition name.
  s = s.replace(/\s+\b(jr\.?|sr\.?|ii|iii|iv|ix|vi{0,3}|v)\b\.?\s*$/i, "");

  // 7. Trailing single uppercase initial + optional period, when ≥3 name words remain.
  //    "Tom Miyoshi B."  →  "Tom Miyoshi"
  //    "Tom Miyoshi B. 2004" has already lost "2004" above, so this catches "B."
  const words = s.trim().split(/\s+/);
  if (words.length >= 3 && /^[A-Z]\.?$/.test(words[words.length - 1])) {
    s = words.slice(0, -1).join(" ");
  }

  return s.replace(/\s+/g, " ").trim();
}

// ── Name normalization ─────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics (accents, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")    // keep only ASCII letters, digits, spaces
    .replace(/\s+/g, " ")
    .trim();
}

// ── Word-level matching ────────────────────────────────────────────────────

/**
 * Returns true when two normalized name tokens should be treated as the same word.
 *
 * Three match strategies:
 *   1. Exact equality
 *   2. Initial expansion — a single letter is an initial of any word starting with it
 *      ("p" matches "paula", "g" matches "goncalo")
 *   3. Transliteration tolerance — for words of 4+ chars, allow 1-char substitution.
 *      Covers common romanization variants ("maiar" ↔ "mayar", Arabic ai/ay),
 *      Eastern European transliterations, and single OCR misreads.
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Initial expansion (bidirectional)
  if (a.length === 1 && b.length > 1 && b[0] === a) return true;
  if (b.length === 1 && a.length > 1 && a[0] === b) return true;
  // Transliteration/OCR tolerance: 1-char substitution for words of ≥4 chars
  if (a.length >= 4 && a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    if (diffs === 1) return true;
  }
  return false;
}

/**
 * Greedy bijective match: every needle consumes exactly one distinct haystack slot.
 *
 * This prevents the "C. Castro" false positive against "Goncalo Da Rosa Castro":
 * the initial "c" would consume "castro", leaving no slot for the explicit "castro"
 * token in the candidate, so the match correctly fails.
 *
 * Without bijection, both "c" and "castro" would independently match "castro" via
 * some(), making "C. Castro" look like a confident match for any "... da Rosa Castro".
 */
function bijectiveMatch(needles: string[], haystack: string[]): boolean {
  const used = new Set<number>();
  for (const needle of needles) {
    let found = false;
    for (let i = 0; i < haystack.length; i++) {
      if (!used.has(i) && wordsMatch(needle, haystack[i])) {
        used.add(i);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * A candidate is a confident match in one of two complementary directions:
 *
 * Forward (recognized ⊆ candidate, bijective):
 *   Every recognized word consumes a distinct candidate word.
 *   Handles a screenshot showing only a surname ("Alcaraz" → "Carlos Alcaraz").
 *
 * Reverse (candidate ⊆ recognized, bijective):
 *   Every candidate word consumes a distinct recognized word.
 *   Handles OCR reading the full formal name while the DB stores an abbreviated
 *   version ("P. Badosa" ← "Paula Badosa", "M. Sherif" ← "Maiar Sherif Ahmed Abdelaziz").
 *   Only applied when the recognized name is at least as long as the candidate, so
 *   we never loosen a shorter OCR read.
 *
 * Bijection in the reverse direction prevents "C. Castro" from matching
 * "Goncalo Da Rosa Castro" — the initial "c" and "castro" would both need to
 * consume "castro", which bijection disallows.
 */
function isConfidentMatch(recognizedNorm: string, candidateNorm: string): boolean {
  if (!recognizedNorm) return false;
  if (recognizedNorm === candidateNorm) return true;

  const rWords = recognizedNorm.split(" ").filter(Boolean);
  const cWords = candidateNorm.split(" ").filter(Boolean);
  if (rWords.length === 0 || cWords.length === 0) return false;

  // Forward: every recognized word bijectively matches some candidate word
  if (bijectiveMatch(rWords, cWords)) return true;

  // Reverse: every candidate word bijectively matches some recognized word
  if (rWords.length >= cWords.length && bijectiveMatch(cWords, rWords)) return true;

  return false;
}

// ── Candidate gathering ────────────────────────────────────────────────────

/**
 * Gathers player candidates for a recognized name.
 *
 * Primary: search by the full name (handles exact DB entries and live standings).
 * Fallback: when the primary returns no confident matches, retry searching by each
 *   word of the name in reverse order (surname first). This handles abbreviated DB
 *   entries like "P. Badosa" when the OCR read "Paula Badosa": searching "Badosa"
 *   finds "P. Badosa", then isConfidentMatch verifies it via the reverse path.
 */
async function gatherCandidates(provider: TennisDataProvider, searchName: string): Promise<PlayerSummary[]> {
  const norm = normalizeName(searchName);

  // Primary search
  const primary = await searchKnownPlayers(provider, searchName);
  const primaryConfident = primary.filter((c) => isConfidentMatch(norm, normalizeName(c.name)));
  if (primaryConfident.length > 0) return primary;

  // Word-by-word fallback (surname first — most distinctive, fewest false positives)
  const words = searchName.trim().split(/\s+/).filter((w) => w.length >= 3).reverse();
  const accumulated = new Map<string, PlayerSummary>();
  for (const p of primary) accumulated.set(p.id, p);

  for (const word of words) {
    const wordResults = await searchKnownPlayers(provider, word);
    for (const c of wordResults) {
      if (!accumulated.has(c.id)) accumulated.set(c.id, c);
    }
    // Stop as soon as at least one confident match exists in the accumulated set
    const hasConfident = Array.from(accumulated.values()).some((c) => isConfidentMatch(norm, normalizeName(c.name)));
    if (hasConfident) break;
  }

  return Array.from(accumulated.values());
}

// ── Player resolution ──────────────────────────────────────────────────────

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

  // Strip OCR draw-sheet metadata (seeds, status tokens, birth years, etc.) before
  // matching. The original recognizedName is preserved for display and debugging.
  const searchName = stripOcrMetadata(recognizedName);
  const norm = normalizeName(searchName);

  const candidates = await gatherCandidates(provider, searchName);
  const confident = candidates.filter((c) => isConfidentMatch(norm, normalizeName(c.name)));

  if (confident.length === 1) {
    return { recognizedName, player: confident[0] };
  }

  if (confident.length > 1) {
    // When multiple candidates pass the confidence check, prefer the one whose
    // stored name has the MOST words — a longer/more-specific stored name covers
    // more of the recognized name and is the more precise identity.
    //
    // Example: "G. Da Rosa Castro" (4 words) beats "G. Castro" (2 words) for
    // "Goncalo Da Rosa Castro". If this doesn't produce a unique winner (tied word
    // count), report ambiguity and let the user pick.
    const scored = confident
      .map((c) => ({ c, score: normalizeName(c.name).split(" ").filter(Boolean).length }))
      .sort((a, b) => b.score - a.score);

    if (scored[0].score > scored[1].score) {
      // Unambiguous best candidate — auto-select
      return { recognizedName, player: scored[0].c };
    }

    warnings.push(
      `Read "${recognizedName}" for ${label}, but multiple matching players were found -- please select the right one from Search Players.`,
    );
  } else {
    warnings.push(
      `Read "${recognizedName}" for ${label}, but couldn't confidently match them to a known player -- please use Search Players.`,
    );
  }
  return { recognizedName, player: null };
}

// ── Event resolution ───────────────────────────────────────────────────────

async function resolveEventMatch(
  provider: TennisDataProvider,
  eventName: string | null,
  warnings: string[],
): Promise<ScreenshotEventMatch> {
  let { surface, level } = inferSurfaceAndLevel(eventName);

  // The named table never resolves Challenger/ITF events by name (see surfaceMap.ts)
  // because live fixtures get a tournament_key → surface lookup instead.
  // A screenshot import has no tournament_key, so fall back to a real name search.
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

// ── Top-level resolution ───────────────────────────────────────────────────

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

  // Resolve each matchup concurrently
  const resolvedEntries = await Promise.all(
    raw.matchups.map((entry) => resolveOneMatchup(provider, entry)),
  );

  // Primary slot: first resolved entry (backward compatibility)
  const primary = resolvedEntries[0];

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
