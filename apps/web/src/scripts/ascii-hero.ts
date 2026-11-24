// Homepage hero: a Berlin skyline (the Brandenburger Tor, the Dom, the Fernsehturm and two
// Plattenbau slabs; on portrait screens the Fernsehturm alone), drawn by a WebGL
// fragment shader and printed as ASCII. Each character cell samples the scene once and
// picks a glyph from an atlas by darkness. The sky follows Berlin: the sun or moon where
// the hour puts it, lit windows at night, and the current clouds, rain, snow, fog or storm
// from /api/berlin-weather. The cursor nudges the light.
// `?weather=<WMO code>&hour=<0-24>` on the page overrides both, to preview a sky.
// Without WebGL the CMS hero media is shown instead. With reduced motion it draws still frames.
// Idempotent, so a live-preview swap can call it again.

import {
  CALM_SKY,
  berlinTime,
  parseWeather,
  skyClock,
  skyWeather,
  type BerlinWeather,
  type SkyWeather,
} from '../lib/berlin-sky';

const RAMP = ' .,:;-=+*#%@'; // from light to dark
const EXTRA = '|\\*'; // rain, slanted rain, snow
const CELL_CSS_PX = 9;
const INK = [0x09 / 255, 0x09 / 255, 0x09 / 255]; // --text
const PAPER = [0xf5 / 255, 0xf5 / 255, 0xf5 / 255]; // --background
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uCell;
uniform float uGlyphs;
uniform float uAtlasGlyphs;
uniform sampler2D uAtlas;
uniform vec3 uInk;
uniform vec3 uPaper;
// Time of day.
uniform float uDay;
uniform vec2 uSun;
uniform vec2 uMoon;
uniform float uMoonPhase;
uniform float uLightX;
// Weather.
uniform float uClouds;
uniform float uRain;
uniform float uSnow;
uniform float uFog;
uniform float uStorm;
uniform float uWind;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float box(vec2 p, vec2 lo, vec2 hi) { return step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y); }

// Prefab facade: floor slabs, recessed windows, lit ones that change slowly; more at night.
float facade(vec2 p, vec2 grid, float base, float seed, float shade) {
  vec2 g = p * grid;
  vec2 f = fract(g);
  vec2 id = floor(g);
  float lum = base + 0.1 * (noise(p * 60.0) - 0.5);
  if (f.y < 0.18) return (base + 0.25) * shade;               // slab edge
  if (f.x > 0.18 && f.x < 0.82 && f.y > 0.32) {
    float lit = step(mix(0.62, 0.9, uDay), hash(id + seed + floor(uTime * 0.15 + hash(id) * 7.0)));
    return mix(0.04, 0.95, lit);                              // window
  }
  return lum * shade;
}

