import { useState } from "react"
import { useLocation, useSearch } from "wouter"
import { useGetPlayer, getGetPlayerQueryKey, useCreatePrediction, Surface, MatchFormat, TournamentLevel } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { PlayerSearch } from "@/components/PlayerSearch"
import { ScreenshotMatchupUpload } from "@/components/ScreenshotMatchupUpload"
import { BulkMatchupPredictor } from "@/components/BulkMatchupPredictor"
import { DataWarning } from "@/components/DataWarning"
import { Activity, Swords, Settings2, RefreshCw, Layers } from "lucide-react"

function PlayerCard({ 
  playerId, 
  title, 
  onRemove 
}: { 
  playerId: string | null
  title: string
  onRemove: () => void 
}) {
  const { data: player, isLoading, isError } = useGetPlayer(playerId || "", {
    query: { queryKey: getGetPlayerQueryKey(playerId || ""), enabled: !!playerId }
  })

  if (!playerId) {
    return (
      <Card className="h-full border-dashed bg-secondary/20">
        <CardContent className="p-6 h-full flex flex-col justify-center items-center text-center space-y-4 min-h-[200px]">
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
            <Swords className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-bold text-lg">{title}</h3>
            <p className="text-sm text-muted-foreground font-mono">Select player from search</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) return <Card className="h-[200px] animate-pulse bg-muted" />

  if (isError || !player) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6">
          <p className="text-destructive font-mono text-sm">Failed to load player data.</p>
          <Button variant="outline" size="sm" onClick={onRemove} className="mt-4">Clear</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full relative overflow-hidden border-2 border-primary/20">
      <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <p className="text-xs font-mono text-muted-foreground uppercase">{title}</p>
            <h3 className="text-2xl font-bold tracking-tight">{player.name}</h3>
          </div>
          {player.countryCode && (
            <Badge variant="outline" className="font-mono">{player.countryCode}</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6">
          <div>
            <p className="text-xs font-mono text-muted-foreground">RANK</p>
            <p className="font-bold">{player.currentRank || 'NR'}</p>
          </div>
          <div>
            <p className="text-xs font-mono text-muted-foreground">AGE</p>
            <p className="font-bold">{player.age || '--'}</p>
          </div>
          <div>
            <p className="text-xs font-mono text-muted-foreground">PLAYS</p>
            <p className="font-bold">{player.plays || '--'}</p>
          </div>
          <div>
            <p className="text-xs font-mono text-muted-foreground">TOUR</p>
            <p className="font-bold">{player.tour || '--'}</p>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onRemove} className="w-full mt-6 text-muted-foreground font-mono">
          CHANGE PLAYER
        </Button>
      </CardContent>
    </Card>
  )
}

export default function PredictBuilderPage() {
  const [, setLocation] = useLocation()
  const searchString = useSearch()
  const searchParams = new URLSearchParams(searchString)
  
  const p1 = searchParams.get('p1')
  const p2 = searchParams.get('p2')
  // Auto-detected from the real fixture when arriving via "Custom Match" on Today's Fixtures --
  // still fully editable below, this only changes the starting values.
  const prefillSurface = searchParams.get('surface') as Surface | null
  const prefillFormat = searchParams.get('format') as MatchFormat | null
  const prefillLevel = searchParams.get('level') as TournamentLevel | null
  const prefillTournamentName = searchParams.get('tournamentName')

  const [player1Id, setPlayer1Id] = useState<string | null>(p1)
  const [player2Id, setPlayer2Id] = useState<string | null>(p2)
  const [surface, setSurface] = useState<Surface>(prefillSurface ?? 'Hard')
  const [format, setFormat] = useState<MatchFormat>(prefillFormat ?? 'BestOf3')
  const [level, setLevel] = useState<TournamentLevel>(prefillLevel ?? 'ATP250')
  // Set when the surface/level came from reading an uploaded screenshot instead of a real
  // fixture -- reuses the same "AUTO-DETECTED" indicator as the Custom Match fixture flow above,
  // since both mean "we filled this in for you, but you should double check it."
  const [screenshotDetectedSurface, setScreenshotDetectedSurface] = useState(false)
  const [screenshotTournamentName, setScreenshotTournamentName] = useState<string | null>(null)
  const wasAutoDetected = !!(prefillSurface || prefillFormat || prefillLevel) || screenshotDetectedSurface
  const [showBulkUpload, setShowBulkUpload] = useState(false)

  const createPrediction = useCreatePrediction()

  const handleScreenshotResolved = ({
    player1,
    player2,
    surface: detectedSurface,
    level: detectedLevel,
    eventName,
  }: {
    player1: { player: { id: string } | null }
    player2: { player: { id: string } | null }
    surface: Surface | null
    level: TournamentLevel | null
    eventName: string | null
  }) => {
    if (player1.player) setPlayer1Id(player1.player.id)
    if (player2.player) setPlayer2Id(player2.player.id)
    if (detectedSurface) {
      setSurface(detectedSurface)
      setScreenshotDetectedSurface(true)
    }
    if (detectedLevel) setLevel(detectedLevel)
    if (eventName) setScreenshotTournamentName(eventName)
  }

  const handleRunModel = () => {
    if (!player1Id || !player2Id) return

    createPrediction.mutate({
      data: {
        player1Id,
        player2Id,
        surface,
        matchFormat: format,
        tournamentLevel: level,
        tournamentName: prefillTournamentName ?? screenshotTournamentName ?? undefined
      }
    }, {
      onSuccess: (prediction) => {
        setLocation(`/predictions/${prediction.id}`)
      }
    })
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter">{wasAutoDetected ? "CUSTOM MATCH" : "BUILD MATCHUP"}</h1>
        <p className="text-muted-foreground mt-1">
          {wasAutoDetected
            ? "Terrain and tournament auto-detected from the fixture -- adjust anything below before running the engine."
            : "Configure parameters and run the prediction engine."}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <PlayerCard 
          title="PLAYER 1" 
          playerId={player1Id} 
          onRemove={() => setPlayer1Id(null)} 
        />
        <PlayerCard 
          title="PLAYER 2" 
          playerId={player2Id} 
          onRemove={() => setPlayer2Id(null)} 
        />
      </div>

      {/* Always rendered (not just while a slot is empty) so the recognition chips/warnings from
          the last upload stay visible even after a fully successful match fills both players --
          otherwise this card would unmount the instant both slots fill and the confirmation the
          user just saw would vanish before they could read it. */}
      <ScreenshotMatchupUpload onResolved={handleScreenshotResolved} />

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-muted-foreground"
          onClick={() => setShowBulkUpload((v) => !v)}
        >
          <Layers className="w-3.5 h-3.5 mr-1.5" />
          {showBulkUpload ? "HIDE BULK UPLOAD" : "GOT MULTIPLE SCREENSHOTS? BULK UPLOAD & BATCH PREDICT"}
        </Button>
        {showBulkUpload && (
          <div className="mt-3">
            <BulkMatchupPredictor />
          </div>
        )}
      </div>

      {(!player1Id || !player2Id) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <SearchIcon className="w-5 h-5" /> SEARCH PLAYERS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PlayerSearch 
              onSelect={(player) => {
                if (!player1Id) setPlayer1Id(player.id)
                else if (!player2Id && player.id !== player1Id) setPlayer2Id(player.id)
              }} 
            />
          </CardContent>
        </Card>
      )}

      {player1Id && player2Id && (
        <Card className="border-primary/20">
          <CardHeader className="bg-secondary/30 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings2 className="w-5 h-5" /> MATCH CONDITIONS
            </CardTitle>
            <CardDescription>Engine weights adjust based on these parameters.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid sm:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-muted-foreground flex items-center gap-1.5">
                  SURFACE
                  {prefillSurface && <Badge variant="secondary" className="text-[9px] px-1 py-0">AUTO-DETECTED</Badge>}
                </label>
                <Select value={surface} onChange={(e) => setSurface(e.target.value as Surface)}>
                  <option value="Hard">Hard Court</option>
                  <option value="Clay">Clay</option>
                  <option value="Grass">Grass</option>
                  <option value="IndoorHard">Indoor Hard</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-muted-foreground">FORMAT</label>
                <Select value={format} onChange={(e) => setFormat(e.target.value as MatchFormat)}>
                  <option value="BestOf3">Best of 3</option>
                  <option value="BestOf5">Best of 5 (Slams)</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-muted-foreground">LEVEL</label>
                <Select value={level} onChange={(e) => setLevel(e.target.value as TournamentLevel)}>
                  <option value="GrandSlam">Grand Slam</option>
                  <option value="Masters1000">Masters 1000</option>
                  <option value="ATP500">ATP 500 / WTA 500</option>
                  <option value="ATP250">ATP 250 / WTA 250</option>
                  <option value="Challenger">Challenger</option>
                </Select>
              </div>
            </div>

            <div className="mt-8">
              {createPrediction.isError && (
                <div className="mb-4 p-4 border border-destructive/30 bg-destructive/10 text-destructive text-sm rounded-md font-mono flex items-start gap-2">
                  <Activity className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>ENGINE ERROR:</strong> Failed to run prediction. Provider may be unavailable or matchup data is insufficient.
                  </div>
                </div>
              )}

              <Button 
                size="lg" 
                className="w-full font-bold font-mono text-base h-14" 
                variant="accent"
                disabled={createPrediction.isPending || player1Id === player2Id}
                onClick={handleRunModel}
              >
                {createPrediction.isPending ? (
                  <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> RUNNING MODELS...</>
                ) : (
                  <><Activity className="w-5 h-5 mr-2" /> EXECUTE PREDICTION ENGINE</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SearchIcon(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
}
