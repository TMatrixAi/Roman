import { History as HistoryIcon } from "lucide-react"

export function HistoricalMatchFallbackBadge() {
  return (
    <span
      className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded-[2px] normal-case text-xs font-mono flex items-center gap-1 shrink-0"
      title="At least one player's tour/rank came from their own past match record, not a live ranking"
    >
      <HistoryIcon className="w-3 h-3" /> PAST-MATCH RANK
    </span>
  )
}