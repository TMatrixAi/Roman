import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { useGetUpcomingFixtures, useCreatePrediction, type Fixture } from "@workspace/api-client-react"
import { useLocation } from "wouter"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyDataState } from "./DataWarning"
import { Calendar, Swords, Zap, RefreshCw } from "lucide-react"
import { formatEasternDateTime } from "@/lib/timezone"

export type TourFilter = "all" | "atp" | "wta" | "itf"

const WTA_LEVELS = new Set(["WTA1000", "WTA500", "WTA250"])
const ATP_LEVELS = new Set(["Masters1000", "ATP500", "ATP250"])
const ITF_LEVELS = new Set(["Challenger", "ITF"])

/**
 * Fixture has no per-match tour/gender field, so ATP/WTA/ITF buckets are inferred from
 * tournamentLevel. GrandSlam draws host both ATP and WTA -- we can't disambiguate a specific
 * fixture without more data, so a Slam match is honestly counted in BOTH buckets rather than
 * guessed into one. Challenger and ITF are folded into a single "ITF" bucket since the requested
 * filter has no separate slot for them.
 *
 * Task #84: a fixture whose level couldn't be resolved at all (null) is NOT the same as a fixture
 * we know doesn't belong to the selected tour -- it's a real, upcoming match we simply can't
 * classify yet (shown with the generic "TOURNAMENT" badge). Hiding it under every specific tour
 * filter silently loses real matches with no indication they exist, so -- same honesty principle
 * as GrandSlam above -- it's shown under every tour filter rather than guessed into one or
 * dropped.
 */
function matchesFilter(fixture: Fixture, filter: TourFilter): boolean {
  if (filter === "all") return true
  const level = fixture.tournamentLevel
  if (!level) return true
  if (filter === "wta") return WTA_LEVELS.has(level) || level === "GrandSlam"
  if (filter === "atp") return ATP_LEVELS.has(level) || level === "GrandSlam"
  if (filter === "itf") return ITF_LEVELS.has(level)
  return false
}

/**
 * Task #110: real, independent second filter alongside the tour/level one -- matches on the
 * fixture's actual tournamentName, never a guess. A null/undefined tournamentFilter (or the
 * "all" sentinel) matches everything, same convention as TourFilter's "all".
 */
function matchesTournament(fixture: Fixture, tournamentFilter: string | null): boolean {
  if (!tournamentFilter || tournamentFilter === "all") return true
  return fixture.tournamentName === tournamentFilter
}

/**
 * Sort key for a fixture's real start time. Fixtures with no provider-confirmed time ("Time TBD")
 * sort after every confirmed fixture on the same calendar date, rather than being guessed into
 * some position -- never fabricated, never inherited from another match or the tournament date.
 */
function timeSortKey(fixture: Fixture): number {
  return fixture.scheduledStart ? new Date(fixture.scheduledStart).getTime() : new Date(`${fixture.date}T23:59:59.999Z`).getTime()
}

/**
 * Live (already-started, no winner yet) fixtures sort as a group ahead of every not-yet-started
 * fixture, mirroring the server's own `liveFirstSortKey` -- a live match is the most actionable
 * thing to show first, regardless of how its own start time compares to an upcoming match's.
 */
function liveFirstCompare(a: Fixture, b: Fixture): number {
  const aGroup = a.isLive ? 0 : 1
  const bGroup = b.isLive ? 0 : 1
  return aGroup !== bGroup ? aGroup - bGroup : timeSortKey(a) - timeSortKey(b)
}

/**
 * Fixtures NOT matching the applied tour filter are hidden entirely -- this is a real filter, not
 * a reordering. The remaining (matching) fixtures keep the existing live-first, then time-based
 * order. When tourFilter is "all", every fixture matches, so nothing is hidden.
 */
function filterFixtures(fixtures: Fixture[], tourFilter: TourFilter, tournamentFilter: string | null): Fixture[] {
  return fixtures
    .filter((fixture) => matchesFilter(fixture, tourFilter) && matchesTournament(fixture, tournamentFilter))
    .sort(liveFirstCompare)
}

/**
 * Formats a fixture's real start time consistently in Eastern time, or "Time TBD" when the
 * provider hasn't confirmed one. See `formatEasternDateTime` for why Eastern (not the viewer's
 * local timezone) is used everywhere in this app.
 */
function formatFixtureTime(fixture: Fixture): string {
  return formatEasternDateTime(fixture.scheduledStart)
}

function buildCustomMatchUrl(fixture: Fixture): string {
  const params = new URLSearchParams({ p1: fixture.player1Id, p2: fixture.player2Id })
  if (fixture.surface) params.set("surface", fixture.surface)
  if (fixture.matchFormat) params.set("format", fixture.matchFormat)
  if (fixture.tournamentLevel) params.set("level", fixture.tournamentLevel)
  if (fixture.tournamentName) params.set("tournamentName", fixture.tournamentName)
  return `/predict?${params.toString()}`
}

export type FixturesListHandle = {
  /** Refetches fixtures from the server. Used by the Home page's "Go" button. */
  refetch: () => void
}

const INITIAL_PAGE_SIZE = 50
const PAGE_SIZE_INCREMENT = 50

export const FixturesList = forwardRef<
  FixturesListHandle,
  { tourFilter?: TourFilter; tournamentFilter?: string | null; onTournamentsChange?: (names: string[]) => void }
