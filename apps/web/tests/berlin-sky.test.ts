import { afterEach, describe, expect, it, vi } from 'vitest';
import { berlinTime, moonPhase, parseWeather, skyClock, skyWeather, sunPosition } from '../src/lib/berlin-sky';
import { GET } from '../src/pages/api/berlin-weather';

describe('sunPosition', () => {
  it('puts the summer solstice noon sun about 61° up, due south', () => {
    const { elevation, azimuth } = sunPosition(new Date('2026-06-21T11:08:00Z'));
    expect(elevation).toBeCloseTo(60.9, 0);
    expect(azimuth).toBeGreaterThan(175);
    expect(azimuth).toBeLessThan(185);
  });

  it('puts the winter solstice noon sun about 14° up', () => {
    expect(sunPosition(new Date('2026-12-21T11:10:00Z')).elevation).toBeCloseTo(14, 0);
  });

  it('crosses the horizon at Berlin sunrise and sunset', () => {
    // 24 November 2026: sunrise 07:47 CET, sunset 15:56 CET.
    expect(Math.abs(sunPosition(new Date('2026-11-24T06:47:00Z')).elevation + 0.8)).toBeLessThan(1);
    expect(Math.abs(sunPosition(new Date('2026-11-24T14:56:00Z')).elevation + 0.8)).toBeLessThan(1);
  });
});

describe('skyClock', () => {
  it('is day at noon, with the sun high and left of the tower', () => {
    const clock = skyClock(new Date('2026-06-21T11:08:00Z'));
    expect(clock.day).toBe(1);
    expect(clock.sun[0]).toBeCloseTo(0.37, 1);
    expect(clock.sun[1]).toBeGreaterThan(0.8);
    expect(clock.lightX).toBeCloseTo(clock.sun[0]);
  });

  it('is night at midnight, with the moon up instead', () => {
    const clock = skyClock(new Date('2026-11-24T23:00:00Z'));
    expect(clock.day).toBe(0);
    expect(clock.sun[1]).toBeLessThan(0);
    expect(clock.moon[1]).toBeGreaterThan(0.7);
    expect(clock.lightX).toBeCloseTo(clock.moon[0]);
  });

  it('keeps the moon above the rooftops right after sunset', () => {
    expect(skyClock(new Date('2026-11-24T16:00:00Z')).moon[1]).toBeGreaterThan(0.65);
  });

  it('sets the sun low in the west, between day and night', () => {
    const clock = skyClock(new Date('2026-11-24T14:56:00Z'));
    expect(clock.day).toBeGreaterThan(0.2);
    expect(clock.day).toBeLessThan(0.8);
    expect(clock.sun[0]).toBeGreaterThan(0.6);
  });
});

describe('moonPhase', () => {
  it('is new at the February 2026 eclipse and full at the March 2026 one', () => {
    expect(moonPhase(new Date('2026-02-17T12:01:00Z'))).toBeLessThan(0.03);
    expect(Math.abs(moonPhase(new Date('2026-03-03T11:38:00Z')) - 0.5)).toBeLessThan(0.03);
  });
});

describe('berlinTime', () => {
  it('uses CET in winter and CEST in summer', () => {
    expect(berlinTime(22, new Date('2026-11-24T12:00:00Z')).toISOString()).toBe('2026-11-24T21:00:00.000Z');
    expect(berlinTime(6.5, new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-07-01T04:30:00.000Z');
  });
});

describe('skyWeather', () => {
  it('maps clear, rain, snow, fog and storms', () => {
    expect(skyWeather({ weatherCode: 0, cloudCover: 0, windSpeed: 0 })).toMatchObject({ clouds: 0, rain: 0, snow: 0 });
    expect(skyWeather({ weatherCode: 63, cloudCover: 40, windSpeed: 20 })).toMatchObject({ rain: 0.6, clouds: 0.8, wind: 0.5 });
    expect(skyWeather({ weatherCode: 75, cloudCover: 100, windSpeed: 80 })).toMatchObject({ snow: 0.85, rain: 0, wind: 1 });
    expect(skyWeather({ weatherCode: 45, cloudCover: 100, windSpeed: 5 }).fog).toBeGreaterThan(0);
    expect(skyWeather({ weatherCode: 95, cloudCover: 100, windSpeed: 30 }).storm).toBe(1);
  });

  it('treats an unknown code as no precipitation', () => {
    expect(skyWeather({ weatherCode: 42, cloudCover: 50, windSpeed: 10 })).toMatchObject({ rain: 0, snow: 0, fog: 0, clouds: 0.5 });
  });
});

describe('parseWeather', () => {
  it('accepts a reading and rejects anything else', () => {
    expect(parseWeather({ weatherCode: 3, cloudCover: 100, windSpeed: 6.3 })).toEqual({ weatherCode: 3, cloudCover: 100, windSpeed: 6.3 });
    expect(parseWeather({ weatherCode: '3', cloudCover: 100, windSpeed: 6 })).toBeNull();
    expect(parseWeather(null)).toBeNull();
  });
});

describe('GET /api/berlin-weather', () => {
  afterEach(() => vi.restoreAllMocks());
  const call = () => {
    const cache = { set: vi.fn() };
    return { cache, response: GET({ cache } as never) as Promise<Response> };
  };

  it('returns the current weather and caches it for 15 minutes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ current: { weather_code: 61, cloud_cover: 90, wind_speed_10m: 12 } }),
    );
    const { cache, response } = call();
    expect(await (await response).json()).toEqual({ weatherCode: 61, cloudCover: 90, windSpeed: 12 });
    expect(cache.set).toHaveBeenCalledWith({ maxAge: 900, swr: 900 });
  });

  it('returns 502 without caching when Open-Meteo fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 503 }));
    const { cache, response } = call();
    expect((await response).status).toBe(502);
    expect(cache.set).toHaveBeenCalledWith(false);
  });
});
