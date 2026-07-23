import { useState } from "react"
import { useLocation } from "wouter"
import { useCreatePrediction, Surface, MatchFormat, TournamentLevel, useGetPlayer, getGetPlayerQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { PlayerSearch } from "@/components/PlayerSearch"
import { Zap, Activity, RefreshCw, Swords, AlertTriangle, XCircle, ChevronDown } from "lucide-react"

// ---------------------------------------------------------------------------
// Mini player slot (no external import — keeps ForceSignal self-contained)
// ---------------------------------------------------------------------------
function PlayerSlot({ playerId, title, onRemove }: { playerId: string | null; title: string; onRemove: () => void }) {
  const { data: player, isLoading } = useGetPlayer(playerId ?? "", {
    query: { queryKey: getGetPlayerQueryKey(playerId ?? ""), enabled: !!playerId },
  })

  if (!playerId) {
    return (
      <div className="border-2 border-dashed border-primary/55 rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[120px] bg-secondary/20">
        <Swords className="w-8 h-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm font-bold text-muted-foreground font-display">{title}</p>
        <p className="text-xs text-muted-foreground/60 font-mono mt-1">Search below to select</p>
      </div>
    )
  }
  if (isLoading) return <div className="h-[120px] rounded-xl bg-muted animate-pulse" />

  return (
    <div className="border border-primary/30 rounded-xl p-4 bg-card relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-warning to-warning/60" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] font-mono font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
          <p className="text-xl font-display font-bold mt-0.5">{player?.name ?? playerId}</p>
          {player?.countryCode && <Badge variant="secondary" className="mt-1 text-[10px]">{player.countryCode}</Badge>}
        </div>
        <button onClick={onRemove} className="p-1.5 text-muted-foreground/50 hover:text-destructive transition-colors rounded-md hover:bg-destructive/10">
          <XCircle className="w-4 h-4" />
        </button>
      </div>
      {player?.currentRank && (
        <p className="text-xs font-mono text-muted-foreground mt-2">Rank #{player.currentRank}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Force Signal page
// ---------------------------------------------------------------------------
export default function ForceSignalPage() {
  const [, setLocation] = useLocation()
  const [player1Id, setPlayer1Id] = useState<string | null>(null)
  const [player2Id, setPlayer2Id] = useState<string | null>(null)
  const [surface, setSurface] = useState<Surface>("Hard")
  const [format, setFormat] = useState<MatchFormat>("BestOf3")
  const [level, setLevel] = useState<TournamentLevel>("ATP250")
  const [tournamentName, setTournamentName] = useState("")
  const [conditionsOpen, setConditionsOpen] = useState(false)

  const createPrediction = useCreatePrediction()

  const handleRun = () => {
    if (!player1Id || !player2Id) return
    createPrediction.mutate(
      {
        data: {
          player1Id,
          player2Id,
          surface,
          matchFormat: format,
          tournamentLevel: level,
          tournamentName: tournamentName.trim() || undefined,
        },
      },
      {
        onSuccess: (prediction) => {
          // forceSignal=true tells the result page to show the directional pick
          // even when the engine says "too close to call".
          setLocation(`/predictions/${prediction.id}?forceSignal=true`)
        },
      },
    )
  }

  const bothSelected = !!player1Id && !!player2Id && player1Id !== player2Id

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500 max-w-3xl mx-auto">

      {/* Page header */}
      <div className="border-b border-border/50 pb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-warning/10 rounded-lg border border-warning/20">
            <Zap className="w-5 h-5 text-warning" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">Force Signal</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Shows a directional pick even for close matches (raw ensemble within 3% of 50/50).
          Use when you need a call regardless of confidence — the engine still runs in full; only the display changes.
        </p>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-warning/30 bg-warning/5 text-sm">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-warning">Forced picks on close matches are unreliable</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            When raw ensemble probability is within 3% of 50/50, backtesting showed these calls perform at or below chance.
            This mode is for reference only — the probability split is still shown alongside the forced pick.
          </p>
        </div>
      </div>

      {/* Player slots */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PlayerSlot title="PLAYER 1" playerId={player1Id} onRemove={() => setPlayer1Id(null)} />
        <PlayerSlot title="PLAYER 2" playerId={player2Id} onRemove={() => setPlayer2Id(null)} />
      </div>

      {/* Player search */}
      <Card className="border-border shadow-md glass-panel">
        <CardContent className="p-4">
          <PlayerSearch
            onSelect={(player) => {
              if (!player1Id) setPlayer1Id(player.id)
              else if (!player2Id && player.id !== player1Id) setPlayer2Id(player.id)
            }}
          />
        </CardContent>
      </Card>

      {/* Match conditions (collapsible) */}
      {bothSelected && (
        <Card className="border-border shadow-md overflow-hidden glass-panel">
          <button
            type="button"
            className="w-full text-left bg-secondary/30 border-b border-border/50 p-4 hover:bg-secondary/50 transition-colors focus-visible:outline-none"
            onClick={() => setConditionsOpen((o) => !o)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Match Conditions</CardTitle>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${conditionsOpen ? "rotate-180" : ""}`} />
            </div>
            {!conditionsOpen && (
              <CardDescription className="text-xs mt-0.5">
                {surface} · {format === "BestOf5" ? "BO5" : "BO3"} · {level}
              </CardDescription>
            )}
          </button>

          {conditionsOpen && (
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">Tournament Name</label>
                <Input
                  value={tournamentName}
                  onChange={(e) => setTournamentName(e.target.value)}
                  placeholder="e.g. Cincinnati Open"
                  className="h-10 bg-background/50"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">Surface</label>
                  <Select value={surface} onChange={(e) => setSurface(e.target.value as Surface)} className="h-10 bg-background/50">
                    <option value="Hard">Hard Court</option>
                    <option value="Clay">Clay</option>
                    <option value="Grass">Grass</option>
                    <option value="IndoorHard">Indoor Hard</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">Format</label>
                  <Select value={format} onChange={(e) => setFormat(e.target.value as MatchFormat)} className="h-10 bg-background/50">
                    <option value="BestOf3">Best of 3</option>
                    <option value="BestOf5">Best of 5</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-widest">Level</label>
                  <Select value={level} onChange={(e) => setLevel(e.target.value as TournamentLevel)} className="h-10 bg-background/50">
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
            </CardContent>
          )}

          {/* Execute */}
          <div className="p-4 pt-0 border-t border-border/30">
            {createPrediction.isError && (
              <div className="mb-3 p-3 border border-destructive/30 bg-destructive/5 text-destructive text-xs rounded-lg font-mono flex items-center gap-2">
                <Activity className="w-4 h-4 shrink-0" />
                Engine error — provider may be unavailable or matchup data is insufficient.
              </div>
            )}
            <Button
              size="lg"
              className="w-full font-bold font-mono text-base h-14 rounded-xl relative overflow-hidden group bg-warning hover:bg-warning/90 text-warning-foreground"
              disabled={createPrediction.isPending || !bothSelected}
              onClick={handleRun}
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              <span className="relative z-10 flex items-center justify-center gap-3">
                {createPrediction.isPending ? (
                  <><RefreshCw className="w-5 h-5 animate-spin" /> RUNNING MODELS...</>
                ) : (
                  <><Zap className="w-5 h-5" /> FORCE SIGNAL</>
                )}
              </span>
            </Button>
          </div>
        </Card>
      )}

      {!bothSelected && (
        <p className="text-xs text-muted-foreground font-mono text-center">
          Select both players above to enable the Force Signal engine.
        </p>
      )}
    </div>
  )
}
