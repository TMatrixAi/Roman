import { useState, useCallback } from "react"
import { useListEvaluationPredictions, type EvaluationPrediction } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate, formatProbability } from "@/lib/utils"
import { asPercentage } from "@/lib/percentage"
import { CheckCircle2, XCircle, Clock, Ban, CalendarClock, FlaskConical, Radio, History as HistoryIcon, ChevronDown, Loader2 } from "lucide-react"

const PAGE_SIZE = 50

/** Task #30: mirrors the Ledger's `HistoricalMatchFallbackBadge` (see `History.tsx`) -- real
 * disclosure that at least one player in this prediction was resolved via the historical-match
 * fallback (not in current live ATP/WTA standings) rather than a live ranking, per
 * `usedHistoricalMatchFallback` (derived server-side from this row's own stored
 * `featureSnapshot.engine.warnings`, never guessed). */
function HistoricalMatchFallbackBadge() {
  return (
    <span
      className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded-[2px] normal-case text-xs font-mono flex items-center gap-1 shrink-0"
      title="At least one player's tour/rank came from their own past match record, not a live ranking"
    >
      <HistoryIcon className="w-3 h-3" /> PAST-MATCH RANK
    </span>
  )
}

const RUN_KIND_LABEL: Record<string, string> = {
  historical_test: "Historical Test",
  paper_trade: "Paper Trade",
  live: "Live",
}

