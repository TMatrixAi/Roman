import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { useGetUpcomingFixtures, useCreatePrediction, type Fixture } from "@workspace/api-client-react"
import { useLocation } from "wouter"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyDataState } from "./DataWarning"
import { Calendar, Swords, Zap, RefreshCw, Wifi } from "lucide-react"
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

function filterFixtures(fixtures: Fixture[], tourFilter: TourFilter, tournamentFilter: string | null): Fixture[] {
  return fixtures
    .filter((fixture) => matchesFilter(fixture, tourFilter) && matchesTournament(fixture, tournamentFilter))
    .sort(liveFirstCompare)
}

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

/** Level badge colour tiers */
function levelVariant(level: string | null | undefined): "default" | "secondary" | "outline" {
  if (!level) return "outline"
  if (level === "GrandSlam") return "default"
  if (level === "Masters1000" || level === "WTA1000") return "secondary"
  return "outline"
}

/** Surface colour class for the accent bar */
function surfaceBarClass(surface: string | null | undefined): string {
  switch (surface) {
    case "Hard": return "bg-[hsl(var(--surface-hard))]"
    case "IndoorHard": return "bg-[hsl(var(--surface-indoor))]"
    case "Clay": return "bg-[hsl(var(--surface-clay))]"
    case "Grass": return "bg-[hsl(var(--surface-grass))]"
    default: return "bg-border"
  }
}

/** Surface colour for the small dot/text label */
function surfaceTextClass(surface: string | null | undefined): string {
  switch (surface) {
    case "Hard": return "text-[hsl(var(--surface-hard))]"
    case "IndoorHard": return "text-[hsl(var(--surface-indoor))]"
    case "Clay": return "text-[hsl(var(--surface-clay))]"
    case "Grass": return "text-[hsl(var(--surface-grass))]"
    default: return "text-muted-foreground"
  }
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
    setForce(false)
  }, [force, isFetching])

  useImperativeHandle(ref, () => ({
    refetch: () => { setLimit(INITIAL_PAGE_SIZE); handleRefresh() },
  }), [])

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
      <div className="space-y-2.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-[7rem] rounded-xl overflow-hidden flex">
            <Skeleton className="w-1 self-stretch rounded-none" />
            <Skeleton className="flex-1 rounded-none rounded-r-xl" />
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return <EmptyDataState message="Unable to load upcoming fixtures" icon={Calendar} />
  }

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-muted-foreground gap-1.5 h-8"
          disabled={isFetching}
          onClick={handleRefresh}
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          REFRESH
        </Button>
      </div>

      {visibleFixtures.length === 0 ? (
        <div className="p-10 border border-dashed border-border/60 rounded-xl text-center text-muted-foreground font-mono text-xs tracking-widest uppercase">
          No upcoming fixtures found
        </div>
      ) : (
        visibleFixtures.map((fixture) => (
          <div
            key={fixture.id}
            className="group flex rounded-xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all duration-200"
          >
            {/* Surface accent bar */}
            <div className={`w-[3px] shrink-0 self-stretch ${surfaceBarClass(fixture.surface)}`} />

            {/* Main content */}
            <div className="flex-1 flex flex-col sm:flex-row min-w-0">
              <div className="flex-1 p-4 flex flex-col justify-between gap-3 min-w-0">
                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-mono text-muted-foreground">
                  <Badge
                    variant={levelVariant(fixture.tournamentLevel)}
                    className="rounded-sm font-mono text-[0.625rem] px-1.5 py-0 h-4 leading-none"
                  >
                    {fixture.tournamentLevel || 'TOURNAMENT'}
                  </Badge>
                  {fixture.tournamentName && (
                    <span className="truncate max-w-[42vw] sm:max-w-[180px] text-muted-foreground/80">
                      {fixture.tournamentName}
                    </span>
                  )}
                  <span className="text-border/60">·</span>
                  <span className={`font-semibold ${surfaceTextClass(fixture.surface)}`}>
                    {fixture.surface}{fixture.indoor ? ' (Indoor)' : ''}
                  </span>
                  <span className="text-border/60">·</span>
                  {fixture.isLive ? (
                    <span className="inline-flex items-center gap-1.5 font-bold text-destructive">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-destructive" />
                      </span>
                      LIVE
                    </span>
                  ) : (
                    <span className={!fixture.scheduledStart ? "text-muted-foreground/50 italic" : undefined}>
                      {formatFixtureTime(fixture)}
                    </span>
                  )}
                </div>

                {/* Players */}
                <div className="space-y-1">
                  <div className="font-display font-bold text-[1.0625rem] leading-snug truncate">{fixture.player1Name}</div>
                  <div className="text-[0.6875rem] font-mono text-muted-foreground/50 uppercase tracking-widest font-bold">vs</div>
                  <div className="font-display font-bold text-[1.0625rem] leading-snug truncate">{fixture.player2Name}</div>
                </div>

                {predictNowError === fixture.id && (
                  <p className="text-[0.6875rem] text-destructive font-mono">Predict Now failed — provider may be unavailable.</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex sm:flex-col items-center justify-end gap-2 px-4 py-3 sm:px-3 sm:py-4 bg-secondary/30 border-t sm:border-t-0 sm:border-l border-border/40 sm:min-w-[7.5rem]">
                <Button
                  size="sm"
                  className="flex-1 sm:w-full font-mono font-bold text-[0.6875rem] h-9 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm gap-1.5"
                  disabled={predictNowFixtureId === fixture.id}
                  onClick={() => handlePredictNow(fixture)}
                >
                  {predictNowFixtureId === fixture.id ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  PREDICT
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:w-full font-mono font-bold text-[0.6875rem] h-9 gap-1.5"
                  onClick={() => setLocation(buildCustomMatchUrl(fixture))}
                >
                  <Swords className="w-3 h-3" />
                  CUSTOM
                </Button>
              </div>
            </div>
          </div>
        ))
      )}

      {hasMore && (
        <div className="flex justify-center pt-3">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs gap-1.5 h-9"
            disabled={isFetching}
            onClick={() => setLimit((l) => l + PAGE_SIZE_INCREMENT)}
          >
            {isFetching ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
            LOAD MORE MATCHES
          </Button>
        </div>
      )}
    </div>
  )
})
