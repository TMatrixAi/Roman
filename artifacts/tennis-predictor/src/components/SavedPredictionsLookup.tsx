import { useLocation } from "wouter"
import { LedgerPlayerSearch } from "@/components/LedgerPlayerSearch"
import { UserSearch } from "lucide-react"
import type { LedgerPlayerSummary } from "@workspace/api-client-react"

/**
 * Slim player-history finder for the Ledger. Navigates to a player's recorded predictions.
 * Distinct from the Build page's player-search (which queries the live provider for new predictions).
 */
export function SavedPredictionsLookup() {
  const [, navigate] = useLocation()

  const goToPlayer = (player: LedgerPlayerSummary) => {
    navigate(`/history?playerId=${encodeURIComponent(player.id)}&playerName=${encodeURIComponent(player.name)}`)
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-muted-foreground tracking-widest uppercase">
        <UserSearch className="w-3.5 h-3.5 shrink-0" />
        Search Prediction History
      </div>
      <LedgerPlayerSearch onSelect={goToPlayer} slim />
    </div>
  )
}