>(
  function FixturesList({ tourFilter = "all", tournamentFilter = null, onTournamentsChange }, ref) {
  const [limit, setLimit] = useState(INITIAL_PAGE_SIZE)
  // Task: "Refresh Fixtures" must actually pull fresh data, not silently re-serve the provider's
  // 5-minute in-memory cache. `force` flips true only for the single request the button
  // triggers (a distinct query key, so it's a real new network call, never a no-op cache hit),
  // then resets so normal/automatic loads go back through the cache as usual.
  const [force, setForce] = useState(false)
  const { data, isLoading, isError, isFetching } = useGetUpcomingFixtures({ limit, force: force || undefined })
  const fixtures = data?.fixtures
  const hasMore = data?.hasMore ?? false
  const [, setLocation] = useLocation()
  const createPrediction = useCreatePrediction()
  const [predictNowFixtureId, setPredictNowFixtureId] = useState<string | null>(null)
  const [predictNowError, setPredictNowError] = useState<string | null>(null)

  const handleRefresh = () => {
    setForce(true)
  }

  useEffect(() => {
    if (!force || isFetching) return
    // The forced request has resolved (or failed) -- drop back to normal cached behavior for
    // whatever triggers the next fetch (pagination, filters, automatic refetches).
    setForce(false)
  }, [force, isFetching])

  useImperativeHandle(ref, () => ({
    refetch: () => { setLimit(INITIAL_PAGE_SIZE); handleRefresh() },
  }), [])

  // Task #110: real distinct tournament names among the currently loaded fixtures (independent
  // of tourFilter, so switching the level dropdown doesn't make event options disappear/reappear
  // out from under the user), reported up for the Home page's event dropdown. Never fabricated --
  // only tournamentName values fixtures actually have.
  useEffect(() => {
    if (!onTournamentsChange) return
    const names = Array.from(new Set((fixtures ?? []).map((f) => f.tournamentName).filter((n): n is string => !!n))).sort()
    onTournamentsChange(names)
  }, [fixtures, onTournamentsChange])

  const visibleFixtures = useMemo(() => {
    if (!fixtures) return []
    return filterFixtures(fixtures, tourFilter, tournamentFilter)
  }, [fixtures, tourFilter, tournamentFilter])

  const handlePredictNow = (fixture: Fixture) => {
    setPredictNowError(null)
    setPredictNowFixtureId(fixture.id)
    createPrediction.mutate(
      {
        data: {
          player1Id: fixture.player1Id,
          player2Id: fixture.player2Id,
          surface: fixture.surface ?? "Hard",
          matchFormat: fixture.matchFormat ?? (fixture.tournamentLevel === "GrandSlam" ? "BestOf5" : "BestOf3"),
          tournamentLevel: fixture.tournamentLevel ?? undefined,
          tournamentName: fixture.tournamentName ?? undefined,
        },
      },
      {
        onSuccess: (prediction) => {
          setPredictNowFixtureId(null)
          setLocation(`/predictions/${prediction.id}`)
        },
        onError: () => {
          setPredictNowFixtureId(null)
          setPredictNowError(fixture.id)
        },
      },
    )
  }

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

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-muted-foreground"
          disabled={isFetching}
          onClick={handleRefresh}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          REFRESH FIXTURES
        </Button>
      </div>

      {visibleFixtures.length === 0 ? (
        <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground font-mono text-sm">
          NO UPCOMING FIXTURES FOUND
        </div>
      ) : (
        visibleFixtures.map((fixture) => (
        <Card key={fixture.id} className="overflow-hidden hover:border-primary/50 transition-colors">
          <div className="flex flex-col sm:flex-row">
            <div className="flex-1 p-4 flex flex-col justify-center">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-muted-foreground mb-3">
                <Badge variant="secondary" className="rounded-sm font-mono text-[10px] px-1.5 py-0">
                  {fixture.tournamentLevel || 'TOURNAMENT'}
                </Badge>
                {fixture.tournamentName && <span className="truncate max-w-[45vw] sm:max-w-[200px]">{fixture.tournamentName}</span>}
                <span>•</span>
                <span>{fixture.surface} {fixture.indoor ? '(Indoor)' : ''}</span>
                <span>•</span>
                {fixture.isLive ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-destructive">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                    </span>
                    LIVE
                  </span>
                ) : (
                  <span className={!fixture.scheduledStart ? "text-muted-foreground/70 italic" : undefined}>{formatFixtureTime(fixture)}</span>
                )}
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

              {predictNowError === fixture.id && (
                <p className="mt-2 text-xs text-destructive font-mono">Predict Now failed -- provider may be unavailable. Try again.</p>
              )}
            </div>
            
            <div className="bg-secondary p-4 flex sm:flex-col items-center justify-center gap-2 border-t sm:border-t-0 sm:border-l border-border">
              <Button
                variant="accent"
                size="sm"
                className="w-full font-mono font-bold bg-primary text-primary-foreground hover:brightness-110"
                disabled={predictNowFixtureId === fixture.id}
                onClick={() => handlePredictNow(fixture)}
              >
                {predictNowFixtureId === fixture.id ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                PREDICT NOW
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono font-bold"
                onClick={() => setLocation(buildCustomMatchUrl(fixture))}
              >
                <Swords className="w-4 h-4 mr-2" />
                CUSTOM MATCH
              </Button>
            </div>
          </div>
        </Card>
        ))
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            disabled={isFetching}
            onClick={() => setLimit((l) => l + PAGE_SIZE_INCREMENT)}
          >
            {isFetching ? (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : null}
            LOAD MORE MATCHES
          </Button>
        </div>
      )}
    </div>
  )
})
