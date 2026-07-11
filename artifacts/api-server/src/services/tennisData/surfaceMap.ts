import type { Surface, TournamentLevel } from "./types";

// API-Tennis does not report court surface or tournament tier directly on fixtures/results.
// Surface and tour-level are well-known, stable public facts about specific tournaments
// (e.g. "Wimbledon is grass"), so we maintain a lookup rather than fabricating per-match data.
// Anything not in this table is reported as `null` ("not available") -- never guessed.
const TOURNAMENT_SURFACE: Array<{ match: RegExp; surface: Surface; level?: TournamentLevel }> = [
  { match: /wimbledon/i, surface: "Grass", level: "GrandSlam" },
  { match: /roland garros|french open/i, surface: "Clay", level: "GrandSlam" },
  { match: /us open/i, surface: "Hard", level: "GrandSlam" },
  { match: /australian open/i, surface: "Hard", level: "GrandSlam" },
  { match: /indian wells/i, surface: "Hard", level: "Masters1000" },
  { match: /miami open/i, surface: "Hard", level: "Masters1000" },
  { match: /monte.?carlo/i, surface: "Clay", level: "Masters1000" },
  { match: /madrid open/i, surface: "Clay", level: "Masters1000" },
  { match: /^rome|italian open/i, surface: "Clay", level: "Masters1000" },
  { match: /canadian open|montreal|toronto/i, surface: "Hard", level: "Masters1000" },
  { match: /cincinnati/i, surface: "Hard", level: "Masters1000" },
  { match: /shanghai/i, surface: "Hard", level: "Masters1000" },
  { match: /paris masters|bercy/i, surface: "IndoorHard", level: "Masters1000" },
  { match: /halle/i, surface: "Grass", level: "ATP500" },
  { match: /queen'?s club|queens/i, surface: "Grass", level: "ATP500" },
  { match: /barcelona/i, surface: "Clay", level: "ATP500" },
  { match: /hamburg/i, surface: "Clay", level: "ATP500" },
  { match: /dubai/i, surface: "Hard", level: "ATP500" },
  { match: /acapulco/i, surface: "Hard", level: "ATP500" },
  { match: /rotterdam/i, surface: "IndoorHard", level: "ATP500" },
  { match: /basel/i, surface: "IndoorHard", level: "ATP500" },
  { match: /vienna/i, surface: "IndoorHard", level: "ATP500" },
  { match: /atp finals|nitto/i, surface: "IndoorHard", level: "Masters1000" },
  { match: /wta finals/i, surface: "IndoorHard", level: "WTA1000" },
  { match: /doha|qatar/i, surface: "Hard", level: "WTA1000" },
  { match: /wuhan/i, surface: "Hard", level: "WTA1000" },
  { match: /beijing/i, surface: "Hard", level: "WTA1000" },
];

export function inferSurfaceAndLevel(tournamentName: string | null | undefined): {
  surface: Surface | null;
  level: TournamentLevel | null;
} {
  if (!tournamentName) return { surface: null, level: null };
  for (const entry of TOURNAMENT_SURFACE) {
    if (entry.match.test(tournamentName)) {
      return { surface: entry.surface, level: entry.level ?? null };
    }
  }
  return { surface: null, level: null };
}
