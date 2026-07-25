import { useMemo, useRef, useState } from "react"
import { useLocation } from "wouter"
import { Badge } from "@/components/ui/badge"
import { FixturesList, type FixturesListHandle, type TourFilter } from "@/components/FixturesList"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ActivitySquare, ArrowRight, PlaySquare, Swords } from "lucide-react"

const WTA_LEVELS = new Set(["WTA1000", "WTA500", "WTA250"])
const ATP_LEVELS = new Set(["Masters1000", "ATP500", "ATP250"])
const ITF_LEVELS = new Set(["Challenger", "ITF"])

const ALL_TOURNAMENTS = "all"

// The specific TournamentLevel values that also appear as TourFilter options (for EVENT narrowing)
const SPECIFIC_LEVEL_FILTERS = new Set([
  "GrandSlam", "Masters1000", "WTA1000", "ATP500", "WTA500",
  "ATP250", "WTA250", "Challenger", "ITF",
])

export default function Home() {
  const [, setLocation] = useLocation()
  const [tourFilter, setTourFilter] = useState<TourFilter>("all")
  const [appliedTourFilter, setAppliedTourFilter] = useState<TourFilter>("all")
  // All {name, level} pairs reported by FixturesList from its loaded fixtures. Used to derive
  // the filtered EVENT dropdown options based on the currently-selected LEVEL.
  const [allTournamentEntries, setAllTournamentEntries] = useState<{ name: string; level: string | null | undefined }[]>([])
  const [tournamentFilter, setTournamentFilter] = useState<string>(ALL_TOURNAMENTS)
  const [appliedTournamentFilter, setAppliedTournamentFilter] = useState<string>(ALL_TOURNAMENTS)
  const fixturesRef = useRef<FixturesListHandle>(null)

  // Narrows EVENT options based on the currently-selected LEVEL (not yet applied).
  // Deduplicates by name and sorts alphabetically.
  const filteredTournamentOptions = useMemo(() => {
    let filtered = allTournamentEntries
    if (tourFilter === "atp") {
      filtered = allTournamentEntries.filter((e) => !e.level || ATP_LEVELS.has(e.level) || e.level === "GrandSlam")
    } else if (tourFilter === "wta") {
      filtered = allTournamentEntries.filter((e) => !e.level || WTA_LEVELS.has(e.level) || e.level === "GrandSlam")
    } else if (tourFilter === "itf") {
      filtered = allTournamentEntries.filter((e) => !e.level || ITF_LEVELS.has(e.level))
    } else if (SPECIFIC_LEVEL_FILTERS.has(tourFilter)) {
      filtered = allTournamentEntries.filter((e) => !e.level || e.level === tourFilter)
    }
    return Array.from(new Set(filtered.map((e) => e.name))).sort()
  }, [allTournamentEntries, tourFilter])

  // Changing LEVEL resets the EVENT selection so a stale tournament name from a different tier
  // doesn't persist invisibly in the dropdown after the options list changes.
  const handleTourFilterChange = (newFilter: TourFilter) => {
    setTourFilter(newFilter)
    setTournamentFilter(ALL_TOURNAMENTS)
  }

  const handleGo = () => {
    setAppliedTourFilter(tourFilter)
    setAppliedTournamentFilter(tournamentFilter)
    fixturesRef.current?.refetch()
  }

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-[linear-gradient(145deg,#060A07_0%,#0C1A10_60%,#102214_100%)] text-foreground rounded-3xl p-8 md:p-12 relative overflow-hidden shadow-xl border border-primary/20">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/8 rounded-full blur-3xl -mr-64 -mt-64 pointer-events-none" />
        <div className="absolute bottom-0 right-10 opacity-[0.03] pointer-events-none mix-blend-overlay">
          <ActivitySquare className="w-[400px] h-[400px]" />
        </div>
        <div className="relative z-10 max-w-3xl space-y-6">
          <h1 className="text-5xl sm:text-6xl md:text-8xl font-display font-bold tracking-tight leading-[1.02] break-words">
            <span className="text-emerald-50 drop-shadow-[0_2px_20px_rgba(16,185,129,0.3)]">PROBABILITY</span>
            <br />
            <span className="text-emerald-100">NOT</span>
            <br />
            <span className="text-emerald-50 drop-shadow-[0_2px_20px_rgba(16,185,129,0.3)]">SENTIMENT.</span>
          </h1>
          <p className="text-emerald-100/95 text-lg md:text-xl font-medium max-w-2xl leading-relaxed">
            Multi-model prediction engine based on real ATP/WTA data. Surface Elo, serve/return strength, fatigue, and head-to-head.
          </p>
          <div className="pt-6 flex flex-wrap items-center gap-4">
            <button
              onClick={() => setLocation("/predict")}
              className="bg-primary text-primary-foreground px-8 py-4 rounded-xl font-bold font-mono text-sm hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all flex items-center gap-2 hover:-translate-y-1"
            >
              <PlaySquare className="w-4 h-4" />
              RUN MODEL
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3 pt-4 border-t border-border/40 mt-8">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">LEVEL</label>
              <Select
                value={tourFilter}
                onChange={(e) => handleTourFilterChange(e.target.value as TourFilter)}
                className="w-auto bg-background/20 backdrop-blur-sm text-foreground border-border/40 font-mono text-sm rounded-lg"
                aria-label="Filter upcoming fixtures by level"
              >
                <option value="all" className="text-foreground">All Matches</option>
                <optgroup label="Grand Slams">
                  <option value="GrandSlam" className="text-foreground">Grand Slam</option>
                </optgroup>
                <optgroup label="ATP">
                  <option value="Masters1000" className="text-foreground">Masters 1000</option>
                  <option value="ATP500" className="text-foreground">ATP 500</option>
                  <option value="ATP250" className="text-foreground">ATP 250</option>
                  <option value="Challenger" className="text-foreground">Challenger</option>
                  <option value="ITF" className="text-foreground">ITF</option>
                  <option value="atp" className="text-foreground">All ATP</option>
                </optgroup>
                <optgroup label="WTA">
                  <option value="WTA1000" className="text-foreground">WTA 1000</option>
                  <option value="WTA500" className="text-foreground">WTA 500</option>
                  <option value="WTA250" className="text-foreground">WTA 250</option>
                  <option value="wta" className="text-foreground">All WTA</option>
                </optgroup>
                <optgroup label="Lower Tiers">
                  <option value="itf" className="text-foreground">All Challenger/ITF</option>
                </optgroup>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono font-bold text-muted-foreground tracking-widest uppercase">EVENT</label>
              <Select
                value={tournamentFilter}
                onChange={(e) => setTournamentFilter(e.target.value)}
                className="w-auto bg-background/20 backdrop-blur-sm text-foreground border-border/40 font-mono text-sm rounded-lg max-w-[200px] truncate"
                aria-label="Filter upcoming fixtures by tournament"
              >
                <option value={ALL_TOURNAMENTS} className="text-foreground">All Tournaments</option>
                {filteredTournamentOptions.map((name) => (
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

      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-border/50 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Swords className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-2xl font-bold font-display">Upcoming Fixtures</h2>
          </div>
          <Badge variant="outline" className="font-mono text-[10px] border-primary/50 text-primary bg-primary/10 gap-1.5">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-70 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            LIVE DATA
          </Badge>
        </div>
        <FixturesList
          ref={fixturesRef}
          tourFilter={appliedTourFilter}
          tournamentFilter={appliedTournamentFilter}
          onTournamentsChange={setAllTournamentEntries}
        />
      </section>
    </div>
  )
}
