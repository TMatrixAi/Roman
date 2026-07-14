import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTournamentTimezone } from "./timezoneMap";

test("resolveTournamentTimezone resolves majors/Masters by fixed city", () => {
  assert.equal(resolveTournamentTimezone("Wimbledon"), "Europe/London");
  assert.equal(resolveTournamentTimezone("Rome"), "Europe/Rome");
  assert.equal(resolveTournamentTimezone("Rome - Qualification"), "Europe/Rome");
});

test("resolveTournamentTimezone resolves smaller tour stops from real fixture city names (Task #74)", () => {
  assert.equal(resolveTournamentTimezone("Iasi"), "Europe/Bucharest");
  assert.equal(resolveTournamentTimezone("M15 Monastir 27"), "Africa/Tunis");
  assert.equal(resolveTournamentTimezone("W15 Monastir 22"), "Africa/Tunis");
  assert.equal(resolveTournamentTimezone("M25 Brisbane"), "Australia/Brisbane");
  assert.equal(resolveTournamentTimezone("W75 Brisbane 2"), "Australia/Brisbane");
  assert.equal(resolveTournamentTimezone("ATP Buenos Aires"), "America/Argentina/Buenos_Aires");
  assert.equal(resolveTournamentTimezone("W35 Sao Paulo"), "America/Sao_Paulo");
  assert.equal(resolveTournamentTimezone("W15 Astana 2"), "Asia/Almaty");
  assert.equal(resolveTournamentTimezone("Tenerife 2"), "Atlantic/Canary");
});

test("resolveTournamentTimezone only matches US cities via their explicit state-code suffix, not the bare city name", () => {
  // "Naples" alone must stay unresolved -- it's much more likely to mean Naples, Italy than
  // Naples, FL, and this table never guesses between them.
  assert.equal(resolveTournamentTimezone("Naples"), null);
  assert.equal(resolveTournamentTimezone("M15 Naples, FL"), "America/New_York");
  assert.equal(resolveTournamentTimezone("Rochester"), null);
  assert.equal(resolveTournamentTimezone("M15 Rochester, NY"), "America/New_York");
  assert.equal(resolveTournamentTimezone("M25 Louisville, KY"), "America/Kentucky/Louisville");
});

test("resolveTournamentTimezone does not let a compound city name collide with an unrelated fixed city", () => {
  // "Porto Alegre" (Brazil) must not be misread as "Porto" (Portugal) -- different country, different offset.
  assert.equal(resolveTournamentTimezone("Porto Alegre"), null);
  assert.equal(resolveTournamentTimezone("W50 Porto"), "Europe/Lisbon");
});

test("resolveTournamentTimezone resolves an explicit '(Country)' suffix for a single-timezone country", () => {
  assert.equal(resolveTournamentTimezone("Athens (Greece)"), "Europe/Athens");
  assert.equal(resolveTournamentTimezone("Kitzbuhel (Austria) - Qualification"), "Europe/Vienna");
});

test("resolveTournamentTimezone never guesses a rotating team event, a multi-timezone bare country, or an ambiguous bare city shared by two known tennis-hosting locations", () => {
  assert.equal(resolveTournamentTimezone("Davis Cup - World Group I Teams"), null);
  assert.equal(resolveTournamentTimezone("Billie Jean King Cup - Group III Teams"), null);
  assert.equal(resolveTournamentTimezone("UTS Championship"), null);
  assert.equal(resolveTournamentTimezone("W15 Brisbane (Australia)"), "Australia/Brisbane");
  // Birmingham could mean Birmingham, UK or Birmingham, Alabama, USA -- genuinely ambiguous.
  assert.equal(resolveTournamentTimezone("W35 Birmingham"), null);
});

test("resolveTournamentTimezone returns null for missing input", () => {
  assert.equal(resolveTournamentTimezone(null), null);
  assert.equal(resolveTournamentTimezone(undefined), null);
  assert.equal(resolveTournamentTimezone(""), null);
});
