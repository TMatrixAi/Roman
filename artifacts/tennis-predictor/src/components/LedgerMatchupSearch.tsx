import { useState } from "react"
import {
  searchLedgerPlayers,
  getLedgerPlayerPredictions,
  type LedgerPlayerSummary,
  type PredictionSummary,
} from "@workspace/api-client-react"
import { parseMatchupLines, type ParsedMatchupLine } from "@/lib/matchupLineParser"
import { resolvePlayerCandidate, matchPredictionsToPair } from "@/lib/matchupResolution"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ClipboardPaste, RefreshCw, CheckCircle2, XCircle, HelpCircle, Eye } from "lucide-react"

type LineStatus =
  | "resolving"
  | "unparsed"
  | "no-player-match"
  | "player-ambiguous"
  | "no-prediction-match"
  | "prediction-ambiguous"
  | "resolved"
  | "error"

interface LineResult {
  key: string
  parsed: ParsedMatchupLine
  status: LineStatus
  playerACandidates: LedgerPlayerSummary[]
  playerBCandidates: LedgerPlayerSummary[]
  chosenPlayerA: LedgerPlayerSummary | null
  chosenPlayerB: LedgerPlayerSummary | null
  predictionCandidates: PredictionSummary[]
  resolvedPrediction: PredictionSummary | null
  errorMessage: string | null
}

function initialLineResult(parsed: ParsedMatchupLine, key: string): LineResult {
  return {
    key,
    parsed,
    status: parsed.parseError ? "unparsed" : "resolving",
    playerACandidates: [],
    playerBCandidates: [],
    chosenPlayerA: null,
    chosenPlayerB: null,
    predictionCandidates: [],
    resolvedPrediction: null,
    errorMessage: null,
  }
}

/**
 * Resolves one already-parsed line into a specific saved Ledger prediction (or a reported
 * no-match/ambiguous state), optionally forcing one or both player identities when the caller
 * already picked a candidate from an earlier ambiguous result. Never guesses: every branch that
 * isn't a confident single match is reported back for the UI to surface, not silently resolved.
 */
async function resolveLine(
  parsed: ParsedMatchupLine,
  overrideA: LedgerPlayerSummary | null,
  overrideB: LedgerPlayerSummary | null,
): Promise<Omit<LineResult, "key" | "parsed">> {
  if (parsed.parseError || !parsed.playerAName || !parsed.playerBName) {
    return {
      status: "unparsed",
      playerACandidates: [],
      playerBCandidates: [],
      chosenPlayerA: null,
      chosenPlayerB: null,
      predictionCandidates: [],
      resolvedPrediction: null,
      errorMessage: null,
    }
  }

  // Task #110 fix: a thrown request here (network error, provider hiccup, etc.) must never leave
  // the line stuck in "resolving" forever -- report it as an explicit, retryable error state
  // instead of letting the exception escape past the caller's state update.
  try {
    const [candidatesA, candidatesB] = await Promise.all([
      overrideA ? Promise.resolve([overrideA]) : searchLedgerPlayers({ query: parsed.playerAName }),
      overrideB ? Promise.resolve([overrideB]) : searchLedgerPlayers({ query: parsed.playerBName }),
    ])

    const matchA = overrideA
      ? { kind: "resolved" as const, player: overrideA }
      : resolvePlayerCandidate(candidatesA, parsed.playerAName)
    const matchB = overrideB
      ? { kind: "resolved" as const, player: overrideB }
      : resolvePlayerCandidate(candidatesB, parsed.playerBName)

    if (matchA.kind !== "resolved" || matchB.kind !== "resolved") {
      return {
        status: matchA.kind === "ambiguous" || matchB.kind === "ambiguous" ? "player-ambiguous" : "no-player-match",
        playerACandidates: matchA.kind === "ambiguous" ? matchA.candidates : candidatesA,
        playerBCandidates: matchB.kind === "ambiguous" ? matchB.candidates : candidatesB,
        chosenPlayerA: matchA.kind === "resolved" ? matchA.player : null,
        chosenPlayerB: matchB.kind === "resolved" ? matchB.player : null,
        predictionCandidates: [],
        resolvedPrediction: null,
        errorMessage: null,
      }
    }

    const playerAPredictions = await getLedgerPlayerPredictions(matchA.player.id)
    const predictionMatch = matchPredictionsToPair(playerAPredictions, matchA.player.id, matchB.player.id, parsed.tournamentName)

    return {
      status: predictionMatch.kind === "resolved" ? "resolved" : predictionMatch.kind === "ambiguous" ? "prediction-ambiguous" : "no-prediction-match",
      playerACandidates: [],
      playerBCandidates: [],
      chosenPlayerA: matchA.player,
      chosenPlayerB: matchB.player,
      predictionCandidates: predictionMatch.kind === "ambiguous" ? predictionMatch.candidates : [],
      resolvedPrediction: predictionMatch.kind === "resolved" ? predictionMatch.prediction : null,
      errorMessage: null,
    }
  } catch (err) {
    return {
      status: "error",
      playerACandidates: [],
      playerBCandidates: [],
      chosenPlayerA: null,
      chosenPlayerB: null,
      predictionCandidates: [],
      resolvedPrediction: null,
      errorMessage: err instanceof Error ? err.message : "Lookup failed",
    }
  }
}

