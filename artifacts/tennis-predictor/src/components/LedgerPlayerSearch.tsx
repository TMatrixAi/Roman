import { useSearchLedgerPlayers, getSearchLedgerPlayersQueryKey, type LedgerPlayerSummary } from "@workspace/api-client-react"
import { Input } from "@/components/ui/input"
import { Search, User } from "lucide-react"
import { useState, useEffect } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

/**
 * Search scoped to players who actually appear in at least one saved Ledger prediction --
 * distinct from PlayerSearch.tsx, which searches the live tennis-data provider for creating new
 * predictions. Selecting a result here is for jumping to that player's recorded history, not for
 * starting a new prediction.
 */
export function LedgerPlayerSearch({
  onSelect,
  onQueryChange,
  slim = false,
}: {
  onSelect: (player: LedgerPlayerSummary) => void
  /** Fired on every keystroke (not debounced) -- lets a parent clear an active player-navigation
   * context as soon as the user starts typing a new search, per the "starting a new search"
   * exit condition. */
  onQueryChange?: () => void
  /** Compact mode: smaller empty-state, tighter spacing. */
  slim?: boolean
}) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data: players, isLoading, isError } = useSearchLedgerPlayers(
    { query: debouncedQuery },
    { query: { queryKey: getSearchLedgerPlayersQueryKey({ query: debouncedQuery }), enabled: debouncedQuery.length >= 2, retry: false } }
  )

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search players with saved predictions"
          className="pl-9 font-mono bg-card h-9 text-sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onQueryChange?.()
          }}
        />
      </div>

      <div className={slim ? "" : "min-h-[120px]"}>
        {debouncedQuery.length < 2 && !players && (
          <div className={`flex items-center justify-center text-xs font-mono text-muted-foreground border border-dashed rounded-lg ${slim ? "py-3" : "p-8"}`}>
            ENTER 2+ CHARS TO SEARCH THE LEDGER
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="p-4 border border-destructive/30 bg-destructive/10 text-destructive text-sm font-mono rounded-md">
            ERR: SEARCH FAILED
          </div>
        )}

        {players && players.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 text-center text-sm font-mono text-muted-foreground border border-dashed rounded-lg p-8">
            <span>NO PLAYERS FOUND IN LEDGER</span>
            <span className="text-xs normal-case font-sans text-muted-foreground/80 max-w-xs">
              Only players with at least one recorded prediction show up here.
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
                  <div className="w-9 h-9 rounded-sm bg-secondary flex items-center justify-center text-secondary-foreground shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                  <div className="font-bold">{player.name}</div>
                </div>
                <Badge variant="outline" className="font-mono shrink-0">
                  {player.predictionCount} PREDICTION{player.predictionCount === 1 ? "" : "S"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
