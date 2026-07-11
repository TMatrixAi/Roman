import type { MatchRecord, Surface } from "../tennisData/types";

export interface StyleMatchupResult {
  player1Styles: string[];
  player2Styles: string[];
  player1Advantages: string[];
  player2Advantages: string[];
  reliability: number;
}

const SURFACES: Surface[] = ["Hard", "Clay", "Grass", "IndoorHard"];

function surfaceWinRates(matches: MatchRecord[]): Partial<Record<Surface, number>> {
  const rates: Partial<Record<Surface, number>> = {};
  for (const surface of SURFACES) {
    const onSurface = matches.filter((m) => m.surface === surface);
    if (onSurface.length >= 3) {
      rates[surface] = onSurface.filter((m) => m.result === "W").length / onSurface.length;
    }
  }
  return rates;
}

function inferStyleTags(rates: Partial<Record<Surface, number>>): string[] {
  const tags: string[] = [];
  if ((rates.Clay ?? 0) >= 0.65) tags.push("Clay specialist");
  if ((rates.Grass ?? 0) >= 0.65) tags.push("Grass specialist");
  if ((rates.Hard ?? 0) >= 0.65) tags.push("Hard-court specialist");
  if ((rates.IndoorHard ?? 0) >= 0.65) tags.push("Strong indoors");
  if (tags.length === 0) tags.push("All-court, no dominant surface signal yet");
  return tags;
}

export function computeStyleMatchupModule(player1Matches: MatchRecord[], player2Matches: MatchRecord[]): StyleMatchupResult {
  const p1Rates = surfaceWinRates(player1Matches);
  const p2Rates = surfaceWinRates(player2Matches);

  const player1Styles = inferStyleTags(p1Rates);
  const player2Styles = inferStyleTags(p2Rates);

  const player1Advantages: string[] = [];
  const player2Advantages: string[] = [];
  for (const surface of SURFACES) {
    const p1 = p1Rates[surface];
    const p2 = p2Rates[surface];
    if (p1 !== undefined && p2 !== undefined && Math.abs(p1 - p2) >= 0.15) {
      const label = `${surface} win-rate edge`;
      if (p1 > p2) player1Advantages.push(label);
      else player2Advantages.push(label);
    }
  }

  const sampleBreadth = Object.keys(p1Rates).length + Object.keys(p2Rates).length;
  const reliability = Math.max(15, Math.min(70, sampleBreadth * 10));

  return { player1Styles, player2Styles, player1Advantages, player2Advantages, reliability: Math.round(reliability) };
}
