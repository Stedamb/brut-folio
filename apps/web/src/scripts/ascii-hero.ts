// Homepage hero: a 3D Berlin skyline printed as ASCII. The Brandenburger Tor with its
// Quadriga, the Dom, the Fernsehturm and two Plattenbau slabs are signed distance fields,
// raymarched in WebGL; on portrait screens the Fernsehturm stands alone, centred.
//
// Two passes. The scene pass renders one ray per quarter character cell into a small texture.
// The print pass averages each cell, picks a glyph by darkness and lays rain and snow on top.
// The landmarks are solid volumes shaded only by glyph density, no outlines or textures.
//
// The light follows Berlin: the sun's real direction by day, casting shadows across the
// skyline, the moon by night with lit windows. The sky stays paper, with the sun, the moon
// in its real phase, stars and the current clouds from /api/berlin-weather; rain, snow, fog
// and storms come from the same reading, and snow settles on every roof. The camera dollies
// slowly into the scene; the cursor turns it, shifts the sky and slants the rain. `?weather=<WMO code>&hour=<0-24>` on the page previews any sky.
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
const EXTRA = '|\\*/v'; // rain and edges, slanted rain and edges, snow and lamps, edges, birds
// Glyph families, light to dark, six each: stone, concrete, metal, leaves, the tram.
const FAMILIES = '.-=#%@' + '.:;+#@' + '.:oO0@' + '.:+*o%' + ':=$&#@';
const CELL_CSS_PX = 7;
const SUPERSAMPLE = 2; // scene rays per cell, per axis
const SOLO_BELOW_ASPECT = 1.1; // narrower than this, the Fernsehturm stands alone
const INK = [0x09 / 255, 0x09 / 255, 0x09 / 255]; // --text
const PAPER = [0xf5 / 255, 0xf5 / 255, 0xf5 / 255]; // --background
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = `
precision highp float;
uniform float uTime;
uniform float uRain;
uniform float uSnow;
uniform float uWind;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
`;

