import { useRef, useState } from "react"
import { useLocation } from "wouter"
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

export default function Home() {
  const [, setLocation] = useLocation()
  const [tourFilter, setTourFilter] = useState<TourFilter>("all")
  const [priorityFilter, setPriorityFilter] = useState<TourFilter>("all")
  const fixturesRef = useRef<FixturesListHandle>(null)

  const handleGo = () => {
    setPriorityFilter(tourFilter)
    fixturesRef.current?.refetch()
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary text-primary-foreground rounded-lg p-8 md:p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
          <ActivitySquare className="w-96 h-96 -mt-24 -mr-24" />
        </div>
        <div className="relative z-10 max-w-2xl space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tighter">
            PROBABILITY <br /> NOT SENTIMENT.
          </h1>
          <p className="text-primary-foreground/80 text-lg md:text-xl font-medium max-w-xl">
            Multi-model prediction engine based on real ATP/WTA data. Surface Elo, serve/return strength, fatigue, and head-to-head.
          </p>
          <div className="pt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={() => setLocation("/history")}
              className="bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 px-6 py-3 rounded-md font-bold font-mono text-sm transition-all"
            >
              VIEW LEDGER
            </button>
            <button
              onClick={() => setLocation("/predict")}
              className="bg-accent text-accent-foreground px-6 py-3 rounded-md font-bold font-mono text-sm hover:brightness-110 transition-all flex items-center gap-2 ml-auto"
            >
              <PlaySquare className="w-4 h-4" />
              BUILD MATCHUP
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={tourFilter}
              onChange={(e) => setTourFilter(e.target.value as TourFilter)}
              className="w-auto bg-primary-foreground/10 text-primary-foreground border-primary-foreground/20 font-mono text-sm"
              aria-label="Prioritize upcoming fixtures by tour"
            >
              {TOUR_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="text-foreground">{opt.label}</option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGo}
              className="font-mono font-bold gap-1.5"
            >
              GO
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-8">
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <Swords className="w-5 h-5" />
            <h2 className="text-xl font-bold">UPCOMING FIXTURES</h2>
          </div>
          <p className="text-sm text-muted-foreground font-mono mb-4">QUICK START PREDICTIONS</p>
          <FixturesList ref={fixturesRef} priorityFilter={priorityFilter} />
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <ActivitySquare className="w-5 h-5" />
            <h2 className="text-xl font-bold">PLAYER LOOKUP</h2>
          </div>
          <p className="text-sm text-muted-foreground font-mono mb-4">SEARCH DATABASE</p>
          <Card className="border-border shadow-none">
            <CardContent className="pt-6">
              <PlayerSearch onSelect={(player) => setLocation(`/predict?p1=${player.id}`)} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
