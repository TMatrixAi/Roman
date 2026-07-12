import {
  useGetEvaluationDashboard,
  useListEvaluationRuns,
  useRunWalkForward,
  useRunPaperTradingCycle,
  useGetEvaluationSettings,
  useUpdateEvaluationSettings,
  type EvaluationDashboardSegment,
  type SpecialistSegmentSummary,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { formatDate } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { getGetEvaluationDashboardQueryKey, getListEvaluationRunsQueryKey, getGetEvaluationSettingsQueryKey } from "@workspace/api-client-react"
import { Loader2, PlayCircle, Radio, Flame, Snowflake, Layers } from "lucide-react"

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-mono text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tracking-tighter">{value}</div>
    </div>
  )
}

function SegmentCard({ segment }: { segment: EvaluationDashboardSegment }) {
  const m = segment.metrics
  const dateRange =
    m.dateRangeStart && m.dateRangeEnd
      ? `${formatDate(m.dateRangeStart)} – ${formatDate(m.dateRangeEnd)}`
      : "No data yet"

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">{segment.label}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{dateRange}</p>
        </div>
        <Badge variant={segment.isGenuinelyUnseen ? "success" : "secondary"} className="font-mono whitespace-nowrap">
          {segment.isGenuinelyUnseen ? "GENUINELY UNSEEN" : "USED FOR CALIBRATION"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricStat label={`ACCURACY (n=${m.n})`} value={m.accuracy !== null ? `${m.accuracy}%` : "—"} />
          <MetricStat label="LOG LOSS" value={m.logLoss !== null ? m.logLoss.toFixed(3) : "—"} />
          <MetricStat label="BRIER SCORE" value={m.brier !== null ? m.brier.toFixed(3) : "—"} />
          <MetricStat
            label={`RETIREMENTS (n=${m.retiredCount})`}
            value={m.retiredAccuracy !== null ? `${m.retiredAccuracy}%` : "excluded"}
          />
        </div>

        <div className="flex gap-4 text-xs font-mono text-muted-foreground">
          <span>VOID (walkover/cancelled): {m.voidCount}</span>
          <span>MISSED CUTOFF: {m.missedCount}</span>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-mono text-muted-foreground">CALIBRATION BUCKETS (confidence vs. observed accuracy)</div>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
            {segment.calibrationBuckets.map((b) => (
              <div key={b.label} className="border rounded-md p-2 text-center">
                <div className="text-[10px] font-mono text-muted-foreground">{b.label}</div>
                <div className="text-sm font-bold">{b.observedAccuracy !== null ? `${b.observedAccuracy}%` : "—"}</div>
                <div className="text-[10px] text-muted-foreground">n={b.n}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            {segment.streaks.currentStreakType === "win" ? (
              <Flame className="w-4 h-4 text-green-600" />
            ) : segment.streaks.currentStreakType === "loss" ? (
              <Snowflake className="w-4 h-4 text-destructive" />
            ) : null}
            <span className="font-mono text-muted-foreground">
              CURRENT: {segment.streaks.currentStreakType ? `${segment.streaks.currentStreakLength} ${segment.streaks.currentStreakType}${segment.streaks.currentStreakLength === 1 ? "" : "s"}` : "—"}
            </span>
          </div>
          <span className="font-mono text-muted-foreground">LONGEST WIN: {segment.streaks.longestWinStreak}</span>
          <span className="font-mono text-muted-foreground">LONGEST LOSS: {segment.streaks.longestLossStreak}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function SpecialistSegmentTable({ segments }: { segments: SpecialistSegmentSummary[] }) {
  const activeCount = segments.filter((s) => s.meetsThreshold).length
  const mostRecentRefit = segments.reduce<string | null>((latest, s) => {
    if (!s.computedAt) return latest
    if (!latest || new Date(s.computedAt).getTime() > new Date(latest).getTime()) return s.computedAt
    return latest
  }, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="w-4 h-4" /> Self-Learning Report: Specialist Segments (Phase 6)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          This is the engine's real self-learning signal: each tour/surface segment's trust (blend weight) is re-derived
          from its own measured log loss and accuracy vs. the general model on the SAME validation points, every
          calibration refit -- not a fixed rule. Sample sizes are always shown alongside accuracy so a small sample is
          never presented as a strong result.
        </p>
        <p className="text-xs font-mono text-muted-foreground">
          {activeCount} of {segments.length} segments actively trusted this cycle
          {mostRecentRefit && <> · last recomputed {formatDate(mostRecentRefit)}</>}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-mono text-muted-foreground border-b">
                <th className="py-2 pr-4">Segment</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Historical Matches</th>
                <th className="py-2 pr-4">Validation N</th>
                <th className="py-2 pr-4">Specialist Acc.</th>
                <th className="py-2 pr-4">General Acc.</th>
                <th className="py-2 pr-4">Specialist Log Loss</th>
                <th className="py-2 pr-4">General Log Loss</th>
                <th className="py-2 pr-4">Blend Weight</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.segmentKey} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{s.label}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={s.meetsThreshold ? "success" : "outline"} className="font-mono text-[10px]">
                      {s.meetsThreshold ? "ACTIVE" : "INSUFFICIENT DATA"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 font-mono">{s.historicalMatchCount}</td>
                  <td className="py-2 pr-4 font-mono">{s.validationSampleSize}</td>
                  <td className="py-2 pr-4 font-mono">{s.accuracy !== null && s.accuracy !== undefined ? `${s.accuracy}%` : "—"}</td>
                  <td className="py-2 pr-4 font-mono">{s.generalAccuracy !== null && s.generalAccuracy !== undefined ? `${s.generalAccuracy}%` : "—"}</td>
                  <td className="py-2 pr-4 font-mono">{s.logLoss !== null && s.logLoss !== undefined ? s.logLoss.toFixed(3) : "—"}</td>
                  <td className="py-2 pr-4 font-mono">{s.generalLogLoss !== null && s.generalLogLoss !== undefined ? s.generalLogLoss.toFixed(3) : "—"}</td>
                  <td className="py-2 pr-4 font-mono">{s.meetsThreshold ? s.weight.toFixed(2) : "0.00 (fallback to general)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AccuracyDashboardPage() {
  const queryClient = useQueryClient()
  const { data: dashboard, isLoading } = useGetEvaluationDashboard()
  const { data: runs } = useListEvaluationRuns()
  const { data: settings } = useGetEvaluationSettings()

  const runWalkForward = useRunWalkForward({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetEvaluationDashboardQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListEvaluationRunsQueryKey() })
      },
    },
  })
  const runPaperTrading = useRunPaperTradingCycle({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetEvaluationDashboardQueryKey() }),
    },
  })
  const updateSettings = useUpdateEvaluationSettings({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetEvaluationSettingsQueryKey() }),
    },
  })

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">ACCURACY DASHBOARD</h1>
          <p className="text-muted-foreground mt-1">
            Segmented, honestly-labeled results. Validation numbers were used to fit calibration — only test and paper-trade numbers are genuinely unseen.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => runPaperTrading.mutate()} disabled={runPaperTrading.isPending} className="gap-2">
            {runPaperTrading.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
            Run Paper-Trade Cycle
          </Button>
          <Button onClick={() => runWalkForward.mutate({ data: {} })} disabled={runWalkForward.isPending} className="gap-2">
            {runWalkForward.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Run Walk-Forward Evaluation
          </Button>
        </div>
      </div>

      {runWalkForward.data?.skippedNoEligibleMatches && (
        <Card className="border-warning">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Not enough historical match data to run a meaningful walk-forward evaluation yet. Backfill more historical matches first.
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card>
          <CardHeader><CardTitle className="text-base">Settings</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-8">
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.retirementRule === "included"}
                onCheckedChange={(checked) => updateSettings.mutate({ data: { retirementRule: checked ? "included" : "excluded" } })}
              />
              <div>
                <div className="text-sm font-medium">Count retirements toward accuracy</div>
                <div className="text-xs text-muted-foreground">Off (default): retirements are graded but reported separately, never in the headline number.</div>
              </div>
            </div>
            <div className="text-sm text-muted-foreground font-mono">
              PAPER-TRADE LEAD TIME: {settings.paperTradeLeadMinutes} min before scheduled start
            </div>
            <div className="text-sm text-muted-foreground font-mono">
              LIVE CALIBRATION FIT ON: {dashboard?.activeCalibrationSampleSize ?? 0} validation predictions
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : dashboard ? (
        <div className="space-y-6">
          {dashboard.segments.map((segment) => (
            <SegmentCard key={segment.key} segment={segment} />
          ))}
          {dashboard.specialistSegments.length > 0 && <SpecialistSegmentTable segments={dashboard.specialistSegments} />}
        </div>
      ) : null}

      {runs && runs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Walk-Forward Folds</h2>
          <div className="space-y-3">
            {runs.map((run) => (
              <Card key={run.id}>
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">FOLD</div>
                    <div className="font-bold">#{run.foldIndex}</div>
                  </div>
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">VALIDATION WINDOW</div>
                    <div>{formatDate(run.validationStart)} – {formatDate(run.validationEnd)}</div>
                    <div className="text-xs text-muted-foreground">
                      acc {run.validationMetrics.accuracy !== null ? `${run.validationMetrics.accuracy}%` : "—"} (n={run.validationMetrics.n})
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">TEST WINDOW (unseen)</div>
                    <div>{formatDate(run.testStart)} – {formatDate(run.testEnd)}</div>
                    <div className="text-xs text-muted-foreground">
                      acc {run.testMetrics.accuracy !== null ? `${run.testMetrics.accuracy}%` : "—"} (n={run.testMetrics.n})
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">MODEL VERSION</div>
                    <div className="font-mono text-xs">{run.modelVersion}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
