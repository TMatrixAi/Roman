import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useLocation } from "wouter"
import {
  recognizeMatchupScreenshot,
  createPrediction,
  type ScreenshotMatchupResult,
  type ScreenshotMatchupEntry,
  type Surface,
  type TournamentLevel,
  type MatchFormat,
} from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { RecognizedChip } from "@/components/ScreenshotMatchupUpload"
import {
  Layers, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Activity, History, Trash2, X,
  ChevronDown, Settings2,
} from "lucide-react"

const MAX_FILES = 20

const STORAGE_KEY = "bulkMatchupPredictor.batch.v1"

function readStoredBatch(): BatchItem[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    if (!parsed.every((it) => it && typeof it === "object" && typeof it.key === "string" && typeof it.fileName === "string")) {
      return null
    }
    return parsed as BatchItem[]
  } catch {
    return null
  }
}

function writeStoredBatch(items: BatchItem[]) {
  try {
    if (items.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY)
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    }
  } catch {
    // Best-effort — if sessionStorage is unavailable the batch simply won't survive a refresh.
  }
}

function clearStoredBatch() {
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

function sanitizeResumedItems(items: BatchItem[]): BatchItem[] {
  return items.map((it) => {
    if (it.status === "resolving") {
      return {
        ...it,
        status: "read-error" as ItemStatus,
        errorMessage: "This screenshot's data was lost when the page refreshed. Re-upload it to include it in the batch.",
      }
    }
    if (it.predictStatus === "pending") return { ...it, predictStatus: "idle" as PredictStatus }
    return it
  })
}

const RESOLVE_CONCURRENCY = 4

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0
  async function runNext(): Promise<void> {
    const index = nextIndex++
    if (index >= items.length) return
    await worker(items[index], index)
    await runNext()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
}

function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

type ItemStatus = "resolving" | "resolved" | "unresolved" | "read-error"
type PredictStatus = "idle" | "pending" | "success" | "error"

interface BatchItem {
  key: string
  fileName: string
  status: ItemStatus
  result: ScreenshotMatchupResult | null
  errorMessage: string | null
  // Match conditions sent to the engine — each is editable per-item inline
  surface: Surface
  level: TournamentLevel
  matchFormat: MatchFormat
  tournamentName: string | null
  // Whether each condition was detected from the screenshot (vs defaulted)
  surfaceDetected: boolean
  levelDetected: boolean
  tournamentDetected: boolean
  // Per-item conditions panel open/closed
  conditionsExpanded: boolean
  predictStatus: PredictStatus
  predictionId: number | null
  predictError: string | null
}

function isReady(item: BatchItem): boolean {
  return item.status === "resolved"
}

function needsPredicting(item: BatchItem): boolean {
  return isReady(item) && item.predictStatus !== "success"
}

function entryToResult(m: ScreenshotMatchupEntry): ScreenshotMatchupResult {
  return { player1: m.player1, player2: m.player2, event: m.event, warnings: m.warnings }
}

function makeDefaultItem(key: string, fileName: string): BatchItem {
  return {
    key,
    fileName,
    status: "resolving",
    result: null,
    errorMessage: null,
    surface: "Hard",
    level: "ATP250",
    matchFormat: "BestOf3",
    tournamentName: null,
    surfaceDetected: false,
    levelDetected: false,
    tournamentDetected: false,
    conditionsExpanded: false,
    predictStatus: "idle",
    predictionId: null,
    predictError: null,
  }
}

// ---------------------------------------------------------------------------
// Surface colour helper
// ---------------------------------------------------------------------------
function surfaceColour(s: Surface) {
  if (s === "Clay") return "text-orange-500"
  if (s === "Grass") return "text-green-500"
  if (s === "IndoorHard") return "text-purple-400"
  return "text-blue-400"
}

// ---------------------------------------------------------------------------
// Missing-data summary
// ---------------------------------------------------------------------------
interface DataGap { label: string; count: number; tip: string }

function computeGaps(items: BatchItem[]): DataGap[] {
  const ready = items.filter(isReady)
  if (ready.length === 0) return []
  const gaps: DataGap[] = []
  const noSurface = ready.filter((i) => !i.surfaceDetected).length
  const noTournament = ready.filter((i) => !i.tournamentDetected).length
  const noLevel = ready.filter((i) => !i.levelDetected).length
  if (noSurface > 0) gaps.push({ label: `${noSurface} match${noSurface > 1 ? "es" : ""}: surface not detected`, tip: "Defaulting to Hard. Tap ▸ Edit Conditions on any row to correct it.", count: noSurface })
  if (noTournament > 0) gaps.push({ label: `${noTournament} match${noTournament > 1 ? "es" : ""}: no tournament name`, tip: "Venue weather and travel distance won't be available.", count: noTournament })
  if (noLevel > 0) gaps.push({ label: `${noLevel} match${noLevel > 1 ? "es" : ""}: level not detected`, tip: "Defaulting to ATP 250. Tap ▸ Edit Conditions on any row to correct it.", count: noLevel })
  return gaps
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BulkMatchupPredictorHandle {
  handleFiles: (files: File[]) => void
}

export const BulkMatchupPredictor = forwardRef<BulkMatchupPredictorHandle>(function BulkMatchupPredictor(_props, ref) {
  const [, setLocation] = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BatchItem[]>([])
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)
  const [isPredicting, setIsPredicting] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [resumableBatch, setResumableBatch] = useState<BatchItem[] | null>(null)

  useEffect(() => { setResumableBatch(readStoredBatch()) }, [])
  useEffect(() => { if (items.length > 0) writeStoredBatch(items) }, [items])

  const resolvedCount = items.filter(isReady).length
  const pendingPredictCount = items.filter(needsPredicting).length
  const alreadyPredictedCount = resolvedCount - pendingPredictCount
  const hasItems = items.length > 0
  const anyResolving = items.some((i) => i.status === "resolving")
  const gaps = computeGaps(items)

  // ---------------------------------------------------------------------------
  // Resume / discard
  // ---------------------------------------------------------------------------
  const handleResume = () => {
    if (!resumableBatch) return
    setBatchError(null); setSelectionWarning(null)
    setItems(sanitizeResumedItems(resumableBatch))
    setResumableBatch(null)
  }
  const handleDiscardResumable = () => { clearStoredBatch(); setResumableBatch(null) }
  const handleDeleteItem = (key: string) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.key !== key)
      if (next.length === 0) clearStoredBatch()
      return next
    })
  }

  // ---------------------------------------------------------------------------
  // Per-item condition editing
  // ---------------------------------------------------------------------------
  function updateItem(key: string, patch: Partial<BatchItem>) {
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, ...patch } : it))
  }
  function toggleConditions(key: string) {
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, conditionsExpanded: !it.conditionsExpanded } : it))
  }

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------
  useImperativeHandle(ref, () => ({ handleFiles: (files: File[]) => { void handleFiles(files) } }))

  const handleFiles = async (files: File[]) => {
    setBatchError(null); setSelectionWarning(null)
    clearStoredBatch(); setResumableBatch(null)

    let toProcess = files
    if (toProcess.length > MAX_FILES) {
      setSelectionWarning(`You selected ${files.length} screenshots — only the first ${MAX_FILES} were used.`)
      toProcess = toProcess.slice(0, MAX_FILES)
    }

    const initialItems: BatchItem[] = toProcess.map((file) =>
      makeDefaultItem(`${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file.name)
    )
    setItems(initialItems)

    await runWithConcurrency(toProcess, RESOLVE_CONCURRENCY, async (file, index) => {
      const key = initialItems[index].key
      try {
        const imageBase64 = await fileToBase64DataUrl(file)
        const result = await recognizeMatchupScreenshot({ imageBase64 })

        if (result.matchups && result.matchups.length > 1) {
          const expandedItems: BatchItem[] = result.matchups.map((m, mi) => ({
            ...makeDefaultItem(`${key}-m${mi}`, mi === 0 ? file.name : `${file.name} (match ${mi + 1} of ${result.matchups!.length})`),
            status: (m.resolved ? "resolved" : "unresolved") as ItemStatus,
            result: entryToResult(m),
            errorMessage: m.resolved ? null : (m.warnings[0] ?? "Couldn't resolve this matchup from the screenshot."),
            surface: (m.event.surface ?? "Hard") as Surface,
            level: (m.event.level ?? "ATP250") as TournamentLevel,
            tournamentName: m.event.recognizedName ?? null,
            surfaceDetected: !!m.event.surface,
            levelDetected: !!m.event.level,
            tournamentDetected: !!m.event.recognizedName,
          }))
          setItems((prev) => {
            const idx = prev.findIndex((it) => it.key === key)
            if (idx === -1) return prev
            return [...prev.slice(0, idx), ...expandedItems, ...prev.slice(idx + 1)]
          })
        } else {
          const ready = !!result.player1.player && !!result.player2.player
          const detectedSurface = result.event.surface as Surface | null
          const detectedLevel = result.event.level as TournamentLevel | null
          const detectedTournament = result.event.recognizedName ?? null
          setItems((prev) =>
            prev.map((it) =>
              it.key === key
                ? {
                    ...it,
                    status: ready ? "resolved" : "unresolved",
                    result,
                    errorMessage: ready ? null : (result.warnings[0] ?? "Couldn't confidently resolve both players from this screenshot."),
                    surface: detectedSurface ?? it.surface,
                    level: detectedLevel ?? it.level,
                    tournamentName: detectedTournament,
                    surfaceDetected: !!detectedSurface,
                    levelDetected: !!detectedLevel,
                    tournamentDetected: !!detectedTournament,
                  }
                : it,
            ),
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const isQuota = msg.toLowerCase().includes("quota") || msg.includes("502")
        setItems((prev) =>
          prev.map((it) =>
            it.key === key
              ? {
                  ...it,
                  status: "read-error",
                  errorMessage: isQuota
                    ? "Screenshot AI is unavailable right now — try again later."
                    : "Couldn't read this screenshot. Try a clearer image.",
                }
              : it,
          ),
        )
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Predict
  // ---------------------------------------------------------------------------
  const handlePredict = async () => {
    setBatchError(null); setIsPredicting(true)
    const readyKeys = items.filter(needsPredicting).map((i) => i.key)
    setItems((prev) => prev.map((it) => (readyKeys.includes(it.key) ? { ...it, predictStatus: "pending" } : it)))

    for (const item of items) {
      if (!needsPredicting(item) || !item.result?.player1.player || !item.result?.player2.player) continue
      try {
        const prediction = await createPrediction({
          player1Id: item.result.player1.player.id,
          player2Id: item.result.player2.player.id,
          surface: item.surface,
          matchFormat: item.matchFormat,
          tournamentLevel: item.level,
          tournamentName: item.tournamentName ?? undefined,
        })
        setItems((prev) =>
          prev.map((it) => (it.key === item.key ? { ...it, predictStatus: "success", predictionId: prediction.id } : it)),
        )
      } catch {
        setItems((prev) =>
          prev.map((it) =>
            it.key === item.key ? { ...it, predictStatus: "error", predictError: "Prediction engine failed for this matchup." } : it,
          ),
        )
      }
    }
    setIsPredicting(false)
  }

  const navigateToResults = () => {
    setItems((prev) => {
      const createdIds = prev.filter((it) => it.predictStatus === "success" && it.predictionId != null).map((it) => it.predictionId as number)
      if (createdIds.length > 0) {
        clearStoredBatch()
        setLocation(`/predictions/${createdIds[0]}?batch=${createdIds.join(",")}`)
      } else {
        setBatchError("None of the matchups in this batch could be predicted. Check the errors below and try again.")
      }
      return prev
    })
  }

  const handlePredictClick = async () => {
    await handlePredict()
    navigateToResults()
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted-foreground font-mono">
          Drop up to {MAX_FILES} screenshots — each image is read by the vision AI independently.
          Long images with multiple match cards are expanded into separate matchup rows automatically.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void handleFiles(files)
            e.target.value = ""
          }}
        />
        <Button
          variant="outline" size="sm" className="font-mono shrink-0"
          disabled={anyResolving || isPredicting}
          onClick={() => inputRef.current?.click()}
        >
          {anyResolving
            ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> READING...</>
            : <><Layers className="w-4 h-4 mr-2" /> SELECT SCREENSHOTS</>}
        </Button>
      </div>

      {/* Resume banner */}
      {resumableBatch && !hasItems && (
        <div className="p-3 border border-primary/30 bg-primary/5 text-sm rounded-md font-mono flex items-start gap-3 flex-wrap">
          <History className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <div className="flex-1 min-w-[220px]">
            <p>
              Found an unfinished batch from before the page refreshed —{" "}
              {resumableBatch.length} item{resumableBatch.length === 1 ? "" : "s"}, {resumableBatch.filter(isReady).length} resolved.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="accent" className="font-mono" onClick={handleResume}>RESUME BATCH</Button>
            <Button size="sm" variant="outline" className="font-mono" onClick={handleDiscardResumable}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> DISCARD
            </Button>
          </div>
        </div>
      )}

      {selectionWarning && (
        <div className="p-3 border border-warning/30 bg-warning/10 text-sm rounded-md font-mono flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
          <div>{selectionWarning}</div>
        </div>
      )}

      {/* Item list */}
      {hasItems && (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="border rounded-md bg-secondary/20 overflow-hidden">
              {/* Main row */}
              <div className="p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">{item.fileName}</span>
                  <div className="flex items-center gap-2 ml-auto shrink-0">
                    <ItemStatusBadge item={item} />
                    <button
                      onClick={() => handleDeleteItem(item.key)}
                      disabled={item.status === "resolving" || item.predictStatus === "pending"}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={`Remove ${item.fileName}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {item.status === "resolving" && (
                  <div className="mt-2 text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading screenshot...
                  </div>
                )}

                {item.result && (
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <RecognizedChip label="P1" name={item.result.player1.recognizedName} matched={!!item.result.player1.player} />
                    <RecognizedChip label="P2" name={item.result.player2.recognizedName} matched={!!item.result.player2.player} />
                    {item.result.event.recognizedName && (
                      <RecognizedChip label="EVENT" name={item.result.event.recognizedName} matched={!!item.result.event.surface} />
                    )}
                    {/* Surface chip — dim if not detected (defaulted) */}
                    <span className={`text-[0.6rem] font-bold uppercase px-1.5 py-0.5 rounded bg-secondary font-mono ${surfaceColour(item.surface)} ${!item.surfaceDetected ? "opacity-50" : ""}`} title={item.surfaceDetected ? "Detected from screenshot" : "Default — not detected"}>
                      {item.surface}
                    </span>
                    {/* Level chip */}
                    <span className={`text-[0.6rem] text-muted-foreground uppercase font-mono px-1 py-0.5 rounded bg-secondary/60 ${!item.levelDetected ? "opacity-50" : ""}`} title={item.levelDetected ? "Detected from screenshot" : "Default — not detected"}>
                      {item.level}
                    </span>
                    {/* Format chip */}
                    <span className="text-[0.6rem] text-muted-foreground/60 uppercase font-mono px-1 py-0.5">
                      {item.matchFormat === "BestOf5" ? "BO5" : "BO3"}
                    </span>
                  </div>
                )}

                {(item.status === "unresolved" || item.status === "read-error") && item.errorMessage && (
                  <div className="mt-2 text-xs text-destructive font-mono flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{item.errorMessage} This item will be skipped.</span>
                  </div>
                )}

                {item.predictStatus === "error" && (
                  <div className="mt-2 text-xs text-destructive font-mono flex items-start gap-2">
                    <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{item.predictError}</span>
                  </div>
                )}

                {/* Edit conditions toggle — only for resolved items not yet predicted */}
                {item.status === "resolved" && item.predictStatus !== "success" && (
                  <button
                    type="button"
                    onClick={() => toggleConditions(item.key)}
                    className="mt-2 flex items-center gap-1 text-[0.6rem] font-mono text-muted-foreground/70 hover:text-muted-foreground transition-colors uppercase tracking-wide"
                  >
                    <Settings2 className="w-3 h-3" />
                    Edit conditions
                    <ChevronDown className={`w-3 h-3 transition-transform ${item.conditionsExpanded ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>

              {/* Inline conditions editor */}
              {item.conditionsExpanded && item.status === "resolved" && (
                <div className="border-t border-border/50 bg-secondary/10 p-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[0.55rem] font-mono font-bold text-muted-foreground uppercase tracking-widest">Surface</label>
                      <Select
                        value={item.surface}
                        onChange={(e) => updateItem(item.key, { surface: e.target.value as Surface, surfaceDetected: true })}
                        className="h-7 text-xs bg-background/50"
                      >
                        <option value="Hard">Hard</option>
                        <option value="Clay">Clay</option>
                        <option value="Grass">Grass</option>
                        <option value="IndoorHard">Indoor Hard</option>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.55rem] font-mono font-bold text-muted-foreground uppercase tracking-widest">Format</label>
                      <Select
                        value={item.matchFormat}
                        onChange={(e) => updateItem(item.key, { matchFormat: e.target.value as MatchFormat })}
                        className="h-7 text-xs bg-background/50"
                      >
                        <option value="BestOf3">Best of 3</option>
                        <option value="BestOf5">Best of 5</option>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.55rem] font-mono font-bold text-muted-foreground uppercase tracking-widest">Level</label>
                      <Select
                        value={item.level}
                        onChange={(e) => updateItem(item.key, { level: e.target.value as TournamentLevel, levelDetected: true })}
                        className="h-7 text-xs bg-background/50"
                      >
                        <option value="GrandSlam">Grand Slam</option>
                        <option value="Masters1000">Masters 1000</option>
                        <option value="WTA1000">WTA 1000</option>
                        <option value="ATP500">ATP 500</option>
                        <option value="WTA500">WTA 500</option>
                        <option value="ATP250">ATP 250</option>
                        <option value="WTA250">WTA 250</option>
                        <option value="Challenger">Challenger</option>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[0.55rem] font-mono font-bold text-muted-foreground uppercase tracking-widest">Tournament name</label>
                    <Input
                      value={item.tournamentName ?? ""}
                      onChange={(e) => updateItem(item.key, { tournamentName: e.target.value || null, tournamentDetected: !!e.target.value })}
                      placeholder="e.g. Cincinnati Open (for venue weather)"
                      className="h-7 text-xs bg-background/50"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Missing-data warnings — only shown when there are ready items with gaps */}
      {gaps.length > 0 && !anyResolving && (
        <div className="p-3 border border-warning/20 bg-warning/5 rounded-md space-y-1.5">
          <p className="text-[0.6rem] font-mono font-bold text-warning uppercase tracking-widest flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Missing data — predictions will still run
          </p>
          {gaps.map((gap) => (
            <p key={gap.label} className="text-xs text-muted-foreground font-mono">
              <span className="text-warning/90">▸ {gap.label}</span> — {gap.tip}
            </p>
          ))}
        </div>
      )}

      {batchError && (
        <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive text-sm rounded-md font-mono flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{batchError}</div>
        </div>
      )}

      {/* Primary action button */}
      {hasItems && (
        <Button
          size="lg" className="w-full font-bold font-mono h-12" variant="accent"
          disabled={anyResolving || isPredicting || resolvedCount === 0}
          onClick={handlePredictClick}
        >
          {isPredicting ? (
            <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> RUNNING {pendingPredictCount} PREDICTION{pendingPredictCount === 1 ? "" : "S"}...</>
          ) : pendingPredictCount === 0 ? (
            <><CheckCircle2 className="w-5 h-5 mr-2" /> VIEW {alreadyPredictedCount} PREDICTED RESULT{alreadyPredictedCount === 1 ? "" : "S"}</>
          ) : (
            <><Activity className="w-5 h-5 mr-2" /> PREDICT {pendingPredictCount} MATCHUP{pendingPredictCount === 1 ? "" : "S"}</>
          )}
        </Button>
      )}
      {hasItems && alreadyPredictedCount > 0 && pendingPredictCount > 0 && !anyResolving && (
        <p className="text-xs text-muted-foreground font-mono text-center">
          {alreadyPredictedCount} matchup{alreadyPredictedCount === 1 ? "" : "s"} already predicted — only the remaining {pendingPredictCount} will run.
        </p>
      )}
      {hasItems && resolvedCount === 0 && !anyResolving && (
        <p className="text-xs text-muted-foreground font-mono text-center">
          No items in this batch resolved to a full matchup yet.
        </p>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function ItemStatusBadge({ item }: { item: BatchItem }) {
  if (item.predictStatus === "success") return <Badge variant="success" className="font-mono gap-1"><CheckCircle2 className="w-3 h-3" /> PREDICTED</Badge>
  if (item.predictStatus === "error") return <Badge variant="destructive" className="font-mono gap-1"><XCircle className="w-3 h-3" /> PREDICT FAILED</Badge>
  if (item.predictStatus === "pending") return <Badge variant="outline" className="font-mono gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> PREDICTING</Badge>
  if (item.status === "resolving") return <Badge variant="outline" className="font-mono gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> READING</Badge>
  if (item.status === "resolved") return <Badge variant="success" className="font-mono gap-1"><CheckCircle2 className="w-3 h-3" /> READY</Badge>
  return <Badge variant="destructive" className="font-mono gap-1"><XCircle className="w-3 h-3" /> SKIPPED</Badge>
}
