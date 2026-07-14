// Tournament -> venue lookup, analogous to tennisData/surfaceMap.ts: fixtures from the provider
// don't include venue coordinates, so real, verifiable venue coordinates are looked up by
// tournament name for events we can confidently identify.
//
// Anything not listed here resolves to `null`. Callers must treat that as "venue conditions not
// available" rather than inventing a location.
//
// Task #104: replaced the old regex-only table (~18 tournaments, single-alias-per-entry, prone to
// literal-substring false positives like "halle" inside "challenger") with an alias-based table.
// Each real venue has one canonical name plus every real-world spelling/variant a caller might
// send, matched as WHOLE WORDS (never a raw substring) against a normalized form of the
// tournament name. Coverage is expanded to the Grand Slams, every Masters/WTA 1000, and the
// common ATP/WTA 500 & 250 stops -- still a hardcoded list (no broader machine-readable
// city/country venue feed was found on the connected provider -- `get_tournaments` exposes only
// `tournament_name` and surface, no city/country/coordinates), so anything genuinely unlisted
// still returns `null` rather than a guessed location.

export interface Venue {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface VenueEntry {
  /** Real venue location shown to users/disclosures. */
  name: string;
  /** Every real-world name/spelling that should resolve to this venue, matched as whole word(s). */
  aliases: string[];
  latitude: number;
  longitude: number;
  timezone: string;
  /** Tournament level when it's a single, unambiguous level for every alias below (informational only -- not consumed by matching). */
  level?: string;
}

const TOURNAMENT_VENUES: VenueEntry[] = [
  // ---- Grand Slams ----
  {
    name: "Melbourne, Australia",
    aliases: ["australian open"],
    latitude: -37.8213608,
    longitude: 144.9790884,
    timezone: "Australia/Melbourne",
    level: "GrandSlam",
  },
  {
    name: "Paris, France (Roland Garros)",
    aliases: ["roland garros", "french open"],
    latitude: 48.846869,
    longitude: 2.2484179,
    timezone: "Europe/Paris",
    level: "GrandSlam",
  },
  {
    name: "Wimbledon, London, UK",
    aliases: ["wimbledon"],
    latitude: 51.4342,
    longitude: -0.2147,
    timezone: "Europe/London",
    level: "GrandSlam",
  },
  {
    name: "New York, USA (US Open)",
    aliases: ["us open"],
    latitude: 40.7495765,
    longitude: -73.8465422,
    timezone: "America/New_York",
    level: "GrandSlam",
  },

  // ---- Masters 1000 / WTA 1000 ----
  {
    name: "Indian Wells, USA",
    aliases: ["indian wells", "bnp paribas open"],
    latitude: 33.7201239,
    longitude: -116.3012579,
    timezone: "America/Los_Angeles",
    level: "Masters1000",
  },
  {
    name: "Miami Gardens, USA",
    aliases: ["miami open"],
    latitude: 25.9579032,
    longitude: -80.2388497,
    timezone: "America/New_York",
    level: "Masters1000",
  },
  {
    name: "Monte Carlo, Monaco",
    aliases: ["monte carlo masters", "monte carlo", "monte-carlo"],
    latitude: 43.7396,
    longitude: 7.4356,
    timezone: "Europe/Monaco",
    level: "Masters1000",
  },
  {
    name: "Madrid, Spain",
    aliases: ["madrid open", "mutua madrid open"],
    latitude: 40.3713283,
    longitude: -3.6818094,
    timezone: "Europe/Madrid",
    level: "Masters1000",
  },
  {
    name: "Rome, Italy",
    aliases: ["rome", "italian open", "internazionali bnl d italia", "internazionali bnl ditalia"],
    latitude: 41.9325174,
    longitude: 12.4570742,
    timezone: "Europe/Rome",
    level: "Masters1000",
  },
  {
    name: "Toronto, Canada",
    // Toronto and Montreal alternate hosting the (men's/women's) Canadian Open each year --
    // deliberately no bare "canadian open" alias on either entry so an ambiguous, city-less
    // mention resolves to null instead of guessing which city hosted that year.
    aliases: ["toronto", "national bank open toronto", "canadian open toronto"],
    latitude: 43.7715881,
    longitude: -79.5120776,
    timezone: "America/Toronto",
    level: "Masters1000",
  },
  {
    name: "Montreal, Canada",
    aliases: ["montreal", "national bank open montreal", "canadian open montreal"],
    latitude: 45.5329553,
    longitude: -73.6267358,
    timezone: "America/Toronto",
    level: "Masters1000",
  },
  {
    name: "Mason, Ohio, USA",
    aliases: ["cincinnati", "cincinnati open"],
    latitude: 39.346673,
    longitude: -84.2771507,
    timezone: "America/New_York",
    level: "Masters1000",
  },
  {
    name: "Shanghai, China",
    aliases: ["shanghai masters", "shanghai"],
    latitude: 31.2304,
    longitude: 121.4737,
    timezone: "Asia/Shanghai",
    level: "Masters1000",
  },
  {
    name: "Paris, France (Bercy)",
    aliases: ["paris masters", "rolex paris masters"],
    latitude: 48.8397,
    longitude: 2.3785,
    timezone: "Europe/Paris",
    level: "Masters1000",
  },
  {
    name: "Wuhan, China",
    aliases: ["wuhan open", "wuhan"],
    latitude: 30.5928,
    longitude: 114.3055,
    timezone: "Asia/Shanghai",
    level: "WTA1000",
  },
  {
    name: "Beijing, China",
    aliases: ["china open", "beijing"],
    latitude: 39.9042,
    longitude: 116.4074,
    timezone: "Asia/Shanghai",
    level: "WTA1000",
  },
  {
    name: "Doha, Qatar",
    aliases: ["qatar open", "doha"],
    latitude: 25.2854,
    longitude: 51.531,
    timezone: "Asia/Qatar",
  },
  {
    name: "Dubai, UAE",
    aliases: ["dubai championships", "dubai"],
    latitude: 25.2048,
    longitude: 55.2708,
    timezone: "Asia/Dubai",
  },

  // ---- Common ATP/WTA 500 & 250 ----
  { name: "London, UK (Queen's Club)", aliases: ["queens club", "queen s club"], latitude: 51.4817, longitude: -0.2154, timezone: "Europe/London" },
  { name: "Halle, Germany", aliases: ["halle"], latitude: 51.4826, longitude: 8.2895, timezone: "Europe/Berlin" },
  { name: "Barcelona, Spain", aliases: ["barcelona"], latitude: 41.3851, longitude: 2.1734, timezone: "Europe/Madrid" },
  { name: "Hamburg, Germany", aliases: ["hamburg"], latitude: 53.5511, longitude: 9.9937, timezone: "Europe/Berlin" },
  { name: "Washington, D.C., USA", aliases: ["washington", "citi open"], latitude: 38.9072, longitude: -77.0369, timezone: "America/New_York" },
  { name: "Tokyo, Japan", aliases: ["tokyo"], latitude: 35.6762, longitude: 139.6503, timezone: "Asia/Tokyo" },
  { name: "Vienna, Austria", aliases: ["vienna"], latitude: 48.2082, longitude: 16.3738, timezone: "Europe/Vienna" },
  { name: "Basel, Switzerland", aliases: ["basel"], latitude: 47.5596, longitude: 7.5886, timezone: "Europe/Zurich" },
  { name: "Acapulco, Mexico", aliases: ["acapulco"], latitude: 16.8531, longitude: -99.8237, timezone: "America/Mexico_City" },
  { name: "Rio de Janeiro, Brazil", aliases: ["rio open", "rio de janeiro"], latitude: -22.9068, longitude: -43.1729, timezone: "America/Sao_Paulo" },
  { name: "Adelaide, Australia", aliases: ["adelaide"], latitude: -34.9285, longitude: 138.6007, timezone: "Australia/Adelaide" },
  { name: "Auckland, New Zealand", aliases: ["auckland"], latitude: -36.8485, longitude: 174.7633, timezone: "Pacific/Auckland" },
  { name: "Brisbane, Australia", aliases: ["brisbane"], latitude: -27.4698, longitude: 153.0251, timezone: "Australia/Brisbane" },
  { name: "Marseille, France", aliases: ["marseille"], latitude: 43.2965, longitude: 5.3698, timezone: "Europe/Paris" },
  { name: "Montpellier, France", aliases: ["montpellier"], latitude: 43.6108, longitude: 3.8767, timezone: "Europe/Paris" },
  { name: "Delray Beach, USA", aliases: ["delray beach"], latitude: 26.4615, longitude: -80.0728, timezone: "America/New_York" },
  { name: "Los Cabos, Mexico", aliases: ["los cabos"], latitude: 22.8905, longitude: -109.9167, timezone: "America/Mazatlan" },
  { name: "Estoril, Portugal", aliases: ["estoril"], latitude: 38.7071, longitude: -9.3979, timezone: "Europe/Lisbon" },
  { name: "Geneva, Switzerland", aliases: ["geneva"], latitude: 46.2044, longitude: 6.1432, timezone: "Europe/Zurich" },
  { name: "Lyon, France", aliases: ["lyon"], latitude: 45.764, longitude: 4.8357, timezone: "Europe/Paris" },
  { name: "Mallorca, Spain", aliases: ["mallorca"], latitude: 39.5696, longitude: 2.6502, timezone: "Europe/Madrid" },
  { name: "Eastbourne, UK", aliases: ["eastbourne"], latitude: 50.7687, longitude: 0.29, timezone: "Europe/London" },
  { name: "Newport, USA", aliases: ["newport"], latitude: 41.4901, longitude: -71.3128, timezone: "America/New_York" },
  { name: "Atlanta, USA", aliases: ["atlanta"], latitude: 33.749, longitude: -84.388, timezone: "America/New_York" },
  { name: "Winston-Salem, USA", aliases: ["winston salem"], latitude: 36.0999, longitude: -80.2442, timezone: "America/New_York" },
  { name: "Chengdu, China", aliases: ["chengdu"], latitude: 30.5728, longitude: 104.0668, timezone: "Asia/Shanghai" },
  { name: "Antwerp, Belgium", aliases: ["antwerp"], latitude: 51.2194, longitude: 4.4025, timezone: "Europe/Brussels" },
  { name: "Stockholm, Sweden", aliases: ["stockholm"], latitude: 59.3293, longitude: 18.0686, timezone: "Europe/Stockholm" },
  { name: "Metz, France", aliases: ["metz"], latitude: 49.1193, longitude: 6.1757, timezone: "Europe/Paris" },
  { name: "Gstaad, Switzerland", aliases: ["gstaad"], latitude: 46.4711, longitude: 7.2867, timezone: "Europe/Zurich" },
  { name: "Bastad, Sweden", aliases: ["bastad", "bastad sweden"], latitude: 56.4267, longitude: 12.8534, timezone: "Europe/Stockholm" },
  { name: "Kitzbuhel, Austria", aliases: ["kitzbuhel", "kitzbuehel"], latitude: 47.4467, longitude: 12.3925, timezone: "Europe/Vienna" },
  { name: "Umag, Croatia", aliases: ["umag"], latitude: 45.4339, longitude: 13.5253, timezone: "Europe/Zagreb" },
  { name: "Cordoba, Argentina", aliases: ["cordoba"], latitude: -31.4201, longitude: -64.1888, timezone: "America/Argentina/Cordoba" },
  { name: "Santiago, Chile", aliases: ["santiago"], latitude: -33.4489, longitude: -70.6693, timezone: "America/Santiago" },
  { name: "Buenos Aires, Argentina", aliases: ["buenos aires"], latitude: -34.6037, longitude: -58.3816, timezone: "America/Argentina/Buenos_Aires" },
  { name: "Abu Dhabi, UAE", aliases: ["abu dhabi"], latitude: 24.4539, longitude: 54.3773, timezone: "Asia/Dubai" },
  { name: "Charleston, USA", aliases: ["charleston"], latitude: 32.7765, longitude: -79.9311, timezone: "America/New_York" },
  { name: "Stuttgart, Germany", aliases: ["stuttgart"], latitude: 48.7758, longitude: 9.1829, timezone: "Europe/Berlin" },
  { name: "Berlin, Germany", aliases: ["berlin"], latitude: 52.52, longitude: 13.405, timezone: "Europe/Berlin" },
  { name: "San Diego, USA", aliases: ["san diego"], latitude: 32.7157, longitude: -117.1611, timezone: "America/Los_Angeles" },
  { name: "Zhengzhou, China", aliases: ["zhengzhou"], latitude: 34.7466, longitude: 113.6254, timezone: "Asia/Shanghai" },
  { name: "Hobart, Australia", aliases: ["hobart"], latitude: -42.8821, longitude: 147.3272, timezone: "Australia/Hobart" },
  { name: "Linz, Austria", aliases: ["linz"], latitude: 48.3069, longitude: 14.2858, timezone: "Europe/Vienna" },
  { name: "Bogota, Colombia", aliases: ["bogota"], latitude: 4.711, longitude: -74.0721, timezone: "America/Bogota" },
  { name: "Rabat, Morocco", aliases: ["rabat"], latitude: 34.0209, longitude: -6.8416, timezone: "Africa/Casablanca" },
  { name: "Nottingham, UK", aliases: ["nottingham"], latitude: 52.9548, longitude: -1.1581, timezone: "Europe/London" },
  { name: "Birmingham, UK", aliases: ["birmingham"], latitude: 52.4862, longitude: -1.8904, timezone: "Europe/London" },
  { name: "Cleveland, USA", aliases: ["cleveland"], latitude: 41.4993, longitude: -81.6944, timezone: "America/New_York" },
  { name: "Monastir, Tunisia", aliases: ["monastir"], latitude: 35.7643, longitude: 10.8113, timezone: "Africa/Tunis" },
  { name: "Cluj-Napoca, Romania", aliases: ["cluj napoca", "cluj"], latitude: 46.7712, longitude: 23.6236, timezone: "Europe/Bucharest" },
  { name: "Guangzhou, China", aliases: ["guangzhou"], latitude: 23.1291, longitude: 113.2644, timezone: "Asia/Shanghai" },
  { name: "Osaka, Japan", aliases: ["osaka"], latitude: 34.6937, longitude: 135.5023, timezone: "Asia/Tokyo" },
];

// Challenger, ITF, qualifying, junior, boys, and girls events must NEVER resolve to a major
// tour venue -- even one that shares a host city (e.g. an ITF event in Basel is not "the" ATP
// 500 Basel). This guard runs BEFORE any alias matching, so it's the only gate that matters here.
const NEVER_NAMED_TABLE = /challenger|\bitf\b|\bqualif|\bjunior|\bboys\b|\bgirls\b/i;

/**
 * Normalizes a tournament name for matching: lowercases, strips accents, turns hyphens into
 * spaces (so "Roland-Garros" and "Roland Garros" normalize identically), removes remaining
 * punctuation, and collapses repeated whitespace. Applied identically to incoming names and to
 * every stored alias below, so both sides of a comparison go through the exact same pipeline.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Precomputed, normalized alias -> venue lookup, built once at module load. Each alias is matched
 * as a WHOLE WORD (or whole phrase) against the normalized tournament name -- never a raw
 * substring -- so a short alias like "halle" can't accidentally match inside an unrelated longer
 * word the way plain `.includes()` would.
 */
const ALIAS_MATCHERS: Array<{ regex: RegExp; venue: Venue }> = TOURNAMENT_VENUES.flatMap((entry) => {
  const venue: Venue = { name: entry.name, latitude: entry.latitude, longitude: entry.longitude, timezone: entry.timezone };
  return entry.aliases.map((alias) => ({
    regex: new RegExp(`\\b${escapeRegExp(normalizeName(alias))}\\b`),
    venue,
  }));
});

export function inferVenue(tournamentName: string | null | undefined): Venue | null {
  if (!tournamentName || NEVER_NAMED_TABLE.test(tournamentName)) {
    return null;
  }

  const normalized = normalizeName(tournamentName);
  if (!normalized) return null;

  for (const { regex, venue } of ALIAS_MATCHERS) {
    if (regex.test(normalized)) {
      return venue;
    }
  }

  return null;
}
