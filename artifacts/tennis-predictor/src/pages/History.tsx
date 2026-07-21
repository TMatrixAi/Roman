import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetPredictionStats,
  useListPredictions,
  useDeletePrediction,
  useBulkDeletePredictions,
  useGradePendingLedgerPredictions,
  usePreviewDuplicatePredictions,
  useRemoveDuplicatePredictions,
  useGetLedgerPlayerPredictions,
  getListPredictionsQueryKey,
  getGetPredictionStatsQueryKey,
  getGetLedgerPlayerPredictionsQueryKey,
  type PredictionSummary,
  type DuplicatePredictionsPreviewResult,
} from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate, formatProbability } from "@/lib/utils"
import { asPercentage } from "@/lib/percentage"
import { Skeleton } from "@/components/ui/skeleton"
import { readAndClearPasteSearchHandoff } from "@/lib/pasteSearchHandoff"
import { SavedPredictionsLookup } from "@/components/SavedPredictionsLookup"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Link, useLocation, useSearch } from "wouter"
import {
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  ChevronRight,
  ChevronLeft,
  Trash2,
  RefreshCw,
  Copy,
  X,
  UserSearch,
  ClipboardPaste,
  History as HistoryIcon,
  Scale,
} from "lucide-react"

/** Task #30: real disclosure -- shown when this saved prediction involved a player resolved via
 * the historical-match fallback (not in current live ATP/WTA standings) rather than a live
 * ranking, per `usedHistoricalMatchFallback` (derived server-side from this row's own stored
 * `engine.warnings`, never guessed). Shares the "muted, normal-case" styling `PlayerSearch.tsx`
 * uses for the same real disclosure at prediction-creation time. */
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

