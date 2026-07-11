import { useLocation } from "wouter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { FixturesList } from "@/components/FixturesList"
import { PlayerSearch } from "@/components/PlayerSearch"
import { ActivitySquare, PlaySquare, Swords } from "lucide-react"

export default function Home() {
  const [, setLocation] = useLocation()

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
          <div className="pt-4 flex flex-wrap gap-4">
            <button 
              onClick={() => setLocation("/predict")}
              className="bg-accent text-accent-foreground px-6 py-3 rounded-md font-bold font-mono text-sm hover:brightness-110 transition-all flex items-center gap-2"
            >
              <PlaySquare className="w-4 h-4" />
              BUILD MATCHUP
            </button>
            <button 
              onClick={() => setLocation("/history")}
              className="bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 px-6 py-3 rounded-md font-bold font-mono text-sm transition-all"
            >
              VIEW LEDGER
            </button>
          </div>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-8">
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <Swords className="w-5 h-5" />
            <h2 className="text-xl font-bold">TODAY'S FIXTURES</h2>
          </div>
          <p className="text-sm text-muted-foreground font-mono mb-4">QUICK START PREDICTIONS</p>
          <FixturesList onSelectMatchup={(p1, p2) => setLocation(`/predict?p1=${p1}&p2=${p2}`)} />
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
