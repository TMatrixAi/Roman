/**
 * Task #110: pure matching logic for the Ledger's paste-search feature -- separated from the
 * network calls (searchLedgerPlayers / getLedgerPlayerPredictions) so it's directly testable
 * against plain fixture data. Every function here takes already-fetched candidates and never
 * silently guesses: ambiguous or absent matches are reported as such, not resolved to a best
 * guess.
 */
import type { LedgerPlayerSummary, PredictionSummary } from "@workspace/api-client-react"

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

export type PlayerMatchResult =
  | { kind: "resolved"; player: LedgerPlayerSummary }
  | { kind: "no-match"; query: string }
  | { kind: "ambiguous"; query: string; candidates: LedgerPlayerSummary[] }

/**
 * Picks a single player from search candidates for a pasted name. An exact (case/whitespace
 * insensitive) name match always wins outright even if other loose-substring candidates exist.
 * Otherwise, a single candidate is accepted as the only option; two or more non-exact candidates
 * are reported as ambiguous rather than picking the "most predictions" one by default, since that
 * ranking says nothing about which one the pasted name actually meant.
 */
export function resolvePlayerCandidate(candidates: LedgerPlayerSummary[], query: string): PlayerMatchResult {
  if (candidates.length === 0) return { kind: "no-match", query }

  const exact = candidates.filter((c) => normalize(c.name) === normalize(query))
  if (exact.length === 1) return { kind: "resolved", player: exact[0] }
  if (exact.length > 1) return { kind: "ambiguous", query, candidates: exact }

  if (candidates.length === 1) return { kind: "resolved", player: candidates[0] }
  return { kind: "ambiguous", query, candidates }
}

export type PredictionMatchResult =
  | { kind: "resolved"; prediction: PredictionSummary }
  | { kind: "no-match" }
  | { kind: "ambiguous"; candidates: PredictionSummary[] }

/**
 * Given every saved prediction involving playerAId, finds the specific one that also involves
 * playerBId (on either side of the matchup). When more than one such prediction exists (the same
 * two players met more than once) and the pasted line named a tournament, that tournament name
 * narrows the set via a loose substring match; if narrowing doesn't get down to exactly one, the
 * full (or narrowed) set is reported as ambiguous rather than guessing the most recent one.
 */
export function matchPredictionsToPair(
  playerAPredictions: PredictionSummary[],
  playerAId: string,
  playerBId: string,
  tournamentName: string | null,
): PredictionMatchResult {
  const pairMatches = playerAPredictions.filter(
    (p) =>
      (p.player1Id === playerAId && p.player2Id === playerBId) ||
      (p.player2Id === playerAId && p.player1Id === playerBId),
  )

  if (pairMatches.length === 0) return { kind: "no-match" }
  if (pairMatches.length === 1) return { kind: "resolved", prediction: pairMatches[0] }

  if (tournamentName) {
    const needle = normalize(tournamentName)
    const narrowed = pairMatches.filter((p) => {
      const haystack = p.tournamentName ? normalize(p.tournamentName) : null
      return haystack !== null && (haystack.includes(needle) || needle.includes(haystack))
    })
    if (narrowed.length === 1) return { kind: "resolved", prediction: narrowed[0] }
    if (narrowed.length > 1) return { kind: "ambiguous", candidates: narrowed }
  }

  return { kind: "ambiguous", candidates: pairMatches }
}
