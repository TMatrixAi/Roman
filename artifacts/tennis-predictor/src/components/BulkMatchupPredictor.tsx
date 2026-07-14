import { useEffect, useRef, useState } from "react"
import { useLocation } from "wouter"
import {
  recognizeMatchupScreenshot,
  createPrediction,
  type ScreenshotMatchupResult,
  type Surface,
  type TournamentLevel,
} from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { RecognizedChip } from "@/components/ScreenshotMatchupUpload"
import { Layers, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Activity, History, Trash2 } from "lucide-react"

const MAX_FILES = 20

// Task #99: everything a BatchItem holds is plain JSON-serializable data (no File/Blob
// references -- files are read to a base64 string and immediately discarded from state), so the
// whole in-progress batch can be mirrored into sessionStorage as-is and offered back on reload.
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
    // Best-effort only -- if sessionStorage is unavailable (private browsing quirks, quota),
    // the batch simply won't survive a refresh, but nothing about the current run breaks.
  }
}

function clearStoredBatch() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// A refresh mid-run can catch an item still "resolving" (its screenshot file was never held in
// state, so it can't be re-read) or a prediction still "pending" (we don't know if the request
// that was in flight actually landed). Both get downgraded to a safe, re-runnable state instead
// of silently pretending to still be in progress forever.
function sanitizeResumedItems(items: BatchItem[]): BatchItem[] {
  return items.map((it) => {
    if (it.status === "resolving") {
      return {
        ...it,
        status: "read-error" as ItemStatus,
        errorMessage: "This screenshot's data was lost when the page refreshed. Re-upload it to include it in the batch.",
      }
    }
    if (it.predictStatus === "pending") {
      return { ...it, predictStatus: "idle" as PredictStatus }
    }
    return it
  })
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
  // Values actually sent to the prediction engine -- default to the same fallbacks the
  // single-screenshot flow uses (Hard / BestOf3 / ATP250) when the screenshot didn't reveal them,
  // since a missing surface/level should never block an otherwise-resolved matchup.
  surface: Surface
  level: TournamentLevel
  tournamentName: string | null
  predictStatus: PredictStatus
  predictionId: number | null
  predictError: string | null
}

function isReady(item: BatchItem): boolean {
  return item.status === "resolved"
}

// A resumed batch can already have items sitting at predictStatus "success" (predicted before an
// accidental refresh, with a real predictionId already created) -- those must never be
// re-submitted, or resuming mid-run would duplicate predictions for work that's already done.
function needsPredicting(item: BatchItem): boolean {
  return isReady(item) && item.predictStatus !== "success"
}

/**
 * Task #97: lets a user drop up to 20 matchup screenshots at once, resolves each one
 * independently through the same recognition/resolution call the single-screenshot flow uses
 * (so no leaking of one screenshot's detected player/surface into another), then batch-runs the
 * existing single-match prediction engine across everything that resolved cleanly. Screenshots
 * that fail to resolve a full matchup are flagged in their own row and simply excluded from the
 * predict step -- they never block the rest of the batch.
 */
