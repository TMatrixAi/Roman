import { useLocation } from "wouter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { LedgerPlayerSearch } from "@/components/LedgerPlayerSearch"
import { UserSearch } from "lucide-react"
import type { LedgerPlayerSummary } from "@workspace/api-client-react"

/**
 * Bottom-of-page finder: look up a player name to browse their saved prediction history in the
 * Ledger. Distinct from the "Player Search" tab above (which searches the live provider to add
 * players to a new prediction) and from the "Paste Search" tab above (which finds multiple
 * existing predictions from a pasted list). This box is only for navigating to a specific
 * player's recorded history — it does not start a new prediction.
 */
export function SavedPredictionsLookup() {
  const [, navigate] = useLocation()

  const goToPlayer = (player: LedgerPlayerSummary) => {
    navigate(`/history?playerId=${encodeURIComponent(player.id)}&playerName=${encodeURIComponent(player.name)}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserSearch className="w-5 h-5" />
          FIND A PLAYER'S SAVED MATCHES
        </CardTitle>
        <CardDescription>
          Search by player name to open their full recorded prediction history in the Ledger.
          To find multiple specific matchups, use the Paste Search tab in the Player Search box above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LedgerPlayerSearch onSelect={goToPlayer} />
      </CardContent>
    </Card>
  )
}
