// Static tournament -> venue lookup, analogous to tennisData/surfaceMap.ts: fixtures from the
// provider don't include venue coordinates, so real, verifiable venue coordinates are looked up
// by tournament name for events we can confidently identify.
//
// Anything not listed here resolves to `null`. Callers must treat that as "venue conditions not
// available" rather than inventing a location.

const TOURNAMENT_VENUES: Array<{
  match: RegExp;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}> = [
  {
    match: /wimbledon/i,
    name: "Wimbledon, London, UK",
    latitude: 51.4342,
    longitude: -0.2147,
    timezone: "Europe/London",
  },
  {
    match: /roland.?garros|french open/i,
    name: "Paris, France",
    latitude: 48.846869,
    longitude: 2.2484179,
    timezone: "Europe/Paris",
  },
  {
    match: /\bus open\b/i,
    name: "New York, USA",
    latitude: 40.7495765,
    longitude: -73.8465422,
    timezone: "America/New_York",
  },
  {
    match: /australian open/i,
    name: "Melbourne, Australia",
    latitude: -37.8213608,
    longitude: 144.9790884,
    timezone: "Australia/Melbourne",
  },
  {
    match: /indian wells/i,
    name: "Indian Wells, USA",
    latitude: 33.7201239,
    longitude: -116.3012579,
    timezone: "America/Los_Angeles",
  },
  {
    match: /miami open/i,
    name: "Miami Gardens, USA",
    latitude: 25.9579032,
    longitude: -80.2388497,
    timezone: "America/New_York",
  },
  {
    match: /monte.?carlo/i,
    name: "Monte Carlo, Monaco",
    latitude: 43.7396,
    longitude: 7.4356,
    timezone: "Europe/Monaco",
  },
  {
    match: /madrid open/i,
    name: "Madrid, Spain",
    latitude: 40.3713283,
    longitude: -3.6818094,
    timezone: "Europe/Madrid",
  },
  {
    match: /^rome\b|italian open/i,
    name: "Rome, Italy",
    latitude: 41.9325174,
    longitude: 12.4570742,
    timezone: "Europe/Rome",
  },
  {
    match: /\btoronto\b|canadian open.*toronto/i,
    name: "Toronto, Canada",
    latitude: 43.7715881,
    longitude: -79.5120776,
    timezone: "America/Toronto",
  },
  {
    match: /\bmontreal\b|canadian open.*montreal/i,
    name: "Montreal, Canada",
    latitude: 45.5329553,
    longitude: -73.6267358,
    timezone: "America/Toronto",
  },
  {
    match: /\bcincinnati\b/i,
    name: "Mason, Ohio, USA",
    latitude: 39.346673,
    longitude: -84.2771507,
    timezone: "America/New_York",
  },
  {
    match: /\bhalle\b/i,
    name: "Halle, Germany",
    latitude: 51.4826,
    longitude: 8.2895,
    timezone: "Europe/Berlin",
  },
  {
    match: /queen'?s club|\bqueens\b/i,
    name: "London, UK",
    latitude: 51.4817,
    longitude: -0.2154,
    timezone: "Europe/London",
  },
  {
    match: /\bbarcelona\b/i,
    name: "Barcelona, Spain",
    latitude: 41.3851,
    longitude: 2.1734,
    timezone: "Europe/Madrid",
  },
  {
    match: /\bhamburg\b/i,
    name: "Hamburg, Germany",
    latitude: 53.5511,
    longitude: 9.9937,
    timezone: "Europe/Berlin",
  },
  {
    match: /\bdubai\b/i,
    name: "Dubai, UAE",
    latitude: 25.2048,
    longitude: 55.2708,
    timezone: "Asia/Dubai",
  },
  {
    match: /\bacapulco\b/i,
    name: "Acapulco, Mexico",
    latitude: 16.8531,
    longitude: -99.8237,
    timezone: "America/Mexico_City",
  },
  {
    match: /\bdoha\b|\bqatar\b/i,
    name: "Doha, Qatar",
    latitude: 25.2854,
    longitude: 51.531,
    timezone: "Asia/Qatar",
  },
];

// Short, single-word venue names can accidentally appear inside unrelated lower-tier event names.
// For example, "halle" can appear inside other strings. No major venue in the table above should
// be inferred for Challenger, ITF, qualifying, junior, boys, or girls events.
const NEVER_NAMED_TABLE =
  /challenger|\bitf\b|\bqualif|\bjunior|\bboys\b|\bgirls\b/i;

export interface Venue {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export function inferVenue(
  tournamentName: string | null | undefined,
): Venue | null {
  if (!tournamentName || NEVER_NAMED_TABLE.test(tournamentName)) {
    return null;
  }

  for (const entry of TOURNAMENT_VENUES) {
    if (entry.match.test(tournamentName)) {
      return {
        name: entry.name,
        latitude: entry.latitude,
        longitude: entry.longitude,
        timezone: entry.timezone,
      };
    }
  }

  return null;
}