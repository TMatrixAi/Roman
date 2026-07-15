import { useState } from "react"
import { useLocation, useSearch } from "wouter"
import { useGetPlayer, getGetPlayerQueryKey, useCreatePrediction, Surface, MatchFormat, TournamentLevel } from "@workspace/api-client-react"
import type { PredictionSummary } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { PlayerSearch } from "@/components/PlayerSearch"
import { LedgerMatchupSearch } from "@/components/LedgerMatchupSearch"
import { BulkMatchupPredictor } from "@/components/BulkMatchupPredictor"
import { SavedPredictionsLookup } from "@/components/SavedPredictionsLookup"
import { storePasteSearchHandoff } from "@/lib/pasteSearchHandoff"
import { Activity, Search, Swords, Settings2, RefreshCw, ClipboardPaste } from "lucide-react"

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
      <Card className="h-full border-dashed border-2 bg-secondary/30 glass-panel">
        <CardContent className="p-8 h-full flex flex-col justify-center items-center text-center space-y-4 min-h-[240px]">
          <div className="w-16 h-16 rounded-full bg-background shadow-sm flex items-center justify-center border border-border">
            <Swords className="w-6 h-6 text-muted-foreground/50" />
          </div>
          <div>
            <h3 className="font-display font-bold text-xl">{title}</h3>
            <p className="text-sm text-muted-foreground font-mono mt-1">Select player from search below</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) return <Card className="h-[240px] animate-pulse bg-muted rounded-2xl" />

  if (isError || !player) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-8 text-center min-h-[240px] flex flex-col justify-center items-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-4">
            <Activity className="w-5 h-5" />
          </div>
          <p className="text-destructive font-mono text-sm font-medium">Failed to load player data.</p>
          <Button variant="outline" size="sm" onClick={onRemove} className="mt-4">Clear Selection</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full relative overflow-hidden border border-primary/20 shadow-lg hover-lift group">
      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary to-accent" />
      <div className="absolute right-0 bottom-0 opacity-[0.02] mix-blend-overlay pointer-events-none group-hover:scale-110 transition-transform duration-700">
        <Swords className="w-48 h-48 -mb-10 -mr-10" />
      </div>
      <CardContent className="p-6 sm:p-8 flex flex-col h-full relative z-10">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <p className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
            <h3 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground/90">{player.name}</h3>
          </div>
          {player.countryCode && (
            <Badge variant="secondary" className="font-mono bg-background border shadow-sm">{player.countryCode}</Badge>
          )}
        </div>

        <div className="grid grid-cols-4 gap-4 mt-8 flex-1">
          <div className="bg-secondary/50 rounded-lg p-3 text-center border border-border/50">
            <p className="text-[10px] font-mono font-bold text-muted-foreground mb-1">RANK</p>
            <p className="font-bold font-mono text-lg tabular-nums">{player.currentRank || '--'}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3 text-center border border-border/50">
            <p className="text-[10px] font-mono font-bold text-muted-foreground mb-1">AGE</p>
            <p className="font-bold font-mono text-lg tabular-nums">{player.age || '--'}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3 text-center border border-border/50">
            <p className="text-[10px] font-mono font-bold text-muted-foreground mb-1">PLAYS</p>
            <p className="font-bold text-sm uppercase tracking-wide mt-1.5">{player.plays || '--'}</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3 text-center border border-border/50">
            <p className="text-[10px] font-mono font-bold text-muted-foreground mb-1">TOUR</p>
            <p className="font-bold text-sm uppercase tracking-wide mt-1.5">{player.tour || '--'}</p>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onRemove} className="w-full mt-6 text-muted-foreground font-mono text-xs hover:text-destructive hover:bg-destructive/10">
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
  // Free-text tournament name, separate from Level -- this is what venue/weather/travel lookups
  // match against, so it needs to be the real tournament name (e.g. "Cincinnati Open"), not
  // derived or guessed from the Level dropdown.
  const [tournamentName, setTournamentName] = useState(prefillTournamentName ?? '')
  const wasAutoDetected = !!(prefillSurface || prefillFormat || prefillLevel)

  const createPrediction = useCreatePrediction()

  const handleRunModel = () => {
    if (!player1Id || !player2Id) return

    const trimmedTournamentName = tournamentName.trim()

    createPrediction.mutate({
      data: {
        player1Id,
        player2Id,
        surface,
        matchFormat: format,
        tournamentLevel: level,
        tournamentName: trimmedTournamentName || undefined
      }
    }, {
      onSuccess: (prediction) => {
        setLocation(`/predictions/${prediction.id}`)
      }
    })
  }

  const goToPasteMatches = (predictions: PredictionSummary[], startIndex: number) => {
    storePasteSearchHandoff(predictions, startIndex)
    setLocation("/history?pasteSearch=1")
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">{wasAutoDetected ? "Custom Match" : "Build Matchup"}</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            {wasAutoDetected
              ? "Terrain and tournament auto-detected from the fixture — adjust anything below before running the engine."
              : "Search players, configure parameters, and run the prediction engine."}
          </p>
        </div>
      </div>

      {/* Box 1 + Box 2 — Player One and Player Two slots */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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

      {/* Box 3 — Player Search: search live provider to fill slots above, or paste multiple matchups to find existing ones */}
      <Card className="border-border shadow-md glass-panel">
        <CardHeader className="bg-secondary/30 border-b border-border/50 py-4 px-6">
          <CardTitle className="text-base font-display flex items-center gap-2.5">
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <Search className="w-4 h-4 text-primary" />
            </div>
            Player Search
          </CardTitle>
          <CardDescription className="mt-1">
            Search a player to add them to a slot above, or paste multiple matchups to look up saved predictions.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs defaultValue="search">
            <TabsList className="mb-4">
              <TabsTrigger value="search" className="font-mono gap-2">
                <Search className="w-4 h-4" />
                PLAYER SEARCH
              </TabsTrigger>
              <TabsTrigger value="paste" className="font-mono gap-2">
                <ClipboardPaste className="w-4 h-4" />
                PASTE SEARCH
              </TabsTrigger>
            </TabsList>

            <TabsContent value="search">
              <p className="text-xs text-muted-foreground font-mono mb-4">
                Search the player database. The first result you tap fills Player 1; the second fills Player 2.
              </p>
              <PlayerSearch 
                onSelect={(player) => {
                  if (!player1Id) setPlayer1Id(player.id)
                  else if (!player2Id && player.id !== player1Id) setPlayer2Id(player.id)
                }} 
              />
            </TabsContent>

            <TabsContent value="paste">
              <p className="text-xs text-muted-foreground font-mono mb-4">
                Paste a list of matchups (one per line) to find saved predictions in the Ledger. Results open in the Ledger with step-through navigation.
              </p>
              <LedgerMatchupSearch onView={goToPasteMatches} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Box 4 — Bulk Uploads: predict multiple matchups from screenshots */}
      <BulkMatchupPredictor />

      {/* Match Conditions — only visible once both players are selected */}
      {player1Id && player2Id && (
        <Card className="border-primary/30 shadow-xl overflow-hidden glass-panel relative">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -mr-48 -mt-48 pointer-events-none" />
          <CardHeader className="bg-secondary/40 border-b border-border/50 relative z-10 p-6 sm:p-8">
            <CardTitle className="text-2xl font-display flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Settings2 className="w-6 h-6 text-primary" />
              </div>
              Match Conditions
            </CardTitle>
            <CardDescription className="text-base mt-2">Engine weights adjust based on these parameters.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 sm:p-8 relative z-10">
            <div className="space-y-3 mb-8">
              <label className="text-[11px] font-mono font-bold text-muted-foreground flex items-center gap-2 uppercase tracking-widest">
                Tournament Name
                {prefillTournamentName && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">AUTO-DETECTED</Badge>}
              </label>
              <Input
                value={tournamentName}
                onChange={(e) => setTournamentName(e.target.value)}
                placeholder="e.g. Cincinnati Open"
                className="h-12 text-base bg-background/50 border-border/60 focus:border-primary focus:ring-primary/20 transition-all"
              />
              <p className="text-xs text-muted-foreground/80 font-mono">
                Used to look up real venue weather and travel distance. Separate from Level below — enter the actual tournament name, not a category.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              <div className="space-y-3">
                <label className="text-[11px] font-mono font-bold text-muted-foreground flex items-center gap-2 uppercase tracking-widest">
                  Surface
                  {prefillSurface && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">AUTO-DETECTED</Badge>}
                </label>
                <Select value={surface} onChange={(e) => setSurface(e.target.value as Surface)} className="h-12 bg-background/50">
                  <option value="Hard">Hard Court</option>
                  <option value="Clay">Clay</option>
                  <option value="Grass">Grass</option>
                  <option value="IndoorHard">Indoor Hard</option>
                </Select>
              </div>
              <div className="space-y-3">
                <label className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">Format</label>
                <Select value={format} onChange={(e) => setFormat(e.target.value as MatchFormat)} className="h-12 bg-background/50">
                  <option value="BestOf3">Best of 3</option>
                  <option value="BestOf5">Best of 5 (Slams)</option>
                </Select>
              </div>
              <div className="space-y-3">
                <label className="text-[11px] font-mono font-bold text-muted-foreground flex items-center gap-2 uppercase tracking-widest">
                  Level
                  {prefillLevel && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">AUTO-DETECTED</Badge>}
                </label>
                <Select value={level} onChange={(e) => setLevel(e.target.value as TournamentLevel)} className="h-12 bg-background/50">
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

            <div className="mt-10 pt-8 border-t border-border/50">
              {createPrediction.isError && (
                <div className="mb-6 p-4 border border-destructive/30 bg-destructive/5 text-destructive text-sm rounded-xl font-mono flex items-start gap-3">
                  <Activity className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block mb-1">ENGINE ERROR:</strong>
                    Failed to run prediction. Provider may be unavailable or matchup data is insufficient.
                  </div>
                </div>
              )}

              <Button 
                size="lg" 
                className="w-full font-bold font-mono text-lg h-16 rounded-xl relative overflow-hidden group" 
                variant="accent"
                disabled={createPrediction.isPending || player1Id === player2Id}
                onClick={handleRunModel}
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                <span className="relative z-10 flex items-center justify-center gap-3">
                  {createPrediction.isPending ? (
                    <><RefreshCw className="w-6 h-6 animate-spin" /> RUNNING MODELS...</>
                  ) : (
                    <><Activity className="w-6 h-6" /> EXECUTE PREDICTION ENGINE</>
                  )}
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom box — Find a saved prediction by player name */}
      <SavedPredictionsLookup />
    </div>
  )
}
