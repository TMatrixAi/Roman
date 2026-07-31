import {
  type MatchFormat,
  type Prediction,
  type PredictionRequest,
  type TournamentLevel,
  type Surface,
} from "@workspace/api-client-react"

interface IntegrityContext {
  requestMatchId: string
  submittedPlayer1Name?: string | null
  submittedPlayer2Name?: string | null
}

interface CreatePredictionIntegrityInput {
  player1Id: string
  player2Id: string
  surface: Surface
  matchFormat: MatchFormat
  tournamentLevel?: TournamentLevel
  tournamentName?: string | null
  indoor?: boolean | null
}

export function buildClientMatchId(parts: {
  source: string
  player1Id: string
  player2Id: string
  tournamentName?: string | null
  surface: Surface
  matchFormat: MatchFormat
}): string {
  const compactTournament = (parts.tournamentName ?? "na").trim().toLowerCase().replace(/\s+/g, "-")
  return [
    parts.source,
    parts.player1Id,
    parts.player2Id,
    compactTournament,
    parts.surface,
    parts.matchFormat,
    Date.now().toString(36),
  ].join(":")
}

export async function createPredictionWithIntegrity(
  input: CreatePredictionIntegrityInput,
  context: IntegrityContext,
): Promise<Prediction> {
  const requestId = crypto.randomUUID()
  const payload: PredictionRequest = {
    player1Id: input.player1Id,
    player2Id: input.player2Id,
    surface: input.surface,
    matchFormat: input.matchFormat,
    tournamentLevel: input.tournamentLevel,
    tournamentName: input.tournamentName ?? null,
    indoor: input.indoor ?? null,
  }

  const res = await fetch("/api/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-prediction-request-id": requestId,
      "x-prediction-match-id": context.requestMatchId,
      ...(context.submittedPlayer1Name ? { "x-submitted-player1-name": context.submittedPlayer1Name } : {}),
      ...(context.submittedPlayer2Name ? { "x-submitted-player2-name": context.submittedPlayer2Name } : {}),
    },
    body: JSON.stringify(payload),
  })

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const msg = typeof body === "object" && body && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Prediction request failed (HTTP ${res.status})`
    throw new Error(msg)
  }

  const echoedRequestId = res.headers.get("x-prediction-request-id")
  const echoedMatchId = res.headers.get("x-prediction-match-id")

  if (echoedRequestId !== requestId || echoedMatchId !== context.requestMatchId) {
    throw new Error("Integrity check failed: response was bound to a different request")
  }

  const prediction = body as Prediction

  if (prediction.player1Id !== input.player1Id || prediction.player2Id !== input.player2Id) {
    throw new Error("Integrity check failed: response player IDs do not match submitted player IDs")
  }
  if (prediction.surface !== input.surface || prediction.matchFormat !== input.matchFormat) {
    throw new Error("Integrity check failed: response match settings do not match submitted settings")
  }
  if ((prediction.tournamentName ?? null) !== (input.tournamentName ?? null)) {
    throw new Error("Integrity check failed: response tournament does not match submitted tournament")
  }

  if (prediction.player1Name.includes("/") || prediction.player2Name.includes("/")) {
    throw new Error("Integrity check failed: doubles/team player names returned for a singles prediction request")
  }

  return prediction
}
