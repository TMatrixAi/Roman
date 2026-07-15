import type { Fixture } from "../services/tennisData/types";

// Days are fetched in parallel batches of this size, widening the window round by round until
// `limit` results are collected or this many total days out have been examined -- a safety cap
// so a genuinely dead calendar (e.g. off-season) can't trigger an unbounded number of provider
// calls.
export const BATCH_DAYS = 7;
export const MAX_LOOKAHEAD_DAYS = 35;

export function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Real start-time sort key: unconfirmed ("Time TBD") fixtures sort after every confirmed fixture on the same calendar date. */
export function sortKey(f: Fixture): number {
  return f.scheduledStart ? new Date(f.scheduledStart).getTime() : new Date(`${f.date}T23:59:59.999Z`).getTime();
}

/**
 * Live fixtures (already started, no winner yet) sort as a group ahead of every not-yet-started
 * fixture -- a live match is the most actionable thing to show first, regardless of how its own
 * start time compares to an upcoming match's. Within each group, soonest/earliest-started first.
 */
export function liveFirstSortKey(f: Fixture): [number, number] {
  return [f.isLive ? 0 : 1, sortKey(f)];
}

function compareLiveFirst(a: Fixture, b: Fixture): number {
  const [aGroup, aTime] = liveFirstSortKey(a);
  const [bGroup, bTime] = liveFirstSortKey(b);
  return aGroup !== bGroup ? aGroup - bGroup : aTime - bTime;
}

export interface UpcomingWindowResult {
  fixtures: Fixture[];
  /** True when at least one more fixture exists beyond `offset + limit` within the lookahead window (i.e. paging further would return more). */
  hasMore: boolean;
}

/**
 * Assembles a rolling "now forward" window of upcoming fixtures: fetches successive calendar-day
 * batches (each batch as a SINGLE multi-day range call, via `fetchRange`) starting today,
 * widening the window further out whenever the near-term days are sparse, until `offset + limit`
 * results are collected (so a page further into the list can be sliced out) or
 * `MAX_LOOKAHEAD_DAYS` is reached. Always sorted soonest-first.
 *
 * Batches are fetched one range call at a time rather than one call per day -- during a sparse
 * (e.g. off-season) stretch, the old per-day-call approach needed up to `BATCH_DAYS` round trips
 * just to fill the first batch; a single range call gets the same data in one round trip. Batch
 * boundaries are anchored to `nowMs`'s calendar day (not to `limit`/`offset`), so repeated calls
 * for different pages on the same day request the exact same range keys and get real cache reuse
 * from the provider.
 *
 * This window is not strictly "not yet started": a fixture with a confirmed `scheduledStart` in
 * the past (relative to `nowMs`) that the provider hasn't reported a winner for yet is currently
 * live/in-progress -- it's kept, flagged `isLive`, and sorted ahead of every not-yet-started
 * fixture (see `liveFirstSortKey`), since a live match is the most actionable thing to surface
 * first. A fixture with no confirmed time ("Time TBD") is kept regardless -- we genuinely can't
 * tell whether it has started, and this codebase never hides real data over uncertainty (see
 * combineDateTimeUtc's contract).
 *
 * `offset` lets a caller page past an earlier page's results (e.g. a busy Challenger/ITF day with
 * 50+ matches before noon) instead of being permanently capped at the first `limit` fixtures.
 */
export async function collectUpcomingWindow(
  fetchRange: (dateStart: string, dateStop: string) => Promise<Fixture[]>,
  opts: { limit: number; nowMs: number; offset?: number },
): Promise<UpcomingWindowResult> {
  const { limit, nowMs, offset = 0 } = opts;
  const target = offset + limit;
  const collected: Fixture[] = [];
  const seenIds = new Set<string>();

  for (let dayOffset = 0; dayOffset < MAX_LOOKAHEAD_DAYS; dayOffset += BATCH_DAYS) {
    const dayCount = Math.min(BATCH_DAYS, MAX_LOOKAHEAD_DAYS - dayOffset);
    const batchStart = utcDateString(nowMs + dayOffset * 86_400_000);
    const batchStop = utcDateString(nowMs + (dayOffset + dayCount - 1) * 86_400_000);
    const fixtures = await fetchRange(batchStart, batchStop);

    for (const fixture of fixtures) {
      if (seenIds.has(fixture.id)) continue;
      seenIds.add(fixture.id);
      collected.push(fixture);
    }

    // Collect one extra beyond `target` so we can tell whether a further page would be
    // non-empty (`hasMore`), without that lookahead fixture leaking into this page's slice.
    if (collected.length > target) break;
  }

  const sorted = collected.sort(compareLiveFirst);
  return {
    fixtures: sorted.slice(offset, target),
    hasMore: sorted.length > target,
  };
}