float sky(vec2 p, vec2 m, float aspect, float t) {
  // The sky itself is always paper, day or night; only what is in it prints.
  float lum = 1.0;


  // Sun by day, moon by night: an outlined disc with craters.
  float span = max(aspect, 1.6);                            // portrait screens: keep the sun's path wide
  vec2 sun = vec2((uSun.x - 0.5) * span, uSun.y);
  float ds = length(p - sun);
  if (ds < 0.055) lum = mix(lum, ds > 0.045 ? 0.1 : 0.4, uDay);
  else if (ds < 0.1 && fract(atan(p.y - sun.y, p.x - sun.x) * 1.9 + t * 0.05) < 0.25) lum = mix(lum, 0.55, uDay * (1.0 - uClouds));
  // Clouds drift with the wind. Even overcast leaves gaps of open sky.
  float n = fbm(vec2(p.x * 2.5 + t * (0.015 + 0.08 * uWind), p.y * 5.0));
  float edge = mix(0.82, 0.5, uClouds);
  float cloud = smoothstep(edge, edge + 0.15, n);
  float cloudLum = mix(0.5, 0.68, uDay) + 0.15 * (n - 0.5);
  lum = mix(lum, cloudLum, cloud * 0.9);

  // Stars at night, twinkling in the gaps between clouds.
  float night = 1.0 - uDay;
  vec2 sg = floor(p * vec2(70.0, 55.0));
  float star = step(0.988, hash(sg)) * (0.6 + 0.4 * sin(t * 2.0 + hash(sg + 3.0) * 6.28));
  lum -= 0.7 * star * night * (1.0 - cloud) * (1.0 - 0.7 * uFog);

  // The moon at night, in front of the clouds, in its real phase: the lit side stays paper
  // with a few craters, the dark side prints, and an outline holds the disc.
  vec2 moon = vec2((uMoon.x - 0.5) * span, uMoon.y);
  vec2 md = (p - moon) / 0.065;
  if (dot(md, md) < 1.0) {
    vec3 nrm = vec3(md, sqrt(1.0 - dot(md, md)));
    float phi = uMoonPhase * 6.2832;
    float lit = step(0.0, dot(nrm, vec3(sin(phi), 0.0, -cos(phi))));
    float crater = step(0.6, noise(md * 3.0 + 4.0));
    float face = mix(0.35, 0.82 - 0.35 * crater, lit);
    lum = mix(lum, dot(md, md) > 0.68 ? 0.08 : face, night);
  }

  // Lightning bleaches the clouds.
  float flash = uStorm * step(0.965, hash(vec2(floor(t * 6.0), 1.7)));
  lum = mix(lum, 1.0, flash * 0.85);

  // A faint halo follows the cursor.
  lum -= 0.18 * exp(-160.0 * dot(p - m, p - m));
  return lum;
}

// Snow settles on a flat roof ending at height top.
float roof(float y, float top) { return step(top - 0.013, y) * step(0.25, uSnow); }

