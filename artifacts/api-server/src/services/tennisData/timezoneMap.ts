/**
 * Real tournament-venue -> IANA timezone lookup, mirroring the lookup-table pattern already used
 * for surface/level (`surfaceMap.ts`) and weather venues (`predictionEngine/venueMap.ts`).
 *
 * API-Tennis exposes no explicit timezone or country field on `get_fixtures` rows. The prior
 * assumption (`combineDateTimeUtc` treating `event_time` as if it were already UTC) was wrong.
 * Confirmed live (2026-07-13, real UTC time 09:06Z): several matches were already live/mid-set
 * with raw `event_time` values ("Iasi" 10:05, "Rome"/"Gstaad" 10:40) that, read as literal UTC,
 * would place their start in the future -- impossible for a match already underway.
 * Back-computing the real offset each venue needed to already be in progress lines up almost
 * exactly with that venue's real local UTC offset that day (Romania EEST = UTC+3, Italy/
 * Switzerland CEST = UTC+2): `event_time` is the venue's real local wall-clock time, not UTC.
 *
 * Resolution is two-tier, most-precise first:
 *  1. A specific tournament city/venue identified from real fixture data (majors/Masters/500s
 *     with an essentially fixed home city, plus the smaller weekly tour stops actually seen live
 *     -- see the live-data note on `CITY_TIMEZONE` below).
 *  2. A country parsed out of the explicit "(Country)" suffix API-Tennis puts on many tournament
 *     names (e.g. "Athens (Greece)", "Kitzbuhel (Austria) - Qualification"), restricted to
 *     countries with one effective timezone for tennis-hosting purposes. Large multi-timezone
 *     countries (USA, Canada, Australia, Russia, Brazil, Mexico, ...) are deliberately absent
 *     here -- a bare country name can't disambiguate them, and this table never guesses.
 *
 * Anything neither tier resolves returns null -- callers must treat the fixture's time as
 * unconfirmed ("Time TBD") rather than assuming a timezone.
 */

interface CityTimezoneEntry {
  match: RegExp;
  timezone: string;
}

