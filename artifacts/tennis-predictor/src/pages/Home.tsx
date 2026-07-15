import { useRef, useState } from "react"
import { useLocation } from "wouter"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { FixturesList, type FixturesListHandle, type TourFilter } from "@/components/FixturesList"
import { PlayerSearch } from "@/components/PlayerSearch"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ActivitySquare, ArrowRight, PlaySquare, Swords } from "lucide-react"

const TOUR_FILTER_OPTIONS: { value: TourFilter; label: string }[] = [
  { value: "all", label: "All Matches" },
  { value: "itf", label: "ITF" },
  { value: "atp", label: "ATP Tournaments" },
  { value: "wta", label: "WTA Tournaments" },
]

const ALL_TOURNAMENTS = "all"

export default function Home() {
  const [, setLocation] = useLocation()
  const [tourFilter, setTourFilter] = useState<TourFilter>("all")
  const [appliedTourFilter, setAppliedTourFilter] = useState<TourFilter>("all")
  // Task #110: event/tournament filter, applied together with the tour/level filter via the same
  // "Go" button. Options are populated from real tournamentName values FixturesList reports among
  // the fixtures it currently has loaded -- never a fabricated or hardcoded list.
  const [tournamentOptions, setTournamentOptions] = useState<string[]>([])
  const [tournamentFilter, setTournamentFilter] = useState<string>(ALL_TOURNAMENTS)
  const [appliedTournamentFilter, setAppliedTournamentFilter] = useState<string>(ALL_TOURNAMENTS)
  const fixturesRef = useRef<FixturesListHandle>(null)

  const handleGo = () => {
    setAppliedTourFilter(tourFilter)
    setAppliedTournamentFilter(tournamentFilter)
    fixturesRef.current?.refetch()
  }

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl p-8 md:p-12 relative overflow-hidden shadow-xl border border-primary/20">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-white/5 rounded-full blur-3xl -mr-64 -mt-64 pointer-events-none" />
        <div className="absolute bottom-0 right-10 opacity-[0.03] pointer-events-none mix-blend-overlay">
          <ActivitySquare className="w-[400px] h-[400px]" />
        </div>
        <div className="relative z-10 max-w-3xl space-y-6">
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-display font-bold tracking-tight leading-[1.05] break-words">
            PROBABILITY <br /> <span className="text-primary-foreground/70">NOT SENTIMENT.</span>
          </h1>
          <p className="text-primary-foreground/90 text-lg md:text-xl font-medium max-w-2xl leading-relaxed">
            Multi-model prediction engine based on real ATP/WTA data. Surface Elo, serve/return strength, fatigue, and head-to-head.
          </p>
          <div className="pt-6 flex flex-wrap items-center gap-4">
            <button
              onClick={() => setLocation("/history")}
              className="bg-primary-foreground/10 backdrop-blur-sm text-primary-foreground hover:bg-primary-foreground/20 border border-primary-foreground/10 px-8 py-4 rounded-xl font-bold font-mono text-sm transition-all hover:-translate-y-1"
            >
              VIEW LEDGER
            </button>
            <button
              onClick={() => setLocation("/predict")}
              className="bg-accent text-accent-foreground px-8 py-4 rounded-xl font-bold font-mono text-sm hover:brightness-110 shadow-lg shadow-accent/20 transition-all flex items-center gap-2 hover:-translate-y-1"
            >
              <PlaySquare className="w-4 h-4" />
              BUILD MATCHUP
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3 pt-4 border-t border-primary-foreground/10 mt-8">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono font-bold text-primary-foreground/60 tracking-widest uppercase">LEVEL</label>
              <Select
                value={tourFilter}
                onChange={(e) => setTourFilter(e.target.value as TourFilter)}
                className="w-auto bg-primary-foreground/10 backdrop-blur-sm text-primary-foreground border-primary-foreground/20 font-mono text-sm rounded-lg"
                aria-label="Filter upcoming fixtures by tour"
              >
                {TOUR_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="text-foreground">{opt.label}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono font-bold text-primary-foreground/60 tracking-widest uppercase">EVENT</label>
              <Select
                value={tournamentFilter}
                onChange={(e) => setTournamentFilter(e.target.value)}
                className="w-auto bg-primary-foreground/10 backdrop-blur-sm text-primary-foreground border-primary-foreground/20 font-mono text-sm rounded-lg max-w-[200px] truncate"
                aria-label="Filter upcoming fixtures by tournament"
              >
                <option value={ALL_TOURNAMENTS} className="text-foreground">All Tournaments</option>
                {tournamentOptions.map((name) => (
                  <option key={name} value={name} className="text-foreground">{name}</option>
                ))}
              </Select>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGo}
              className="font-mono font-bold gap-1.5 h-10 rounded-lg hover:-translate-y-0 text-primary"
            >
              GO
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/50 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Swords className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-2xl font-bold font-display">Upcoming Fixtures</h2>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">LIVE DATA</Badge>
          </div>
          <FixturesList
            ref={fixturesRef}
            tourFilter={appliedTourFilter}
            tournamentFilter={appliedTournamentFilter}
            onTournamentsChange={setTournamentOptions}
          />
        </section>

        <section className="space-y-6">
          <div className="flex items-center gap-3 border-b border-border/50 pb-4">
            <div className="p-2 bg-secondary rounded-lg">
              <ActivitySquare className="w-5 h-5 text-secondary-foreground" />
            </div>
            <h2 className="text-2xl font-bold font-display">Player Lookup</h2>
          </div>
          <Card className="border-border shadow-md glass-panel">
            <CardContent className="pt-6">
              <PlayerSearch onSelect={(player) => setLocation(`/predict?p1=${player.id}`)} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