float scene(vec2 uv) {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  vec2 m = vec2((uMouse.x - 0.5) * aspect, uMouse.y);
  vec2 light = normalize(vec2(mix((uLightX - 0.5) * 2.0, (uMouse.x - 0.5) * 2.0, 0.4), 0.6));
  float shade = mix(0.32, 1.0, uDay);                       // stone and concrete at night
  float t = uTime;
  float y = p.y;

  float lum = sky(p, m, aspect, t);

  float par = (uMouse.x - 0.5) * 0.02;                      // background parallax
  vec2 q = p + vec2(par, 0.0);

  // On narrow, portrait screens only the Fernsehturm stands, centred.
  bool solo = aspect < 1.1;

  if (!solo) {
    // Berliner Dom, behind: a hall with arched windows, corner towers, a drum and the ribbed dome.
    float dx0 = (0.33 - 0.5) * aspect, dx1 = (0.48 - 0.5) * aspect;
    float dc = (dx0 + dx1) * 0.5, hw = (dx1 - dx0) * 0.5;
    float dr = (q.x - dc) / hw;                               // -1..1 across the hall
    if (abs(dr) < 1.0 && y > 0.06 && y < 0.3) {
      vec2 g = vec2((dr + 1.0) * 7.0, (y - 0.06) * 18.0);
      vec2 f = fract(g);
      float arch = step(0.3, f.x) * step(f.x, 0.7) * step(0.2, f.y) * step(length(vec2(f.x - 0.5, (f.y - 0.62) * 1.2)), 0.22 + step(f.y, 0.62));
      lum = arch > 0.0 ? mix(0.12, 0.9, step(mix(0.6, 0.95, uDay), hash(floor(g) + 9.0))) : (0.6 + 0.05 * noise(q * 60.0)) * shade;
      if (fract(g.y) < 0.12) lum = 0.4 * shade;                 // cornices
      lum = mix(lum, 0.97, roof(y, 0.3));
    }
    for (int i = 0; i < 2; i++) {                             // corner towers with small domes
      float tx = dc + (i == 0 ? -0.88 : 0.88) * hw;
      float tw = 0.12 * hw;
      if (abs(q.x - tx) < tw && y > 0.06 && y < 0.38) lum = (0.5 + 0.2 * light.x * sign(q.x - tx)) * shade;
      vec2 td = vec2((q.x - tx) / tw, (y - 0.38) / 0.03);
      if (td.y > 0.0 && dot(td, td) < 1.0) lum = (0.25 + 0.25 * max(0.0, td.x * light.x + 0.5)) * shade;
      if (abs(q.x - tx) < 0.003 && y > 0.4 && y < 0.43) lum = 0.1;
    }
    if (abs(dr) < 0.6 && y > 0.3 && y < 0.39) {               // drum with columns
      lum = (fract(dr * 9.0) < 0.3 ? 0.3 : 0.62) * shade;
      if (y > 0.375) lum = 0.35 * shade;
    }
    vec2 dd = vec2(dr / 0.62, (y - 0.39) / 0.13);
    if (dd.y > 0.0 && dot(dd, dd) < 1.0) {                    // the dome, lit from the side, with ribs
      float nz = sqrt(max(0.0, 1.0 - dot(dd, dd)));
      lum = (0.12 + 0.55 * max(0.0, dot(normalize(vec3(dd.x, dd.y, nz)), normalize(vec3(light, 0.9))))) * mix(0.5, 1.0, uDay);
      if (fract(atan(dd.x, nz) * 2.6) < 0.12) lum *= 0.5;
      lum = mix(lum, 0.97, step(0.25, uSnow) * step(0.75, dd.y) * 0.8);
    }
    if (abs(q.x - dc) < 0.1 * hw && y > 0.505 && y < 0.55) lum = 0.3 * shade; // lantern
    if (abs(q.x - dc) < 0.003 && y > 0.55 && y < 0.6) lum = 0.1;               // cross
    if (abs(q.x - dc) < 0.012 && abs(y - 0.585) < 0.003) lum = 0.1;

    // Plattenbau, right: a tall prefab slab behind a long low one with balcony bands.
    float ax0 = (0.72 - 0.5) * aspect, ax1 = (0.97 - 0.5) * aspect;
    if (box(q, vec2(ax0, 0.06), vec2(ax1, 0.47)) > 0.0) {
      lum = facade(q - vec2(ax0, 0.06), vec2(48.0, 30.0), 0.62, 3.0, shade);
      if (fract((q.x - ax0) * 6.0) < 0.04) lum = 0.35 * shade;   // panel joints
      lum = mix(lum, 0.97, roof(y, 0.47));
    }
    if (abs(q.x - (ax0 + ax1) * 0.5) < 0.003 && y > 0.47 && y < 0.56) lum = 0.15; // rooftop mast
    float bx0 = (0.67 - 0.5) * aspect, bx1 = (0.88 - 0.5) * aspect;
    if (box(p, vec2(bx0, 0.06), vec2(bx1, 0.26)) > 0.0) {
      vec2 f = fract((p - vec2(bx0, 0.06)) * vec2(30.0, 25.0));
      lum = facade(p - vec2(bx0, 0.06), vec2(30.0, 25.0), 0.55, 4.0, shade);
      if (f.y < 0.3) lum = (0.3 + 0.1 * step(0.5, fract(p.x * 9.0))) * shade; // balcony bands
      lum -= 0.15 * smoothstep(bx1 - 0.05, bx1, p.x) * max(0.0, -light.x) * shade;
      lum = mix(lum, 0.97, roof(y, 0.26));
    }

    // Brandenburger Tor, left: six columns, the entablature, the attic and the Quadriga.
    float gx0 = (0.05 - 0.5) * aspect, gx1 = (0.3 - 0.5) * aspect, gw = gx1 - gx0;
    float gc = (gx0 + gx1) * 0.5;
    for (int i = 0; i < 2; i++) {                             // the guardhouses at either side
      float hx = i == 0 ? gx0 - 0.1 * gw : gx1 + 0.1 * gw;
      if (abs(p.x - hx) < 0.08 * gw && y > 0.06 && y < 0.2) {
        lum = 0.62 * shade;
        if (fract((p.x - hx) / gw * 25.0) < 0.5 && y > 0.1 && y < 0.16) lum = 0.25 * shade;
        lum = mix(lum, 0.97, roof(y, 0.2));
      }
    }
    if (p.x > gx0 && p.x < gx1 && y > 0.06 && y < 0.3) {
      float f = (p.x - gx0) / gw * 5.0;                       // five passages, six columns
      float c = f - floor(f + 0.5);
      float w = 0.18 + 0.06 * step(0.28, y);                  // capitals flare at the top
      if (abs(c) < w || y < 0.075) lum = (0.42 + 0.25 * (c / w) * light.x) * shade;
    }
    if (p.x > gx0 - 0.01 && p.x < gx1 + 0.01 && y >= 0.3 && y < 0.36) {
      lum = 0.55 * shade;
      if (y > 0.315 && y < 0.34) lum = (fract((p.x - gx0) / gw * 30.0) < 0.35 ? 0.2 : 0.6) * shade; // triglyphs
      if (y > 0.35) lum = 0.3 * shade;
    }
    if (abs(p.x - gc) < 0.36 * gw && y >= 0.36 && y < 0.4) {
      lum = abs(p.x - gc) > 0.33 * gw || y > 0.39 ? 0.3 * shade : 0.6 * shade; // attic
      lum = mix(lum, 0.97, roof(y, 0.4));
    }
    vec2 hq = vec2((p.x - gc) / (0.11 * gw), (y - 0.4) / 0.04);
    if (abs(hq.x) < 1.0 && hq.y > 0.0 && hq.y < 1.0) {          // four horses: legs, bodies, raised heads
      float lane = fract((hq.x + 1.0) * 2.0);
      float body = step(0.45, hq.y) * step(hq.y, 0.8) * step(0.1, lane) * step(lane, 0.9);
      float legs = step(hq.y, 0.45) * step(0.5, fract(lane * 3.0));
      float head = step(0.8, hq.y) * step(lane, 0.3);
      if (body + legs + head > 0.0) lum = 0.12;
    }
    if (abs(p.x - gc) < 0.004 && y > 0.44 && y < 0.5) lum = 0.1;      // Victoria and her staff
    if (abs(p.x - gc) < 0.012 && y > 0.43 && y < 0.465) lum = 0.12;
    if (abs(length(vec2(p.x - gc, y - 0.507)) - 0.008) < 0.003) lum = 0.1; // the wreath
  }

  // Fernsehturm: shaft, sphere with panel grid, upper shaft and striped antenna.
  float cx = solo ? 0.0 : 0.1 * aspect;
  float w = mix(0.03, 0.016, smoothstep(0.06, 0.6, y));
  if (abs(p.x - cx) < w && y > 0.06 && y < 0.62) {
    float n = (p.x - cx) / w;
    lum = 0.08 + 0.4 * shade * max(0.0, n * light.x + sqrt(max(0.0, 1.0 - n * n)) * 0.4);
  }
  vec2 sc = vec2(cx, 0.66);
  float r = 0.075;
  vec2 d = p - sc;
  if (dot(d, d) < r * r) {
    vec3 nrm = vec3(d / r, sqrt(max(0.0, 1.0 - dot(d, d) / (r * r))));
    float diff = max(0.0, dot(nrm, normalize(vec3(light, 0.8))));
    lum = 0.04 + 0.7 * diff * mix(0.45, 1.0, uDay);
    float lat = fract(asin(nrm.y) * 6.0), lon = fract(atan(nrm.x, nrm.z) * 5.0 + t * 0.05);
    if (lat < 0.08 || lon < 0.08) lum *= 0.55;               // facets
  }
  if (abs(p.x - cx) < 0.042 && abs(y - 0.6) < 0.01) lum = 0.1; // platform ring
  if (abs(p.x - cx) < 0.011 && y > 0.72 && y < 0.82) lum = 0.15;
  if (abs(p.x - cx) < 0.005 && y > 0.82 && y < 0.95) lum = fract(y * 40.0) < 0.5 ? 0.05 : 0.5;
  float blink = step(0.5, fract(t * 0.6));
  if (dot(p - vec2(cx, 0.955), p - vec2(cx, 0.955)) < 0.00004) lum = mix(0.9, 0.05, blink);

  // Ground: darker when wet, white under snow.
  if (y < 0.06) {
    lum = (0.55 + 0.2 * noise(vec2(p.x * 30.0, y * 80.0))) * mix(0.65, 1.0, uDay) * (1.0 - 0.35 * uRain);
    lum = mix(lum, 0.95 - 0.08 * noise(p * 90.0), smoothstep(0.1, 0.4, uSnow));
  }

  // Fog fades the scene into the paper, more so higher up.
  lum = mix(lum, 1.0, uFog * (0.35 + 0.45 * smoothstep(0.0, 0.7, y)));

  return clamp(lum, 0.0, 1.0);
}

