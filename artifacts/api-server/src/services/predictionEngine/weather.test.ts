import { test } from "node:test";
import assert from "node:assert/strict";
import { logger } from "../../lib/logger";
import { getUpcomingConditions } from "./weather";

// A real, known venue (Wimbledon/London) with a scheduled time comfortably inside the forecast
// horizon, so every test below actually reaches the network-call path instead of short-circuiting
// on "unknown venue" or "too far out to forecast".
const UPCOMING_AT = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

function withMockedFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function withCapturedWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const original = logger.warn.bind(logger);
  const warnings: unknown[][] = [];
  // @ts-expect-error -- test-only spy, restored immediately after
  logger.warn = (...args: unknown[]) => {
    warnings.push(args);
    return original(...(args as Parameters<typeof original>));
  };
  return fn()
    .then((result) => ({ result, warnings }))
    .finally(() => {
      logger.warn = original;
    });
}

test("getUpcomingConditions logs a warning and returns null on a network failure", async () => {
  const { result, warnings } = await withCapturedWarnings(() =>
    withMockedFetch(
      async () => {
        throw new Error("simulated network failure");
      },
      () => getUpcomingConditions("Wimbledon", UPCOMING_AT),
    ),
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /network error/i);
});

test("getUpcomingConditions logs a warning and returns null on a non-OK response", async () => {
  const { result, warnings } = await withCapturedWarnings(() =>
    withMockedFetch(
      async () => new Response("", { status: 503 }),
      () => getUpcomingConditions("Wimbledon", UPCOMING_AT),
    ),
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /non-OK response/i);
});

test("getUpcomingConditions logs a warning and returns null when hourly data is missing", async () => {
  const { result, warnings } = await withCapturedWarnings(() =>
    withMockedFetch(
      async () => new Response(JSON.stringify({}), { status: 200 }),
      () => getUpcomingConditions("Wimbledon", UPCOMING_AT),
    ),
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /no hourly data/i);
});

test("getUpcomingConditions returns real conditions and logs nothing on a valid response", async () => {
  const dateStr = UPCOMING_AT.toISOString().slice(0, 10);
  const { result, warnings } = await withCapturedWarnings(() =>
    withMockedFetch(
      async () =>
        new Response(
          JSON.stringify({
            hourly: {
              time: [`${dateStr}T12:00`],
              temperature_2m: [21.4],
              wind_speed_10m: [9.6],
              precipitation_probability: [10],
            },
          }),
          { status: 200 },
        ),
      () => getUpcomingConditions("Wimbledon", UPCOMING_AT),
    ),
  );

  assert.equal(warnings.length, 0);
  assert.ok(result);
  assert.equal(result!.temperatureC, 21);
  assert.equal(result!.windSpeedKph, 10);
  assert.equal(result!.precipitationProbability, 10);
});

test("getUpcomingConditions returns null without logging when the venue can't be resolved (genuinely absent, not a failure)", async () => {
  const { result, warnings } = await withCapturedWarnings(() =>
    getUpcomingConditions("Some Unknown Challenger Event", UPCOMING_AT),
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 0);
});
