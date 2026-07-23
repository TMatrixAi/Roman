import { useState } from "react"
import { useParams, Link } from "wouter"
import {
  useGetBacktest,
  useGetBacktestPredictions,
  useCancelBacktest,
  type BacktestPrediction,
  type BacktestCalibrationBucket,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  FlaskConical,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Download,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  BarChart3,
  TrendingUp,
  Target,
  Filter,
} from "lucide-react"
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
import { formatDate } from "@/lib/utils"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "outline" }> = {
  completed: { label: "COMPLETED", variant: "success" },
  "completed-with-warnings": { label: "WARNINGS", variant: "warning" },
  failed: { label: "FAILED", variant: "destructive" },
  cancelled: { label: "CANCELLED", variant: "outline" },
  running: { label: "RUNNING", variant: "secondary" },
  queued: { label: "QUEUED", variant: "outline" },
  validating: { label: "VALIDATING", variant: "secondary" },
  preparing: { label: "PREPARING", variant: "secondary" },
  "generating-report": { label: "REPORTING", variant: "secondary" },
}

const ACTIVE_STATUSES = new Set(["queued", "validating", "preparing", "running", "training", "generating-report"])

function isActive(s: string) {
  return ACTIVE_STATUSES.has(s)
}

function pct(n: number | null | undefined, decimals = 1) {
  return n == null ? "—" : `${n.toFixed ? n.toFixed(decimals) : n}%`
}

function fmt3(n: number | null | undefined) {
  return n == null ? "—" : (typeof n === "number" ? n.toFixed(3) : n)
}

function MetricStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-1 p-4 bg-background rounded-xl border border-border/50 shadow-sm text-center">
      <div className="text-[9px] font-mono font-bold text-muted-foreground tracking-widest uppercase">{label}</div>
      <div className="text-2xl font-display font-bold tracking-tight text-primary tabular-nums">{value}</div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ─── Calibration Chart ───────────────────────────────────────────────────────

function CalibrationChart({ buckets }: { buckets: BacktestCalibrationBucket[] }) {
  const data = buckets.map((b) => ({
    label: b.label,
    predicted: b.avgPredicted != null ? +(b.avgPredicted * 100).toFixed(1) : null,
    observed: b.observedAccuracy,
    n: b.n,
  }))

  if (data.every((d) => d.n === 0)) {
    return (
      <div className="py-10 text-center text-xs font-mono text-muted-foreground">
        No data for calibration chart
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth: 280 }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: "monospace" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fontFamily: "monospace" }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
              formatter={(value: number, name: string) => [`${value?.toFixed(1)}%`, name === "observed" ? "Observed" : "Predicted"]}
            />
            <ReferenceLine y={50} stroke="hsl(var(--muted-foreground)/0.4)" strokeDasharray="4 4" />
            <Bar dataKey="observed" fill="hsl(var(--primary))" name="Observed accuracy" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="text-center text-[9px] font-mono text-muted-foreground mt-1">
          Confidence band → observed accuracy (tap bars for n)
        </div>
      </div>
    </div>
  )
}

// ─── Individual Prediction Explorer ──────────────────────────────────────────