export function BulkMatchupPredictor() {
  const [, setLocation] = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BatchItem[]>([])
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)
  const [isPredicting, setIsPredicting] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  // Loaded from sessionStorage on mount but held separately from `items` until the user chooses
  // to resume or discard it -- so an accidental refresh never silently re-shows stale state, it
  // always asks first.
  const [resumableBatch, setResumableBatch] = useState<BatchItem[] | null>(null)

  useEffect(() => {
    setResumableBatch(readStoredBatch())
  }, [])

  // Mirror the live batch into sessionStorage as it changes, so a refresh or accidental
  // navigation mid-run has something to offer back on return. Deliberately only fires once this
  // run actually has items -- `items` starts empty on every mount (including right after a
  // refresh, before the user has chosen Resume/Discard), so writing unconditionally here would
  // wipe out the very batch we just loaded into `resumableBatch` before the user ever saw it.
  // Storage is only ever cleared by an explicit action: discard, starting a new selection, or
  // successfully navigating to results.
  useEffect(() => {
    if (items.length > 0) {
      writeStoredBatch(items)
    }
  }, [items])

  const resolvedCount = items.filter(isReady).length
  const pendingPredictCount = items.filter(needsPredicting).length
  const alreadyPredictedCount = resolvedCount - pendingPredictCount
  const hasItems = items.length > 0
  const anyResolving = items.some((i) => i.status === "resolving")

  const handleResume = () => {
    if (!resumableBatch) return
    setBatchError(null)
    setSelectionWarning(null)
    setItems(sanitizeResumedItems(resumableBatch))
    setResumableBatch(null)
  }

  const handleDiscardResumable = () => {
    clearStoredBatch()
    setResumableBatch(null)
  }

  const handleFiles = async (files: File[]) => {
    setBatchError(null)
    setSelectionWarning(null)
    // Starting a fresh selection supersedes any not-yet-resumed batch from a previous session.
    clearStoredBatch()
    setResumableBatch(null)

    let toProcess = files
    if (toProcess.length > MAX_FILES) {
      setSelectionWarning(`You selected ${files.length} screenshots -- only the first ${MAX_FILES} were used.`)
      toProcess = toProcess.slice(0, MAX_FILES)
    }

    const initialItems: BatchItem[] = toProcess.map((file) => ({
      key: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      fileName: file.name,
      status: "resolving",
      result: null,
      errorMessage: null,
      surface: "Hard",
      level: "ATP250",
      tournamentName: null,
      predictStatus: "idle",
      predictionId: null,
      predictError: null,
    }))
    setItems(initialItems)

    // Each file is read and resolved completely independently -- separate base64 read, separate
    // API call, separate result object -- so nothing from one screenshot can leak into another's
    // detected player/surface/tournament even when several resolve concurrently.
    await Promise.all(
      toProcess.map(async (file, index) => {
        const key = initialItems[index].key
        try {
          const imageBase64 = await fileToBase64DataUrl(file)
          const result = await recognizeMatchupScreenshot({ imageBase64 })
          const ready = !!result.player1.player && !!result.player2.player
          setItems((prev) =>
            prev.map((it) =>
              it.key === key
                ? {
                    ...it,
                    status: ready ? "resolved" : "unresolved",
                    result,
                    errorMessage: ready
                      ? null
                      : result.warnings[0] ?? "Couldn't confidently resolve both players from this screenshot.",
                    surface: result.event.surface ?? it.surface,
                    level: result.event.level ?? it.level,
                    tournamentName: result.event.recognizedName ?? null,
                  }
                : it,
            ),
          )
        } catch {
          setItems((prev) =>
            prev.map((it) =>
              it.key === key
                ? { ...it, status: "read-error", errorMessage: "Couldn't read this screenshot. Try a clearer image." }
                : it,
            ),
          )
        }
      }),
    )
  }

  const handlePredict = async () => {
    setBatchError(null)
    setIsPredicting(true)

    const readyKeys = items.filter(needsPredicting).map((i) => i.key)
    setItems((prev) => prev.map((it) => (readyKeys.includes(it.key) ? { ...it, predictStatus: "pending" } : it)))

    // Run one at a time -- these hit the same real prediction engine as the single-match flow,
    // and keeping it sequential keeps provider load/rate limits predictable for a batch of up to
    // 20, while still letting one failure not block the rest.
    for (const item of items) {
      if (!needsPredicting(item) || !item.result?.player1.player || !item.result?.player2.player) continue
      try {
        const prediction = await createPrediction({
          player1Id: item.result.player1.player.id,
          player2Id: item.result.player2.player.id,
          surface: item.surface,
          matchFormat: "BestOf3",
          tournamentLevel: item.level,
          tournamentName: item.tournamentName ?? undefined,
        })
        setItems((prev) =>
          prev.map((it) => (it.key === item.key ? { ...it, predictStatus: "success", predictionId: prediction.id } : it)),
        )
      } catch {
        setItems((prev) =>
          prev.map((it) =>
            it.key === item.key ? { ...it, predictStatus: "error", predictError: "Failed to run the prediction engine for this matchup." } : it,
          ),
        )
      }
    }

    setIsPredicting(false)
  }

  // Read the freshest state after the predict loop finishes, in a follow-up microtask via
  // setItems' functional form, so navigation always reflects the final success/failure of every
  // item rather than a stale closure from before the loop ran.
  const navigateToResults = () => {
    setItems((prev) => {
      const createdIds = prev.filter((it) => it.predictStatus === "success" && it.predictionId != null).map((it) => it.predictionId as number)
      if (createdIds.length > 0) {
        // The batch's job is done -- nothing left to resume into, so drop the persisted copy
        // rather than resurfacing a finished batch after the next refresh.
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

  return (
    <Card className="border-dashed">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm bg-secondary flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-sm">BULK UPLOAD</p>
              <p className="text-xs text-muted-foreground font-mono">
                Drop up to {MAX_FILES} screenshots -- we'll resolve each matchup and run the engine on everything that matches
              </p>
            </div>
          </div>

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
            variant="outline"
            size="sm"
            className="font-mono"
            disabled={anyResolving || isPredicting}
            onClick={() => inputRef.current?.click()}
          >
            {anyResolving ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> READING...</>
            ) : (
              <><Layers className="w-4 h-4 mr-2" /> SELECT SCREENSHOTS</>
            )}
          </Button>
        </div>

        {resumableBatch && !hasItems && (
          <div className="mt-4 p-3 border border-primary/30 bg-primary/5 text-sm rounded-md font-mono flex items-start gap-3 flex-wrap">
            <History className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
            <div className="flex-1 min-w-[220px]">
              <p>
                Found an unfinished batch from before the page refreshed --{" "}
                {resumableBatch.length} screenshot{resumableBatch.length === 1 ? "" : "s"}, {resumableBatch.filter(isReady).length} resolved.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="accent" className="font-mono" onClick={handleResume}>
                RESUME BATCH
              </Button>
              <Button size="sm" variant="outline" className="font-mono" onClick={handleDiscardResumable}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> DISCARD
              </Button>
            </div>
          </div>
        )}

        {selectionWarning && (
          <div className="mt-4 p-3 border border-warning/30 bg-warning/10 text-sm rounded-md font-mono flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
            <div>{selectionWarning}</div>
          </div>
        )}

        {hasItems && (
          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <div key={item.key} className="p-3 border rounded-md bg-secondary/20">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground truncate max-w-[220px]">{item.fileName}</span>
                  <ItemStatusBadge item={item} />
                </div>

                {item.status === "resolving" && (
                  <div className="mt-2 text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading screenshot...
                  </div>
                )}

                {item.result && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <RecognizedChip label="PLAYER 1" name={item.result.player1.recognizedName} matched={!!item.result.player1.player} />
                    <RecognizedChip label="PLAYER 2" name={item.result.player2.recognizedName} matched={!!item.result.player2.player} />
                    <RecognizedChip label="EVENT" name={item.result.event.recognizedName} matched={!!item.result.event.surface} />
                  </div>
                )}

                {item.errorMessage && (item.status === "unresolved" || item.status === "read-error") && (
                  <div className="mt-2 text-xs text-destructive font-mono flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{item.errorMessage} This screenshot will be skipped.</span>
                  </div>
                )}

                {item.predictStatus === "error" && (
                  <div className="mt-2 text-xs text-destructive font-mono flex items-start gap-2">
                    <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{item.predictError}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {batchError && (
          <div className="mt-4 p-3 border border-destructive/30 bg-destructive/10 text-destructive text-sm rounded-md font-mono flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{batchError}</div>
          </div>
        )}

        {hasItems && (
          <div className="mt-5">
            <Button
              size="lg"
              className="w-full font-bold font-mono h-12"
              variant="accent"
              disabled={anyResolving || isPredicting || resolvedCount === 0}
              onClick={handlePredictClick}
            >
              {isPredicting ? (
                <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> RUNNING {pendingPredictCount} PREDICTION{pendingPredictCount === 1 ? "" : "S"}...</>
              ) : pendingPredictCount === 0 ? (
                // Everything ready in this batch was already predicted (e.g. resumed after a
                // refresh that hit mid-run) -- nothing left to (re-)submit, just take the user to
                // the results they already generated.
                <><CheckCircle2 className="w-5 h-5 mr-2" /> VIEW {alreadyPredictedCount} PREDICTED RESULT{alreadyPredictedCount === 1 ? "" : "S"}</>
              ) : (
                <><Activity className="w-5 h-5 mr-2" /> PREDICT {pendingPredictCount} MATCHUP{pendingPredictCount === 1 ? "" : "S"}</>
              )}
            </Button>
            {alreadyPredictedCount > 0 && pendingPredictCount > 0 && !anyResolving && (
              <p className="text-xs text-muted-foreground font-mono mt-2 text-center">
                {alreadyPredictedCount} matchup{alreadyPredictedCount === 1 ? "" : "s"} already predicted from before -- only the remaining {pendingPredictCount} will run.
              </p>
            )}
            {resolvedCount === 0 && !anyResolving && (
              <p className="text-xs text-muted-foreground font-mono mt-2 text-center">
                No screenshots in this batch resolved to a full matchup yet.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ItemStatusBadge({ item }: { item: BatchItem }) {
  if (item.predictStatus === "success") {
    return <Badge variant="success" className="font-mono gap-1"><CheckCircle2 className="w-3 h-3" /> PREDICTED</Badge>
  }
  if (item.predictStatus === "error") {
    return <Badge variant="destructive" className="font-mono gap-1"><XCircle className="w-3 h-3" /> PREDICT FAILED</Badge>
  }
  if (item.predictStatus === "pending") {
    return <Badge variant="outline" className="font-mono gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> PREDICTING</Badge>
  }
  if (item.status === "resolving") {
    return <Badge variant="outline" className="font-mono gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> READING</Badge>
  }
  if (item.status === "resolved") {
    return <Badge variant="success" className="font-mono gap-1"><CheckCircle2 className="w-3 h-3" /> READY</Badge>
  }
  return <Badge variant="destructive" className="font-mono gap-1"><XCircle className="w-3 h-3" /> SKIPPED</Badge>
}