// The scene pass: one ray per fragment of a texture SUPERSAMPLE times the character grid.
const SCENE = `${COMMON}
uniform vec2 uRes;        // canvas size in pixels
uniform float uCell;      // character cell in pixels
uniform float uSS;        // rays per cell, per axis
uniform vec2 uMouse;
uniform float uSolo;
// Time of day.
uniform float uDay;
uniform vec2 uSun;
uniform vec2 uMoon;
uniform float uMoonPhase;
uniform vec3 uLight;
// Weather.
uniform float uClouds;
uniform float uFog;
uniform float uStorm;

// Landmark positions in metres, set per frame from the aspect ratio. The camera stands at
// the origin, 5 m up, looking down -z; x is to the right.
vec3 GATE, DOM, TOWER, SLAB, LOW;

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// --- Distance functions -------------------------------------------------------------------

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
// A vertical cylinder of radius r between heights y0 and y1.
float sdCyl(vec3 p, float r, float y0, float y1) {
  vec2 d = vec2(length(p.xz) - r, max(y0 - p.y, p.y - y1));
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}
// A ring standing upright, facing the camera.
float sdRing(vec3 p, float radius, float thickness) {
  return length(vec2(length(p.xy) - radius, p.z)) - thickness;
}

// Brandenburger Tor: plinth, two rows of six Doric columns, entablature, stepped attic, wings.
float gateSdf(vec3 q) {
  float bound = sdBox(q - vec3(0.0, 12.5, 0.0), vec3(36.0, 13.0, 8.0));
  if (bound > 4.0) return bound;
  float d = sdBox(q - vec3(0.0, 0.75, 0.0), vec3(24.0, 0.75, 6.5));
  float i = clamp(floor((q.x + 17.5) / 7.0 + 0.5), 0.0, 5.0);
  vec3 c = q - vec3(-17.5 + 7.0 * i, 0.0, 0.0);
  c.z = abs(c.z) - 4.0;
  d = min(d, sdCyl(c, 1.4, 1.5, 15.0));
  d = min(d, sdBox(c - vec3(0.0, 14.6, 0.0), vec3(1.9, 0.45, 1.9)));          // capitals
  d = min(d, sdBox(q - vec3(0.0, 17.5, 0.0), vec3(23.0, 2.5, 6.2)));          // entablature
  d = min(d, sdBox(q - vec3(0.0, 21.5, 0.0), vec3(13.0, 1.5, 5.0)));          // attic
  d = min(d, sdBox(q - vec3(0.0, 23.3, 0.0), vec3(9.5, 0.35, 4.2)));
  vec3 w = vec3(abs(q.x) - 30.0, q.y, q.z + 1.0);                             // wings
  d = min(d, sdBox(w - vec3(0.0, 6.0, 0.0), vec3(5.5, 6.0, 5.5)));
  d = min(d, sdBox(w - vec3(0.0, 12.4, 0.0), vec3(6.0, 0.45, 6.0)));
  return d;
}

// The Quadriga on top of the gate, drawn 1.6 times life size so it survives as ASCII:
// four horses with raised heads, the chariot, Victoria with her wings, staff and wreath.
float quadrigaSdf(vec3 q) {
  vec3 h = (q - vec3(0.0, 23.6, 0.5)) / 1.6;
  float bound = sdBox(h - vec3(0.0, 4.5, -0.5), vec3(6.5, 5.0, 3.5));
  if (bound > 2.0) return bound * 1.6;
  float i = clamp(floor((h.x + 4.5) / 3.0 + 0.5), 0.0, 3.0);
  vec3 o = h - vec3(-4.5 + 3.0 * i, 0.0, 0.0);
  float d = sdEll(o - vec3(0.0, 2.2, 0.0), vec3(0.8, 1.0, 2.0));               // body
  d = min(d, sdEll(o - vec3(0.0, 3.6, 1.7), vec3(0.45, 1.3, 0.55)));            // neck and head
  d = min(d, sdBox(o - vec3(0.0, 0.7, 0.0), vec3(0.5, 0.7, 1.5)));              // legs
  d = min(d, sdBox(h - vec3(0.0, 1.6, -2.4), vec3(2.0, 1.4, 0.9)));             // chariot
  d = min(d, sdCyl(h - vec3(0.0, 0.0, -2.4), 0.65, 2.5, 6.2));                  // Victoria
  d = min(d, sdBox(h - vec3(0.0, 5.4, -2.6), vec3(2.3, 0.4, 0.25)));            // wings
  d = min(d, sdCyl(h - vec3(1.5, 0.0, -2.2), 0.22, 3.0, 8.0));                  // staff
  d = min(d, sdRing(h - vec3(1.5, 8.7, -2.2), 0.8, 0.22));                      // wreath
  return d * 1.6;
}

// Berliner Dom: the hall with its portico, four corner towers, the drum, the ribbed dome,
// the lantern and the cross.
float domSdf(vec3 q) {
  float bound = sdBox(q - vec3(0.0, 45.0, 1.0), vec3(37.0, 46.0, 33.0));
  if (bound > 4.0) return bound;
  float d = sdBox(q - vec3(0.0, 15.0, 0.0), vec3(34.0, 15.0, 28.0));
  d = min(d, sdBox(q - vec3(0.0, 30.6, 0.0), vec3(35.0, 0.9, 29.0)));          // cornice
  d = min(d, sdBox(q - vec3(0.0, 18.0, 28.5), vec3(13.0, 18.0, 2.0)));          // portico
  float ci = clamp(floor((q.x + 11.0) / 4.4 + 0.5), 0.0, 5.0);                  // its six columns
  d = min(d, sdCyl(q - vec3(-11.0 + 4.4 * ci, 0.0, 32.0), 1.0, 0.0, 30.0));
  d = min(d, sdBox(q - vec3(0.0, 31.5, 31.5), vec3(13.0, 1.6, 1.6)));
  vec3 c = vec3(abs(q.x) - 29.0, q.y, abs(q.z) - 23.0);                         // corner towers
  d = min(d, sdBox(c - vec3(0.0, 22.0, 0.0), vec3(5.0, 22.0, 5.0)));
  d = min(d, sdEll(c - vec3(0.0, 44.0, 0.0), vec3(5.0, 7.0, 5.0)));
  d = min(d, sdCyl(c, 1.0, 44.0, 55.0));
  d = min(d, sdCyl(q, 17.0, 31.0, 46.0));                                       // drum
  d = min(d, sdEll(q - vec3(0.0, 46.0, 0.0), vec3(17.0, 25.0, 17.0)));          // dome
  d = min(d, sdCyl(q, 3.5, 68.0, 77.0));                                        // lantern
  d = min(d, sdEll(q - vec3(0.0, 77.0, 0.0), vec3(3.5, 4.0, 3.5)));
  d = min(d, sdBox(q - vec3(0.0, 84.0, 0.0), vec3(1.0, 4.5, 1.0)));            // cross
  d = min(d, sdBox(q - vec3(0.0, 85.5, 0.0), vec3(3.0, 1.0, 1.0)));
  return d;
}

// Fernsehturm: the pavilion, the tapering shaft, the sphere (drawn larger than life), the antenna.
float towerSdf(vec3 q) {
  float bound = sdCyl(q, 36.0, -1.0, 372.0);
  if (bound > 4.0) return bound;
  float r = mix(14.0, 5.5, clamp(q.y / 250.0, 0.0, 1.0));
  float d = max(length(q.xz) - r, max(-q.y, q.y - 250.0)) * 0.95;
  // The pavilion round its foot, with its folded roof.
  float zig = abs(fract(atan(q.z, q.x) * 6.0 / 3.14159) - 0.5) * 2.0;
  d = min(d, max(length(q.xz) - 34.0, max(-q.y, q.y - (8.0 + 4.0 * zig))) * 0.8);
  d = min(d, length(q - vec3(0.0, 213.0, 0.0)) - 26.0);
  d = min(d, sdCyl(q, 2.8, 250.0, 368.0));
  return d;
}

// Plattenbau: a tall prefab slab with a lift housing and a mast, and a long low one.
float slabSdf(vec3 q) {
  float d = sdBox(q - vec3(0.0, 30.0, 0.0), vec3(40.0, 30.0, 7.0));
  // Pilasters and floor ledges on the façade, so the sun draws a grid of shadows on it.
  vec3 f = q;
  f.x -= clamp(floor(f.x / 6.0 + 0.5), -6.0, 6.0) * 6.0;
  d = min(d, sdBox(f - vec3(0.0, 30.0, 7.4), vec3(0.35, 29.5, 0.5)));
  vec3 l = q;
  l.y -= clamp(floor(l.y / 6.0 + 0.5), 1.0, 9.0) * 6.0;
  d = min(d, sdBox(l - vec3(0.0, 0.0, 7.3), vec3(39.5, 0.22, 0.4)));
  d = min(d, sdBox(q - vec3(-24.0, 61.5, 0.0), vec3(4.0, 1.5, 4.0)));
  d = min(d, sdCyl(q - vec3(20.0, 0.0, 0.0), 0.8, 60.0, 72.0));
  return d;
}
float lowSdf(vec3 q) {
  float d = sdBox(q - vec3(0.0, 8.0, 0.0), vec3(25.0, 8.0, 6.0));
  if (d > 4.0) return d;
  // Balconies, one per flat: a slab and a parapet, four floors of ten, shading the floor below.
  vec3 b = q;
  b.x -= (clamp(floor(b.x / 5.0), -5.0, 4.0) + 0.5) * 5.0;
  b.y -= (clamp(floor(b.y / 3.2 - 0.5), 0.0, 3.0) + 1.0) * 3.2;
  b.z -= 6.8;
  float balcony = min(sdBox(b, vec3(1.9, 0.12, 0.8)), sdBox(b - vec3(0.0, 0.5, 0.72), vec3(1.9, 0.5, 0.08)));
  return min(d, balcony);
}

// Unter den Linden: a row of lime trees with leafy crowns that sway in the wind.
vec3 TREES; float TREE_SPACING;
float treesSdf(vec3 p) {
  vec3 q = p - TREES;
  float bound = sdBox(q - vec3(0.0, 9.0, 0.0), vec3(3.5 * TREE_SPACING + 8.0, 10.5, 8.0));
  if (bound > 3.0) return bound;
  float i = clamp(floor(q.x / TREE_SPACING + 0.5), -3.0, 3.0);
  vec3 c = q - vec3(i * TREE_SPACING, 0.0, 0.0);
  float sway = (0.3 + 0.9 * uWind) * sin(uTime * 0.6 + i * 1.7);
  vec3 k = c - vec3(sway, 11.0, 0.0);
  float leaves = 0.9 * sin(k.x * 1.3 + uTime * 0.3) * sin(k.y * 1.1 + i) * sin(k.z * 1.2);
  float crown = (length(k * vec3(1.0, 1.2, 1.0)) - 5.4 + leaves) * 0.7;
  return min(sdCyl(c, 0.6, 0.0, 7.5), crown);
}

// Two trams on a street that runs away from the viewer through a gap in the lime trees, one
// on each track: one comes from behind the camera and heads off towards the Dom, the other
// comes back. Each takes 40 seconds.
float TRAM_X;
const float TRAM_NEAR = 20.0, TRAM_FAR = -250.0;
float oneTram(vec3 q) {
  float d = sdBox(q - vec3(0.0, 2.2, 0.0), vec3(1.3, 1.8, 14.0)) - 0.2;
  return min(d, sdBox(q - vec3(0.0, 4.3, 0.0), vec3(0.5, 0.2, 1.6)));           // pantograph
}
float tramSdf(vec3 p) {
  float span = TRAM_NEAR - TRAM_FAR;
  float bound = sdBox(p - vec3(TRAM_X, 2.5, (TRAM_NEAR + TRAM_FAR) * 0.5), vec3(4.0, 3.0, span * 0.5 + 15.0));
  if (bound > 3.0) return bound;
  float away = TRAM_NEAR - fract(uTime / 40.0) * span;
  float back = TRAM_FAR + fract(uTime / 40.0 + 0.5) * span;
  return min(oneTram(p - vec3(TRAM_X - 1.8, 0.0, away)), oneTram(p - vec3(TRAM_X + 1.8, 0.0, back)));
}

// Street lamps on both sides of the tram street, lit at night.
float lampsSdf(vec3 p) {
  vec3 q = p - vec3(TRAM_X, 0.0, 0.0);
  float bound = sdBox(q - vec3(0.0, 4.5, -132.0), vec3(6.5, 5.0, 122.0));
  if (bound > 2.0) return bound;
  q.x = abs(q.x) - 5.2;
  q.z += clamp(floor(-q.z / 22.0 + 0.5), 1.0, 11.0) * 22.0;
  float d = sdCyl(q, 0.22, 0.0, 8.5);
  d = min(d, sdBox(q - vec3(-0.9, 8.4, 0.0), vec3(0.9, 0.12, 0.12)));
  return min(d, sdBox(q - vec3(-1.7, 8.2, 0.0), vec3(0.45, 0.25, 0.3)));
}

// The tracks: four rails converging towards the horizon, on a slightly darker street.
float tracks(vec3 p) {
  if (p.z > 0.0 || p.z < TRAM_FAR - 10.0) return 0.0;
  float dx = abs(p.x - TRAM_X);
  float rails = step(abs(abs(dx - 1.8) - 0.72), 0.16);
  return 0.08 * step(dx, 4.2) + 0.4 * rails * step(dx, 3.0);
}

// Materials: 1 ground, 2 tower, 3 gate, 4 Quadriga, 5 Dom, 6 tall slab, 7 low slab,
// 8 trees, 9 tram, 10 lamps.
vec2 map(vec3 p) {
  vec2 r = vec2(p.y, 1.0);
  float d = towerSdf(p - TOWER);
  if (d < r.x) r = vec2(d, 2.0);
  if (uSolo < 0.5) {
    d = gateSdf(p - GATE);     if (d < r.x) r = vec2(d, 3.0);
    d = quadrigaSdf(p - GATE); if (d < r.x) r = vec2(d, 4.0);
    d = domSdf(p - DOM);       if (d < r.x) r = vec2(d, 5.0);
    d = slabSdf(p - SLAB);     if (d < r.x) r = vec2(d, 6.0);
    d = lowSdf(p - LOW);       if (d < r.x) r = vec2(d, 7.0);
  }
  d = treesSdf(p); if (d < r.x) r = vec2(d, 8.0);
  d = tramSdf(p);  if (d < r.x) r = vec2(d, 9.0);
  d = lampsSdf(p); if (d < r.x) r = vec2(d, 10.0);
  return r;
}

const float FAR = 2500.0;

vec2 march(vec3 ro, vec3 rd) {
  float t = 1.0;
  for (int i = 0; i < 140; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.002 * t) return vec2(t, h.y);
    t += h.x;
    if (t > FAR) break;
  }
  // The far ground beyond the march still reads as ground; everything else is sky.
  if (rd.y < 0.0) return vec2(-ro.y / rd.y, 1.0);
  return vec2(FAR, 0.0);
}

vec3 normalAt(vec3 p, float t) {
  vec2 e = vec2(1.0, -1.0) * max(0.01, 0.0012 * t);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
                   e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.5;
  for (int i = 0; i < 48; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.4, 30.0);
    if (res < 0.01 || t > 600.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 1.5 * float(i);
    o += (h - map(p + n * h).x) * s;
    s *= 0.6;
  }
  return clamp(1.0 - 0.08 * o, 0.0, 1.0);
}

// How strongly a surface takes the light: stone and concrete pale, glass, copper and bronze
// darker, so each landmark reads as its own volume. No textures: the shape is the drawing.
float albedo(float m, vec3 p) {
  if (m < 2.5) {                                                // Fernsehturm: concrete, a steel sphere
    vec3 q = p - TOWER;
    return length(q - vec3(0.0, 213.0, 0.0)) < 26.6 ? 0.7 : (q.y > 250.0 ? 0.8 : 0.95);
  }
  if (m < 3.5) return 0.95;                                     // the gate's sandstone
  if (m < 4.5) return 0.6;                                      // the Quadriga's bronze
  if (m < 5.5) return (p - DOM).y > 44.0 ? 0.75 : 0.9;          // the Dom: copper domes, stone
  if (m < 7.5) return 0.9;                                      // Plattenbau concrete
  if (m < 8.5) return 0.75;                                     // leaves
  if (m < 9.5) return 0.95;                                     // the tram's yellow
  return 0.55;                                                  // cast-iron lamps
}

// Which glyph family prints a surface: 1 ground, 2 stone, 3 concrete, 4 metal, 5 leaves, 6 tram.
// The scene pass adds 7 for a bird and 8 for a lamp lit at night.
float glyphClass(float m, vec3 p) {
  if (m < 1.5) return 1.0;
  if (m < 2.5) {
    vec3 q = p - TOWER;
    return length(q - vec3(0.0, 213.0, 0.0)) < 26.6 || q.y > 250.0 ? 4.0 : 3.0;
  }
  if (m < 3.5) return 2.0;
  if (m < 4.5) return 4.0;
  if (m < 5.5) return (p - DOM).y > 44.0 ? 4.0 : 2.0;
  if (m < 7.5) return 3.0;
  if (m < 8.5) return 5.0;
  if (m < 9.5) return 6.0;
  return 4.0;
}

// The sky, in screen space: always paper, with the sun, the clouds, the stars and the moon.
float sky(vec2 p, float aspect, float t) {
  float lum = 1.0;
  // The cursor shifts the sky a little, the clouds more than the sun, moon and stars.
  vec2 look = uMouse - 0.5;
  vec2 pc = p + look * vec2(0.07, 0.035);
  p += look * vec2(0.025, 0.012);
  float span = max(aspect, 1.6);                                // portrait screens: keep the sun's path wide
  vec2 sun = vec2((uSun.x - 0.5) * span, uSun.y);
  float ds = length(p - sun);
  if (ds < 0.055) lum = mix(lum, ds > 0.045 ? 0.1 : 0.4, uDay);
  else if (ds < 0.1 && fract(atan(p.y - sun.y, p.x - sun.x) * 1.9 + t * 0.05) < 0.25) lum = mix(lum, 0.55, uDay * (1.0 - uClouds));

  // Clouds drift with the wind. Even overcast leaves gaps of open sky.
  float n = fbm(vec2(pc.x * 2.5 + t * (0.015 + 0.08 * uWind), pc.y * 5.0));
  float edge = mix(0.82, 0.5, uClouds);
  float cloud = smoothstep(edge, edge + 0.15, n);
  lum = mix(lum, mix(0.5, 0.68, uDay) + 0.15 * (n - 0.5), cloud * 0.9);

  // Stars at night, twinkling in the gaps between clouds.
  float night = 1.0 - uDay;
  vec2 sg = floor(p * vec2(70.0, 55.0));
  float star = step(0.988, hash(sg)) * (0.6 + 0.4 * sin(t * 2.0 + hash(sg + 3.0) * 6.28));
  lum -= 0.7 * star * night * (1.0 - cloud) * (1.0 - 0.7 * uFog);

  // The moon at night, in front of the clouds, in its real phase: the lit side stays paper
  // with a few craters, the dark side prints, and an outline holds the disc.
  float moonX = clamp((uMoon.x - 0.5) * span, -0.5 * aspect + 0.08, 0.5 * aspect - 0.08); // always in frame
  vec2 md = (p - vec2(moonX, uMoon.y)) / 0.065;
  if (dot(md, md) < 1.0) {
    vec3 nrm = vec3(md, sqrt(1.0 - dot(md, md)));
    float phi = uMoonPhase * 6.2832;
    float lit = step(0.0, dot(nrm, vec3(sin(phi), 0.0, -cos(phi))));
    float face = mix(0.35, 0.82 - 0.35 * step(0.6, noise(md * 3.0 + 4.0)), lit);
    lum = mix(lum, dot(md, md) > 0.68 ? 0.08 : face, night);
  }
  return lum;
}

// A small flock crossing the sky in a V every 100 seconds, by day and out of the rain.
float birdAt(vec2 px, float t) {
  if (uDay < 0.5 || uRain > 0.3) return 0.0;
  vec2 lead = vec2(fract(t / 100.0 + 0.3) * 1.5 - 0.25, 0.8 + 0.03 * sin(t * 0.21)) * uRes;
  for (int i = 0; i < 7; i++) {
    float rank = floor((float(i) + 1.0) * 0.5), side = mod(float(i), 2.0) * 2.0 - 1.0;
    vec2 b = lead + vec2(-rank * 2.6, rank * 1.6 * side) * uCell + vec2(0.0, 0.5 * uCell * sin(t * 3.0 + float(i)));
    if (length(px - b) < uCell * 0.8) return 1.0;
  }
  return 0.0;
}

void main() {
  vec2 px = gl_FragCoord.xy * uCell / uSS;
  vec2 suv = px / uRes;
  float aspect = uRes.x / uRes.y;
  float t = uTime;

  // The composition holds across widths: wider screens spread the landmarks apart.
  float k = clamp(aspect / 1.9, 0.75, 1.4);
  GATE = vec3(-69.0 * k, 0.0, -120.0);
  DOM = vec3(-30.0 * k, 0.0, -300.0);
  TOWER = vec3(uSolo > 0.5 ? 0.0 : 60.0 * k, 0.0, -450.0);
  SLAB = vec3(118.0 * k, 0.0, -215.0);
  LOW = vec3(50.0 * k, 0.0, -95.0);
  TREES = vec3(uSolo > 0.5 ? 0.0 : -5.0 * k, 0.0, -175.0);
  TREE_SPACING = 16.0 * k;
  TRAM_X = uSolo > 0.5 ? -8.0 : -13.0 * k;                       // between two lime trees

  // Camera: a slow dolly into the scene, rising a little like a crane, then back out, eased
  // at both ends so the 100-second loop never jumps. The cursor turns and shifts it a little.
  float dolly = 0.5 - 0.5 * cos(t * 3.14159 / 50.0);
  float yaw = (uMouse.x - 0.5) * 0.05 + 0.012 * sin(t * 0.05);
  float pitch = 0.31 + 0.025 * dolly + (uMouse.y - 0.5) * 0.03;
  vec3 ro = vec3((uMouse.x - 0.5) * 14.0 + (uSolo > 0.5 ? 25.0 : 6.0) * sin(t * 0.04), 5.0 + 4.0 * dolly, -65.0 * dolly);
  vec3 fw = vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch));
  vec3 rt = normalize(vec3(cos(yaw), 0.0, sin(yaw)));
  vec3 up = cross(rt, fw);
  vec2 ndc = (suv * 2.0 - 1.0) * vec2(aspect, 1.0) * 0.4663; // 50° vertical field of view
  vec3 rd = normalize(fw + ndc.x * rt + ndc.y * up);

  vec2 hit = march(ro, rd);
  float lum, depth = 1.0, cls = 0.0;
  float flash = uStorm * step(0.965, hash(vec2(floor(t * 6.0), 1.7)));
  if (hit.y < 0.5) {
    lum = mix(sky(vec2((suv.x - 0.5) * aspect, suv.y), aspect, t), 1.0, flash * 0.85);
    if (birdAt(px, t) > 0.0) { lum = 0.4; cls = 7.0; }
  } else {
    vec3 p = ro + rd * hit.x;
    vec3 n = hit.y < 1.5 ? vec3(0.0, 1.0, 0.0) : normalAt(p, hit.x);
    cls = glyphClass(hit.y, p);
    float day = uDay;
    float sh = softShadow(p + n * 0.3, uLight);
    if (hit.y < 1.5) {
      // The ground stays paper; only the shadows the landmarks cast on it print, and the
      // contact shadow where each thing meets it.
      lum = 1.0 - 0.55 * (1.0 - sh) * mix(0.6, 1.0, day) - 0.4 * (1.0 - occlusion(p, n)) - tracks(p);
    } else {
      // Solid volumes shaded by how they face the light, as dense glyphs: every surface
      // prints something, the lit side light, the far side dense.
      float diffuse = max(dot(n, uLight), 0.0) * sh;
      float wrap = 0.5 + 0.5 * dot(n, uLight);                  // soft fall-off into the shade
      float spec = pow(max(dot(reflect(-uLight, n), -rd), 0.0), 24.0) * sh;
      // Light gathers towards the top of each volume and drains towards its base.
      float rise = mix(0.72, 1.0, smoothstep(0.0, 40.0, p.y));
      float light = (mix(0.2, 0.35, day) * wrap * occlusion(p, n) + mix(0.4, 0.55, day) * diffuse) * rise + 0.25 * spec;
      float ink = 0.22 + 0.62 * (1.0 - clamp(albedo(hit.y, p) * light, 0.0, 1.0));
      // The warning light on the antenna blinks.
      if (hit.y < 2.5 && (p - TOWER).y > 362.0) ink = mix(0.05, 1.0, step(0.5, fract(t * 0.6)));
      // Snow settles on whatever faces up.
      ink = mix(ink, 0.12, smoothstep(0.55, 0.8, n.y) * smoothstep(0.15, 0.45, uSnow));
      lum = 1.0 - ink;
      if (hit.y > 9.5 && p.y > 7.9 && day < 0.5) cls = 8.0;     // a lamp lit at night
    }
    lum = mix(lum, 1.0, flash * 0.5);
    // Distance fades into the paper: a little always, a lot in fog.
    lum = mix(lum, 1.0, 1.0 - exp(-hit.x * (0.0003 + 0.006 * uFog)));
    depth = log(1.0 + hit.x) / log(1.0 + FAR);
  }
  gl_FragColor = vec4(clamp(lum, 0.0, 1.0), depth, cls / 16.0, 1.0);
}
`;

