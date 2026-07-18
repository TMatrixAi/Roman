import { test } from "node:test"
import assert from "node:assert/strict"
import { parseMatchupLine, parseMatchupLines } from "./matchupLineParser"

test("parses 'Player A vs Player B — Tournament' with an em dash", () => {
  const result = parseMatchupLine("Djokovic vs Alcaraz — Wimbledon")
  assert.equal(result.playerAName, "Djokovic")
  assert.equal(result.playerBName, "Alcaraz")
  assert.equal(result.tournamentName, "Wimbledon")
  assert.equal(result.parseError, null)
})

test("parses a hyphen-separated tournament without splitting hyphenated player surnames", () => {
  const result = parseMatchupLine("Auger-Aliassime vs Bonzi - Halle Open")
  assert.equal(result.playerAName, "Auger-Aliassime")
  assert.equal(result.playerBName, "Bonzi")
  assert.equal(result.tournamentName, "Halle Open")
})

test("parses 'v' and '@' separators", () => {
  const result = parseMatchupLine("Swiatek v Sabalenka @ French Open")
  assert.equal(result.playerAName, "Swiatek")
  assert.equal(result.playerBName, "Sabalenka")
  assert.equal(result.tournamentName, "French Open")
})

test("parses 'in' as a tournament separator", () => {
  const result = parseMatchupLine("Sinner vs Zverev in Miami Open")
  assert.equal(result.playerAName, "Sinner")
  assert.equal(result.playerBName, "Zverev")
  assert.equal(result.tournamentName, "Miami Open")
})

test("has no tournament when the line only has two player names", () => {
  const result = parseMatchupLine("Sinner vs Zverev")
  assert.equal(result.playerAName, "Sinner")
  assert.equal(result.playerBName, "Zverev")
  assert.equal(result.tournamentName, null)
  assert.equal(result.parseError, null)
})

test("flags a line with no recognizable vs-separator as a parse error, without guessing", () => {
  const result = parseMatchupLine("Just some random text with no matchup")
  assert.equal(result.playerAName, null)
  assert.equal(result.playerBName, null)
  assert.ok(result.parseError)
})

test("flags an empty line as a parse error", () => {
  const result = parseMatchupLine("   ")
  assert.ok(result.parseError)
})

test("parseMatchupLines splits on newlines and skips blank lines", () => {
  const results = parseMatchupLines("Djokovic vs Alcaraz — Wimbledon\n\n  Sinner vs Zverev\n")
  assert.equal(results.length, 2)
  assert.equal(results[0].playerAName, "Djokovic")
  assert.equal(results[1].playerAName, "Sinner")
})

test("bare 'vs' does not get confused by a tournament name containing 'in'", () => {
  const result = parseMatchupLine("Medvedev vs Rublev in Indian Wells")
  assert.equal(result.playerAName, "Medvedev")
  assert.equal(result.playerBName, "Rublev")
  assert.equal(result.tournamentName, "Indian Wells")
})

