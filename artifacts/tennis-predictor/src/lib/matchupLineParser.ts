/**
 * Task #110 / Task #20: tolerant parsing of pasted matchup lines like "Player A vs Player B — Tournament"
 * into a structured shape. Real pasted lists vary in separator style (em dash, hyphen, "@", "in"
 * for the tournament; "vs", "vs.", "v", "versus", "-", "—" for the players), so this never assumes an exact
 * template -- it only reports a parsed shape when it can confidently find the vs-split, and always
 * flags lines it can't split rather than guessing.
 */

export interface ParsedMatchupLine {
  raw: string
  /** Non-null only when the line could be split into exactly two player names. */
  playerAName: string | null
  playerBName: string | null
  /** Present only when the line had a recognizable trailing tournament segment. */
  tournamentName: string | null
  /** Set when the line could not be split into two player names -- never guessed. */
  parseError: string | null
}

// Ordered longest-separator-first so "vs." isn't left with a trailing period matched separately,
// and so multi-char separators aren't shadowed by a shorter one that happens to be a substring.
const VS_SEPARATOR_PATTERN = /\s+(?:vs\.?|versus|v\.)\s+/i

// Leading bullet/list markers from pasted rendered lists: "*", "-", "•", or a leading "1." / "1)"
// numbering. These are stripped before splitting so the marker never leaks into `playerAName`
// (e.g. "* Murphy Cassone vs. Tristan Schoolkate" must not parse playerAName as "* Murphy Cassone").
// A leading "-" marker is only stripped when followed by whitespace, so a genuinely hyphenated
// leading name segment is never mistaken for a marker.
const LEADING_LIST_MARKER_PATTERN = /^(?:[*•]|-(?=\s)|\d+[.)])\s*/

function stripLeadingListMarker(line: string): string {
  return line.replace(LEADING_LIST_MARKER_PATTERN, "").trim()
}

// Parenthetical tournament suffix: "A vs B (Wimbledon)" → strip "(Wimbledon)" and use as tournament.
// Must be at the very end of the line (trailing). Only strips when the paren content is non-empty.
const PAREN_TOURNAMENT_PATTERN = /\s*\(([^)]+)\)\s*$/

// A bare " v " or " - " is ambiguous with hyphenated player names (e.g. "Auger-Aliassime" would
// never appear, but "Auger-Aliassime vs Bonzi" must not be split on the surname's own hyphen), so
// these looser separators are only tried once the primary VS_SEPARATOR_PATTERN fails to match.
// Em dash and en dash are included here as last-resort player separators (see splitTournament below
// for why they are normally tried as tournament separators first, and when they fall through).
const LOOSE_VS_SEPARATOR_PATTERN = /\s+(?:v|[—–]|-)\s+/i

// Tried in order; each one splits on its LAST occurrence in the line (the tournament segment is
// always trailing), so a hyphenated player surname earlier in the line (e.g.
// "Auger-Aliassime vs Bonzi - Halle Open") is never mistaken for the tournament separator itself.
// Em dash / en dash and "@"/"at"/"in" are unambiguous; the plain " - " variant is tried last
// since it's the one most likely to collide with a genuinely hyphenated name.
const TOURNAMENT_SEPARATOR_PATTERNS = [/[—–]/g, /\s+@\s+/gi, /\s+\bat\b\s+/gi, /\s+\bin\b\s+/gi, /\s+-\s+/g]

function lastMatch(pattern: RegExp, line: string): RegExpExecArray | null {
  let last: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    last = match
  }
  return last
}

/**
 * Handles "Last, First" reversed names by flipping at the comma.
 * e.g. "Djokovic, Novak" → "Novak Djokovic"
 *      "del Potro, Juan Martin" → "Juan Martin del Potro"
 * Only flips when there is exactly one comma -- multiple commas are left as-is (too ambiguous).
 */
function normalizePlayerName(name: string): string {
  const commaIdx = name.indexOf(",")
  if (commaIdx === -1) return name
  // Multiple commas -- don't attempt to flip, too ambiguous
  if (name.indexOf(",", commaIdx + 1) !== -1) return name
  const lastName = name.slice(0, commaIdx).trim()
  const firstName = name.slice(commaIdx + 1).trim()
  if (!lastName || !firstName) return name
  return `${firstName} ${lastName}`
}

