import { useGetProviderStatus, useGetHistoricalDataFreshness } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Activity, AlertCircle, CheckCircle2, Clock, Database } from "lucide-react"
import { formatEasternClock } from "@/lib/timezone"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Task #144: `historical_matches` used to silently stop advancing for over a year with no visible
 * signal anywhere. This surfaces how far it currently reaches right in the persistent status bar,
 * next to provider connectivity, so a stall is noticed quickly instead of staying silent.
 * Anything more than a couple of days behind "today" is flagged -- the incremental job only ever
 * advances through yesterday by design (today's matches may not have terminal results yet), so a
 * 1-day gap is normal, not stale.
 */
function HistoricalDataFreshnessIndicator() {
  const { data: freshness, isLoading, isError } = useGetHistoricalDataFreshness()

  if (isLoading || isError || !freshness) return null

  const isStale = freshness.daysBehind === null || freshness.daysBehind > 2

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`h-5 px-1.5 text-[10px] cursor-default hidden xl:flex ${
            isStale
              ? "border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-500/10"
              : "border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10"
          }`}
        >
          <Database className="w-2.5 h-2.5 mr-1" />
          {freshness.latestCoveredDate ?? "NO DATA"}
          {freshness.daysBehind !== null && freshness.daysBehind > 1 ? ` (${freshness.daysBehind}d)` : ""}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-xs">
        Historical data through {freshness.latestCoveredDate ?? "unknown"}
        {freshness.daysBehind !== null && freshness.daysBehind > 1
          ? ` — ${freshness.daysBehind} days behind`
          : " — up to date"}
      </TooltipContent>
    </Tooltip>
  )
}

export function ProviderStatusIndicator() {
  const { data: status, isLoading, isError } = useGetProviderStatus()

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-mono text-muted-foreground animate-pulse">
        <Activity className="w-3 h-3" />
        <span className="hidden sm:inline">CONNECTING...</span>
      </div>
    )
  }

  if (isError || !status) {
    return (
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-mono text-destructive">
        <AlertCircle className="w-3 h-3" />
        <span className="hidden sm:inline">OFFLINE</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-[0.6875rem] font-mono">
      {/* Provider name — only on wide screens */}
      <span className="hidden lg:inline text-muted-foreground font-bold tracking-tight">
        {status.provider?.toUpperCase() ?? "PROVIDER"}
      </span>

      {/* Status badge — always visible */}
      <Tooltip>
        <TooltipTrigger asChild>
          {status.connected ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/10 cursor-default gap-1">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">ONLINE</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-destructive/30 text-destructive bg-destructive/10 cursor-default gap-1">
              <AlertCircle className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">OFFLINE</span>
            </Badge>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="font-mono text-xs">
          {status.provider?.toUpperCase() ?? "PROVIDER"} — {status.connected ? "connected" : "disconnected"}
          {status.lastSuccessfulCallAt && ` · last sync ${formatEasternClock(status.lastSuccessfulCallAt)}`}
        </TooltipContent>
      </Tooltip>

      {/* Last sync — only on large screens */}
      {status.lastSuccessfulCallAt && (
        <span className="hidden xl:flex items-center gap-1 text-muted-foreground/70">
          <Clock className="w-2.5 h-2.5" />
          {formatEasternClock(status.lastSuccessfulCallAt)}
        </span>
      )}

      <HistoricalDataFreshnessIndicator />
    </div>
  )
}