function RunKindBadge({ runKind }: { runKind: string }) {
  const Icon = runKind === "historical_test" ? FlaskConical : Radio
  return (
    <Badge variant="outline" className="font-mono gap-1">
      <Icon className="w-3 h-3" /> {RUN_KIND_LABEL[runKind] ?? runKind}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "graded":
      return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3 h-3" /> GRADED</Badge>
    case "pending":
      return <Badge variant="outline" className="gap-1"><Clock className="w-3 h-3" /> PENDING (LOCKED)</Badge>
    case "void":
      return <Badge variant="warning" className="gap-1"><Ban className="w-3 h-3" /> VOID</Badge>
    case "missed":
      return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> MISSED CUTOFF</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function PredictionRow({ prediction }: { prediction: EvaluationPrediction }) {
  const isGraded = prediction.status === "graded"
  const isCorrect = isGraded && prediction.actualWinnerId === prediction.predictedWinnerId
  const isPreMatch = prediction.status === "pending"

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between p-4 sm:p-5 border border-border/50 rounded-xl bg-card/60 backdrop-blur-sm shadow-sm hover:border-primary/40 hover:bg-card hover:shadow-md transition-all duration-300 gap-4 group">
      <div className="flex-1 space-y-2.5">
        <div className="flex items-center gap-x-2.5 gap-y-1.5 text-[11px] font-mono font-bold text-muted-foreground tracking-widest flex-wrap">
          <RunKindBadge runKind={prediction.runKind} />
          <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> {formatDate(prediction.scheduledStartAt)}</span>
          {prediction.surface && (
            <>
              <span className="text-border">•</span>
              <span className="text-foreground/80 bg-secondary/50 px-2 py-0.5 rounded uppercase">{prediction.surface}</span>
            </>
          )}
          {prediction.segment && <Badge variant="outline" className="capitalize bg-background shadow-sm border-border/60">{prediction.segment}</Badge>}
          {prediction.resultType && prediction.resultType !== "normal" && (
            <Badge variant="warning" className="capitalize shadow-sm">{prediction.resultType}</Badge>
          )}
          {prediction.status !== "missed" && prediction.includedInAccuracy === false && (
            <span className="italic text-muted-foreground/60 lowercase px-1 bg-secondary/30 rounded-md">excluded from accuracy</span>
          )}
          {prediction.usedHistoricalMatchFallback && <HistoricalMatchFallbackBadge />}
        </div>
        {prediction.status === "missed" ? (
          <div className="text-sm text-muted-foreground italic border-l-2 border-muted-foreground/30 pl-3 py-1">
            Fixture {prediction.player1Name} vs {prediction.player2Name}: cutoff passed before a prediction could be locked. Never backfilled.
          </div>
        ) : (
          <div className="flex items-center gap-3 text-lg sm:text-xl font-display font-bold tracking-tight mt-1">
            <span className={prediction.predictedWinnerId === prediction.player1Id ? "text-primary drop-shadow-sm" : "text-foreground/80"}>
              {prediction.player1Name}
            </span>
            <span className="text-sm font-mono font-bold text-muted-foreground/60 italic lowercase px-1">vs</span>
            <span className={prediction.predictedWinnerId === prediction.player2Id ? "text-primary drop-shadow-sm" : "text-foreground/80"}>
              {prediction.player2Name}
            </span>
          </div>
        )}
      </div>

      {prediction.status !== "missed" && (
        <div className="flex flex-wrap items-center gap-4 md:gap-8 md:justify-end border-t border-border/50 md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0">
          <div className="flex flex-col md:items-end gap-1.5">
            <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">{isPreMatch ? "LOCKED PICK" : "PREDICTED"}</div>
            <div className="font-bold font-display flex items-center gap-2">
              {prediction.predictedWinnerName ?? "—"}
              {prediction.calibratedProbability != null && (
                <Badge variant="outline" className="font-mono tabular-nums bg-background shadow-sm">
                  {formatProbability(
                    asPercentage(
                      prediction.predictedWinnerId === prediction.player1Id
                        ? prediction.calibratedProbability
                        : 100 - prediction.calibratedProbability,
                    ),
                  )}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col md:items-end gap-1.5 w-32">
            <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">RESULT</div>
            <StatusBadge status={prediction.status} />
          </div>

          {isGraded && (
            <div className="flex flex-col md:items-end gap-1.5 w-20">
              <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">OUTCOME</div>
              {isCorrect ? (
                <span className="flex items-center gap-1.5 text-sm font-bold text-success drop-shadow-sm">
                  <CheckCircle2 className="w-4 h-4" /> WON
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                  <XCircle className="w-4 h-4" /> LOST
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PredictionLogPage() {
  const [runKind, setRunKind] = useState<"all" | "historical_test" | "paper_trade">("all")
  const [page, setPage] = useState(0)
  const [allPredictions, setAllPredictions] = useState<EvaluationPrediction[]>([])
  const [hasMore, setHasMore] = useState(true)

  const { data: predictions, isLoading, isFetching } = useListEvaluationPredictions({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(runKind !== "all" ? { runKind } : {}),
  }, {
    query: {
      keepPreviousData: true,
      onSuccess: (data: EvaluationPrediction[]) => {
        if (page === 0) {
          setAllPredictions(data)
        } else {
          setAllPredictions(prev => [...prev, ...data])
        }
        setHasMore(data.length === PAGE_SIZE)
      },
    },
  })

  const handleTabChange = useCallback((v: string) => {
    setRunKind(v as typeof runKind)
    setPage(0)
    setAllPredictions([])
    setHasMore(true)
  }, [])

  const loadMore = useCallback(() => {
    setPage(p => p + 1)
  }, [])

  const displayed = allPredictions.length > 0 ? allPredictions : (predictions ?? [])
  const preMatch = displayed.filter((p) => p.status === "pending")
  const postMatch = displayed.filter((p) => p.status !== "pending")

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Prediction Log</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Every locked evaluation prediction — historical walk-forward tests and live paper trades. Locked at cutoff, never edited or backfilled.
          </p>
        </div>
        <Tabs value={runKind} onValueChange={handleTabChange} className="w-full md:w-auto">
          <TabsList className="w-full h-11 bg-secondary/50 border border-border/50 p-1">
            <TabsTrigger value="all" className="flex-1 font-mono text-xs uppercase tracking-widest">All</TabsTrigger>
            <TabsTrigger value="historical_test" className="flex-1 font-mono text-xs uppercase tracking-widest">Historical Test</TabsTrigger>
            <TabsTrigger value="paper_trade" className="flex-1 font-mono text-xs uppercase tracking-widest">Paper Trade</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-12">
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/30">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold font-display">Pre-match <span className="text-muted-foreground font-medium text-lg ml-2">(locked, awaiting result)</span></h2>
            </div>
            {preMatch.length > 0 ? (
              <div className="space-y-3">
                {preMatch.map((p) => <PredictionRow key={p.id} prediction={p} />)}
              </div>
            ) : (
              <Card className="glass-panel border-dashed border-primary/45 shadow-none"><CardContent className="p-12 text-center text-sm text-muted-foreground font-mono font-bold tracking-widest uppercase flex flex-col items-center gap-4">
                <div className="p-3 bg-secondary/50 rounded-full mb-2 border border-border/60"><Clock className="w-6 h-6 opacity-50" /></div>
                No Pending Locked Predictions
              </CardContent></Card>
            )}
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <HistoryIcon className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold font-display">Post-match</h2>
            </div>
            {postMatch.length > 0 ? (
              <div className="space-y-3">
                {postMatch.map((p) => <PredictionRow key={p.id} prediction={p} />)}
              </div>
            ) : (
              <Card className="glass-panel border-dashed border-primary/45 shadow-none"><CardContent className="p-12 text-center text-sm text-muted-foreground font-mono font-bold tracking-widest uppercase flex flex-col items-center gap-4">
                <div className="p-3 bg-secondary/50 rounded-full mb-2 border border-border/60"><HistoryIcon className="w-6 h-6 opacity-50" /></div>
                No Graded Predictions Yet
              </CardContent></Card>
            )}
          </section>
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={isFetching}
            className="gap-2 font-mono"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
            {isFetching ? "Loading…" : `Load more (showing ${displayed.length})`}
          </Button>
        </div>
      )}
    </div>
  )
}
