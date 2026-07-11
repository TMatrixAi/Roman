import { useSearchPlayers, getSearchPlayersQueryKey, type PlayerSummary } from "@workspace/api-client-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, User, Trophy, Globe2 } from "lucide-react"
import { useState, useEffect } from "react"
import { Skeleton } from "@/components/ui/skeleton"

export function PlayerSearch({ onSelect }: { onSelect: (player: PlayerSummary) => void }) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data: players, isLoading, isError } = useSearchPlayers(
    { query: debouncedQuery },
    { query: { queryKey: getSearchPlayersQueryKey({ query: debouncedQuery }), enabled: debouncedQuery.length >= 2, retry: false } }
  )

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search player name (e.g. Alcaraz)..."
          className="pl-9 font-mono bg-card"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="min-h-[300px]">
        {debouncedQuery.length < 2 && !players && (
          <div className="h-full flex items-center justify-center text-sm font-mono text-muted-foreground border border-dashed rounded-lg p-8">
            ENTER 2+ CHARS TO SEARCH
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div className="p-4 border border-destructive/30 bg-destructive/10 text-destructive text-sm font-mono rounded-md">
            ERR: PROVIDER UNAVAILABLE OR SEARCH FAILED
          </div>
        )}

        {players && players.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-1 text-center text-sm font-mono text-muted-foreground border border-dashed rounded-lg p-8">
            <span>NO PLAYERS FOUND</span>
            <span className="text-xs normal-case font-sans text-muted-foreground/80 max-w-xs">
              Search only covers players currently in the ATP/WTA rankings. Retired players and
              players who only compete on the Challenger/ITF circuit won't appear here.
            </span>
          </div>
        )}

        {players && players.length > 0 && (
          <div className="space-y-2">
            {players.map(player => (
              <div 
                key={player.id}
                className="group flex items-center justify-between p-3 border rounded-md bg-card hover:border-primary transition-colors cursor-pointer"
                onClick={() => onSelect(player)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center text-secondary-foreground font-bold font-mono">
                    {player.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-bold">{player.name}</div>
                    <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground mt-1">
                      {player.countryCode && (
                        <span className="flex items-center gap-1">
                          <Globe2 className="w-3 h-3" /> {player.countryCode}
                        </span>
                      )}
                      {player.currentRank && (
                        <span className="flex items-center gap-1">
                          <Trophy className="w-3 h-3" /> RANK {player.currentRank}
                        </span>
                      )}
                      {player.tour && (
                        <span className="px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded-[2px]">
                          {player.tour}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 font-mono">
                  SELECT
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
