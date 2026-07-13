/**
 * Odds providers spell player names inconsistently vs. our tennis data provider ("Carlos Alcaraz"
 * vs. "C. Alcaraz" vs. "Alcaraz Carlos"), so matching by exact string equality would silently miss
 * almost every real matchup. We match on normalized surname containment instead -- accurate enough
 * for two-player disambiguation (surnames collide far less often than first names in a single
 * tournament draw) without requiring a second, brittle identity-resolution system.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z\s]/g, " ")
    .trim();
}

function tokens(name: string): string[] {
  return normalize(name).split(/\s+/).filter(Boolean);
}

function surname(name: string): string {
  const parts = tokens(name);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

// Surnames shorter than this are too common as accidental substrings/tokens across unrelated
// names (initials, short given names, etc.) to trust on their own.
const MIN_TRUSTED_SURNAME_LENGTH = 3;

/**
 * True when `ourName`'s surname exactly matches one of `providerName`'s whitespace-separated
 * tokens (or vice versa) -- token-exact, never raw substring containment, so a short surname like
 * "Li" cannot accidentally match inside an unrelated word/token. Guards against surnames shorter
 * than MIN_TRUSTED_SURNAME_LENGTH entirely, since those are too ambiguous to disambiguate a
 * two-player matchup on their own.
 */
export function namesLikelyMatch(ourName: string, providerName: string): boolean {
  const ourSurname = surname(ourName);
  const providerSurname = surname(providerName);
  const providerTokens = tokens(providerName);
  const ourTokens = tokens(ourName);

  if (ourSurname.length >= MIN_TRUSTED_SURNAME_LENGTH && providerTokens.includes(ourSurname)) {
    return true;
  }
  // Some providers list "Surname F." or "Surname, First" -- also check the provider's own surname
  // (last normalized token) as an exact token against our name, to catch that ordering.
  if (providerSurname.length >= MIN_TRUSTED_SURNAME_LENGTH && ourTokens.includes(providerSurname)) {
    return true;
  }
  return false;
}

/**
 * Matches a provider event's two team/player names against our two players, in EITHER order
 * (the provider's home/away or team1/team2 slot has no fixed relationship to our player1/player2).
 * Returns which provider slot corresponds to our player1 ("first") vs player2 ("second"), or null
 * when the event doesn't look like this matchup at all.
 */
export function matchPlayersToEvent(
  ourPlayer1Name: string,
  ourPlayer2Name: string,
  eventNameA: string,
  eventNameB: string,
): "aIsPlayer1" | "bIsPlayer1" | null {
  const aMatchesP1 = namesLikelyMatch(ourPlayer1Name, eventNameA);
  const aMatchesP2 = namesLikelyMatch(ourPlayer2Name, eventNameA);
  const bMatchesP1 = namesLikelyMatch(ourPlayer1Name, eventNameB);
  const bMatchesP2 = namesLikelyMatch(ourPlayer2Name, eventNameB);

  if (aMatchesP1 && bMatchesP2) return "aIsPlayer1";
  if (bMatchesP1 && aMatchesP2) return "bIsPlayer1";
  return null;
}
