---
name: TTL cache silently defeats manual refresh; live matches deliberately filtered out
description: Two non-obvious tennis-predictor fixtures pipeline behaviors worth knowing before touching the upcoming-fixtures flow again.
---

## TTL cache defeats "refresh" buttons unless explicitly bypassed
`ApiTennisProvider` caches raw fixture fetches for 5 minutes (`TtlCache`/`FIXTURES_TTL_MS`).
A manual "Refresh Fixtures" click inside that window silently re-served identical cached
data with no error — looked like the button did nothing. Fix pattern: give `TtlCache.getOrFetch`
an explicit `{ bypass: boolean }` option (skip the read, still write the fresh value back),
thread a `bypassCache`/`force` flag from the route (`force` query param) down to the button
handler. Any cache sitting in front of a user-facing "refresh" action needs an explicit
bypass path — a shorter TTL is not a real fix, just a smaller window for the same bug.

**Why relevant again:** any other "refresh"-style UI action backed by a `TtlCache` in this
codebase likely has the same latent bug until it gets the same bypass treatment.

## Live matches were deliberately filtered out of the upcoming window
`collectUpcomingWindow` used to explicitly drop any fixture whose confirmed `scheduledStart`
had already passed, treating it as "already started" and discarding it — meaning the
soonest fixture shown was always ~2 hours out even though the provider already reports
live matches (unfinished, `event_winner === null`) mixed into the same upcoming-fixtures
feed. Now fixed: live fixtures are kept and sorted ahead of upcoming ones (`isLive` field
on `Fixture`, `compareLiveFirst` sort in `upcomingWindow.ts` and `FixturesList.tsx`).
No live-score polling/provider was added — this was a prioritization/visibility fix only,
not a live-scores feature.

**Why:** worth knowing before re-touching `collectUpcomingWindow` or the `Fixture` schema —
don't reintroduce a "drop past-start-time fixtures" filter without checking this history.
</content>