function RemoveDuplicateTradesButton({ onRemoved }: { onRemoved: () => void }) {
  const [preview, setPreview] = useState<DuplicatePredictionsPreviewResult | null>(null)
  const [lastRemovedCount, setLastRemovedCount] = useState<number | null>(null)

  const previewDuplicates = usePreviewDuplicatePredictions({
    mutation: { onSuccess: (data) => setPreview(data) },
  })
  const removeDuplicates = useRemoveDuplicatePredictions({
    mutation: {
      onSuccess: (data) => {
        setLastRemovedCount(data.removedCount)
        setPreview(null)
        onRemoved()
      },
    },
  })

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="font-mono self-start md:self-auto"
        disabled={previewDuplicates.isPending}
        onClick={() => {
          setLastRemovedCount(null)
          previewDuplicates.mutate()
        }}
      >
        <Copy className={`w-4 h-4 mr-2 ${previewDuplicates.isPending ? "animate-pulse" : ""}`} />
        REMOVE DUPLICATES
      </Button>

      {lastRemovedCount !== null && (
        <span className="text-xs font-mono text-muted-foreground self-center">
          {lastRemovedCount > 0 ? `Removed ${lastRemovedCount} duplicate${lastRemovedCount === 1 ? "" : "s"}.` : "No duplicates found."}
        </span>
      )}

      <AlertDialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove duplicate trades?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {preview && preview.removableCount > 0 ? (
                  <>
                    <p>
                      Found {preview.removableCount} duplicate prediction{preview.removableCount === 1 ? "" : "s"} across{" "}
                      {preview.groups.length} match{preview.groups.length === 1 ? "" : "es"}. The earliest prediction for each match
                      will be kept; the rest will be permanently deleted from Prediction History.
                    </p>
                    <ul className="max-h-48 overflow-y-auto space-y-1 text-xs font-mono border rounded-md p-2 bg-muted/30">
                      {preview.groups.map((g) => (
                        <li key={g.keepId} className="flex justify-between gap-2">
                          <span className="truncate">
                            {g.player1Name} vs {g.player2Name}
                            {g.tournamentName ? ` (${g.tournamentName})` : ""}
                          </span>
                          <span className="shrink-0 text-muted-foreground">-{g.removeIds.length}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>No duplicate predictions were found in Prediction History.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {preview && preview.removableCount > 0 && (
              <AlertDialogAction disabled={removeDuplicates.isPending} onClick={() => removeDuplicates.mutate()}>
                Remove {preview.removableCount} duplicate{preview.removableCount === 1 ? "" : "s"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function StatCard({ title, value, subtext, icon: Icon }: { title: string, value: string | number, subtext?: string, icon: any }) {
  return (
    <Card className="bg-card shadow-sm glass-panel hover-lift">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-3">
            <p className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
            <p className="text-4xl font-display font-bold tracking-tight text-primary tabular-nums">{value}</p>
            {subtext && <p className="text-xs text-muted-foreground/80 font-medium">{subtext}</p>}
          </div>
          <div className="p-3 bg-secondary/50 rounded-xl border border-border/50">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PredictionRow({
  prediction,
  selected,
  onToggleSelect,
  onDelete,
  isDeleting,
}: {
  prediction: PredictionSummary
  selected: boolean
  onToggleSelect: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const isResolved = !!prediction.actualWinnerName;
  // NOTE: PredictionSummary (the Ledger list endpoint) only exposes player/winner NAMES, not IDs,
  // so this must compare by name -- unlike PredictionResult.tsx and PredictionLog.tsx, which have
  // IDs available and compare by ID. Two same-named players in different matches on the same page
  // is the one theoretical false-positive/negative this leaves open; flagged in the 2026-07-13
  // invariant-checking report rather than fixed here since it requires widening the API contract
  // (PredictionSummary schema + backend route + regenerated client), which is out of scope for a
  // display-layer fix.
  const isCorrect = prediction.actualWinnerName === prediction.predictedWinnerName;

  const renderRecommendationBadge = () => {
    switch (prediction.recommendation) {
      case 'STRONG_RECOMMENDATION': return <Badge variant="success" title="Engine's highest-confidence tier -- validation is still limited and this tier hasn't yet been shown to beat other tiers.">HIGH CONF</Badge>
      case 'MODERATE_LEAN': return <Badge variant="secondary">LEAN</Badge>
      case 'HIGH_RISK': return <Badge variant="warning">RISK</Badge>
      case 'NO_STRONG_SIGNAL': return <Badge variant="outline" className="gap-1 text-muted-foreground border-muted-foreground/30" title="Task #37: prediction was within ±3% of a coin flip — backtesting shows these picks perform at or below chance. Flagged separately so you can track your borderline pick accuracy."><Scale className="w-3 h-3" /> COIN FLIP</Badge>
      case 'DO_NOT_RECOMMEND': return <Badge variant="destructive">NO REC</Badge>
      default: return null
    }
  }

  return (
    <div className="group flex flex-col md:flex-row md:items-center justify-between p-4 sm:p-5 border border-border/50 rounded-xl bg-card/60 backdrop-blur-sm shadow-sm hover:border-primary/40 hover:bg-card hover:shadow-md transition-all duration-300 gap-4">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="w-4 h-4 shrink-0 accent-primary cursor-pointer rounded-sm border-border"
        aria-label={`Select prediction ${prediction.id}`}
      />

      <Link
        href={`/predictions/${prediction.id}?from=ledger`}
        onClick={() => sessionStorage.setItem("ledger_scroll_y", String(window.scrollY))}
        className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
      >
        <div className="flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] font-mono font-bold text-muted-foreground tracking-widest uppercase">
            <span>{formatDate(prediction.createdAt)}</span>
            <span className="text-border">•</span>
            <span className="text-foreground/80 bg-secondary/50 px-2 py-0.5 rounded">{prediction.surface}</span>
            {prediction.tournamentName && (
              <>
                <span className="text-border">•</span>
                <span className="truncate max-w-[45vw] sm:max-w-[150px]">{prediction.tournamentName}</span>
              </>
            )}
            {prediction.usedHistoricalMatchFallback && <HistoricalMatchFallbackBadge />}
          </div>
          <div className="flex items-center gap-3 text-lg sm:text-xl font-display font-bold tracking-tight">
            <span className={prediction.predictedWinnerName === prediction.player1Name ? "text-primary drop-shadow-sm" : "text-foreground/80"}>
              {prediction.player1Name}
            </span>
            <span className="text-sm font-mono font-bold text-muted-foreground/60 italic lowercase px-1">vs</span>
            <span className={prediction.predictedWinnerName === prediction.player2Name ? "text-primary drop-shadow-sm" : "text-foreground/80"}>
              {prediction.player2Name}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 md:gap-8 md:justify-end border-t border-border/50 md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0">
          <div className="flex flex-col md:items-end gap-1.5">
            <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">PREDICTED</div>
            <div className="font-bold font-display flex items-center gap-2">
              {prediction.predictedWinnerName}
              <Badge variant="outline" className="font-mono tabular-nums bg-background shadow-sm">{formatProbability(asPercentage(prediction.predictedWinnerProbability))}</Badge>
            </div>
          </div>

          <div className="flex flex-col md:items-end gap-1.5">
            <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">RECOMMENDATION</div>
            {renderRecommendationBadge()}
          </div>

          <div className="flex flex-col md:items-end gap-1.5 w-24">
            <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">STATUS</div>
            {isResolved ? (
              isCorrect ? (
                <span className="flex items-center gap-1.5 text-sm font-bold text-success drop-shadow-sm">
                  <CheckCircle2 className="w-4 h-4" /> WON
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                  <XCircle className="w-4 h-4" /> LOST
                </span>
              )
            ) : (
              <span className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
                <Clock className="w-4 h-4" /> PENDING
              </span>
            )}
          </div>

          <ChevronRight className="w-5 h-5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all group-hover:translate-x-1 hidden md:block" />
        </div>
      </Link>

      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        disabled={isDeleting}
        onClick={(e) => { e.preventDefault(); onDelete() }}
        aria-label="Delete prediction"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  )
}

/** Read-only rendering of a single prediction, used for the player-navigation focus panel --
 * shares the same layout language as PredictionRow but drops the select checkbox and delete
 * action, since focus mode is purely for jumping around a player's history. */
function PlayerFocusRow({ prediction }: { prediction: PredictionSummary }) {
  const isResolved = !!prediction.actualWinnerName;
  const isCorrect = prediction.actualWinnerName === prediction.predictedWinnerName;

  const renderRecommendationBadge = () => {
    switch (prediction.recommendation) {
      case 'STRONG_RECOMMENDATION': return <Badge variant="success" className="shadow-sm" title="Engine's highest-confidence tier -- validation is still limited and this tier hasn't yet been shown to beat other tiers.">HIGH CONF</Badge>
      case 'MODERATE_LEAN': return <Badge variant="secondary" className="shadow-sm">LEAN</Badge>
      case 'HIGH_RISK': return <Badge variant="warning" className="shadow-sm">RISK</Badge>
      case 'NO_STRONG_SIGNAL': return <Badge variant="outline" className="shadow-sm bg-background gap-1 text-muted-foreground border-muted-foreground/30" title="Prediction was within ±3% of a coin flip — these picks perform at or below chance in backtesting."><Scale className="w-3 h-3" /> COIN FLIP</Badge>
      case 'DO_NOT_RECOMMEND': return <Badge variant="destructive" className="shadow-sm">NO REC</Badge>
      default: return null
    }
  }

  return (
    <Link
      href={`/predictions/${prediction.id}?from=ledger`}
      className="flex flex-col md:flex-row md:items-center justify-between p-5 border-2 border-primary rounded-xl bg-card shadow-md ring-4 ring-primary/20 hover:bg-card/80 transition-all duration-300 gap-4"
    >
      <div className="flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] font-mono font-bold text-muted-foreground tracking-widest uppercase">
          <span>{formatDate(prediction.createdAt)}</span>
          <span className="text-border">•</span>
          <span className="text-foreground/80 bg-secondary/50 px-2 py-0.5 rounded">{prediction.surface}</span>
          {prediction.tournamentName && (
            <>
              <span className="text-border">•</span>
              <span className="truncate max-w-[45vw] sm:max-w-[150px]">{prediction.tournamentName}</span>
            </>
          )}
          {prediction.usedHistoricalMatchFallback && <HistoricalMatchFallbackBadge />}
        </div>
        <div className="flex items-center gap-3 text-lg sm:text-xl font-display font-bold tracking-tight">
          <span className={prediction.predictedWinnerName === prediction.player1Name ? "text-primary drop-shadow-sm" : "text-foreground/80"}>
            {prediction.player1Name}
          </span>
          <span className="text-sm font-mono font-bold text-muted-foreground/60 italic lowercase px-1">vs</span>
          <span className={prediction.predictedWinnerName === prediction.player2Name ? "text-primary drop-shadow-sm" : "text-foreground/80"}>
            {prediction.player2Name}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 md:gap-8 md:justify-end border-t border-border/50 md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0">
        <div className="flex flex-col md:items-end gap-1.5">
          <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">PREDICTED</div>
          <div className="font-bold font-display flex items-center gap-2">
            {prediction.predictedWinnerName}
            <Badge variant="outline" className="font-mono tabular-nums bg-background shadow-sm">{formatProbability(asPercentage(prediction.predictedWinnerProbability))}</Badge>
          </div>
        </div>

        <div className="flex flex-col md:items-end gap-1.5">
          <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">RECOMMENDATION</div>
          {renderRecommendationBadge()}
        </div>

        <div className="flex flex-col md:items-end gap-1.5 w-24">
          <div className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">STATUS</div>
          {isResolved ? (
            isCorrect ? (
              <span className="flex items-center gap-1.5 text-sm font-bold text-success drop-shadow-sm">
                <CheckCircle2 className="w-4 h-4" /> WON
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                <XCircle className="w-4 h-4" /> LOST
              </span>
            )
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
              <Clock className="w-4 h-4" /> PENDING
            </span>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-primary opacity-50 group-hover:opacity-100 transition-all group-hover:translate-x-1 hidden md:block" />
      </div>
    </Link>
  )
}

export default function HistoryPage() {
  const queryClient = useQueryClient()
  const { data: stats, isLoading: statsLoading } = useGetPredictionStats()
  const { data: predictions, isLoading: predictionsLoading } = useListPredictions({ limit: 50 })

  // Restore scroll position when returning from a prediction detail via "Back to Ledger".
  // The position is saved in sessionStorage by PredictionRow's Link onClick; we restore it
  // once after the prediction list first renders (dependency on `predictions`), then clear
  // the key so a manual refresh or later visit starts at the top as normal.
  useEffect(() => {
    if (!predictions) return
    const saved = sessionStorage.getItem("ledger_scroll_y")
    if (!saved) return
    sessionStorage.removeItem("ledger_scroll_y")
    const y = parseFloat(saved)
    if (!isNaN(y)) {
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }))
    }
  }, [predictions])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Player search + navigation: selecting a player loads that player's *entire* chronological
  // Ledger history (never capped by the main list's 50-row limit) and jumps focus to their most
  // recent prediction. `playerIndex` walks that array; the floating back/next control only shows
  // once there's more than one prediction to step through.
  const [activePlayer, setActivePlayer] = useState<{ id: string; name: string } | null>(null)
  const [playerIndex, setPlayerIndex] = useState(0)
  const focusRef = useRef<HTMLDivElement>(null)

  // Task #110: paste-search focus/navigation. Mutually exclusive with the single-player focus
  // above -- selecting into one clears the other -- since both drive the same bottom-right
  // floating stepper and would otherwise conflict about which list it's stepping through.
  const [pasteMatches, setPasteMatches] = useState<PredictionSummary[]>([])
  const [pasteMatchIndex, setPasteMatchIndex] = useState(0)
  const pasteFocusRef = useRef<HTMLDivElement>(null)

  const playerPredictionsQuery = useGetLedgerPlayerPredictions(activePlayer?.id ?? "", {
    query: {
      queryKey: getGetLedgerPlayerPredictionsQueryKey(activePlayer?.id ?? ""),
      enabled: !!activePlayer,
    },
  })
  const playerPredictions = activePlayer ? playerPredictionsQuery.data : undefined
  // Defensive clamp: never index past the end of the currently-loaded array. This matters right
  // after switching from a player with more predictions to one with fewer, in the window before
  // the jump-to-most-recent effect below has had a chance to run.
  const safePlayerIndex = playerPredictions && playerPredictions.length > 0
    ? Math.min(playerIndex, playerPredictions.length - 1)
    : 0

  // Jump to the most recent prediction the first time a newly-selected player's history finishes
  // loading. Tracked via a ref (not just activePlayer?.id in the dependency array) because data
  // for the new player is almost never available on the same render as the id change -- this
  // must re-run once the query resolves, while still leaving playerIndex alone on later re-runs
  // (e.g. from an unrelated cache invalidation) once the user has started stepping back/next.
  const jumpedForPlayerId = useRef<string | null>(null)
  useEffect(() => {
    if (!activePlayer) {
      jumpedForPlayerId.current = null
      return
    }
    if (!playerPredictions || playerPredictions.length === 0) return
    if (jumpedForPlayerId.current === activePlayer.id) return
    jumpedForPlayerId.current = activePlayer.id
    setPlayerIndex(playerPredictions.length - 1)
    const raf = requestAnimationFrame(() => {
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
    return () => cancelAnimationFrame(raf)
  }, [activePlayer, playerPredictions])

  const clearPlayerNavigation = () => {
    setActivePlayer(null)
    setPlayerIndex(0)
    jumpedForPlayerId.current = null
  }

  const selectPlayer = (player: { id: string; name: string }) => {
    clearPasteNavigation()
    setActivePlayer({ id: player.id, name: player.name })
  }

  const clearPasteNavigation = () => {
    setPasteMatches([])
    setPasteMatchIndex(0)
  }

  // Task #110: called by the paste-search tab once the user asks to view its resolved matches
  // (either "view all" or a specific row's "view"). Clears any single-player focus so the two
  // navigators never show at once, jumps to the requested match, and switches to the tab where
  // the focus row actually renders.
  const viewPasteMatches = (predictions: PredictionSummary[], startIndex: number) => {
    clearPlayerNavigation()
    setPasteMatches(predictions)
    setPasteMatchIndex(Math.max(0, Math.min(startIndex, predictions.length - 1)))
    requestAnimationFrame(() => {
      pasteFocusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  // The "Search Players" / "Paste Search" lookup tools now live on Build Matchup
  // (`SavedPredictionsLookup.tsx`), since they're for finding an *existing* saved prediction
  // before starting a new one -- but the focus/step-through UI they drive only exists here. A
  // selection there navigates here with a handoff: a single player via plain URL params (small,
  // safe to put in a URL), a paste-search result set via sessionStorage (an arbitrary-length array
  // of full PredictionSummary objects doesn't fit cleanly in a URL). Runs once per navigation
  // (`consumedDeepLinkRef`) and immediately strips the query string so a manual refresh afterwards
  // doesn't re-trigger it or re-read an already-cleared handoff.
  const search = useSearch()
  const [, navigate] = useLocation()
  const consumedDeepLinkRef = useRef<string | null>(null)
  useEffect(() => {
    if (!search || consumedDeepLinkRef.current === search) return
    consumedDeepLinkRef.current = search
    const params = new URLSearchParams(search)
    const playerId = params.get("playerId")
    const playerName = params.get("playerName")
    if (playerId && playerName) {
      selectPlayer({ id: playerId, name: playerName })
      navigate("/history", { replace: true })
      return
    }
    if (params.get("pasteSearch") === "1") {
      const handoff = readAndClearPasteSearchHandoff()
      if (handoff) viewPasteMatches(handoff.predictions, handoff.startIndex)
      navigate("/history", { replace: true })
    }
  }, [search])

  const safePasteMatchIndex = pasteMatches.length > 0 ? Math.min(pasteMatchIndex, pasteMatches.length - 1) : 0

  const invalidateLedger = () => {
    queryClient.invalidateQueries({ queryKey: getListPredictionsQueryKey({ limit: 50 }) })
    queryClient.invalidateQueries({ queryKey: getGetPredictionStatsQueryKey() })
    if (activePlayer) {
      queryClient.invalidateQueries({ queryKey: getGetLedgerPlayerPredictionsQueryKey(activePlayer.id) })
    }
  }

  const deletePrediction = useDeletePrediction({ mutation: { onSuccess: invalidateLedger } })
  const bulkDelete = useBulkDeletePredictions({
    mutation: {
      onSuccess: () => {
        setSelectedIds(new Set())
        invalidateLedger()
      },
    },
  })
  const gradePending = useGradePendingLedgerPredictions({ mutation: { onSuccess: invalidateLedger } })

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = !!predictions && predictions.length > 0 && selectedIds.size === predictions.length

  const toggleSelectAll = () => {
    if (!predictions) return
    setSelectedIds(allSelected ? new Set() : new Set(predictions.map((p) => p.id)))
  }

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Prediction History</h1>
          <p className="text-muted-foreground mt-2 text-lg">Browse, search, and manage past predictions and outcomes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="font-mono self-start md:self-auto h-10 shadow-sm"
            disabled={gradePending.isPending}
            onClick={() => gradePending.mutate()}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${gradePending.isPending ? "animate-spin" : ""}`} />
            UPDATE RESULTS
          </Button>
          <RemoveDuplicateTradesButton onRemoved={invalidateLedger} />
        </div>
      </div>

      {gradePending.isSuccess && gradePending.data && (
        <div className="text-xs font-mono text-muted-foreground -mt-4">
          Checked {gradePending.data.checked} pending prediction{gradePending.data.checked === 1 ? "" : "s"} against real results -- {gradePending.data.graded} newly graded.
        </div>
      )}

      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : stats ? (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            title="TOTAL RUNS" 
            value={stats.totalPredictions} 
            icon={Target} 
          />
          <StatCard 
            title="RESOLVED" 
            value={stats.resolvedPredictions} 
            icon={Clock} 
          />
          <StatCard 
            title="ACCURACY" 
            value={stats.accuracy !== null ? `${stats.accuracy.toFixed(1)}%` : '--'} 
            subtext={`${stats.correctPredictions} correct`}
            icon={TrendingUp} 
          />
          <StatCard 
            title="HIGH CONF" 
            value={stats.byRecommendation?.find(r => r.recommendation === 'STRONG_RECOMMENDATION')?.count || 0} 
            subtext="Highest-confidence tier -- not yet proven better than other tiers"
            icon={AlertTriangle} 
          />
          {/* Task #37: coin-flip predictions flagged separately so users can track their borderline picks */}
          {(stats.byRecommendation?.find(r => r.recommendation === 'NO_STRONG_SIGNAL')?.count ?? 0) > 0 && (
            <StatCard
              title="COIN FLIP"
              value={stats.byRecommendation?.find(r => r.recommendation === 'NO_STRONG_SIGNAL')?.count || 0}
              subtext="Within ±3% of 50/50 — backtesting shows these perform at or below chance"
              icon={Scale}
            />
          )}
        </div>
        <SavedPredictionsLookup />
        </>
      ) : null}

      <div className="space-y-4">
        {activePlayer && (
          <div ref={focusRef} className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-mono font-bold text-muted-foreground flex items-center gap-2">
                <UserSearch className="w-4 h-4" />
                PLAYER FOCUS: {activePlayer.name}
                {playerPredictions && playerPredictions.length > 0 && (
                  <span className="text-muted-foreground/70">
                    ({safePlayerIndex + 1} of {playerPredictions.length})
                  </span>
                )}
              </h3>
              <Button variant="ghost" size="sm" className="font-mono text-muted-foreground" onClick={clearPlayerNavigation}>
                <X className="w-4 h-4 mr-1" />
                CLEAR
              </Button>
            </div>

            {playerPredictionsQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : playerPredictions && playerPredictions.length > 0 ? (
              <PlayerFocusRow prediction={playerPredictions[safePlayerIndex]} />
            ) : (
              <div className="p-4 border border-dashed rounded-md text-center text-sm font-mono text-muted-foreground">
                NO PREDICTIONS FOUND FOR THIS PLAYER
              </div>
            )}
          </div>
        )}

        {pasteMatches.length > 0 && (
          <div ref={pasteFocusRef} className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-mono font-bold text-muted-foreground flex items-center gap-2">
                <ClipboardPaste className="w-4 h-4" />
                MATCH FOCUS
                <span className="text-muted-foreground/70">
                  ({safePasteMatchIndex + 1} of {pasteMatches.length})
                </span>
              </h3>
              <Button variant="ghost" size="sm" className="font-mono text-muted-foreground" onClick={clearPasteNavigation}>
                <X className="w-4 h-4 mr-1" />
                CLEAR
              </Button>
            </div>
            <PlayerFocusRow prediction={pasteMatches[safePasteMatchIndex]} />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            PREDICTION HISTORY
          </h2>
          {predictions && predictions.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                SELECT ALL
              </label>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="font-mono"
                  disabled={bulkDelete.isPending}
                  onClick={() => bulkDelete.mutate({ data: { ids: Array.from(selectedIds) } })}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  DELETE {selectedIds.size}
                </Button>
              )}
            </div>
          )}
        </div>

        {predictionsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : predictions && predictions.length > 0 ? (
          <div className="space-y-3">
            {predictions.map(pred => (
              <PredictionRow
                key={pred.id}
                prediction={pred}
                selected={selectedIds.has(pred.id)}
                onToggleSelect={() => toggleSelect(pred.id)}
                onDelete={() => deletePrediction.mutate({ predictionId: pred.id })}
                isDeleting={deletePrediction.isPending && deletePrediction.variables?.predictionId === pred.id}
              />
            ))}
          </div>
        ) : (
          <div className="p-12 border border-dashed rounded-lg text-center text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="font-mono text-sm">NO PREDICTIONS SAVED YET</p>
            <Link href="/predict">
              <Button variant="outline" className="mt-4 font-mono">RUN FIRST PREDICTION</Button>
            </Link>
          </div>
        )}
      </div>

      {activePlayer && playerPredictions && playerPredictions.length > 1 && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-1 bg-card border rounded-full shadow-lg p-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            disabled={safePlayerIndex === 0}
            onClick={() => setPlayerIndex(Math.max(0, safePlayerIndex - 1))}
            aria-label="Previous prediction for this player"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground px-1 min-w-[3.5rem] text-center">
            {safePlayerIndex + 1} / {playerPredictions.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            disabled={safePlayerIndex === playerPredictions.length - 1}
            onClick={() => setPlayerIndex(Math.min(playerPredictions.length - 1, safePlayerIndex + 1))}
            aria-label="Next prediction for this player"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      )}

      {pasteMatches.length > 1 && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-1 bg-card border rounded-full shadow-lg p-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            disabled={safePasteMatchIndex === 0}
            onClick={() => setPasteMatchIndex(Math.max(0, safePasteMatchIndex - 1))}
            aria-label="Previous resolved paste-search match"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground px-1 min-w-[3.5rem] text-center">
            {safePasteMatchIndex + 1} / {pasteMatches.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            disabled={safePasteMatchIndex === pasteMatches.length - 1}
            onClick={() => setPasteMatchIndex(Math.min(pasteMatches.length - 1, safePasteMatchIndex + 1))}
            aria-label="Next resolved paste-search match"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      )}
    </div>
  )
}
