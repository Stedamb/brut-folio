// Berlin's sky for the homepage hero: where the sun is now, and what the current weather
// means for the scene. Pure functions, shared by the weather endpoint and the hero script.

export const BERLIN = { latitude: 52.52, longitude: 13.405 };

/** Current weather as the endpoint returns it (Open-Meteo `current`, WMO weather codes). */
export interface BerlinWeather {
  weatherCode: number;
  /** 0–100 %. */
  cloudCover: number;
  /** km/h at 10 m. */
  windSpeed: number;
}

/** What the shader draws, each 0–1. */
export interface SkyWeather {
  clouds: number;
  rain: number;
  snow: number;
  fog: number;
  storm: number;
  wind: number;
}

export const CALM_SKY: SkyWeather = { clouds: 0.3, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0.2 };

const RAD = Math.PI / 180;

/**
 * The sun seen from Berlin, in degrees: elevation above the horizon and azimuth clockwise
 * from north. The low-precision almanac formula, good to about a degree.
 */
export function sunPosition(date: Date): { elevation: number; azimuth: number } {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const hourAngle = (gmst * 15 + BERLIN.longitude) * RAD - ra;
  const lat = BERLIN.latitude * RAD;
  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle),
  );
  return { elevation: elevation / RAD, azimuth: (((azimuth / RAD) % 360) + 360) % 360 };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** A point of the sky in the hero, in 0–1 coordinates. The view faces south-southwest: east is left. */
function skyPoint(azimuth: number, elevation: number): [number, number] {
  const fromSouth = ((((azimuth - 180) % 360) + 540) % 360) - 180;
  // Low suns are lifted, so Berlin's winter sun clears the rooftops.
  const height = Math.sign(elevation) * (Math.abs(elevation) / 62) ** 0.35;
  // Facing 20° west of south keeps the midday sun clear of the TV tower's sphere.
  return [0.5 + (fromSouth - 20) / 150, 0.14 + 0.82 * height];
}

/** Time of day in the scene. */
export interface SkyClock {
  /** 1 in daylight, 0 at night, in between through civil twilight. */
  day: number;
  sun: [number, number];
  /** At night the moon crosses opposite the sun and always well above the rooftops: a stand-in, not its real position. */
  moon: [number, number];
  /** The moon's real phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  moonPhase: number;
  /** Horizontal position of whichever light is up, 0–1. */
  lightX: number;
}

export function skyClock(date: Date): SkyClock {
  const { elevation, azimuth } = sunPosition(date);
  const sun = skyPoint(azimuth, elevation);
  // The moon crosses opposite the sun, squeezed into the frame and kept high in the sky.
  const [moonX, moonY] = skyPoint(azimuth + 180, 18 + 0.35 * Math.max(0, -elevation));
  const moon: [number, number] = [0.5 + Math.max(-0.38, Math.min(0.38, (moonX - 0.5) / 2)), moonY];
  const day = smoothstep(-6, 3, elevation);
  return { day, sun, moon, moonPhase: moonPhase(date), lightX: moon[0] + (sun[0] - moon[0]) * day };
}

const SYNODIC_MONTH = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

/** The moon's phase from the mean synodic month, good to about a day. */
export function moonPhase(date: Date): number {
  const age = (date.getTime() - NEW_MOON) / 86_400_000 / SYNODIC_MONTH;
  return ((age % 1) + 1) % 1;
}

/** The UTC instant of `hour` (0–24) on the Berlin calendar day of `now`. */
export function berlinTime(hour: number, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const [, sign = '+', hh = '0', mm = '0'] = /GMT([+-])(\d\d):(\d\d)/.exec(get('timeZoneName')) ?? [];
  const offset = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
  const midnight = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')));
  return new Date(midnight + (hour * 60 - offset) * 60_000);
}

// Precipitation strength per WMO code: [rain, snow, storm].
const PRECIPITATION: Record<number, [number, number, number]> = {
  51: [0.2, 0, 0], 53: [0.3, 0, 0], 55: [0.4, 0, 0], // drizzle
  56: [0.25, 0, 0], 57: [0.4, 0, 0], // freezing drizzle
  61: [0.4, 0, 0], 63: [0.6, 0, 0], 65: [0.85, 0, 0], // rain
  66: [0.45, 0, 0], 67: [0.8, 0, 0], // freezing rain
  71: [0, 0.3, 0], 73: [0, 0.55, 0], 75: [0, 0.85, 0], 77: [0, 0.3, 0], // snow, grains
  80: [0.45, 0, 0], 81: [0.65, 0, 0], 82: [0.9, 0, 0], // rain showers
  85: [0, 0.5, 0], 86: [0, 0.85, 0], // snow showers
  95: [0.8, 0, 1], 96: [0.85, 0, 1], 99: [0.95, 0, 1], // thunderstorm
};

/** Maps the current weather to the scene's parameters. */
export function skyWeather(weather: BerlinWeather): SkyWeather {
  const [rain, snow, storm] = PRECIPITATION[weather.weatherCode] ?? [0, 0, 0];
  const fog = weather.weatherCode === 45 || weather.weatherCode === 48 ? 0.75 : 0;
  // Precipitation never falls from a clear sky, whatever the cloud cover says.
  const clouds = Math.max(clamp01(weather.cloudCover / 100), rain || snow ? 0.8 : 0);
  return { clouds, rain, snow, fog, storm, wind: clamp01(weather.windSpeed / 40) };
}

/** Reads the endpoint's JSON, or null when it is not a weather reading. */
export function parseWeather(body: unknown): BerlinWeather | null {
  const b = body as Partial<BerlinWeather> | null;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!b || !ok(b.weatherCode) || !ok(b.cloudCover) || !ok(b.windSpeed)) return null;
  return { weatherCode: b.weatherCode, cloudCover: b.cloudCover, windSpeed: b.windSpeed };
}