// Precipitation, in character cells: streaks of rain slanted by the wind, swaying snow.
float rainAt(vec2 c) {
  float col = floor(c.x + c.y * uWind * 0.6);
  float h = hash(vec2(col, 3.7));
  float period = 10.0 + 14.0 * h;
  float y = c.y + uTime * (22.0 + 14.0 * h) + h * 97.0;
  float on = step(hash(vec2(col, floor(y / period))), uRain * 0.45) * step(0.01, uRain);
  return on * step(fract(y / period) * period, 1.5);
}
float snowAt(vec2 c) {
  float col = floor(c.x + c.y * uWind * 0.4 + 1.3 * sin(uTime * 0.6 + c.y * 0.15));
  float h = hash(vec2(col, 7.1));
  float period = 5.0 + 9.0 * h;
  float y = c.y + uTime * (2.5 + 3.0 * h) + h * 53.0;
  float on = step(hash(vec2(col, floor(y / period) + 0.5)), uSnow * 0.35) * step(0.01, uSnow);
  return on * step(fract(y / period) * period, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cell = floor(frag / uCell);
  vec2 uv = (cell + 0.5) * uCell / uRes;
  float ink = 1.0 - scene(uv);
  float idx = floor(clamp(ink, 0.0, 0.999) * uGlyphs);
  // Rain and snow show against the sky and light walls; dark cells would swallow them.
  if (uv.y > 0.06 && ink < 0.72) {
    if (snowAt(cell) > 0.0) idx = uGlyphs + 2.0;
    else if (rainAt(cell) > 0.0) idx = uGlyphs + (uWind > 0.25 ? 1.0 : 0.0);
  }
  vec2 local = fract(frag / uCell);
  float a = texture2D(uAtlas, vec2((idx + local.x) / uAtlasGlyphs, 1.0 - local.y)).r;
  gl_FragColor = vec4(mix(uPaper, uInk, a), 1.0);
}
`;

const bound = new WeakSet<HTMLElement>();

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function atlas(cell: number): HTMLCanvasElement {
  const glyphs = [...RAMP, ...EXTRA];
  const canvas = document.createElement('canvas');
  canvas.width = cell * glyphs.length;
  canvas.height = cell;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(cell * 1.05)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  glyphs.forEach((glyph, i) => ctx.fillText(glyph, (i + 0.5) * cell, cell * 0.55));
  return canvas;
}

function showFallback(root: HTMLElement, canvas: HTMLCanvasElement) {
  canvas.remove();
  root.querySelector<HTMLElement>('[data-ascii-fallback]')?.removeAttribute('hidden');
}

/** `?weather=<WMO code>&hour=<0-24>` previews a sky instead of the live one. */
function overrides(search: string): { weather?: BerlinWeather; hour?: number } {
  const params = new URLSearchParams(search);
  const code = params.get('weather');
  const hour = params.get('hour');
  const result: { weather?: BerlinWeather; hour?: number } = {};
  if (code !== null && Number.isInteger(Number(code))) {
    const weatherCode = Number(code);
    const cloudCover = [0, 25, 55, 100][weatherCode] ?? 95;
    result.weather = { weatherCode, cloudCover, windSpeed: 18 };
  }
  if (hour !== null && Number(hour) >= 0 && Number(hour) <= 24) result.hour = Number(hour);
  return result;
}

export function initAsciiHero() {
  const root = document.querySelector<HTMLElement>('[data-ascii-hero]');
  if (!root || bound.has(root)) return;
  bound.add(root);
  const canvas = root.querySelector('canvas');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  const vs = gl && compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl?.createProgram();
  if (!gl || !vs || !fs || !program) return showFallback(root, canvas);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return showFallback(root, canvas);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u('uRes'), uTime = u('uTime'), uMouse = u('uMouse'), uCell = u('uCell');
  const uDay = u('uDay'), uSun = u('uSun'), uMoon = u('uMoon'), uLightX = u('uLightX');
  const uMoonPhase = u('uMoonPhase');
  const weatherUniforms = {
    clouds: u('uClouds'),
    rain: u('uRain'),
    snow: u('uSnow'),
    fog: u('uFog'),
    storm: u('uStorm'),
    wind: u('uWind'),
  } satisfies Record<keyof SkyWeather, WebGLUniformLocation | null>;
  gl.uniform1f(u('uGlyphs'), RAMP.length);
  gl.uniform1f(u('uAtlasGlyphs'), RAMP.length + EXTRA.length);
  gl.uniform3fv(u('uInk'), INK);
  gl.uniform3fv(u('uPaper'), PAPER);
  gl.uniform1i(u('uAtlas'), 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let cell = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const next = Math.round(CELL_CSS_PX * dpr);
    if (next !== cell) {
      cell = next;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas(cell));
    }
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uCell, cell);
  };

  const preview = overrides(window.location.search);
  const now = () => (preview.hour === undefined ? new Date() : berlinTime(preview.hour));
  // The weather eases from a calm sky to the reading, and between readings.
  const weather: SkyWeather = { ...CALM_SKY };
  let target: SkyWeather = { ...CALM_SKY };

  const mouse = { x: 0.6, y: 0.7 };
  const pointer = { x: 0.6, y: 0.7 };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const draw = () => {
    mouse.x += (pointer.x - mouse.x) * 0.08;
    mouse.y += (pointer.y - mouse.y) * 0.08;
    const clock = skyClock(now());
    for (const key of Object.keys(weather) as (keyof SkyWeather)[]) {
      weather[key] = still ? target[key] : weather[key] + (target[key] - weather[key]) * 0.02;
      gl.uniform1f(weatherUniforms[key], weather[key]);
    }
    gl.uniform1f(uDay, clock.day);
    gl.uniform2f(uSun, ...clock.sun);
    gl.uniform2f(uMoon, ...clock.moon);
    gl.uniform1f(uMoonPhase, clock.moonPhase);
    gl.uniform1f(uLightX, clock.lightX);
    gl.uniform1f(uTime, still ? 0 : (performance.now() - start) / 1000);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const setWeather = (reading: BerlinWeather) => {
    target = skyWeather(reading);
    if (still) draw();
  };
  const timers: ReturnType<typeof setInterval>[] = [];
  const connected = () => canvas.isConnected || (timers.forEach(clearInterval), false); // gone after a live-preview swap
  const fetchWeather = async () => {
    if (!connected()) return;
    try {
      const response = await fetch('/api/berlin-weather');
      const reading = response.ok ? parseWeather(await response.json()) : null;
      if (reading) setWeather(reading);
    } catch {
      // Keep the last sky; the clock still moves the sun.
    }
  };
  if (preview.weather) setWeather(preview.weather);
  else {
    void fetchWeather();
    timers.push(setInterval(fetchWeather, WEATHER_REFRESH_MS));
  }
  if (still) timers.push(setInterval(() => connected() && draw(), 60_000)); // the sun moves

  let visible = true;
  let frame = 0;
  const loop = () => {
    frame = 0;
    if (!canvas.isConnected) return; // replaced by a live-preview swap
    draw();
    if (visible && !document.hidden) frame = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!frame && !still) frame = requestAnimationFrame(loop);
  };

  root.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width;
    pointer.y = 1 - (event.clientY - rect.top) / rect.height;
    if (still) {
      mouse.x = pointer.x;
      mouse.y = pointer.y;
      draw();
    }
  });
  new ResizeObserver(() => {
    resize();
    draw();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  }).observe(canvas);
  document.addEventListener('visibilitychange', kick);

  resize();
  draw();
  kick();
}
