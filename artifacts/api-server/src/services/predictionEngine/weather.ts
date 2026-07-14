import { logger } from "../../lib/logger";
import { inferVenue, type Venue } from "./venueMap";

export interface WeatherConditions {
  venueName: string;
  temperatureC: number;
  windSpeedKph: number;
  precipitationProbability: number;
  note: string;
}

const MAX_FORECAST_DAYS = 15; // Open-Meteo's forecast horizon

/**
 * Fetches real forecast conditions (Open-Meteo, no API key required) for a genuinely upcoming
 * fixture with a known venue and a scheduled time within the forecast horizon. Returns null
 * (never a fabricated/typical-weather guess) when the venue is unknown, the match is not
 * actually upcoming, or it's too far out to forecast. Deliberately carries no player-specific
 * edge -- there's no real data connecting these players' historical performance to weather, so
 * this is reported for transparency only and is never fed into the ensemble's probability.
 */
export async function getUpcomingConditions(tournamentName: string | null | undefined, scheduledAt: Date): Promise<WeatherConditions | null> {
  const venue: Venue | null = inferVenue(tournamentName);
  if (!venue) return null;

  const now = Date.now();
  const daysOut = (scheduledAt.getTime() - now) / (24 * 60 * 60 * 1000);
  if (daysOut < 0 || daysOut > MAX_FORECAST_DAYS) return null;

  const dateStr = scheduledAt.toISOString().slice(0, 10);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${venue.latitude}&longitude=${venue.longitude}` +
    `&hourly=temperature_2m,wind_speed_10m,precipitation_probability&timezone=${encodeURIComponent(venue.timezone)}` +
    `&start_date=${dateStr}&end_date=${dateStr}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    // Network failure -- still report "not available" to the caller (never a guessed forecast),
    // but log it so a persistent outage is diagnosable instead of looking identical to a match
    // with no resolvable venue.
    logger.warn({ err, venueName: venue.name }, "Open-Meteo weather lookup failed (network error)");
    return null;
  }
  if (!response.ok) {
    logger.warn(
      { status: response.status, venueName: venue.name },
      "Open-Meteo weather lookup failed (non-OK response)",
    );
    return null;
  }

  const data = (await response.json()) as {
    hourly?: { time: string[]; temperature_2m: number[]; wind_speed_10m: number[]; precipitation_probability: number[] };
  };
  const hourly = data.hourly;
  if (!hourly || hourly.time.length === 0) {
    // A genuinely valid response with no hourly data for the requested date is unexpected (the
    // date is within the forecast horizon), so this is treated as a provider anomaly worth
    // logging, not a normal "no forecast available" case.
    logger.warn({ venueName: venue.name, dateStr }, "Open-Meteo weather lookup returned no hourly data");
    return null;
  }

  const targetHour = scheduledAt.getUTCHours();
  let bestIndex = 0;
  let bestDiff = Infinity;
  hourly.time.forEach((t, i) => {
    const hour = new Date(t).getUTCHours();
    const diff = Math.abs(hour - targetHour);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  });

  return {
    venueName: venue.name,
    temperatureC: Math.round(hourly.temperature_2m[bestIndex]),
    windSpeedKph: Math.round(hourly.wind_speed_10m[bestIndex]),
    precipitationProbability: Math.round(hourly.precipitation_probability[bestIndex]),
    note: "Forecast conditions shown for awareness only -- no reliable data links these players' historical performance to weather, so this is not used to adjust the win probability.",
  };
}