function StatusBadge({ status }: { status: LineStatus }) {
  switch (status) {
    case "resolving":
      return (
        <Badge variant="outline" className="font-mono gap-1">
          <RefreshCw className="w-3 h-3 animate-spin" /> RESOLVING
        </Badge>
      )
    case "resolved":
      return (
        <Badge variant="success" className="font-mono gap-1">
          <CheckCircle2 className="w-3 h-3" /> RESOLVED
        </Badge>
      )
    case "unparsed":
      return (
        <Badge variant="destructive" className="font-mono gap-1">
          <XCircle className="w-3 h-3" /> UNPARSED
        </Badge>
      )
    case "no-player-match":
    case "no-prediction-match":
      return (
        <Badge variant="destructive" className="font-mono gap-1">
          <XCircle className="w-3 h-3" /> NO MATCH
        </Badge>
      )
    case "player-ambiguous":
    case "prediction-ambiguous":
      return (
        <Badge variant="warning" className="font-mono gap-1">
          <HelpCircle className="w-3 h-3" /> AMBIGUOUS
        </Badge>
      )
    case "error":
      return (
        <Badge variant="destructive" className="font-mono gap-1">
          <XCircle className="w-3 h-3" /> LOOKUP FAILED
        </Badge>
      )
  }
}

/**
 * Task #110: lets a user paste a whole list of matchups (one per line, tolerant of separator
 * style) and auto-matches each line against real saved Ledger predictions, so they don't have to
 * search one player at a time. Every line's outcome (resolved / no match / ambiguous) is shown
 * explicitly -- nothing is dropped or guessed. Once at least one line resolves, `onView` hands
 * the ordered list of resolved predictions up to the Ledger page's focus/navigation control.
 */