function PredictionExplorer({ runId, status }: { runId: number; status: string }) {
  const [surface, setSurface] = useState("")
  const [correct, setCorrect] = useState<"" | "true" | "false">("")
  const [resultType, setResultType] = useState("")
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<number | null>(null)
  const PAGE = 20
  const { data: preds, isLoading } = useGetBacktestPredictions(runId, {
    limit: PAGE,
    offset,
    surface: surface || undefined,
    correct: (correct || undefined) as "true" | "false" | undefined,
    resultType: resultType || undefined,
  })

  const atEnd = !preds || preds.length < PAGE

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
          value={surface}
          onChange={(e) => { setSurface(e.target.value); setOffset(0) }}
        >
          <option value="">All surfaces</option>
          <option value="Hard">Hard</option>
          <option value="Clay">Clay</option>
          <option value="Grass">Grass</option>
        </select>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
          value={correct}
          onChange={(e) => { setCorrect(e.target.value as "" | "true" | "false"); setOffset(0) }}
        >
          <option value="">All results</option>
          <option value="true">Correct only</option>
          <option value="false">Incorrect only</option>
        </select>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
          value={resultType}
          onChange={(e) => { setResultType(e.target.value); setOffset(0) }}
        >
          <option value="">All result types</option>
          <option value="normal">Normal</option>
          <option value="retired">Retired</option>
          <option value="walkover">Walkover</option>
        </select>
      </div>

      {isLoading && <Skeleton className="h-48 rounded-xl" />}

      {!isLoading && preds && preds.length === 0 && (
        <div className="py-10 text-center border border-dashed rounded-xl text-muted-foreground font-mono text-xs">
          No predictions match the current filters
        </div>
      )}

      {!isLoading && preds && preds.length > 0 && (
        <div className="space-y-2">
          {preds.map((p) => (
            <PredictionCard
              key={p.id}
              p={p}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(offset > 0 || !atEnd) && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            disabled={offset === 0}
            className="font-mono text-[10px] tracking-widest"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + PAGE)}
            disabled={atEnd}
            className="font-mono text-[10px] tracking-widest"
          >
            Next
          </Button>
          <span className="self-center text-xs font-mono text-muted-foreground ml-1">
            Showing {offset + 1}–{offset + (preds?.length ?? 0)}
          </span>
        </div>
      )}
    </div>
  )
}

