import { useState } from "react"
import {
  useGetEvaluationDashboard,
  useListEvaluationRuns,
  useRunWalkForward,
  useRunPaperTradingCycle,
  useGetEvaluationSettings,
  useUpdateEvaluationSettings,
  useRunShadowReplay,
  useGetShadowReplayDashboard,
  type EvaluationDashboardSegment,
  type SpecialistSegmentSummary,
  type EliteTierBacktest,
  type SegmentMetrics,
  type MarketEdgeSummary,
  type UpsetRiskTierMetrics,
  type DisagreementTierMetrics,
  type ShadowReplayDashboard,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { formatDate } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { getGetEvaluationDashboardQueryKey, getListEvaluationRunsQueryKey, getGetEvaluationSettingsQueryKey, getGetShadowReplayDashboardQueryKey } from "@workspace/api-client-react"
import { Loader2, PlayCircle, Radio, Flame, Snowflake, Layers, Crown, LineChart, ShieldAlert, Swords, FlaskConical } from "lucide-react"

/** Below this many graded rows, a tier's own numbers are too noisy to trust at face value --
 * mirrors the n<30 minimum-sample convention this dashboard already uses for the Elite tier
 * backtest (`EliteTierGroupStats`'s `minSampleSize`). */
const LOW_CONFIDENCE_TIER_SAMPLE = 30

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5 p-4 bg-background rounded-xl border border-border/50 shadow-sm text-center">
      <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">{label}</div>
      <div className="text-3xl font-display font-bold tracking-tight text-primary tabular-nums">{value}</div>
    </div>
  )
}

function eceRead(ece: number | null | undefined): { label: string; variant: "success" | "warning" | "destructive" | "outline" } {
  if (ece === null || ece === undefined) return { label: "NO DATA", variant: "outline" }
  if (ece < 0.03) return { label: "WELL-CALIBRATED", variant: "success" }
  if (ece <= 0.05) return { label: "BORDERLINE", variant: "warning" }
  return { label: "MISCALIBRATED", variant: "destructive" }
}

