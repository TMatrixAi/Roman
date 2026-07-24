import type { MatchFormat, Surface, TournamentLevel } from "@workspace/api-client-react"

interface NormalizePredictionInput {
  player1Id: string
  player2Id: string
  surface?: Surface | null
  matchFormat?: MatchFormat | null
  tournamentLevel?: TournamentLevel | null
  tournamentName?: string | null
  player1Tour?: string | null
  player2Tour?: string | null
}

interface NormalizedPredictionInput {
  player1Id: string
  player2Id: string
  surface: Surface
  matchFormat: MatchFormat
  tournamentLevel: TournamentLevel
  tournamentName?: string
}

function inferTournamentLevelFromContext(input: NormalizePredictionInput): TournamentLevel {
  const name = input.tournamentName?.trim() ?? ""

  // ITF shorthand naming (W15/W25/W35/M15/M25, etc.) is explicit and should override generic defaults.
  if (/\b[WM]\d{2,3}\b/i.test(name)) return "ITF"

  if (input.tournamentLevel) {
    if (input.tournamentLevel === "ATP250") {
      const p1Tour = (input.player1Tour ?? "").toUpperCase()
      const p2Tour = (input.player2Tour ?? "").toUpperCase()
      if (p1Tour === "WTA" || p2Tour === "WTA") return "WTA250"
    }
    return input.tournamentLevel
  }

  const p1Tour = (input.player1Tour ?? "").toUpperCase()
  const p2Tour = (input.player2Tour ?? "").toUpperCase()
  if (p1Tour === "WTA" || p2Tour === "WTA") return "WTA250"
  return "ATP250"
}

export function normalizePredictionInput(input: NormalizePredictionInput): NormalizedPredictionInput {
  const tournamentName = input.tournamentName?.trim() ?? ""

  return {
    player1Id: input.player1Id,
    player2Id: input.player2Id,
    surface: input.surface ?? "Hard",
    matchFormat: input.matchFormat ?? "BestOf3",
    tournamentLevel: inferTournamentLevelFromContext(input),
    tournamentName: tournamentName.length > 0 ? tournamentName : undefined,
  }
}
