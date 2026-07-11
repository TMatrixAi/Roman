import { useGetUpcomingFixtures } from "@workspace/api-client-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyDataState } from "./DataWarning"
import { Calendar, Swords } from "lucide-react"

export function FixturesList({ onSelectMatchup }: { onSelectMatchup?: (p1Id: string, p2Id: string) => void }) {
  const { data: fixtures, isLoading, isError } = useGetUpcomingFixtures()

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (isError) {
    return <EmptyDataState message="Unable to load upcoming fixtures" icon={Calendar} />
  }

  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground font-mono text-sm">
        NO UPCOMING FIXTURES TODAY
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {fixtures.map((fixture) => (
        <Card key={fixture.id} className="overflow-hidden hover:border-primary/50 transition-colors">
          <div className="flex flex-col sm:flex-row">
            <div className="flex-1 p-4 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-3">
                <Badge variant="secondary" className="rounded-sm font-mono text-[10px] px-1.5 py-0">
                  {fixture.tournamentLevel || 'TOURNAMENT'}
                </Badge>
                {fixture.tournamentName && <span className="truncate max-w-[200px]">{fixture.tournamentName}</span>}
                <span>•</span>
                <span>{fixture.surface} {fixture.indoor ? '(Indoor)' : ''}</span>
              </div>
              
              <div className="flex flex-col gap-1.5 font-bold text-lg">
                <div className="flex justify-between items-center">
                  <span>{fixture.player1Name}</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground text-sm font-mono">
                  <span>vs</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>{fixture.player2Name}</span>
                </div>
              </div>
            </div>
            
            {onSelectMatchup && (
              <div className="bg-secondary p-4 flex sm:flex-col items-center justify-center gap-2 border-t sm:border-t-0 sm:border-l border-border">
                <Button 
                  variant="accent" 
                  size="sm" 
                  className="w-full font-mono font-bold"
                  onClick={() => onSelectMatchup(fixture.player1Id, fixture.player2Id)}
                >
                  <Swords className="w-4 h-4 mr-2" />
                  PREDICT
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
