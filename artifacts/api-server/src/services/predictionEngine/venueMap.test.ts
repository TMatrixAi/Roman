import { test } from "node:test";
import assert from "node:assert/strict";
import { inferVenue } from "./venueMap";

test("Wimbledon resolves to a real venue", () => {
  const venue = inferVenue("Wimbledon Women");
  assert.ok(venue);
  assert.match(venue!.name, /London/);
});

test("French Open resolves to Paris (Roland Garros)", () => {
  const venue = inferVenue("French Open");
  assert.ok(venue);
  assert.match(venue!.name, /Paris/);
});

test("Roland-Garros (hyphenated) resolves to the same Paris venue", () => {
  const venue = inferVenue("Roland-Garros");
  assert.ok(venue);
  assert.match(venue!.name, /Paris/);
});

test("US Open resolves to New York", () => {
  const venue = inferVenue("US Open");
  assert.ok(venue);
  assert.match(venue!.name, /New York/);
});

test("BNP Paribas Open resolves to Indian Wells", () => {
  const venue = inferVenue("BNP Paribas Open");
  assert.ok(venue);
  assert.match(venue!.name, /Indian Wells/);
});

test("Mutua Madrid Open resolves to Madrid", () => {
  const venue = inferVenue("Mutua Madrid Open");
  assert.ok(venue);
  assert.match(venue!.name, /Madrid/);
});

test("Internazionali BNL d'Italia resolves to Rome", () => {
  const venue = inferVenue("Internazionali BNL d'Italia");
  assert.ok(venue);
  assert.match(venue!.name, /Rome/);
});

test("National Bank Open Toronto resolves to Toronto, not Montreal", () => {
  const venue = inferVenue("National Bank Open Toronto");
  assert.ok(venue);
  assert.match(venue!.name, /Toronto/);
});

test("National Bank Open Montreal resolves to Montreal, not Toronto", () => {
  const venue = inferVenue("National Bank Open Montreal");
  assert.ok(venue);
  assert.match(venue!.name, /Montreal/);
});

test("A bare, city-less 'Canadian Open' does not guess Toronto or Montreal", () => {
  assert.equal(inferVenue("Canadian Open"), null);
});

test("Cincinnati Open resolves to a real venue", () => {
  const venue = inferVenue("Cincinnati Open");
  assert.ok(venue);
  assert.match(venue!.name, /Ohio/);
});

test("an unknown Challenger event returns null, never a guessed venue", () => {
  assert.equal(inferVenue("ATP Challenger Trieste"), null);
});

test("an ITF event returns null, never a guessed venue", () => {
  assert.equal(inferVenue("ITF W35 Torino"), null);
});

test("a Challenger event sharing a major-venue city name is still never guessed", () => {
  // "Halle" the ATP 500 vs. a hypothetical Challenger with "Halle" in its name -- the
  // Challenger/ITF guard must win regardless of city-name overlap.
  assert.equal(inferVenue("ATP Challenger Halle II"), null);
});

test("a short alias never matches as a raw substring of an unrelated word", () => {
  // "halle" must not match merely because it's a substring of "challenger".
  assert.equal(inferVenue("Challenger Tour Event"), null);
});

test("an unlisted tournament name returns null rather than a fabricated venue", () => {
  assert.equal(inferVenue("Some Never-Before-Seen Exhibition Series"), null);
});

test("null/undefined tournament name returns null", () => {
  assert.equal(inferVenue(null), null);
  assert.equal(inferVenue(undefined), null);
});

test("Halle (ATP 500) resolves correctly and not via substring of unrelated words", () => {
  const venue = inferVenue("Halle Open");
  assert.ok(venue);
  assert.match(venue!.name, /Halle/);
});
