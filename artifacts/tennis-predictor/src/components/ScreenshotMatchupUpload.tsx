import { useRef, useState } from "react"
import { type ScreenshotMatchupResult, type Surface, type TournamentLevel } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ImagePlus, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react"

function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getBaseUrl(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""
}

interface ScreenshotError {
  /** User-facing summary (one line) */
  message: string
  /** Specific reason from the backend (e.g. which provider failed, quota exhaustion) */
  detail?: string
  /** Stage-by-stage pipeline trace — shown in expandable log */
  debugLog?: string[]
}

export function ScreenshotMatchupUpload({
  onResolved,
  onMultipleFiles,
}: {
  onResolved: (result: {
    player1: ScreenshotMatchupResult["player1"]
    player2: ScreenshotMatchupResult["player2"]
    surface: Surface | null
    level: TournamentLevel | null
    eventName: string | null
    warnings: string[]
  }) => void
  // This card is single-matchup-only, but a lot of users reach for it first and select several
  // screenshots at once expecting it to just work. Rather than silently processing only the
  // first file (or erroring), hand the whole selection off to bulk upload -- which is exactly
  // built for this -- instead of making "20 at once" only discoverable via the small toggle below.
  onMultipleFiles?: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const lastFileRef = useRef<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<ScreenshotError | null>(null)
  const [showDebugLog, setShowDebugLog] = useState(false)
  const [lastResult, setLastResult] = useState<ScreenshotMatchupResult | null>(null)

  const handleFile = async (file: File) => {
    setError(null)
    setLastResult(null)
    setShowDebugLog(false)
    lastFileRef.current = file
    setIsLoading(true)
    try {
      const imageBase64 = await fileToBase64DataUrl(file)
      const res = await fetch(`${getBaseUrl()}/api/matchups/from-screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
      })
      if (!res.ok) {
        let detail: string | undefined
        let debugLog: string[] | undefined
        try {
          const body = await res.json() as { error?: string; detail?: string; debugLog?: string[] }
          detail = body.detail ?? body.error
          debugLog = body.debugLog
        } catch { /* body not JSON */ }
        setError({
          message: res.status === 502
            ? "Screenshot AI is unavailable — all configured AI providers failed."
            : `Screenshot processing failed (HTTP ${res.status}).`,
          detail,
          debugLog,
        })
        return
      }
      const result = await res.json() as ScreenshotMatchupResult & { debugLog?: string[]; rawText?: string }
      setLastResult(result)
      onResolved({
        player1: result.player1,
        player2: result.player2,
        surface: result.event.surface ?? null,
        level: result.event.level ?? null,
        eventName: result.event.recognizedName,
        warnings: result.warnings,
      })
    } catch (err) {
      setError({
        message: err instanceof TypeError && err.message.includes("fetch")
          ? "Network error — check your connection and try again."
          : "Couldn't load that file. Try a different image.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRetry = () => {
    if (lastFileRef.current) void handleFile(lastFileRef.current)
  }

  return (
    <Card className="border-dashed">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm bg-secondary flex items-center justify-center shrink-0">
              <ImagePlus className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-sm">INSERT SCREENSHOT</p>
              <p className="text-xs text-muted-foreground font-mono">
                Upload a bracket/schedule image -- we'll try to fill in both players and the surface
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
              if (files.length > 1 && onMultipleFiles) {
                onMultipleFiles(files)
              } else if (files.length === 1) {
                void handleFile(files[0])
              }
              e.target.value = ""
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="font-mono"
            disabled={isLoading}
            onClick={() => inputRef.current?.click()}
          >
            {isLoading ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> READING...</>
            ) : (
              <><ImagePlus className="w-4 h-4 mr-2" /> UPLOAD SCREENSHOT</>
            )}
          </Button>
        </div>

        {error && (
          <div className="mt-4 space-y-2">
            <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive text-sm rounded-md font-mono">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold">{error.message}</p>
                  {error.detail && <p className="text-xs mt-1 opacity-80">{error.detail}</p>}
                </div>
              </div>
              <div className="flex gap-2 mt-3 flex-wrap">
                {lastFileRef.current && (
                  <button
                    onClick={handleRetry}
                    disabled={isLoading}
                    className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-destructive/30 hover:bg-destructive/10 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Retry
                  </button>
                )}
                {error.debugLog && error.debugLog.length > 0 && (
                  <button
                    onClick={() => setShowDebugLog((v) => !v)}
                    className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-destructive/30 hover:bg-destructive/10 transition-colors"
                  >
                    {showDebugLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showDebugLog ? "Hide" : "Show"} diagnostic log ({error.debugLog.length} entries)
                  </button>
                )}
              </div>
            </div>
            {showDebugLog && error.debugLog && (
              <div className="rounded-md border border-border bg-muted/40 p-3 max-h-48 overflow-y-auto space-y-1">
                {error.debugLog.map((line, i) => (
                  <p key={i} className="text-[10px] font-mono text-muted-foreground leading-relaxed">{line}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {lastResult && (
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <RecognizedChip label="PLAYER 1" name={lastResult.player1.recognizedName} matched={!!lastResult.player1.player} />
              <RecognizedChip label="PLAYER 2" name={lastResult.player2.recognizedName} matched={!!lastResult.player2.player} />
              <RecognizedChip label="EVENT" name={lastResult.event.recognizedName} matched={!!lastResult.event.surface} />
            </div>
            {lastResult.warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground font-mono">
                {lastResult.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function RecognizedChip({ label, name, matched }: { label: string; name: string | null; matched: boolean }) {
  if (!name) {
    return (
      <Badge variant="outline" className="font-mono">
        {label}: NOT READ
      </Badge>
    )
  }
  return (
    <Badge variant={matched ? "success" : "warning"} className="font-mono gap-1">
      {matched ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {label}: {name}
    </Badge>
  )
}
