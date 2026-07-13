import { useRef, useState } from "react"
import { useRecognizeMatchupScreenshot, type ScreenshotMatchupResult, type Surface, type TournamentLevel } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ImagePlus, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react"

function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function ScreenshotMatchupUpload({
  onResolved,
}: {
  onResolved: (result: {
    player1: ScreenshotMatchupResult["player1"]
    player2: ScreenshotMatchupResult["player2"]
    surface: Surface | null
    level: TournamentLevel | null
    eventName: string | null
    warnings: string[]
  }) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<ScreenshotMatchupResult | null>(null)
  const recognize = useRecognizeMatchupScreenshot()

  const handleFile = async (file: File) => {
    setError(null)
    setLastResult(null)
    try {
      const imageBase64 = await fileToBase64DataUrl(file)
      recognize.mutate(
        { data: { imageBase64 } },
        {
          onSuccess: (result) => {
            setLastResult(result)
            onResolved({
              player1: result.player1,
              player2: result.player2,
              surface: result.event.surface ?? null,
              level: result.event.level ?? null,
              eventName: result.event.recognizedName,
              warnings: result.warnings,
            })
          },
          onError: () => {
            setError("Couldn't read that screenshot. Try a clearer image, or use Search Players below.")
          },
        },
      )
    } catch {
      setError("Couldn't load that file. Try a different image.")
    }
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
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ""
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="font-mono"
            disabled={recognize.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {recognize.isPending ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> READING...</>
            ) : (
              <><ImagePlus className="w-4 h-4 mr-2" /> UPLOAD SCREENSHOT</>
            )}
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-3 border border-destructive/30 bg-destructive/10 text-destructive text-sm rounded-md font-mono flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
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

function RecognizedChip({ label, name, matched }: { label: string; name: string | null; matched: boolean }) {
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
