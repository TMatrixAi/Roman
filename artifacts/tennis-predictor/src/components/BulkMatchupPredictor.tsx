import { useRef, useState } from "react"
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
import { Layers, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Activity } from "lucide-react"

const MAX_FILES = 20

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

  const resolvedCount = items.filter(isReady).length
  const hasItems = items.length > 0
  const anyResolving = items.some((i) => i.status === "resolving")

  const handleFiles = async (files: File[]) => {
    setBatchError(null)
    setSelectionWarning(null)

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

    const readyKeys = items.filter(isReady).map((i) => i.key)
    setItems((prev) => prev.map((it) => (readyKeys.includes(it.key) ? { ...it, predictStatus: "pending" } : it)))

    // Run one at a time -- these hit the same real prediction engine as the single-match flow,
    // and keeping it sequential keeps provider load/rate limits predictable for a batch of up to
    // 20, while still letting one failure not block the rest.
    for (const item of items) {
      if (!isReady(item) || !item.result?.player1.player || !item.result?.player2.player) continue
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
                <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> RUNNING {resolvedCount} PREDICTION{resolvedCount === 1 ? "" : "S"}...</>
              ) : (
                <><Activity className="w-5 h-5 mr-2" /> PREDICT {resolvedCount} MATCHUP{resolvedCount === 1 ? "" : "S"}</>
              )}
            </Button>
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