// Majors / Masters / prominent 500-level events with an effectively fixed home city. Kept
// independent from `predictionEngine/venueMap.ts` (that table is for weather/travel-distance
// coordinates, a separate task's scope) even though the two overlap for these entries.
// Deliberately excludes any event whose host city/country rotates year to year (e.g. ATP/WTA
// Finals) -- guessing this year's host without live confirmation would violate the
// never-fabricate convention.
const MAJOR_CITY_TIMEZONE: CityTimezoneEntry[] = [
  { match: /wimbledon/i, timezone: "Europe/London" },
  { match: /roland garros|french open/i, timezone: "Europe/Paris" },
  { match: /\bus open\b/i, timezone: "America/New_York" },
  { match: /australian open/i, timezone: "Australia/Melbourne" },
  { match: /indian wells/i, timezone: "America/Los_Angeles" },
  { match: /miami open/i, timezone: "America/New_York" },
  { match: /monte.?carlo/i, timezone: "Europe/Monaco" },
  { match: /madrid open/i, timezone: "Europe/Madrid" },
  { match: /^rome\b|italian open/i, timezone: "Europe/Rome" },
  // Both cities the Canadian Masters alternates between share the same timezone, so the
  // ambiguity doesn't matter here.
  { match: /canadian open|\bmontreal\b|\btoronto\b/i, timezone: "America/Toronto" },
  { match: /\bcincinnati\b/i, timezone: "America/New_York" },
  { match: /\bhalle\b/i, timezone: "Europe/Berlin" },
  { match: /queen'?s club|\bqueens\b/i, timezone: "Europe/London" },
  { match: /\bbarcelona\b/i, timezone: "Europe/Madrid" },
  { match: /\bhamburg\b/i, timezone: "Europe/Berlin" },
  { match: /\bdubai\b/i, timezone: "Asia/Dubai" },
  { match: /\bacapulco\b/i, timezone: "America/Mexico_City" },
  { match: /\bdoha\b|\bqatar\b/i, timezone: "Asia/Qatar" },
  { match: /\brotterdam\b/i, timezone: "Europe/Amsterdam" },
  { match: /\bbasel\b/i, timezone: "Europe/Zurich" },
  { match: /\bvienna\b/i, timezone: "Europe/Vienna" },
];

// Smaller weekly Challenger/ITF/tour-level stops, added from real `get_fixtures` data checked
// live (2026-07-13, 14-day window). Each is a genuinely identifiable, single-location tournament
// city -- not a guess about an ambiguous or rotating venue.
const TOUR_CITY_TIMEZONE: CityTimezoneEntry[] = [
  { match: /\biasi\b/i, timezone: "Europe/Bucharest" }, // Romania
  { match: /\bgstaad\b/i, timezone: "Europe/Zurich" }, // Switzerland
  { match: /\bbastad\b/i, timezone: "Europe/Stockholm" }, // Sweden
  { match: /\bbunschoten\b/i, timezone: "Europe/Amsterdam" }, // Netherlands
  { match: /\bcordenons\b/i, timezone: "Europe/Rome" }, // Italy
  { match: /\bgranby\b/i, timezone: "America/Toronto" }, // Quebec, Canada (Eastern time)
  { match: /\blincoln\b/i, timezone: "America/Chicago" }, // Lincoln, Nebraska, USA (Central time)
  { match: /\bpozoblanco\b/i, timezone: "Europe/Madrid" }, // Spain
  { match: /\bumag\b/i, timezone: "Europe/Zagreb" }, // Croatia
];

// Task #74: widened from real `get_fixtures` tournament names sampled across two real windows
// -- 2026-01-29..2026-02-11 (winter hard-court swing) and 2026-07-13..2026-08-24 (summer
// clay/grass swing) -- rather than just the single 2-week window `TOUR_CITY_TIMEZONE` above was
// built from. Each entry below is a specific, single-location city with one unambiguous
// tennis-relevant timezone. Genuinely ambiguous bare city names shared by multiple well-known
// tennis-hosting locations (e.g. a bare "Birmingham", which could be Birmingham, UK or
// Birmingham, Alabama, USA depending on the week) are deliberately left out rather than guessed
// from seasonal context. US cities that the provider itself disambiguates with a ", STATE" suffix
// (e.g. "Naples, FL" vs. the much more famous Naples, Italy) are matched on that exact
// "city, ST" text, not the bare city name, so an unrelated same-named event without the suffix
// correctly falls through to "Time TBD" instead of being misattributed.
const SEASON_CITY_TIMEZONE: CityTimezoneEntry[] = [
  { match: /\bbaton rouge\b/i, timezone: "America/Chicago" }, // Louisiana, USA
  { match: /\bbuenos aires\b/i, timezone: "America/Argentina/Buenos_Aires" }, // Argentina
  { match: /\brosario\b/i, timezone: "America/Argentina/Buenos_Aires" }, // Argentina (single national timezone)
  { match: /\bdallas\b/i, timezone: "America/Chicago" }, // Texas, USA
  { match: /\bmontpellier\b/i, timezone: "Europe/Paris" }, // France
  { match: /\bbrisbane\b/i, timezone: "Australia/Brisbane" }, // Queensland, Australia -- no DST, single fixed offset year-round
  { match: /\bcesenatico\b/i, timezone: "Europe/Rome" }, // Italy
  { match: /\bchennai\b/i, timezone: "Asia/Kolkata" }, // India
  { match: /\bmumbai\b/i, timezone: "Asia/Kolkata" }, // India
  { match: /\bhyderabad\b/i, timezone: "Asia/Kolkata" }, // India
  { match: /\bpune\b/i, timezone: "Asia/Kolkata" }, // India
  { match: /\bcleveland\b/i, timezone: "America/New_York" }, // Ohio, USA
  { match: /\bconcepcion\b/i, timezone: "America/Santiago" }, // Chile (established ATP Challenger stop)
  { match: /\bkoblenz\b/i, timezone: "Europe/Berlin" }, // Germany
  { match: /\balmoradi\b/i, timezone: "Europe/Madrid" }, // Spain
  { match: /\bantalya\b/i, timezone: "Europe/Istanbul" }, // Turkey
  { match: /\bcastelo branco\b/i, timezone: "Europe/Lisbon" }, // Portugal
  { match: /\bgubbio\b/i, timezone: "Europe/Rome" }, // Italy
  { match: /\btorino\b/i, timezone: "Europe/Rome" }, // Italy
  { match: /\bhuamantla\b/i, timezone: "America/Mexico_City" }, // Mexico
  { match: /\bjavea\b/i, timezone: "Europe/Madrid" }, // Spain
  { match: /\bmanacor\b/i, timezone: "Europe/Madrid" }, // Balearic Islands, Spain (same zone as mainland)
  { match: /\bkursumlijska banja\b/i, timezone: "Europe/Belgrade" }, // Serbia
  { match: /\bmonastir\b/i, timezone: "Africa/Tunis" }, // Tunisia -- very high-volume ITF hub
  { match: /\bsharm el ?sheikh\b/i, timezone: "Africa/Cairo" }, // Egypt
  { match: /\bzahra\b/i, timezone: "Africa/Cairo" }, // Egypt (Cairo-area ITF hub)
  { match: /\bnova gorica\b/i, timezone: "Europe/Ljubljana" }, // Slovenia
  { match: /\bkrsko\b/i, timezone: "Europe/Ljubljana" }, // Slovenia
  { match: /\boberhaching\b/i, timezone: "Europe/Berlin" }, // Germany
  { match: /\buslar\b/i, timezone: "Europe/Berlin" }, // Germany
  { match: /\bnussloch\b/i, timezone: "Europe/Berlin" }, // Germany
  { match: /\bslobozia\b/i, timezone: "Europe/Bucharest" }, // Romania
  { match: /\bcluj-napoca\b/i, timezone: "Europe/Bucharest" }, // Romania
  { match: /\bgandia\b/i, timezone: "Europe/Madrid" }, // Spain
  { match: /\bglasgow\b/i, timezone: "Europe/London" }, // Scotland, UK
  { match: /\bsheffield\b/i, timezone: "Europe/London" }, // England, UK
  { match: /\bnottingham\b/i, timezone: "Europe/London" }, // England, UK
  { match: /\bhillcrest\b/i, timezone: "Africa/Johannesburg" }, // KwaZulu-Natal, South Africa -- established ITF hub
  { match: /\bkramsach\b/i, timezone: "Europe/Vienna" }, // Austria
  { match: /\buriage\b/i, timezone: "Europe/Paris" }, // France (Uriage-les-Bains)
  { match: /\bandrezieux-boutheon\b/i, timezone: "Europe/Paris" }, // France
  { match: /\bgrenoble\b/i, timezone: "Europe/Paris" }, // France
  { match: /\bpau\b/i, timezone: "Europe/Paris" }, // France
  { match: /\bquimper\b/i, timezone: "Europe/Paris" }, // France
  { match: /\bvila real de santo antonio\b/i, timezone: "Europe/Lisbon" }, // Portugal
  { match: /\boeiras\b/i, timezone: "Europe/Lisbon" }, // Portugal
  { match: /\bporto\b(?!\s*alegre)/i, timezone: "Europe/Lisbon" }, // Portugal (excludes Porto Alegre, Brazil -- different country/timezone)
  { match: /\bmanama\b/i, timezone: "Asia/Bahrain" }, // Bahrain
  { match: /\bmanila\b/i, timezone: "Asia/Manila" }, // Philippines
  { match: /\bphan thiet\b/i, timezone: "Asia/Ho_Chi_Minh" }, // Vietnam
  { match: /\btenerife\b/i, timezone: "Atlantic/Canary" }, // Canary Islands, Spain -- one hour behind mainland Spain, NOT Europe/Madrid
  { match: /\bfujairah\b/i, timezone: "Asia/Dubai" }, // United Arab Emirates
  { match: /\babu dhabi\b/i, timezone: "Asia/Dubai" }, // United Arab Emirates
  { match: /\bastana\b/i, timezone: "Asia/Almaty" }, // Kazakhstan (single national timezone)
  { match: /\bostrava\b/i, timezone: "Europe/Prague" }, // Czech Republic
  { match: /\bolomouc\b/i, timezone: "Europe/Prague" }, // Czech Republic
  { match: /\bprague\b/i, timezone: "Europe/Prague" }, // Czech Republic
  { match: /\bnaples,\s*fl\b/i, timezone: "America/New_York" }, // Florida, USA -- NOT the much more famous Naples, Italy; only the explicit ", FL" form matches
  { match: /\bpalm coast,\s*fl\b/i, timezone: "America/New_York" }, // Florida, USA
  { match: /\bsunrise,\s*fl\b/i, timezone: "America/New_York" }, // Florida, USA
  { match: /\bvero beach,\s*fl\b/i, timezone: "America/New_York" }, // Florida, USA
  { match: /\borlando,\s*fl\b/i, timezone: "America/New_York" }, // Florida, USA
  { match: /\brochester,\s*ny\b/i, timezone: "America/New_York" }, // New York, USA -- not Rochester, UK
  { match: /\blouisville,\s*ky\b/i, timezone: "America/Kentucky/Louisville" }, // Kentucky, USA
  { match: /\bsan diego\b/i, timezone: "America/Los_Angeles" }, // California, USA
  { match: /\bsao paulo\b/i, timezone: "America/Sao_Paulo" }, // Brazil -- specific city, not a bare multi-timezone country match
];

const CITY_TIMEZONE: CityTimezoneEntry[] = [...MAJOR_CITY_TIMEZONE, ...TOUR_CITY_TIMEZONE, ...SEASON_CITY_TIMEZONE];

/**
 * Countries with one effective timezone for tennis-hosting purposes, keyed by the exact country
 * name API-Tennis puts in a tournament's "(Country)" suffix, lowercased. Multi-timezone countries
 * (USA, Canada, Australia, Russia, Brazil, Mexico, Indonesia, ...) are intentionally omitted --
 * see the module doc comment.
 */
const COUNTRY_TIMEZONE: Record<string, string> = {
  greece: "Europe/Athens",
  turkey: "Europe/Istanbul",
  austria: "Europe/Vienna",
  argentina: "America/Argentina/Buenos_Aires",
  france: "Europe/Paris",
  germany: "Europe/Berlin",
  italy: "Europe/Rome",
  spain: "Europe/Madrid",
  portugal: "Europe/Lisbon",
  netherlands: "Europe/Amsterdam",
  belgium: "Europe/Brussels",
  switzerland: "Europe/Zurich",
  sweden: "Europe/Stockholm",
  norway: "Europe/Oslo",
  denmark: "Europe/Copenhagen",
  finland: "Europe/Helsinki",
  poland: "Europe/Warsaw",
  "czech republic": "Europe/Prague",
  czechia: "Europe/Prague",
  slovakia: "Europe/Bratislava",
  hungary: "Europe/Budapest",
  croatia: "Europe/Zagreb",
  serbia: "Europe/Belgrade",
  slovenia: "Europe/Ljubljana",
  bulgaria: "Europe/Sofia",
  romania: "Europe/Bucharest",
  ireland: "Europe/Dublin",
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  israel: "Asia/Jerusalem",
  morocco: "Africa/Casablanca",
  tunisia: "Africa/Tunis",
  egypt: "Africa/Cairo",
  "south africa": "Africa/Johannesburg",
  japan: "Asia/Tokyo",
  "south korea": "Asia/Seoul",
  thailand: "Asia/Bangkok",
  vietnam: "Asia/Ho_Chi_Minh",
  philippines: "Asia/Manila",
  singapore: "Asia/Singapore",
  malaysia: "Asia/Kuala_Lumpur",
  india: "Asia/Kolkata",
  "united arab emirates": "Asia/Dubai",
  uae: "Asia/Dubai",
  qatar: "Asia/Qatar",
  chile: "America/Santiago",
  uruguay: "America/Montevideo",
  paraguay: "America/Asuncion",
  peru: "America/Lima",
  colombia: "America/Bogota",
  ecuador: "America/Guayaquil",
  bolivia: "America/La_Paz",
  "new zealand": "Pacific/Auckland",
  china: "Asia/Shanghai",
  taiwan: "Asia/Taipei",
  "hong kong": "Asia/Hong_Kong",
  kuwait: "Asia/Kuwait",
  "saudi arabia": "Asia/Riyadh",
  jordan: "Asia/Amman",
  cyprus: "Asia/Nicosia",
  estonia: "Europe/Tallinn",
  latvia: "Europe/Riga",
  lithuania: "Europe/Vilnius",
  georgia: "Asia/Tbilisi",
  armenia: "Asia/Yerevan",
  azerbaijan: "Asia/Baku",
  uzbekistan: "Asia/Tashkent",
};

/** Extracts the content of a tournament name's first "(...)" group, e.g. "Kitzbuhel (Austria) - Qualification" -> "Austria". */
function extractParenthetical(tournamentName: string): string | null {
  const match = tournamentName.match(/\(([^)]+)\)/);
  return match ? match[1].trim() : null;
}

/**
 * Resolves a real IANA timezone for a tournament, or null when it genuinely can't be determined
 * with confidence. Never guesses: an unrecognized city and an unlisted/multi-timezone country
 * both return null.
 */
export function resolveTournamentTimezone(tournamentName: string | null | undefined): string | null {
  if (!tournamentName) return null;

  for (const entry of CITY_TIMEZONE) {
    if (entry.match.test(tournamentName)) return entry.timezone;
  }

  const country = extractParenthetical(tournamentName);
  if (country) {
    const timezone = COUNTRY_TIMEZONE[country.toLowerCase()];
    if (timezone) return timezone;
  }

  return null;
}
