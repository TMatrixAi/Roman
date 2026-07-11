import { useState } from "react"
import { useListEvaluationPredictions, type EvaluationPrediction } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate, formatProbability } from "@/lib/utils"
import { CheckCircle2, XCircle, Clock, Ban, CalendarClock, FlaskConical, Radio } from "lucide-react"

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
    <div className="flex flex-col md:flex-row md:items-center justify-between p-4 border rounded-md bg-card gap-4">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground flex-wrap">
          <RunKindBadge runKind={prediction.runKind} />
          <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> {formatDate(prediction.scheduledStartAt)}</span>
          {prediction.surface && <span className="uppercase">{prediction.surface}</span>}
          {prediction.segment && <Badge variant="outline" className="capitalize">{prediction.segment}</Badge>}
          {prediction.resultType && prediction.resultType !== "normal" && (
            <Badge variant="warning" className="capitalize">{prediction.resultType}</Badge>
          )}
          {prediction.status !== "missed" && prediction.includedInAccuracy === false && (
            <span className="italic">excluded from accuracy</span>
          )}
        </div>
        {prediction.status === "missed" ? (
          <div className="text-sm text-muted-foreground italic">
            Fixture {prediction.player1Name} vs {prediction.player2Name}: cutoff passed before a prediction could be locked. Never backfilled.
          </div>
        ) : (
          <div className="flex items-center gap-3 text-lg font-bold">
            <span className={prediction.predictedWinnerId === prediction.player1Id ? "text-primary" : "text-muted-foreground"}>
              {prediction.player1Name}
            </span>
            <span className="text-sm font-mono font-normal text-muted-foreground">vs</span>
            <span className={prediction.predictedWinnerId === prediction.player2Id ? "text-primary" : "text-muted-foreground"}>
              {prediction.player2Name}
            </span>
          </div>
        )}
      </div>

      {prediction.status !== "missed" && (
        <div className="flex flex-wrap items-center gap-4 md:gap-6 md:justify-end border-t md:border-t-0 pt-3 md:pt-0">
          <div className="flex flex-col md:items-end gap-1">
            <div className="text-xs font-mono text-muted-foreground">{isPreMatch ? "LOCKED PICK" : "PREDICTED"}</div>
            <div className="font-bold flex items-center gap-2">
              {prediction.predictedWinnerName ?? "—"}
              {prediction.calibratedProbability != null && (
                <Badge variant="outline" className="font-mono">{formatProbability(prediction.calibratedProbability)}</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col md:items-end gap-1 w-32">
            <div className="text-xs font-mono text-muted-foreground">RESULT</div>
            <StatusBadge status={prediction.status} />
          </div>

          {isGraded && (
            <div className="flex flex-col md:items-end gap-1 w-20">
              <div className="text-xs font-mono text-muted-foreground">OUTCOME</div>
              {isCorrect ? (
                <span className="flex items-center gap-1 text-sm font-bold text-green-600 dark:text-green-500">
                  <CheckCircle2 className="w-4 h-4" /> WON
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm font-bold text-destructive">
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

  const { data: predictions, isLoading } = useListEvaluationPredictions({
    limit: 100,
    ...(runKind !== "all" ? { runKind } : {}),
  })

  const preMatch = (predictions ?? []).filter((p) => p.status === "pending")
  const postMatch = (predictions ?? []).filter((p) => p.status !== "pending")

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">PREDICTION LOG</h1>
          <p className="text-muted-foreground mt-1">
            Every locked evaluation prediction — historical walk-forward tests and live paper trades. Locked at cutoff, never edited or backfilled.
          </p>
        </div>
        <Tabs value={runKind} onValueChange={(v) => setRunKind(v as typeof runKind)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="historical_test">Historical Test</TabsTrigger>
            <TabsTrigger value="paper_trade">Paper Trade</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-bold">Pre-match (locked, awaiting result)</h2>
            {preMatch.length > 0 ? (
              <div className="space-y-3">
                {preMatch.map((p) => <PredictionRow key={p.id} prediction={p} />)}
              </div>
            ) : (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground font-mono">NO PENDING LOCKED PREDICTIONS</CardContent></Card>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold">Post-match</h2>
            {postMatch.length > 0 ? (
              <div className="space-y-3">
                {postMatch.map((p) => <PredictionRow key={p.id} prediction={p} />)}
              </div>
            ) : (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground font-mono">NO GRADED PREDICTIONS YET</CardContent></Card>
            )}
          </section>
        </>
      )}
    </div>
  )
}