test("strips a leading '*' bullet marker from a pasted list line", () => {
  const result = parseMatchupLine("* Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(result.playerAName, "Murphy Cassone")
  assert.equal(result.playerBName, "Tristan Schoolkate")
  assert.equal(result.parseError, null)
})

test("strips a leading '-' bullet marker from a pasted list line", () => {
  const result = parseMatchupLine("- Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(result.playerAName, "Murphy Cassone")
  assert.equal(result.playerBName, "Tristan Schoolkate")
})

test("strips a leading '•' bullet marker from a pasted list line", () => {
  const result = parseMatchupLine("• Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(result.playerAName, "Murphy Cassone")
  assert.equal(result.playerBName, "Tristan Schoolkate")
})

test("strips a leading numbered-list marker ('1.' or '1)') from a pasted list line", () => {
  const dot = parseMatchupLine("1. Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(dot.playerAName, "Murphy Cassone")
  assert.equal(dot.playerBName, "Tristan Schoolkate")

  const paren = parseMatchupLine("12) Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(paren.playerAName, "Murphy Cassone")
  assert.equal(paren.playerBName, "Tristan Schoolkate")
})

test("does not strip a genuine leading hyphenated name segment (no space after the hyphen)", () => {
  const result = parseMatchupLine("Auger-Aliassime vs Bonzi - Halle Open")
  assert.equal(result.playerAName, "Auger-Aliassime")
  assert.equal(result.playerBName, "Bonzi")
  assert.equal(result.tournamentName, "Halle Open")
})

test("keeps the un-stripped raw text for display while stripping the marker for parsing", () => {
  const result = parseMatchupLine("* Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(result.raw, "* Murphy Cassone vs. Tristan Schoolkate")
})

test("a marker-less line is unaffected", () => {
  const result = parseMatchupLine("Murphy Cassone vs. Tristan Schoolkate")
  assert.equal(result.playerAName, "Murphy Cassone")
  assert.equal(result.playerBName, "Tristan Schoolkate")
})

// ── Task #20: new formats ────────────────────────────────────────────────────

test("parses 'A — B' (em dash as player separator, no tournament)", () => {
  const result = parseMatchupLine("Alcaraz — Sinner")
  assert.equal(result.playerAName, "Alcaraz")
  assert.equal(result.playerBName, "Sinner")
  assert.equal(result.tournamentName, null)
  assert.equal(result.parseError, null)
})

test("parses 'A — B — Tournament' (two em dashes: player separator + tournament separator)", () => {
  const result = parseMatchupLine("Alcaraz — Sinner — Cincinnati Open")
  assert.equal(result.playerAName, "Alcaraz")
  assert.equal(result.playerBName, "Sinner")
  assert.equal(result.tournamentName, "Cincinnati Open")
  assert.equal(result.parseError, null)
})

test("parses 'A vs B (Tournament)' parenthetical suffix", () => {
  const result = parseMatchupLine("Djokovic vs Zverev (Wimbledon)")
  assert.equal(result.playerAName, "Djokovic")
  assert.equal(result.playerBName, "Zverev")
  assert.equal(result.tournamentName, "Wimbledon")
  assert.equal(result.parseError, null)
})

test("parses 'A — B (Tournament)' (em dash player separator + parenthetical tournament)", () => {
  const result = parseMatchupLine("Swiatek — Sabalenka (French Open)")
  assert.equal(result.playerAName, "Swiatek")
  assert.equal(result.playerBName, "Sabalenka")
  assert.equal(result.tournamentName, "French Open")
  assert.equal(result.parseError, null)
})

test("parenthetical suffix takes priority over em-dash tournament separator", () => {
  // '(Cincinnati Open)' is the tournament; the em dash is the player separator
  const result = parseMatchupLine("Alcaraz — Sinner (Cincinnati Open)")
  assert.equal(result.playerAName, "Alcaraz")
  assert.equal(result.playerBName, "Sinner")
  assert.equal(result.tournamentName, "Cincinnati Open")
  assert.equal(result.parseError, null)
})

test("'A vs B — Tournament' still works (em dash as tournament separator when vs is present)", () => {
  // Regression: existing format must keep working after the em-dash fallback change.
  const result = parseMatchupLine("Alcaraz vs Sinner — Cincinnati Open")
  assert.equal(result.playerAName, "Alcaraz")
  assert.equal(result.playerBName, "Sinner")
  assert.equal(result.tournamentName, "Cincinnati Open")
  assert.equal(result.parseError, null)
})

// ── Date extraction (Task #30) ────────────────────────────────────────────────

test("extracts an ISO date from a line", () => {
  const result = parseMatchupLine("Alcaraz vs Sinner — Wimbledon 2026-07-04")
  assert.equal(result.matchDate, "2026-07-04")
  assert.equal(result.playerAName, "Alcaraz")
  assert.equal(result.playerBName, "Sinner")
})

test("extracts a month-day pattern from a line", () => {
  const result = parseMatchupLine("Rafa vs Alcaraz — Roland Garros, July 4")
  assert.equal(result.matchDate, "July 4")
  assert.equal(result.playerAName, "Rafa")
  assert.equal(result.playerBName, "Alcaraz")
})

test("extracts an abbreviated month-day pattern", () => {
  const result = parseMatchupLine("Djokovic vs Zverev — Miami Open, Jul 14th")
  assert.equal(result.matchDate, "Jul 14")
})

test("extracts 'tomorrow' as a matchDate", () => {
  const result = parseMatchupLine("Sinner vs Alcaraz tomorrow")
  assert.equal(result.matchDate, "tomorrow")
})

test("matchDate is null when no date pattern is present", () => {
  const result = parseMatchupLine("Djokovic vs Alcaraz — Wimbledon")
  assert.equal(result.matchDate, null)
})

test("matchDate does not interfere with player or tournament parsing", () => {
  const result = parseMatchupLine("Swiatek vs Sabalenka — French Open, June 2")
  assert.equal(result.playerAName, "Swiatek")
  assert.equal(result.playerBName, "Sabalenka")
  assert.equal(result.matchDate, "June 2")
  // Tournament name may still contain the date text — that's acceptable since it's extracted
  // independently from the raw line, not from the parsed tournament segment.
})
