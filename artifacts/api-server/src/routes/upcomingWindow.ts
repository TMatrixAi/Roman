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
 * Assembles a rolling "now forward" window of upcoming fixtures: fetches successive calendar
 * days (in parallel batches, via `fetchDay`) starting today, widening the window further out
 * whenever the near-term days are sparse, until `limit` results are collected or
 * `MAX_LOOKAHEAD_DAYS` is reached. Always sorted soonest-first and capped at `limit`.
 *
 * "Upcoming" means not yet started: a fixture with a confirmed `scheduledStart` in the past
 * (relative to `nowMs`) is already live/in-progress and is excluded. A fixture with no confirmed
 * time ("Time TBD") is kept regardless -- we genuinely can't tell whether it has started, and
 * this codebase never hides real data over uncertainty (see combineDateTimeUtc's contract).
 */
export async function collectUpcomingWindow(
  fetchDay: (date: string) => Promise<Fixture[]>,
  opts: { limit: number; nowMs: number },
): Promise<Fixture[]> {
  const { limit, nowMs } = opts;
  const collected: Fixture[] = [];
  const seenIds = new Set<string>();

  for (let offset = 0; offset < MAX_LOOKAHEAD_DAYS; offset += BATCH_DAYS) {
    const dayCount = Math.min(BATCH_DAYS, MAX_LOOKAHEAD_DAYS - offset);
    const batchDates = Array.from({ length: dayCount }, (_, i) => utcDateString(nowMs + (offset + i) * 86_400_000));
    const batchResults = await Promise.all(batchDates.map(fetchDay));

    for (const fixtures of batchResults) {
      for (const fixture of fixtures) {
        if (seenIds.has(fixture.id)) continue;
        if (fixture.scheduledStart && new Date(fixture.scheduledStart).getTime() < nowMs) continue;
        seenIds.add(fixture.id);
        collected.push(fixture);
      }
    }

    if (collected.length >= limit) break;
  }

  return collected.sort((a, b) => sortKey(a) - sortKey(b)).slice(0, limit);
}