function ECEStat({ label, ece }: { label: string; ece: number | null | undefined }) {
  const read = eceRead(ece)
  return (
    <div className="space-y-1.5 p-4 bg-background rounded-xl border border-border/50 shadow-sm flex flex-col items-center justify-center">
      <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">{label}</div>
      <div className="flex items-center gap-3 mt-1">
        <div className="text-3xl font-display font-bold tracking-tight text-foreground tabular-nums">{ece !== null && ece !== undefined ? ece.toFixed(3) : "—"}</div>
        <Badge variant={read.variant} className="font-mono text-[10px] tracking-widest shadow-sm">{read.label}</Badge>
      </div>
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
    <Card className="glass-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/50 bg-secondary/20">
        <div>
          <CardTitle className="text-xl font-display">{segment.label}</CardTitle>
          <p className="text-sm font-mono text-muted-foreground mt-1 tracking-wider">{dateRange}</p>
        </div>
        <Badge variant={segment.isGenuinelyUnseen ? "success" : "secondary"} className="font-mono text-[10px] tracking-widest px-3 py-1 shadow-sm">
          {segment.isGenuinelyUnseen ? "GENUINELY UNSEEN" : "USED FOR CALIBRATION"}
        </Badge>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <MetricStat label={`ACCURACY (n=${m.n})`} value={m.accuracy !== null ? `${m.accuracy}%` : "—"} />
          <MetricStat label="LOG LOSS" value={m.logLoss !== null ? m.logLoss.toFixed(3) : "—"} />
          <MetricStat label="BRIER SCORE" value={m.brier !== null ? m.brier.toFixed(3) : "—"} />
          <MetricStat
            label={`RETIREMENTS (n=${m.retiredCount})`}
            value={m.retiredAccuracy !== null ? `${m.retiredAccuracy}%` : "excluded"}
          />
        </div>

        <div className="flex flex-wrap gap-4 text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">
          <span className="bg-secondary/30 px-3 py-1.5 rounded-md border border-border/50">VOID (walkover/cancelled): <span className="text-foreground">{m.voidCount}</span></span>
          <span className="bg-secondary/30 px-3 py-1.5 rounded-md border border-border/50">MISSED CUTOFF: <span className="text-foreground">{m.missedCount}</span></span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <ECEStat label="ECE (RAW)" ece={m.eceRaw} />
          <ECEStat label="ECE (CALIBRATED)" ece={m.eceCalibrated} />
        </div>

        <div className="space-y-3 bg-secondary/20 p-5 rounded-2xl border border-border/50">
          <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">CALIBRATION BUCKETS (confidence vs. observed accuracy)</div>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
            {segment.calibrationBuckets.map((b) => (
              <div key={b.label} className="border border-border/50 bg-background rounded-xl p-3 text-center shadow-sm">
                <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest">{b.label}</div>
                <div className="text-lg font-display font-bold mt-1 text-primary tabular-nums">{b.observedAccuracy !== null ? `${b.observedAccuracy}%` : "—"}</div>
                <div className="text-[10px] text-muted-foreground/80 font-mono mt-0.5">n={b.n}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-sm bg-background p-4 rounded-xl border border-border/50 shadow-sm">
          <div className="flex items-center gap-2.5">
            {segment.streaks.currentStreakType === "win" ? (
              <Flame className="w-5 h-5 text-success" />
            ) : segment.streaks.currentStreakType === "loss" ? (
              <Snowflake className="w-5 h-5 text-destructive" />
            ) : <span className="w-5 h-5"></span>}
            <span className="font-mono font-bold text-foreground uppercase tracking-widest text-[11px]">
              CURRENT: <span className={segment.streaks.currentStreakType === "win" ? "text-success" : segment.streaks.currentStreakType === "loss" ? "text-destructive" : ""}>{segment.streaks.currentStreakType ? `${segment.streaks.currentStreakLength} ${segment.streaks.currentStreakType}${segment.streaks.currentStreakLength === 1 ? "" : "s"}` : "—"}</span>
            </span>
          </div>
          <span className="w-px h-4 bg-border/50 hidden sm:block"></span>
          <span className="font-mono font-bold text-muted-foreground uppercase tracking-widest text-[11px]">LONGEST WIN: <span className="text-foreground">{segment.streaks.longestWinStreak}</span></span>
          <span className="w-px h-4 bg-border/50 hidden sm:block"></span>
          <span className="font-mono font-bold text-muted-foreground uppercase tracking-widest text-[11px]">LONGEST LOSS: <span className="text-foreground">{segment.streaks.longestLossStreak}</span></span>
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
    <Card className="glass-panel">
      <CardHeader className="border-b border-border/50 bg-secondary/20 p-6 md:p-8">
        <CardTitle className="text-xl font-display flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Layers className="w-5 h-5 text-primary" />
          </div>
          Self-Learning Report: Specialist Segments (Phase 6)
        </CardTitle>
        <p className="text-sm text-muted-foreground/80 leading-relaxed mt-4 max-w-4xl">
          This is the engine's real self-learning signal: each tour/surface segment's trust (blend weight) is re-derived
          from its own measured log loss and accuracy vs. the general model on the SAME validation points, every
          calibration refit -- not a fixed rule. Sample sizes are always shown alongside accuracy so a small sample is
          never presented as a strong result.
        </p>
        <p className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase mt-4">
          <span className="text-foreground">{activeCount}</span> of {segments.length} segments actively trusted this cycle
          {mostRecentRefit && <span className="ml-2 text-border">•</span>} {mostRecentRefit && <span className="ml-2">last recomputed {formatDate(mostRecentRefit)}</span>}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/10">
              <tr className="text-left text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase border-b border-border/50">
                <th className="py-4 px-6 font-bold whitespace-nowrap">Segment</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap">Status</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Matches</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Val N</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Spec Acc.</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Gen Acc.</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Spec Loss</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Gen Loss</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {segments.map((s) => (
                <tr key={s.segmentKey} className="hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-6 font-mono font-bold text-foreground whitespace-nowrap">{s.label}</td>
                  <td className="py-3 px-6 whitespace-nowrap">
                    <Badge variant={s.meetsThreshold ? "success" : "outline"} className="font-mono text-[10px] tracking-widest shadow-sm">
                      {s.meetsThreshold ? "ACTIVE" : "INSUFFICIENT"}
                    </Badge>
                  </td>
                  <td className="py-3 px-6 font-mono tabular-nums text-right">{s.historicalMatchCount}</td>
                  <td className="py-3 px-6 font-mono tabular-nums text-right">{s.validationSampleSize}</td>
                  <td className="py-3 px-6 font-mono font-bold tabular-nums text-right text-primary">{s.accuracy !== null && s.accuracy !== undefined ? `${s.accuracy}%` : "—"}</td>
                  <td className="py-3 px-6 font-mono tabular-nums text-right text-muted-foreground">{s.generalAccuracy !== null && s.generalAccuracy !== undefined ? `${s.generalAccuracy}%` : "—"}</td>
                  <td className="py-3 px-6 font-mono tabular-nums text-right text-primary">{s.logLoss !== null && s.logLoss !== undefined ? s.logLoss.toFixed(3) : "—"}</td>
                  <td className="py-3 px-6 font-mono tabular-nums text-right text-muted-foreground">{s.generalLogLoss !== null && s.generalLogLoss !== undefined ? s.generalLogLoss.toFixed(3) : "—"}</td>
                  <td className="py-3 px-6 font-mono font-bold tabular-nums text-right whitespace-nowrap">
                    {s.meetsThreshold ? (
                      <span className="text-success">{s.weight.toFixed(2)}</span>
                    ) : (
                      <span className="text-muted-foreground/60">0.00 <span className="text-[9px] font-normal uppercase ml-1 block mt-0.5">(fallback)</span></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function EliteTierGroupStats({ label, description, metrics, minSampleSize, meetsMinSample }: { label: string; description: string; metrics: SegmentMetrics; minSampleSize: number; meetsMinSample: boolean }) {
  return (
    <div className="space-y-6 border border-border/50 bg-background rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-lg font-display font-bold text-foreground">{label}</div>
          <p className="text-sm text-muted-foreground/80 mt-1 max-w-2xl leading-relaxed">{description}</p>
        </div>
        <Badge variant={meetsMinSample ? "success" : "outline"} className="font-mono text-[10px] tracking-widest uppercase shadow-sm self-start sm:self-auto shrink-0">
          {meetsMinSample ? "SAMPLE SUFFICIENT" : `n < ${minSampleSize}`}
        </Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <MetricStat label={`ACCURACY (n=${metrics.n})`} value={metrics.accuracy !== null ? `${metrics.accuracy}%` : "—"} />
        <MetricStat label="LOG LOSS" value={metrics.logLoss !== null ? metrics.logLoss.toFixed(3) : "—"} />
        <MetricStat label="BRIER SCORE" value={metrics.brier !== null ? metrics.brier.toFixed(3) : "—"} />
        <ECEStat label="ECE (CALIBRATED)" ece={metrics.eceCalibrated} />
      </div>
      {!meetsMinSample && (
        <p className="text-xs text-muted-foreground font-mono bg-secondary/30 p-3 rounded-lg border border-border/50 text-center">
          Fewer than {minSampleSize} graded matches so far -- these numbers will keep firming up as more real outcomes are graded.
        </p>
      )}
    </div>
  )
}

function EliteTierBacktestCard({ backtest }: { backtest: EliteTierBacktest }) {
  return (
    <Card className="glass-panel">
      <CardHeader className="border-b border-border/50 bg-secondary/20 p-6 md:p-8">
        <CardTitle className="text-xl font-display flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Crown className="w-5 h-5 text-primary" />
          </div>
          Elite Tier Backtest
        </CardTitle>
        <p className="text-sm text-muted-foreground/80 leading-relaxed mt-4 max-w-4xl">
          The "Elite Prediction" tier requires high data quality, Surface Elo/Serve &amp; Return/Recent Form all agreeing,
          a validated segment specialist backing the call, and a calibrated pick that agrees with the raw evidence (no
          model conflict, no High Disagreement, no High/Extreme upset risk). Scored against genuinely-unseen graded
          outcomes only (historical test-segment + paper trading), with the same accuracy/logLoss/Brier/ECE methodology
          used everywhere else on this dashboard. Elite is the engine's most selective bar, not a proven track record --
          the accuracy gap below is directionally positive but not yet statistically significant at current sample
          sizes, so read the numbers rather than assuming superiority from the label alone.
        </p>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-6 bg-secondary/10">
        <EliteTierGroupStats
          label="Real Elite Tier"
          description="Every gate genuinely met, including a real segment specialist."
          metrics={backtest.elite}
          minSampleSize={backtest.minSampleSize}
          meetsMinSample={backtest.eliteMeetsMinSample}
        />
        <EliteTierGroupStats
          label="Near-Elite (backtest-only comparison group)"
          description={'Every Elite gate met except segment-specialist support -- unobservable in historical backtests, since specialist segments are themselves fit FROM this same data. Never shown as "Elite" anywhere in the live app.'}
          metrics={backtest.nearElite}
          minSampleSize={backtest.minSampleSize}
          meetsMinSample={backtest.nearEliteMeetsMinSample}
        />
      </CardContent>
    </Card>
  )
}

const UPSET_RISK_TIER_LABEL: Record<string, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", EXTREME: "Extreme" }
const DISAGREEMENT_TIER_LABEL: Record<string, string> = { Strong: "Strong", Moderate: "Moderate", Mixed: "Mixed", HighDisagreement: "High Disagreement" }

function UpsetRiskTierCard({ tiers }: { tiers: UpsetRiskTierMetrics[] }) {
  return (
    <Card className="glass-panel">
      <CardHeader className="border-b border-border/50 bg-secondary/20 p-6 md:p-8">
        <CardTitle className="text-xl font-display flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <ShieldAlert className="w-5 h-5 text-primary" />
          </div>
          Upset-Risk Track Record (Task 56)
        </CardTitle>
        <p className="text-sm text-muted-foreground/80 leading-relaxed mt-4 max-w-4xl">
          Upset risk is a pure downstream classifier of the already-calibrated probability -- it never changes the
          probability itself, so its validation is whether the model's own favorite actually loses more often as the
          tier climbs. A tier is doing real work only if favorite-loss rate rises LOW → MODERATE → HIGH → EXTREME.
          Scoped to genuinely-unseen graded rows only (historical test-segment + paper trading).
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/10">
              <tr className="text-left text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase border-b border-border/50">
                <th className="py-4 px-6 font-bold whitespace-nowrap">Tier</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Sample</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Favorite-Loss Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {tiers.map((t) => {
                const lowConfidence = t.n < LOW_CONFIDENCE_TIER_SAMPLE
                return (
                  <tr key={t.tier} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-foreground whitespace-nowrap text-base">{UPSET_RISK_TIER_LABEL[t.tier] ?? t.tier}</td>
                    <td className="py-4 px-6 font-mono tabular-nums text-right text-muted-foreground">n={t.n}</td>
                    <td className="py-4 px-6 font-mono font-bold tabular-nums text-right">
                      <div className="flex items-center justify-end gap-3">
                        {lowConfidence && (
                          <Badge variant="outline" className="font-mono text-[9px] tracking-widest shadow-sm">
                            LOW CONFIDENCE (n&lt;{LOW_CONFIDENCE_TIER_SAMPLE})
                          </Badge>
                        )}
                        <span className="text-primary text-lg">{t.favoriteLossRate !== null ? `${t.favoriteLossRate}%` : "—"}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function DisagreementTierCard({ tiers }: { tiers: DisagreementTierMetrics[] }) {
  return (
    <Card className="glass-panel">
      <CardHeader className="border-b border-border/50 bg-secondary/20 p-6 md:p-8">
        <CardTitle className="text-xl font-display flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Swords className="w-5 h-5 text-primary" />
          </div>
          Model-Disagreement Track Record (Task 56)
        </CardTitle>
        <p className="text-sm text-muted-foreground/80 leading-relaxed mt-4 max-w-4xl">
          Model agreement is also a pure downstream classifier -- it never changes the calibrated probability. The
          tier that matters most is High Disagreement, which should show the lowest accuracy of the four: those are
          the genuinely hardest matchups, where the engine's own core models point in different directions. Strong/
          Moderate/Mixed aren't expected to fall in a perfectly straight line -- only High Disagreement being worst
          is the load-bearing claim. Scoped to the same genuinely-unseen rows as the upset-risk table above.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/10">
              <tr className="text-left text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase border-b border-border/50">
                <th className="py-4 px-6 font-bold whitespace-nowrap">Tier</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Sample</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Accuracy</th>
                <th className="py-4 px-6 font-bold whitespace-nowrap text-right">Error Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {tiers.map((t) => {
                const lowConfidence = t.n < LOW_CONFIDENCE_TIER_SAMPLE
                return (
                  <tr key={t.tier} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-foreground whitespace-nowrap text-base">
                      <div className="flex items-center gap-3">
                        {DISAGREEMENT_TIER_LABEL[t.tier] ?? t.tier}
                        {t.tier === "HighDisagreement" && (
                          <Badge variant="secondary" className="font-mono text-[9px] tracking-widest shadow-sm">
                            HARDEST TIER
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6 font-mono tabular-nums text-right text-muted-foreground">n={t.n}</td>
                    <td className="py-4 px-6 font-mono font-bold tabular-nums text-right">
                      <div className="flex items-center justify-end gap-3">
                        {lowConfidence && (
                          <Badge variant="outline" className="font-mono text-[9px] tracking-widest shadow-sm">
                            LOW CONFIDENCE (n&lt;{LOW_CONFIDENCE_TIER_SAMPLE})
                          </Badge>
                        )}
                        <span className="text-primary text-lg">{t.accuracy !== null ? `${t.accuracy}%` : "—"}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-mono font-bold tabular-nums text-right text-muted-foreground">{t.errorRate !== null ? `${t.errorRate}%` : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function MarketEdgeCard({ marketEdge }: { marketEdge: MarketEdgeSummary }) {
  const hasData = marketEdge.n > 0 && marketEdge.averageEdge !== null
  return (
    <Card className="glass-panel">
      <CardHeader className="border-b border-border/50 bg-secondary/20 p-6 md:p-8">
        <CardTitle className="text-xl font-display flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <LineChart className="w-5 h-5 text-primary" />
          </div>
          Market Edge (Task 47)
        </CardTitle>
        <p className="text-sm text-muted-foreground/80 leading-relaxed mt-4 max-w-4xl">
          Compares the model's calibrated probability against real, vig-adjusted implied probability from live
          bookmaker odds (The Odds API, falling back to Odds-API.io), captured at the moment each paper-trade
          prediction was locked. This is a distinct metric from accuracy/ECE above -- it measures agreement with the
          market, not with the eventual real-world outcome. Predictions with no odds available at lock time are left
          out entirely, never counted as zero edge.
        </p>
      </CardHeader>
      <CardContent className="p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <MetricStat label={`AVERAGE EDGE (n=${marketEdge.n})`} value={hasData ? `${marketEdge.averageEdge! > 0 ? "+" : ""}${marketEdge.averageEdge}pp` : "—"} />
          <div className="space-y-2 p-5 bg-background rounded-xl border border-border/50 shadow-sm">
            <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">READING</div>
            <div className="text-sm text-foreground/80 leading-relaxed font-medium">
              {hasData
                ? marketEdge.averageEdge! > 0
                  ? "Model is finding more value in its picks than the market prices in, on average."
                  : marketEdge.averageEdge! < 0
                    ? "Market has been pricing the model's picks more favorably than the model itself, on average."
                    : "Model and market agree on average."
                : "No graded paper-trade predictions with odds available yet."}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ShadowReplayCard({ shadowDashboard }: { shadowDashboard: ShadowReplayDashboard | undefined }) {
  const queryClient = useQueryClient()
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [batchLabel, setBatchLabel] = useState("")
  const [overwrite, setOverwrite] = useState(false)

  const runShadowReplay = useRunShadowReplay({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetShadowReplayDashboardQueryKey() }),
    },
  })

  const canSubmit = startDate.trim() !== "" && endDate.trim() !== "" && batchLabel.trim() !== "" && !runShadowReplay.isPending

  const m = shadowDashboard?.overall

  return (
    <Card className="glass-panel border-accent/40">
      <CardHeader className="border-b border-border/50 bg-secondary/20 p-6 md:p-8">
        <CardTitle className="text-xl font-display flex items-center gap-3">
          <div className="p-2 bg-accent/10 rounded-lg">
            <FlaskConical className="w-5 h-5 text-accent" />
          </div>
          Shadow / Simulated Replay
          <Badge variant="outline" className="font-mono text-[10px] tracking-widest uppercase border-accent/50 text-accent">
            SIMULATED — NOT LIVE EVIDENCE
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground/80 leading-relaxed mt-4 max-w-4xl">
          A fast, leakage-safe replay of held-out historical dates through the same point-in-time scoring path as
          walk-forward, so you don't have to wait for real paper trading to slowly accumulate one graded fixture at a
          time. It is graded using <span className="font-semibold text-foreground">today's currently-active calibration</span>{" "}
          applied uniformly across the whole replayed range — not the calibration that was actually live on each
          historical date. Treat this as directional, simulated evidence only. It is never merged into the segments,
          Elite tier, upset-risk, disagreement, or market-edge numbers above, and it never touches real paper-trade or
          walk-forward rows.
        </p>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-8">
        <form
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 items-end bg-background p-5 rounded-xl border border-border/50 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) return
            runShadowReplay.mutate({ data: { startDate, endDate, batchLabel, overwrite } })
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">End Date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">Batch Label</Label>
            <Input type="text" placeholder="e.g. shadow-2024-q1" value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} required />
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <Checkbox id="shadow-overwrite" checked={overwrite} onCheckedChange={(c) => setOverwrite(c === true)} />
            <Label htmlFor="shadow-overwrite" className="text-xs font-mono text-muted-foreground leading-tight cursor-pointer">
              Overwrite this exact batch label if it already exists
            </Label>
          </div>
          <div className="md:col-span-5">
            <Button type="submit" variant="accent" disabled={!canSubmit} className="gap-2 shadow-md font-mono h-10">
              {runShadowReplay.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              RUN SHADOW REPLAY
            </Button>
          </div>
        </form>

        {runShadowReplay.data && (
          <div className="flex flex-wrap gap-3 text-[11px] font-mono font-bold text-muted-foreground tracking-widest uppercase bg-secondary/20 p-4 rounded-xl border border-border/50">
            <span>INSERTED: <span className="text-foreground">{runShadowReplay.data.inserted}</span></span>
            <span className="text-border">•</span>
            <span>ALREADY CLAIMED: <span className="text-foreground">{runShadowReplay.data.skippedAlreadyClaimed}</span></span>
            <span className="text-border">•</span>
            <span>INSUFFICIENT DATA: <span className="text-foreground">{runShadowReplay.data.skippedInsufficientData}</span></span>
            <span className="text-border">•</span>
            <span>DAYS SIMULATED: <span className="text-foreground">{runShadowReplay.data.daysSimulated}</span></span>
            {runShadowReplay.data.overwrite && (
              <>
                <span className="text-border">•</span>
                <span>DELETED (OVERWRITE): <span className="text-foreground">{runShadowReplay.data.deletedExistingBatchRows}</span></span>
              </>
            )}
          </div>
        )}

        {runShadowReplay.isError && (
          <div className="text-sm font-medium text-destructive bg-destructive/5 border border-destructive rounded-xl p-4">
            {runShadowReplay.error instanceof Error ? runShadowReplay.error.message : "Shadow replay failed."}
          </div>
        )}

        {m && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <MetricStat label={`ACCURACY (n=${m.n})`} value={m.accuracy !== null ? `${m.accuracy}%` : "—"} />
            <MetricStat label="LOG LOSS" value={m.logLoss !== null ? m.logLoss.toFixed(3) : "—"} />
            <MetricStat label="BRIER SCORE" value={m.brier !== null ? m.brier.toFixed(3) : "—"} />
            <ECEStat label="ECE (CALIBRATED)" ece={m.eceCalibrated} />
          </div>
        )}

        {shadowDashboard && shadowDashboard.batches.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-sm">
              <thead className="bg-secondary/10">
                <tr className="text-left text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase border-b border-border/50">
                  <th className="py-3 px-5 font-bold whitespace-nowrap">Batch</th>
                  <th className="py-3 px-5 font-bold whitespace-nowrap text-right">N</th>
                  <th className="py-3 px-5 font-bold whitespace-nowrap">Date Range</th>
                  <th className="py-3 px-5 font-bold whitespace-nowrap">Last Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {shadowDashboard.batches.map((b) => (
                  <tr key={b.batchLabel} className="hover:bg-secondary/30 transition-colors">
                    <td className="py-3 px-5 font-mono font-bold text-foreground whitespace-nowrap">{b.batchLabel}</td>
                    <td className="py-3 px-5 font-mono tabular-nums text-right">{b.n}</td>
                    <td className="py-3 px-5 font-mono text-muted-foreground whitespace-nowrap">
                      {b.dateRangeStart && b.dateRangeEnd ? `${formatDate(b.dateRangeStart)} – ${formatDate(b.dateRangeEnd)}` : "—"}
                    </td>
                    <td className="py-3 px-5 font-mono text-muted-foreground whitespace-nowrap">{b.latestLockedAt ? formatDate(b.latestLockedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {shadowDashboard && shadowDashboard.batches.length === 0 && (
          <p className="text-xs text-muted-foreground font-mono bg-secondary/30 p-3 rounded-lg border border-border/50 text-center">
            No shadow-replay batches have been run yet.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default function AccuracyDashboardPage() {
  const queryClient = useQueryClient()
  const { data: dashboard, isLoading } = useGetEvaluationDashboard()
  const { data: runs } = useListEvaluationRuns()
  const { data: settings } = useGetEvaluationSettings()
  const { data: shadowDashboard } = useGetShadowReplayDashboard()

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
    <div className="space-y-10 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Accuracy Dashboard</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Segmented, honestly-labeled results. Validation numbers were used to fit calibration — only test and paper-trade numbers are genuinely unseen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => runPaperTrading.mutate()} disabled={runPaperTrading.isPending} className="gap-2 shadow-sm font-mono h-10">
            {runPaperTrading.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
            RUN PAPER-TRADE
          </Button>
          <Button variant="accent" onClick={() => runWalkForward.mutate({ data: {} })} disabled={runWalkForward.isPending} className="gap-2 shadow-md font-mono h-10">
            {runWalkForward.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            RUN WALK-FORWARD
          </Button>
        </div>
      </div>

      {runWalkForward.data?.skippedNoEligibleMatches && (
        <Card className="border-warning bg-warning/5 shadow-sm">
          <CardContent className="p-5 text-sm font-medium text-warning-foreground flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-warning shrink-0" />
            Not enough historical match data to run a meaningful walk-forward evaluation yet. Backfill more historical matches first.
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card className="glass-panel">
          <CardHeader className="border-b border-border/50 bg-secondary/20 p-5 md:p-6"><CardTitle className="text-lg font-display">Evaluation Settings</CardTitle></CardHeader>
          <CardContent className="flex flex-col md:flex-row md:items-center gap-6 p-6">
            <div className="flex items-start gap-4 p-4 bg-background rounded-xl border border-border/50 shadow-sm flex-1">
              <Switch
                className="mt-0.5"
                checked={settings.retirementRule === "included"}
                onCheckedChange={(checked) => updateSettings.mutate({ data: { retirementRule: checked ? "included" : "excluded" } })}
              />
              <div>
                <div className="text-sm font-bold font-display tracking-wide">Count retirements toward accuracy</div>
                <div className="text-xs text-muted-foreground/80 mt-1 leading-relaxed">Off (default): retirements are graded but reported separately, never in the headline number.</div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-[10px] text-muted-foreground font-mono font-bold tracking-widest uppercase bg-secondary/30 px-3 py-2 rounded-md border border-border/50">
                PAPER-TRADE LEAD: <span className="text-foreground">{settings.paperTradeLeadMinutes} min</span> before start
              </div>
              <div className="text-[10px] text-muted-foreground font-mono font-bold tracking-widest uppercase bg-secondary/30 px-3 py-2 rounded-md border border-border/50">
                CALIBRATION FIT: <span className="text-foreground">{dashboard?.activeCalibrationSampleSize ?? 0} val predictions</span>
                {dashboard?.activeCalibrationMethod && <span className="text-muted-foreground/50 mx-2">|</span>} {dashboard?.activeCalibrationMethod && <span>method: <span className="text-foreground">{dashboard.activeCalibrationMethod}</span></span>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-6">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-full rounded-2xl" />)}
        </div>
      ) : dashboard ? (
        <div className="space-y-8">
          <EliteTierBacktestCard backtest={dashboard.eliteTierBacktest} />
          <UpsetRiskTierCard tiers={dashboard.upsetRiskTierMetrics} />
          <DisagreementTierCard tiers={dashboard.disagreementTierMetrics} />
          <MarketEdgeCard marketEdge={dashboard.marketEdge} />
          <div className="pt-4 border-t border-border/50 space-y-6">
            <h2 className="text-2xl font-bold font-display mb-6">Performance Segments</h2>
            {dashboard.segments.map((segment) => (
              <SegmentCard key={segment.key} segment={segment} />
            ))}
          </div>
          {dashboard.specialistSegments.length > 0 && <SpecialistSegmentTable segments={dashboard.specialistSegments} />}
        </div>
      ) : null}

      <ShadowReplayCard shadowDashboard={shadowDashboard} />

      {runs && runs.length > 0 && (
        <section className="space-y-6 pt-8 border-t border-border/50">
          <h2 className="text-2xl font-bold font-display">Walk-Forward Folds</h2>
          <div className="space-y-4">
            {runs.map((run) => (
              <Card key={run.id} className="shadow-sm glass-panel hover-lift">
                <CardContent className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-4 gap-6 text-sm">
                  <div className="bg-background p-4 rounded-xl border border-border/50 text-center">
                    <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">FOLD</div>
                    <div className="font-display font-bold text-3xl mt-1 text-primary">#{run.foldIndex}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase mb-1.5">VALIDATION WINDOW</div>
                    <div className="font-mono font-bold">{formatDate(run.validationStart)} – {formatDate(run.validationEnd)}</div>
                    <div className="text-xs text-muted-foreground/80 mt-1.5 font-mono">
                      acc <span className="font-bold text-foreground">{run.validationMetrics.accuracy !== null ? `${run.validationMetrics.accuracy}%` : "—"}</span> (n={run.validationMetrics.n})
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase mb-1.5">TEST WINDOW <span className="opacity-50">(unseen)</span></div>
                    <div className="font-mono font-bold">{formatDate(run.testStart)} – {formatDate(run.testEnd)}</div>
                    <div className="text-xs text-muted-foreground/80 mt-1.5 font-mono">
                      acc <span className="font-bold text-foreground">{run.testMetrics.accuracy !== null ? `${run.testMetrics.accuracy}%` : "—"}</span> (n={run.testMetrics.n})
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase mb-1.5">MODEL VERSION</div>
                    <div className="font-mono font-bold bg-secondary/50 px-3 py-1.5 rounded-md inline-block self-start border border-border/50">{run.modelVersion}</div>
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