function splitPlayers(matchPart: string): [string, string] | null {
  const primary = VS_SEPARATOR_PATTERN.exec(matchPart)
  const pattern = primary ?? LOOSE_VS_SEPARATOR_PATTERN.exec(matchPart)
  if (!pattern) return null

  const playerAName = normalizePlayerName(matchPart.slice(0, pattern.index).trim())
  const playerBName = normalizePlayerName(matchPart.slice(pattern.index + pattern[0].length).trim())
  if (!playerAName || !playerBName) return null
  return [playerAName, playerBName]
}

/**
 * Splits a line into the match-describing part and an optional trailing tournament name.
 * Em dash / en dash are only used as tournament separators when the part before them already
 * contains a player-vs-player separator -- if they don't (e.g. "Alcaraz — Sinner" with no "vs"),
 * they fall through so LOOSE_VS_SEPARATOR_PATTERN can pick them up as the player separator instead.
 */
function splitTournament(line: string): { matchPart: string; tournamentName: string | null } {
  for (const pattern of TOURNAMENT_SEPARATOR_PATTERNS) {
    const match = lastMatch(pattern, line)
    if (match && match.index > 0) {
      const matchPart = line.slice(0, match.index).trim()
      const tournamentName = line.slice(match.index + match[0].length).trim()
      if (matchPart && tournamentName) {
        // Em dash / en dash: only use as tournament separator when the match part itself already
        // has some player separator (VS-type or LOOSE, including another em dash). If not -- e.g.
        // "Alcaraz — Sinner" where the em dash IS the only separator and IS the player separator
        // -- fall through so LOOSE_VS_SEPARATOR_PATTERN handles it as a player separator.
        // Checking both patterns handles "A — B — Tournament" (matchPart = "A — B" has a LOOSE
        // em-dash separator, so it qualifies) vs "A — Tournament" (matchPart = "A" has none).
        if (/[—–]/.test(match[0]) && !VS_SEPARATOR_PATTERN.test(matchPart) && !LOOSE_VS_SEPARATOR_PATTERN.test(matchPart)) {
          continue
        }
        return { matchPart, tournamentName }
      }
    }
  }
  return { matchPart: line.trim(), tournamentName: null }
}

export function parseMatchupLine(rawLine: string): ParsedMatchupLine {
  const raw = rawLine.trim()
  if (!raw) {
    return { raw, playerAName: null, playerBName: null, tournamentName: null, parseError: "Empty line" }
  }

  const withoutMarker = stripLeadingListMarker(raw)

  // Step 1: strip a parenthetical tournament suffix first — "(Wimbledon)" at end of line.
  // This has priority over any other tournament-separator logic so "(Tournament)" format always works.
  const parenMatch = PAREN_TOURNAMENT_PATTERN.exec(withoutMarker)
  const parenTournament = parenMatch ? parenMatch[1].trim() : null
  const lineForSplit = parenTournament ? withoutMarker.slice(0, parenMatch!.index).trim() : withoutMarker

  // Step 2: split on a trailing tournament separator (em dash, @, at, in, -), then player-split
  // the remaining match part. Em dash falls through to the LOOSE player-separator if the match
  // part alone has no VS-type separator (see splitTournament).
  const { matchPart, tournamentName: splitTournamentName } = splitTournament(lineForSplit)
  const finalTournament = parenTournament ?? splitTournamentName

  const players = splitPlayers(matchPart)
  if (players) {
    return { raw, playerAName: players[0], playerBName: players[1], tournamentName: finalTournament, parseError: null }
  }

  return {
    raw,
    playerAName: null,
    playerBName: null,
    tournamentName: finalTournament,
    parseError: 'Could not find a "vs" separator between two player names',
  }
}

/** Splits pasted text into non-empty lines and parses each one independently. */
export function parseMatchupLines(text: string): ParsedMatchupLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseMatchupLine)
}
