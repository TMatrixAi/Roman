// Static tournament -> venue lookup, analogous to tennisData/surfaceMap.ts: fixtures from the
// provider don't include venue coordinates, so real (verifiable, public) venue coordinates are
// looked up by tournament name for the events we can confidently identify. Anything not listed
// here resolves to `null` -- never a guessed location -- which callers must treat as "conditions
// not available" rather than fabricating weather for an unknown place.
const TOURNAMENT_VENUES: Array<{ match: RegExp; name: string; latitude: number; longitude: number; timezone: string }> = [
  { match: /wimbledon/i, name: "London, UK", latitude: 51.4338, longitude: -0.2145, timezone: "Europe/London" },
  { match: /roland garros|french open/i, name: "Paris, France", latitude: 48.8472, longitude: 2.2492, timezone: "Europe/Paris" },
  { match: /us open/i, name: "New York, USA", latitude: 40.7498, longitude: -73.8459, timezone: "America/New_York" },
  { match: /australian open/i, name: "Melbourne, Australia", latitude: -37.8214, longitude: 144.9784, timezone: "Australia/Melbourne" },
  { match: /indian wells/i, name: "Indian Wells, USA", latitude: 33.7206, longitude: -116.3050, timezone: "America/Los_Angeles" },
  { match: /miami open/i, name: "Miami, USA", latitude: 25.9581, longitude: -80.2389, timezone: "America/New_York" },
  { match: /monte.?carlo/i, name: "Monte Carlo, Monaco", latitude: 43.7396, longitude: 7.4356, timezone: "Europe/Monaco" },
  { match: /madrid open/i, name: "Madrid, Spain", latitude: 40.4297, longitude: -3.6825, timezone: "Europe/Madrid" },
  { match: /^rome|italian open/i, name: "Rome, Italy", latitude: 41.9284, longitude: 12.4805, timezone: "Europe/Rome" },
  { match: /canadian open|montreal|toronto/i, name: "Toronto/Montreal, Canada", latitude: 43.6532, longitude: -79.3832, timezone: "America/Toronto" },
  { match: /cincinnati/i, name: "Cincinnati, USA", latitude: 39.2331, longitude: -84.5610, timezone: "America/New_York" },
  { match: /halle/i, name: "Halle, Germany", latitude: 51.4826, longitude: 8.2895, timezone: "Europe/Berlin" },
  { match: /queen'?s club|queens/i, name: "London, UK", latitude: 51.4817, longitude: -0.2154, timezone: "Europe/London" },
  { match: /barcelona/i, name: "Barcelona, Spain", latitude: 41.3851, longitude: 2.1734, timezone: "Europe/Madrid" },
  { match: /hamburg/i, name: "Hamburg, Germany", latitude: 53.5511, longitude: 9.9937, timezone: "Europe/Berlin" },
  { match: /dubai/i, name: "Dubai, UAE", latitude: 25.2048, longitude: 55.2708, timezone: "Asia/Dubai" },
  { match: /acapulco/i, name: "Acapulco, Mexico", latitude: 16.8531, longitude: -99.8237, timezone: "America/Mexico_City" },
  { match: /doha|qatar/i, name: "Doha, Qatar", latitude: 25.2854, longitude: 51.5310, timezone: "Asia/Qatar" },
];

export interface Venue {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export function inferVenue(tournamentName: string | null | undefined): Venue | null {
  if (!tournamentName) return null;
  for (const entry of TOURNAMENT_VENUES) {
    if (entry.match.test(tournamentName)) {
      return { name: entry.name, latitude: entry.latitude, longitude: entry.longitude, timezone: entry.timezone };
    }
  }
  return null;
}
