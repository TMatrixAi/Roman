/**
 * Grand Slam tournament detection and player nickname expansion utilities.
 *
 * Shared by PasteMatchupPredictor and BulkMatchupPredictor so both auto-set
 * Best-of-5 format for men's Grand Slam matches in the same way.
 */

/** Patterns that identify Grand Slam tournaments from free-text tournament names. */
const GRAND_SLAM_PATTERNS = [
  /australian\s*open/i,
  /french\s*open/i,
  /roland[\s-]*garros/i,
  /wimbledon/i,
  /us\s*open/i,
] as const;

/**
 * Returns true when `tournamentName` matches any Grand Slam tournament.
 * Used to auto-select Best-of-5 format for ATP (men's) draws.
 */
export function isGrandSlam(tournamentName: string | null | undefined): boolean {
  if (!tournamentName) return false;
  return GRAND_SLAM_PATTERNS.some((re) => re.test(tournamentName));
}

/**
 * Well-known short names and nicknames for top ATP/WTA players.
 * Keys are lowercase (no punctuation). Values are the full canonical name to use
 * as the expanded search query so provider search and word-subset matching work correctly.
 *
 * Limited to unambiguous monikers where one name universally maps to exactly one player.
 * "Alex", "carlos" etc. are deliberately excluded — too ambiguous at the circuit level.
 */
export const NICKNAME_TABLE: Record<string, string> = {
  rafa: "Rafael Nadal",
  nole: "Novak Djokovic",
  djoker: "Novak Djokovic",
  muzza: "Andy Murray",
  delpo: "Juan Martin del Potro",
  guga: "Gustavo Kuerten",
  coco: "Cori Gauff",
  meddy: "Daniil Medvedev",
  sascha: "Alexander Zverev",
  serena: "Serena Williams",
  venus: "Venus Williams",
  roger: "Roger Federer",
};

/**
 * Expands a well-known player nickname to their canonical full name.
 * Returns the original name unchanged when it is not a known nickname.
 * The lookup is case-insensitive and trims leading/trailing whitespace.
 */
export function expandNickname(name: string): string {
  const key = name.trim().toLowerCase();
  return NICKNAME_TABLE[key] ?? name;
}
