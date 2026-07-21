import { useGetShadowReplayDashboard } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, BarChart2, Database, TrendingUp } from "lucide-react"
import { formatEasternDate } from "@/lib/timezone"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts"

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-secondary/40 border border-border/50 rounded-xl p-4 space-y-1 text-center">
      <p className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-bold font-mono tabular-nums">{value}</p>
      {sub && <p className="text-xs font-mono text-muted-foreground/70">{sub}</p>}
    </div>
  )
}

function pct(n: number | null | undefined, decimals = 1): string {
  return n == null ? "—" : `${(n * 100).toFixed(decimals)}%`
}

function num(n: number | null | undefined, decimals = 4): string {
  return n == null ? "—" : n.toFixed(decimals)
}

export default function ShadowReplayPage() {
  const { data, isLoading, isError } = useGetShadowReplayDashboard()

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl">
        <div className="space-y-2 border-b border-border/50 pb-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="py-20 text-center border border-dashed rounded-xl text-muted-foreground font-mono text-sm">
        Shadow trading data unavailable — the endpoint may not have data yet.
      </div>
    )
  }

  const overall = data.overall ?? { n: 0, accuracy: 0, logLoss: null, brier: null, eceRaw: null, eceCalibrated: null, retiredCount: 0, retiredAccuracy: null, voidCount: 0, missedCount: 0, dateRangeStart: null, dateRangeEnd: null }
  const calibrationBuckets = data.calibrationBuckets ?? []
  const batches = data.batches ?? []

  const calibData = calibrationBuckets.map((b) => ({
    label: b.label,
    predicted: b.avgPredicted != null ? +(b.avgPredicted * 100).toFixed(1) : null,
    observed: b.observedAccuracy != null ? +(b.observedAccuracy * 100).toFixed(1) : null,
    n: b.n,
  }))

  const isEmpty = overall.n === 0 && batches.length === 0

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight flex items-center gap-3">
            Paper Trading
            <Badge variant="outline" className="font-mono text-xs normal-case">Simulated</Badge>
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Retroactively-constructed predictions scored against settled outcomes.
          </p>
        </div>
      </div>

      {/* Disclosure banner */}
      <div className="flex items-start gap-3 p-4 border border-warning/40 bg-warning/5 rounded-xl">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        <p className="text-sm font-mono text-muted-foreground leading-relaxed">
          <strong className="text-foreground">SIMULATED DATA ONLY.</strong>{" "}
          These predictions were constructed retroactively against already-settled match outcomes — they were never submitted live to any market or used to place bets.
          Results here represent a best-case upper bound on engine performance, not a live trading track record.
          Figures should never be interpreted as forward-looking performance.
        </p>
      </div>

      {isEmpty ? (
        <div className="py-16 text-center border border-dashed rounded-xl text-muted-foreground font-mono text-xs tracking-widest uppercase">
          No paper trading data yet
        </div>
      ) : (
        <>
          {/* Overall metrics */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border/50 pb-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-bold font-display">Overall Performance</h2>
              <span className="text-sm font-mono text-muted-foreground ml-auto">
                n = {overall.n.toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="ACCURACY"
                value={pct(overall.accuracy)}
                sub={overall.n > 0 ? `${overall.n.toLocaleString()} graded` : "no data"}
              />
              <MetricCard
                label="LOG LOSS"
                value={num(overall.logLoss, 4)}
                sub="lower = better"
              />
              <MetricCard
                label="BRIER SCORE"
                value={num(overall.brier, 4)}
                sub="lower = better"
              />
              <MetricCard
                label="ECE CALIBRATED"
                value={num(overall.eceCalibrated, 4)}
                sub="calib. error"
              />
            </div>
            {(overall.retiredCount > 0 || overall.voidCount > 0) && (
              <p className="text-xs font-mono text-muted-foreground">
                {overall.retiredCount > 0 && `${overall.retiredCount} retirement(s) included`}
                {overall.retiredCount > 0 && overall.voidCount > 0 && " · "}
                {overall.voidCount > 0 && `${overall.voidCount} void(s) excluded`}
                {overall.missedCount > 0 && ` · ${overall.missedCount} missed`}
              </p>
            )}
            {overall.dateRangeStart && (
              <p className="text-xs font-mono text-muted-foreground">
                Coverage: {formatEasternDate(overall.dateRangeStart)}
                {overall.dateRangeEnd && ` – ${formatEasternDate(overall.dateRangeEnd)}`}
              </p>
            )}
          </section>

          {/* Calibration chart */}
          {calibData.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-border/50 pb-3">
                <div className="p-2 bg-secondary rounded-lg">
                  <BarChart2 className="w-4 h-4 text-secondary-foreground" />
                </div>
                <h2 className="text-xl font-bold font-display">Calibration</h2>
              </div>
              <Card className="glass-panel border-border shadow-md">
                <CardContent className="pt-6 pb-4">
                  <p className="text-xs font-mono text-muted-foreground mb-4">
                    Each group shows avg. predicted probability vs. observed win rate.
                    Perfect calibration = bars aligned. Buckets with no graded predictions are omitted.
                  </p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={calibData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fontFamily: "monospace" }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 10, fontFamily: "monospace" }}
                        domain={[0, 100]}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
                        formatter={(value, name) => [
                          `${value}%`,
                          name === "predicted" ? "Avg Predicted" : "Observed Win Rate",
                        ]}
                      />
                      <ReferenceLine
                        y={50}
                        stroke="hsl(var(--muted-foreground)/0.3)"
                        strokeDasharray="4 4"
                      />
                      <Bar
                        dataKey="predicted"
                        name="predicted"
                        fill="hsl(var(--primary)/0.5)"
                        radius={[2, 2, 0, 0]}
                      />
                      <Bar
                        dataKey="observed"
                        name="observed"
                        fill="hsl(var(--accent))"
                        radius={[2, 2, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-3 justify-end text-xs font-mono text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm bg-primary/50 inline-block" />
                      Predicted
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm bg-accent inline-block" />
                      Observed
                    </span>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Batch history */}
          {batches.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-3 border-b border-border/50 pb-3">
                <div className="p-2 bg-secondary rounded-lg">
                  <Database className="w-4 h-4 text-secondary-foreground" />
                </div>
                <h2 className="text-xl font-bold font-display">Batch History</h2>
                <Badge variant="outline" className="font-mono text-xs ml-auto">
                  {batches.length} batch{batches.length === 1 ? "" : "es"}
                </Badge>
              </div>
              <div className="divide-y divide-border/40 border border-border/40 rounded-xl overflow-hidden">
                {batches.map((batch) => (
                  <div
                    key={batch.batchLabel}
                    className="p-4 flex flex-wrap items-center gap-x-6 gap-y-1 bg-card hover:bg-secondary/30 transition-colors"
                  >
                    <span className="font-mono text-sm font-bold">{batch.batchLabel}</span>
                    <span className="text-sm text-muted-foreground font-mono">
                      {batch.n.toLocaleString()} prediction{batch.n !== 1 ? "s" : ""}
                    </span>
                    {(batch.dateRangeStart || batch.dateRangeEnd) && (
                      <span className="text-xs font-mono text-muted-foreground/70">
                        {batch.dateRangeStart ? formatEasternDate(batch.dateRangeStart) : "?"}
                        {" – "}
                        {batch.dateRangeEnd ? formatEasternDate(batch.dateRangeEnd) : "?"}
                      </span>
                    )}
                    {batch.latestLockedAt && (
                      <span className="text-xs font-mono text-muted-foreground/70 ml-auto">
                        Graded {formatEasternDate(batch.latestLockedAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
