import type { APIRoute } from 'astro';
import { BERLIN, parseWeather } from '../../lib/berlin-sky';

// Berlin's current weather for the homepage hero, from Open-Meteo (no key needed).
// Cached on the CDN for 15 minutes, which is how often Open-Meteo updates `current`,
// so visitors never call the upstream themselves.

const UPSTREAM =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${BERLIN.latitude}&longitude=${BERLIN.longitude}` +
  '&current=weather_code,cloud_cover,wind_speed_10m&timezone=Europe%2FBerlin';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = async ({ cache }) => {
  try {
    const response = await fetch(UPSTREAM, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);
    const { current } = (await response.json()) as {
      current?: { weather_code?: unknown; cloud_cover?: unknown; wind_speed_10m?: unknown };
    };
    const weather = parseWeather({
      weatherCode: current?.weather_code,
      cloudCover: current?.cloud_cover,
      windSpeed: current?.wind_speed_10m,
    });
    if (!weather) throw new Error('Open-Meteo returned no current weather');
    cache.set({ maxAge: 15 * 60, swr: 15 * 60 });
    return json(weather, 200);
  } catch (error) {
    console.warn(`[berlin-weather] ${error instanceof Error ? error.message : error}`);
    cache.set(false);
    return json({ error: 'Weather unavailable' }, 502);
  }
};