// The print pass: one glyph per character cell from the averaged scene.
const PRINT = `${COMMON}
uniform vec2 uCells;      // character grid size
uniform vec2 uMouse;
uniform float uCell;
uniform float uGlyphs;
uniform float uAtlasGlyphs;
uniform float uFamilies;  // atlas index of the first glyph family
uniform sampler2D uAtlas;
uniform sampler2D uScene;
uniform vec3 uInk;
uniform vec3 uPaper;

// Bilinear sampling at the centre of a cell averages its rays.
vec4 cellAt(vec2 c) { return texture2D(uScene, (c + 0.5) / uCells); }

// Precipitation, in character cells: streaks of rain slanted by the wind and towards the
// cursor, swaying snow; both slide sideways as the cursor moves, being close to the viewer.
float rainSlant() { return uWind * 0.6 + (uMouse.x - 0.5) * 1.4; }
float rainShift() { return (0.5 - uMouse.x) * 36.0; }
float rainAt(vec2 c) {
  float col = floor(c.x + rainShift() + c.y * rainSlant());
  float h = hash(vec2(col, 3.7));
  float period = 10.0 + 14.0 * h;
  float y = c.y + uTime * (22.0 + 14.0 * h) + h * 97.0;
  float on = step(hash(vec2(col, floor(y / period))), uRain * 0.45) * step(0.01, uRain);
  return on * step(fract(y / period) * period, 1.5);
}
float snowAt(vec2 c) {
  float col = floor(c.x + 0.7 * rainShift() + c.y * 0.6 * rainSlant() + 1.3 * sin(uTime * 0.6 + c.y * 0.15));
  float h = hash(vec2(col, 7.1));
  float period = 5.0 + 9.0 * h;
  float y = c.y + uTime * (2.5 + 3.0 * h) + h * 53.0;
  float on = step(hash(vec2(col, floor(y / period) + 0.5)), uSnow * 0.35) * step(0.01, uSnow);
  return on * step(fract(y / period) * period, 1.0);
}

const float VERTICAL = 0.0, BACKSLASH = 1.0, SNOW = 2.0, SLASH = 3.0, BIRD = 4.0, DASH = 5.0;
const float FAMILY = 6.0; // glyphs per family

// The glyph family of a cell, from one of its rays: averaging would blend families at edges.
float classAt(vec2 c) { return floor(texture2D(uScene, (c + 0.25) / uCells).b * 16.0 + 0.5); }
bool skyAt(vec2 c) { return cellAt(c).g > 0.995; }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cell = floor(frag / uCell);
  vec4 s = cellAt(cell);
  float ink = 1.0 - s.r;
  float idx = floor(clamp(ink, 0.0, 0.999) * uGlyphs);
  float cls = classAt(cell);
  if (cls > 7.5) idx = uGlyphs + SNOW;                           // a lamp lit at night
  else if (cls > 6.5) idx = uGlyphs + BIRD;
  else if (cls > 1.5) {
    // Each surface prints in its own family: stone - = #, concrete : ; +, metal o O 0, leaves
    // . : * + o, the tram $ &.
    idx = uFamilies + (cls - 2.0) * FAMILY + floor(clamp(ink, 0.0, 0.999) * FAMILY);
    // Where a building meets the sky, its edge prints along its direction.
    bool l = skyAt(cell + vec2(-1.0, 0.0)), r = skyAt(cell + vec2(1.0, 0.0));
    bool u = skyAt(cell + vec2(0.0, 1.0)), d = skyAt(cell + vec2(0.0, -1.0));
    if (cls < 4.5 && (l || r || u) && !(l && r)) {
      if (u && !l && !r) idx = DASH;
      else if (!u && (l || r)) idx = uGlyphs + VERTICAL;
      else idx = uGlyphs + (u && l ? SLASH : BACKSLASH);
    }
  }

  // Rain and snow show against the sky and light walls; dark cells would swallow them.
  if (ink < 0.72) {
    if (snowAt(cell) > 0.0) idx = uGlyphs + SNOW;
    else if (rainAt(cell) > 0.0) {
      float k = rainSlant();
      idx = uGlyphs + (k > 0.25 ? BACKSLASH : k < -0.25 ? SLASH : VERTICAL);
    }
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
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn('[ascii-hero] shader did not compile:', gl.getShaderInfoLog(shader));
  return null;
}

function link(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function atlas(cell: number): HTMLCanvasElement {
  const glyphs = [...RAMP, ...EXTRA, ...FAMILIES];
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

function texture(gl: WebGLRenderingContext): WebGLTexture | null {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
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
  const scene = gl && link(gl, SCENE);
  const print = gl && link(gl, PRINT);
  const framebuffer = gl?.createFramebuffer();
  if (!gl || !scene || !print || !framebuffer) return showFallback(root, canvas);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  for (const program of [scene, print]) {
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  const uniforms = <T extends string>(program: WebGLProgram, names: readonly T[]) =>
    Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<
      T,
      WebGLUniformLocation | null
    >;
  const WEATHER = { clouds: 'uClouds', rain: 'uRain', snow: 'uSnow', fog: 'uFog', storm: 'uStorm', wind: 'uWind' } as const;
  const su = uniforms(scene, [
    'uRes', 'uCell', 'uSS', 'uMouse', 'uSolo', 'uTime', 'uDay', 'uSun', 'uMoon', 'uMoonPhase', 'uLight',
    ...Object.values(WEATHER),
  ] as const);
  const pu = uniforms(print, [
    'uCells', 'uMouse', 'uCell', 'uGlyphs', 'uAtlasGlyphs', 'uFamilies', 'uAtlas', 'uScene', 'uInk', 'uPaper', 'uTime', 'uRain', 'uSnow', 'uWind',
  ] as const);

  gl.useProgram(print);
  gl.uniform1f(pu.uGlyphs, RAMP.length);
  gl.uniform1f(pu.uAtlasGlyphs, RAMP.length + EXTRA.length + FAMILIES.length);
  gl.uniform1f(pu.uFamilies, RAMP.length + EXTRA.length);
  gl.uniform3fv(pu.uInk, INK);
  gl.uniform3fv(pu.uPaper, PAPER);
  gl.uniform1i(pu.uAtlas, 0);
  gl.uniform1i(pu.uScene, 1);
  gl.activeTexture(gl.TEXTURE0);
  const glyphs = texture(gl);
  gl.activeTexture(gl.TEXTURE1);
  const rendered = texture(gl);

  let cell = 0;
  let cols = 0;
  let rows = 0;
  let solo = false;
  let ok = true;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const next = Math.round(CELL_CSS_PX * dpr);
    if (next !== cell) {
      cell = next;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glyphs);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas(cell));
    }
    cols = Math.ceil(canvas.width / cell);
    rows = Math.ceil(canvas.height / cell);
    solo = canvas.width / canvas.height < SOLO_BELOW_ASPECT;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rendered);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols * SUPERSAMPLE, rows * SUPERSAMPLE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rendered, 0);
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) showFallback(root, canvas);
  };

  const preview = overrides(window.location.search);
  const now = () => (preview.hour === undefined ? new Date() : berlinTime(preview.hour));
  // The weather eases from a calm sky to the reading, and between readings.
  const weather: SkyWeather = { ...CALM_SKY };
  let target: SkyWeather = { ...CALM_SKY };

  const mouse = { x: 0.5, y: 0.5 };
  const pointer = { x: 0.5, y: 0.5 };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const draw = () => {
    if (!ok) return;
    mouse.x += (pointer.x - mouse.x) * 0.06;
    mouse.y += (pointer.y - mouse.y) * 0.06;
    const time = still ? 0 : (performance.now() - start) / 1000;
    const clock = skyClock(now());
    for (const key of Object.keys(weather) as (keyof SkyWeather)[]) {
      weather[key] = still ? target[key] : weather[key] + (target[key] - weather[key]) * 0.02;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, cols * SUPERSAMPLE, rows * SUPERSAMPLE);
    gl.useProgram(scene);
    gl.uniform2f(su.uRes, canvas.width, canvas.height);
    gl.uniform1f(su.uCell, cell);
    gl.uniform1f(su.uSS, SUPERSAMPLE);
    gl.uniform2f(su.uMouse, mouse.x, mouse.y);
    gl.uniform1f(su.uSolo, solo ? 1 : 0);
    gl.uniform1f(su.uTime, time);
    gl.uniform1f(su.uDay, clock.day);
    gl.uniform2f(su.uSun, ...clock.sun);
    gl.uniform2f(su.uMoon, ...clock.moon);
    gl.uniform1f(su.uMoonPhase, clock.moonPhase);
    gl.uniform3f(su.uLight, ...clock.light);
    for (const [key, name] of Object.entries(WEATHER) as [keyof SkyWeather, (typeof WEATHER)[keyof SkyWeather]][]) {
      gl.uniform1f(su[name], weather[key]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(print);
    gl.uniform2f(pu.uCells, cols, rows);
    gl.uniform2f(pu.uMouse, mouse.x, mouse.y);
    gl.uniform1f(pu.uCell, cell);
    gl.uniform1f(pu.uTime, time);
    gl.uniform1f(pu.uRain, weather.rain);
    gl.uniform1f(pu.uSnow, weather.snow);
    gl.uniform1f(pu.uWind, weather.wind);
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
