import { useLocation } from "wouter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { LedgerPlayerSearch } from "@/components/LedgerPlayerSearch"
import { LedgerMatchupSearch } from "@/components/LedgerMatchupSearch"
import { storePasteSearchHandoff } from "@/lib/pasteSearchHandoff"
import { UserSearch, ClipboardPaste } from "lucide-react"
import type { LedgerPlayerSummary, PredictionSummary } from "@workspace/api-client-react"

/**
 * Looks up saved Ledger predictions -- browse a player's recorded history, or paste a list of
 * matchups to find the ones already saved -- for someone deciding "have I already predicted
 * this?" before running a new one. Distinct from PlayerSearch.tsx elsewhere on this page, which
 * searches the live provider to start a brand-new prediction, not find an existing one.
 *
 * A selection here doesn't render its result on this page: the focus/step-through UI for a
 * player's history or a resolved paste match only exists on the Ledger page, so a match hands off
 * (via URL for a single player, via `pasteSearchHandoff` sessionStorage for a paste-search result
 * set, since it can't fit cleanly in a URL) and navigates there.
 */
export function SavedPredictionsLookup() {
  const [, navigate] = useLocation()

  const goToPlayer = (player: LedgerPlayerSummary) => {
    navigate(`/history?playerId=${encodeURIComponent(player.id)}&playerName=${encodeURIComponent(player.name)}`)
  }

  const goToPasteMatches = (predictions: PredictionSummary[], startIndex: number) => {
    storePasteSearchHandoff(predictions, startIndex)
    navigate("/history?pasteSearch=1")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserSearch className="w-5 h-5" />
          FIND A SAVED PREDICTION
        </CardTitle>
        <CardDescription>Already ran this matchup? Look it up in the Ledger instead of predicting it again.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="search">
          <TabsList>
            <TabsTrigger value="search" className="font-mono">
              <UserSearch className="w-4 h-4 mr-2" />
              SEARCH PLAYERS
            </TabsTrigger>
            <TabsTrigger value="pasteSearch" className="font-mono">
              <ClipboardPaste className="w-4 h-4 mr-2" />
              PASTE SEARCH
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search">
            <LedgerPlayerSearch onSelect={goToPlayer} />
          </TabsContent>

          <TabsContent value="pasteSearch">
            <LedgerMatchupSearch onView={goToPasteMatches} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
