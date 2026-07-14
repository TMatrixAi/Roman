import { useGetProviderStatus, useGetHistoricalDataFreshness } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Activity, AlertCircle, CheckCircle2, Clock, Database } from "lucide-react"
import { formatEasternClock } from "@/lib/timezone"

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
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">HISTORY:</span>
      {freshness.latestCoveredDate ? (
        <Badge
          variant="outline"
          className={
            isStale
              ? "h-5 px-1.5 text-[10px] border-amber-500/30 text-amber-700 bg-amber-500/10"
              : "h-5 px-1.5 text-[10px] border-green-500/30 text-green-700 bg-green-500/10"
          }
        >
          <Database className="w-3 h-3 mr-1" />
          THROUGH {freshness.latestCoveredDate}
          {freshness.daysBehind !== null && freshness.daysBehind > 1 ? ` (${freshness.daysBehind}d behind)` : ""}
        </Badge>
      ) : (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-destructive/30 text-destructive bg-destructive/10">
          <AlertCircle className="w-3 h-3 mr-1" />
          NO DATA
        </Badge>
      )}
    </div>
  )
}

export function ProviderStatusIndicator() {
  const { data: status, isLoading, isError } = useGetProviderStatus()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground animate-pulse">
        <Activity className="w-3 h-3" />
        <span>CONNECTING...</span>
      </div>
    )
  }

  if (isError || !status) {
    return (
      <div className="flex items-center gap-2 text-xs font-mono text-destructive">
        <AlertCircle className="w-3 h-3" />
        <span>SYS.OFFLINE</span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-4 text-xs font-mono">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">PROVIDER:</span>
        <span className="font-bold tracking-tight">{status.provider.toUpperCase()}</span>
      </div>
      
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">STATUS:</span>
        {status.connected ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-green-500/30 text-green-700 bg-green-500/10">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            ONLINE
          </Badge>
        ) : (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-destructive/30 text-destructive bg-destructive/10">
            <AlertCircle className="w-3 h-3 mr-1" />
            OFFLINE
          </Badge>
        )}
      </div>

      {status.lastSuccessfulCallAt && (
        <div className="flex items-center gap-1.5 hidden sm:flex text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>LAST SYNC: {formatEasternClock(status.lastSuccessfulCallAt)}</span>
        </div>
      )}

      <HistoricalDataFreshnessIndicator />
    </div>
  )
}