function PredictionCard({ p, expanded, onToggle }: { p: BacktestPrediction; expanded: boolean; onToggle: () => void }) {
  const isCorrect = p.predictedWinnerId && p.actualWinnerId && p.predictedWinnerId === p.actualWinnerId
  const prob = p.calibratedProbability ?? p.rawProbability

  return (
    <div className={`relative rounded-lg border transition-colors ${isCorrect ? "border-success/30 bg-success/5" : p.includedInAccuracy ? "border-destructive/20 bg-destructive/5" : "border-border/40 bg-secondary/5"}`}>
      <button
        className="w-full text-left p-3 flex items-start gap-3"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold truncate">
              {p.player1Name} vs {p.player2Name}
            </span>
            {p.surface && (
              <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0 tracking-widest">{p.surface}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-muted-foreground flex-wrap">
            <span>{new Date(p.scheduledStartAt).toLocaleDateString()}</span>
            {p.tournamentName && <span className="truncate max-w-[120px]">{p.tournamentName}</span>}
            {prob != null && <span>Prob: <strong className="text-foreground">{prob.toFixed(1)}%</strong></span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {p.includedInAccuracy && (
            isCorrect
              ? <CheckCircle2 className="w-4 h-4 text-success" />
              : <XCircle className="w-4 h-4 text-destructive" />
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2.5">
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div className="space-y-1">
              <div className="text-muted-foreground uppercase tracking-widest font-bold">Predicted winner</div>
              <div className="text-foreground font-bold">{p.predictedWinnerName ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground uppercase tracking-widest font-bold">Actual winner</div>
              <div className="text-foreground font-bold">{p.actualWinnerName ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground uppercase tracking-widest font-bold">Raw prob</div>
              <div className="text-foreground">{p.rawProbability?.toFixed(1) ?? "—"}%</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground uppercase tracking-widest font-bold">Calibrated prob</div>
              <div className="text-primary font-bold">{p.calibratedProbability?.toFixed(1) ?? "—"}%</div>
            </div>
            {p.matchFormat && (
              <div className="space-y-1">
                <div className="text-muted-foreground uppercase tracking-widest font-bold">Format</div>
                <div className="text-foreground">{p.matchFormat}</div>
              </div>
            )}
            {p.resultType && (
              <div className="space-y-1">
                <div className="text-muted-foreground uppercase tracking-widest font-bold">Result type</div>
                <div className="text-foreground capitalize">{p.resultType}</div>
              </div>
            )}
          </div>
          {!p.includedInAccuracy && (
            <div className="text-[10px] font-mono text-muted-foreground bg-secondary/30 rounded px-2 py-1">
              Excluded from accuracy ({p.resultType ?? "void"})
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Segment Breakdown ───────────────────────────────────────────────────────

function SegmentBreakdown({ runId }: { runId: number }) {
  const { data: preds, isLoading } = useGetBacktestPredictions(runId, { limit: 1000, offset: 0 })

  if (isLoading) return <Skeleton className="h-32 rounded-xl" />
  if (!preds || preds.length === 0) return null

  // Group by surface
  const surfaces: Record<string, { correct: number; total: number }> = {}
  for (const p of preds) {
    if (!p.includedInAccuracy || !p.actualWinnerId) continue
    const surface = p.surface ?? "Unknown"
    if (!surfaces[surface]) surfaces[surface] = { correct: 0, total: 0 }
    surfaces[surface].total++
    if (p.predictedWinnerId === p.actualWinnerId) surfaces[surface].correct++
  }

  // Group by level
  const levels: Record<string, { correct: number; total: number }> = {}
  for (const p of preds) {
    if (!p.includedInAccuracy || !p.actualWinnerId) continue
    const level = p.tournamentLevel ?? "Unknown"
    if (!levels[level]) levels[level] = { correct: 0, total: 0 }
    levels[level].total++
    if (p.predictedWinnerId === p.actualWinnerId) levels[level].correct++
  }

  const renderSegment = (label: string, data: Record<string, { correct: number; total: number }>) => (
    <div className="space-y-2">
      <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">{label}</div>
      {Object.entries(data)
        .filter(([, v]) => v.total >= 5)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([key, v]) => {
          const acc = Math.round((v.correct / v.total) * 1000) / 10
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs font-mono w-24 shrink-0 text-foreground">{key}</span>
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${acc}%` }} />
              </div>
              <span className="text-xs font-mono tabular-nums text-muted-foreground w-20 text-right">
                {acc}% <span className="text-muted-foreground/60">n={v.total}</span>
              </span>
            </div>
          )
        })}
    </div>
  )

  return (
    <div className="space-y-6 p-5 bg-secondary/10 rounded-xl border border-border/40">
      {renderSegment("By Surface", surfaces)}
      {renderSegment("By Tournament Level", levels)}
    </div>
  )
}

// ─── Main Results Page ───────────────────────────────────────────────────────

export default function BacktestResultsPage() {
  const { id } = useParams<{ id: string }>()
  const runId = parseInt(id, 10)
  const [showCalibration, setShowCalibration] = useState(false)
  const [showPredictions, setShowPredictions] = useState(false)
  const [showSegments, setShowSegments] = useState(false)

  const { data: run, isLoading, isError } = useGetBacktest(runId)
  const cancel = useCancelBacktest()

  if (isNaN(runId)) {
    return <div className="py-20 text-center font-mono text-muted-foreground">Invalid backtest ID</div>
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl animate-in fade-in">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (isError || !run) {
    return (
      <div className="py-20 text-center border border-dashed rounded-xl text-muted-foreground font-mono text-sm max-w-4xl">
        Backtest run not found.{" "}
        <Link href="/backtesting" className="text-primary underline">Back to portal</Link>
      </div>
    )
  }

  const m = run.metrics
  const active = isActive(run.status)
  const statusMeta = STATUS_META[run.status] ?? { label: run.status.toUpperCase(), variant: "outline" as const }
  const filters = run.filters ?? {}

  const exportUrl = (format: "json" | "csv") => `/api/backtests/${runId}/export?format=${format}`

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">

      {/* Breadcrumb + header */}
      <div className="space-y-3">
        <Link href="/backtesting" className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground hover:text-primary transition-colors">
          <ChevronLeft className="w-4 h-4" /> Backtesting Portal
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight flex items-center gap-3 flex-wrap">
              <FlaskConical className="w-6 h-6 text-primary shrink-0" />
              {run.name}
            </h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant={statusMeta.variant as "success" | "warning" | "destructive" | "secondary" | "outline"} className="font-mono text-[10px] tracking-widest">
                {statusMeta.label}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
                {run.mode === "evaluation" ? "EVALUATION ONLY" : "TRAINING MODE"}
              </Badge>
              {run.modelVersion && (
                <span className="text-[10px] font-mono text-muted-foreground">MODEL v{run.modelVersion}</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {active && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancel.mutate(runId)}
                disabled={cancel.isPending}
                className="font-mono text-[10px] tracking-widest"
              >
                CANCEL RUN
              </Button>
            )}
            {!active && run.status !== "failed" && (
              <div className="flex items-center gap-1.5">
                <a
                  href={exportUrl("csv")}
                  download
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border/50 text-xs font-mono font-bold tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </a>
                <a
                  href={exportUrl("json")}
                  download
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border/50 text-xs font-mono font-bold tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> JSON
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Safety label */}
      <div className="flex items-start gap-2.5 p-3.5 border border-primary/20 bg-primary/5 rounded-xl">
        <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-muted-foreground leading-relaxed">
          {run.mode === "evaluation"
            ? "Evaluation only — current model and calibration used, frozen. No production changes were made by this run."
            : "Training mode — candidate config generated if this run succeeded. Production config was NOT changed."}
        </p>
      </div>

      {/* Active progress */}
      {active && (
        <Card className="glass-panel border-primary/20">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-mono font-bold">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              {run.currentStage ?? "Running…"}
            </div>
            {run.totalRows > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                  <span>{run.processedRows.toLocaleString()} / {run.totalRows.toLocaleString()} matches scored</span>
                  <span>{Math.round((run.processedRows / run.totalRows) * 100)}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-700 rounded-full"
                    style={{ width: `${Math.min(100, (run.processedRows / run.totalRows) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-[10px] font-mono text-muted-foreground">
              Auto-refreshes every 3 seconds — you can leave this page and come back.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Run metadata */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] font-mono">
        {run.dateRange && (
          <div className="p-3 bg-secondary/20 rounded-lg border border-border/40 space-y-0.5">
            <div className="text-muted-foreground uppercase tracking-widest font-bold">Date Range</div>
            <div className="text-foreground font-bold">{run.dateRange.start} → {run.dateRange.end}</div>
          </div>
        )}
        {run.rowCounts && (
          <>
            <div className="p-3 bg-secondary/20 rounded-lg border border-border/40 space-y-0.5">
              <div className="text-muted-foreground uppercase tracking-widest font-bold">Eligible</div>
              <div className="text-foreground font-bold">{run.rowCounts.eligible.toLocaleString()}</div>
            </div>
            <div className="p-3 bg-secondary/20 rounded-lg border border-border/40 space-y-0.5">
              <div className="text-muted-foreground uppercase tracking-widest font-bold">Excluded</div>
              <div className="text-foreground font-bold">{run.rowCounts.excluded.toLocaleString()}</div>
            </div>
          </>
        )}
        {run.completedAt && (
          <div className="p-3 bg-secondary/20 rounded-lg border border-border/40 space-y-0.5">
            <div className="text-muted-foreground uppercase tracking-widest font-bold">Completed</div>
            <div className="text-foreground font-bold">{formatDate(run.completedAt)}</div>
          </div>
        )}
      </div>

      {/* Filters applied */}
      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest self-center">Filters:</span>
          {Object.entries(filters).filter(([, v]) => v != null && v !== false).map(([k, v]) => (
            <Badge key={k} variant="outline" className="font-mono text-[9px] tracking-widest">
              {k}: {String(v)}
            </Badge>
          ))}
        </div>
      )}

      {/* Errors */}
      {run.errors && run.errors.length > 0 && (
        <div className="flex items-start gap-2.5 p-4 border border-warning/30 bg-warning/5 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="text-xs font-mono font-bold text-foreground">Run completed with {run.errors.length} warning{run.errors.length !== 1 ? "s" : ""}</div>
            {run.errors.slice(0, 3).map((e, i) => (
              <div key={i} className="text-[10px] font-mono text-muted-foreground">{e.message}</div>
            ))}
            {run.errors.length > 3 && <div className="text-[10px] font-mono text-muted-foreground">…and {run.errors.length - 3} more</div>}
          </div>
        </div>
      )}

      {/* Main metrics */}
      {m && (
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <Target className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-lg font-bold font-display">Performance Summary</h2>
            <span className="text-xs font-mono text-muted-foreground ml-auto">n = {m.n?.toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricStat label={`ACCURACY (n=${m.n ?? "—"})`} value={pct(m.accuracy)} />
            <MetricStat label="LOG LOSS" value={fmt3(m.logLoss) as string} />
            <MetricStat label="BRIER SCORE" value={fmt3(m.brier) as string} />
            <MetricStat
              label="CLOSE MATCH ACC."
              value={pct(m.closeMatchAccuracy)}
              sub="45–55% band"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricStat
              label="RETIREMENT ADJ."
              value={pct(m.retirementAdjustedAccuracy)}
              sub="incl. retirements"
            />
            <MetricStat label={`RETIREMENTS`} value={String(m.retiredCount ?? "—")} />
            <MetricStat label="VOID / EXCLUDED" value={String(m.voidCount ?? "—")} />
            <div className="p-4 bg-background rounded-xl border border-border/50 shadow-sm text-center space-y-1">
              <div className="text-[9px] font-mono font-bold text-muted-foreground tracking-widest uppercase">DATE RANGE</div>
              <div className="text-xs font-mono text-foreground leading-relaxed">
                {m.dateRangeStart ? new Date(m.dateRangeStart).toLocaleDateString() : "—"}
                <br />→ {m.dateRangeEnd ? new Date(m.dateRangeEnd).toLocaleDateString() : "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Calibration chart (collapsible) */}
      {m?.calibrationBuckets && (m.calibrationBuckets as BacktestCalibrationBucket[]).length > 0 && (
        <section>
          <button
            className="flex items-center gap-2 w-full text-left border-b border-border/40 pb-3 mb-4 hover:text-primary transition-colors"
            onClick={() => setShowCalibration((v) => !v)}
          >
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <BarChart3 className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-lg font-bold font-display flex-1">Calibration Chart</h2>
            {showCalibration ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showCalibration && (
            <div className="space-y-4">
              <p className="text-xs font-mono text-muted-foreground">Confidence band (x-axis) vs observed accuracy (bar). A well-calibrated model shows bars tracking the 50% baseline proportionally — a 70% confidence band should resolve correctly ~70% of the time.</p>
              <CalibrationChart buckets={m.calibrationBuckets as BacktestCalibrationBucket[]} />
              <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
                {(m.calibrationBuckets as BacktestCalibrationBucket[]).map((b) => (
                  <div key={b.label} className="border border-border/40 bg-background rounded-lg p-2 text-center shadow-sm">
                    <div className="text-[9px] font-mono font-bold text-muted-foreground">{b.label}</div>
                    <div className="text-sm font-bold font-mono text-primary mt-0.5">{b.observedAccuracy != null ? `${b.observedAccuracy}%` : "—"}</div>
                    <div className="text-[9px] font-mono text-muted-foreground">n={b.n}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Segment breakdown (collapsible) */}
      {!active && run.status !== "failed" && (
        <section>
          <button
            className="flex items-center gap-2 w-full text-left border-b border-border/40 pb-3 mb-4 hover:text-primary transition-colors"
            onClick={() => setShowSegments((v) => !v)}
          >
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-lg font-bold font-display flex-1">Segment Breakdown</h2>
            {showSegments ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showSegments && <SegmentBreakdown runId={runId} />}
        </section>
      )}

      {/* Individual Prediction Explorer (collapsible) */}
      {!active && run.status !== "failed" && (
        <section>
          <button
            className="flex items-center gap-2 w-full text-left border-b border-border/40 pb-3 mb-4 hover:text-primary transition-colors"
            onClick={() => setShowPredictions((v) => !v)}
          >
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <Filter className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-lg font-bold font-display flex-1">Individual Prediction Explorer</h2>
            {showPredictions ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showPredictions && <PredictionExplorer runId={runId} status={run.status} />}
        </section>
      )}
    </div>
  )
}