export function LedgerMatchupSearch({
  onView,
}: {
  onView: (predictions: PredictionSummary[], startIndex: number) => void
}) {
  const [text, setText] = useState("")
  const [lines, setLines] = useState<LineResult[]>([])
  const [isResolving, setIsResolving] = useState(false)

  const resolvedPredictions = lines.filter((l) => l.status === "resolved" && l.resolvedPrediction).map((l) => l.resolvedPrediction!)

  const handleGo = async () => {
    const parsed = parseMatchupLines(text)
    if (parsed.length === 0) return

    setIsResolving(true)
    const initial = parsed.map((p, i) => initialLineResult(p, `${i}-${p.raw}`))
    setLines(initial)

    try {
      for (let i = 0; i < initial.length; i++) {
        const key = initial[i].key
        const parsedLine = initial[i].parsed
        if (parsedLine.parseError) continue
        // resolveLine already catches its own lookup failures and reports an "error" line status,
        // but this outer try/finally is a second safety net: even an unexpected throw here (or in
        // a future change to this loop) must not leave isResolving stuck true / the GO button
        // permanently disabled -- see task #110 review feedback on the stuck-loading bug.
        const result = await resolveLine(parsedLine, null, null)
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...result } : l)))
      }
    } finally {
      setIsResolving(false)
    }
  }

  const retryLine = async (key: string) => {
    const line = lines.find((l) => l.key === key)
    if (!line) return
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, status: "resolving", errorMessage: null } : l)))
    try {
      const result = await resolveLine(line.parsed, line.chosenPlayerA, line.chosenPlayerB)
      setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...result } : l)))
    } catch (err) {
      setLines((prev) =>
        prev.map((l) =>
          l.key === key ? { ...l, status: "error", errorMessage: err instanceof Error ? err.message : "Lookup failed" } : l,
        ),
      )
    }
  }

  const pickCandidate = async (key: string, which: "A" | "B", candidate: LedgerPlayerSummary) => {
    const line = lines.find((l) => l.key === key)
    if (!line) return
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, status: "resolving" } : l)))
    const overrideA = which === "A" ? candidate : line.chosenPlayerA
    const overrideB = which === "B" ? candidate : line.chosenPlayerB
    try {
      const result = await resolveLine(line.parsed, overrideA, overrideB)
      setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...result } : l)))
    } catch (err) {
      setLines((prev) =>
        prev.map((l) =>
          l.key === key ? { ...l, status: "error", errorMessage: err instanceof Error ? err.message : "Lookup failed" } : l,
        ),
      )
    }
  }

  const pickPrediction = (key: string, prediction: PredictionSummary) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, status: "resolved", resolvedPrediction: prediction, predictionCandidates: [] } : l)),
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paste matchups, one per line, e.g.\nDjokovic vs Alcaraz — Wimbledon\nSwiatek vs Sabalenka - French Open"}
          className="font-mono text-sm min-h-[100px] bg-card"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-mono text-muted-foreground">
            Separators are flexible -- "vs", "v", em dash, hyphen, "@", or "in" all work.
          </p>
          <Button size="sm" className="font-mono font-bold gap-1.5 shrink-0" disabled={isResolving || text.trim().length === 0} onClick={handleGo}>
            {isResolving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ClipboardPaste className="w-3.5 h-3.5" />}
            GO
          </Button>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="space-y-2">
          {resolvedPredictions.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="font-mono"
                onClick={() => onView(resolvedPredictions, 0)}
              >
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                VIEW {resolvedPredictions.length} RESOLVED MATCH{resolvedPredictions.length === 1 ? "" : "ES"}
              </Button>
            </div>
          )}

          {lines.map((line) => (
            <div key={line.key} className="p-3 border rounded-md bg-secondary/20 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground truncate max-w-[280px]">{line.parsed.raw}</span>
                <StatusBadge status={line.status} />
              </div>

              {line.status === "unparsed" && (
                <p className="text-xs text-destructive font-mono">
                  Could not find two player names separated by "vs" in this line -- skipped.
                </p>
              )}

              {line.status === "no-player-match" && (
                <p className="text-xs text-destructive font-mono">
                  No Ledger player found for {line.chosenPlayerA ? line.parsed.playerBName : line.parsed.playerAName}.
                </p>
              )}

              {line.status === "no-prediction-match" && (
                <p className="text-xs text-destructive font-mono">
                  {line.chosenPlayerA?.name} vs {line.chosenPlayerB?.name} matched real players, but no saved prediction pairs them.
                </p>
              )}

              {line.status === "player-ambiguous" && (
                <div className="space-y-2">
                  {line.playerACandidates.length > 1 && !line.chosenPlayerA && (
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-muted-foreground">Which "{line.parsed.playerAName}"?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {line.playerACandidates.map((c) => (
                          <button
                            key={c.id}
                            className="text-xs font-mono px-2 py-1 border rounded-md bg-card hover:border-primary transition-colors"
                            onClick={() => pickCandidate(line.key, "A", c)}
                          >
                            {c.name} ({c.predictionCount})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {line.playerBCandidates.length > 1 && !line.chosenPlayerB && (
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-muted-foreground">Which "{line.parsed.playerBName}"?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {line.playerBCandidates.map((c) => (
                          <button
                            key={c.id}
                            className="text-xs font-mono px-2 py-1 border rounded-md bg-card hover:border-primary transition-colors"
                            onClick={() => pickCandidate(line.key, "B", c)}
                          >
                            {c.name} ({c.predictionCount})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {line.status === "prediction-ambiguous" && (
                <div className="space-y-1">
                  <p className="text-xs font-mono text-muted-foreground">
                    {line.chosenPlayerA?.name} and {line.chosenPlayerB?.name} met more than once -- which one?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {line.predictionCandidates.map((p) => (
                      <button
                        key={p.id}
                        className="text-xs font-mono px-2 py-1 border rounded-md bg-card hover:border-primary transition-colors"
                        onClick={() => pickPrediction(line.key, p)}
                      >
                        {p.tournamentName ?? "Untitled event"} ({new Date(p.createdAt).toLocaleDateString()})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {line.status === "error" && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-destructive font-mono">
                    Lookup failed{line.errorMessage ? `: ${line.errorMessage}` : ""} -- the server may be unavailable.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs"
                    onClick={() => retryLine(line.key)}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    RETRY
                  </Button>
                </div>
              )}

              {line.status === "resolved" && line.resolvedPrediction && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-bold">
                    {line.resolvedPrediction.player1Name} vs {line.resolvedPrediction.player2Name}
                    {line.resolvedPrediction.tournamentName && (
                      <span className="text-xs font-mono font-normal text-muted-foreground ml-2">{line.resolvedPrediction.tournamentName}</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-mono text-xs"
                    onClick={() => onView(resolvedPredictions, resolvedPredictions.indexOf(line.resolvedPrediction!))}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    VIEW
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
