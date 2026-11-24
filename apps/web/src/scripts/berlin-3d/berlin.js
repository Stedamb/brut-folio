// Berlin 3D: the city, its light and everything that moves in it, seen from high above or
// at eye level. Units are about 1.9 m:
// a person is just under one unit tall.
//
// The Spree runs diagonally through the city. The Fernsehturm stands on the near bank, the
// Berliner Dom and the Lustgarten on the far one, lime trees in their November gold line the
// promenades, a yellow tram crosses the bridge, a tour boat runs downstream, people walk and
// leaves fall. Every material writes a glyph class into the alpha channel for the ASCII pass.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CLS = { grass: 1, leaf: 2, flower: 3, stone: 4, paving: 5, tower: 6, metal: 7, roof: 8, water: 9, foam: 10, person: 11, tram: 12, boat: 13, wood: 14, wall: 15 };

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const fract = (x) => x - Math.floor(x);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
  return (hash2(i, j) * (1 - u) + hash2(i + 1, j) * u) * (1 - v) + (hash2(i, j + 1) * (1 - u) + hash2(i + 1, j + 1) * u) * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.1 + 3, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3 + 5) * 0.15 + vnoise(x * 8.7, y * 8.7) * 0.07;
let seed = 1989; // the Wall came down
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

export const time = { value: 0 };
export const night = { value: 0 };

// What a walker bumps into: rotated boxes and round posts, filled in as the city is built.
const obstacles = [], posts = [];

// Writes a glyph class into the alpha channel of whatever a material renders.
function tag(mat, cls, extra) {
  mat.onBeforeCompile = (s) => {
    extra?.(s);
    s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.a = ${(cls / 16).toFixed(4)};`);
  };
  mat.customProgramCacheKey = () => `c${cls}${extra ? extra.toString().length : 0}`;
  return mat;
}
function colored(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}
const part = (g, hex, x = 0, y = 0, z = 0) => { g.translate(x, y, z); g.deleteAttribute('uv'); return colored(g, hex); };

// ---------- the city's plan ----------
const X0 = -110, X1 = 110, Z0 = -100, Z1 = 46; // the city runs on far behind, to the horizon
const RIVER = [[-120, 33], [-70, 20], [-46, 15], [-24, 10], [-6, 4], [10, -1.5], [28, -9], [50, -17], [72, -24], [120, -38]];
export const river = new THREE.CatmullRomCurve3(RIVER.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5);
const riverPts = river.getSpacedPoints(600);
export const RIVER_HALF = 3.6; // water to the wall
const WATER_Y = -0.45, WALL_Y = -1.0;

const FW = 640, FH = 424;
const fR = new Float32Array(FW * FH);
for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
  const x = X0 + (X1 - X0) * i / (FW - 1), z = Z0 + (Z1 - Z0) * j / (FH - 1);
  let best = 1e9;
  for (let k = 0; k < riverPts.length; k += 2) { const p = riverPts[k], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; }
  fR[j * FW + i] = Math.sqrt(best);
}
function samp(f, x, z) {
  const u = clamp((x - X0) / (X1 - X0)) * (FW - 1), v = clamp((z - Z0) / (Z1 - Z0)) * (FH - 1);
  const i = Math.min(FW - 2, u | 0), j = Math.min(FH - 2, v | 0), a = u - i, b = v - j;
  return (f[j * FW + i] * (1 - a) + f[j * FW + i + 1] * a) * (1 - b) + (f[(j + 1) * FW + i] * (1 - a) + f[(j + 1) * FW + i + 1] * a) * b;
}
const riverD = (x, z) => samp(fR, x, z);

// The bridge and the tram's street cross the river square on.
const BRIDGE_U = 0.47;
const BRIDGE = river.getPointAt(BRIDGE_U), RIVER_T = river.getTangentAt(BRIDGE_U);
const STREET = new THREE.Vector2(-RIVER_T.z, RIVER_T.x).normalize();
if (STREET.y < 0) STREET.negate();
const streetD = (x, z) => Math.abs((x - BRIDGE.x) * STREET.y - (z - BRIDGE.z) * STREET.x);
const streetAt = (s) => [BRIDGE.x + STREET.x * s, BRIDGE.z + STREET.y * s];

export const TOWER = { x: 11, z: 9.5 };
export const DOM = { x: -13, z: -5 };
const plaza = (x, z) => Math.hypot(x - TOWER.x, z - TOWER.z) < 10.5;
const lustgarten = (x, z) => x > -30 && x < -2 && z > -21 && z < -10.5;
const park = (x, z) => lustgarten(x, z) || (fbm(x * 0.05 + 3, z * 0.05 - 2) > 0.6 && riverD(x, z) > 8 && streetD(x, z) > 3.5 && !plaza(x, z));
const flowerField = (x, z) => fbm(x * 0.12 + 11, z * 0.14 - 4);
const ground = (x, z) => {
  const d = riverD(x, z);
  return d < RIVER_HALF ? WALL_Y : 0;
};

function buildGround() {
  const TW = 2048, TH = 1360, col = new Uint8Array(TW * TH * 4), cls = new Uint8Array(TW * TH * 4);
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const x = X0 + (X1 - X0) * i / (TW - 1), z = Z0 + (Z1 - Z0) * j / (TH - 1);
    const d = riverD(x, z), sd = streetD(x, z), n = fbm(x * 0.4, z * 0.4);
    let c, k;
    if (d < RIVER_HALF) { c = [40, 52, 50]; k = CLS.stone; }
    else if (d < RIVER_HALF + 0.7) { c = [196, 190, 178]; k = CLS.stone; }                // the embankment's coping
    else if (sd < 2.0) {                                                                  // asphalt, tram rails
      const rail = Math.abs(sd - 0.55) < 0.07 || Math.abs(sd - 1.25) < 0.07;
      c = rail ? [170, 168, 160] : [78, 76, 74]; k = CLS.paving;
    } else if (d < RIVER_HALF + 3.2 || plaza(x, z)) {                                     // granite promenade and plaza
      const slab = (fract(x * 0.9) < 0.06 || fract(z * 0.9) < 0.06) ? 0.86 : 1;
      c = [214 * slab, 204 * slab, 186 * slab]; k = CLS.paving;
    } else if (park(x, z)) {
      const v = 0.6 + 0.9 * fbm(x * 0.16 + 5, z * 0.16);
      c = [70 * v, 104 * v, 36 * v]; k = CLS.grass;
      if (lustgarten(x, z) && (Math.abs(x + 16) < 0.6 || Math.abs(z + 15.7) < 0.6)) { c = [205, 196, 172]; k = CLS.paving; } // paths
    } else {                                                                              // pavements and courtyards
      c = [150 + n * 40, 146 + n * 36, 136 + n * 30]; k = CLS.paving;
    }
    const o = (j * TW + i) * 4;
    col[o] = clamp(c[0], 0, 255); col[o + 1] = clamp(c[1], 0, 255); col[o + 2] = clamp(c[2], 0, 255); col[o + 3] = 255; cls[o] = k * 16;
  }
  const colTex = new THREE.DataTexture(col, TW, TH, THREE.RGBAFormat);
  colTex.colorSpace = THREE.SRGBColorSpace; colTex.magFilter = THREE.LinearFilter; colTex.minFilter = THREE.LinearMipmapLinearFilter; colTex.generateMipmaps = true; colTex.anisotropy = 8; colTex.needsUpdate = true;
  const clsTex = new THREE.DataTexture(cls, TW, TH, THREE.RGBAFormat); clsTex.magFilter = clsTex.minFilter = THREE.NearestFilter; clsTex.needsUpdate = true;
  const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, 600, 620); g.rotateX(-Math.PI / 2); g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, ground(x, z)); uv.setXY(i, (x - X0) / (X1 - X0), (z - Z0) / (Z1 - Z0)); }
  g.computeVertexNormals();
  const m = new THREE.MeshLambertMaterial({ map: colTex });
  m.onBeforeCompile = (s) => {
    s.uniforms.clsTex = { value: clsTex };
    s.fragmentShader = 'uniform sampler2D clsTex;\n' + s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.a = texture2D(clsTex, vMapUv).r;`);
  };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true;
  return mesh;
}

// ---------- the Spree ----------
function buildRiver() {
  const depth = new Float32Array(FW * FH * 4);
  for (let i = 0; i < FW * FH; i++) depth[i * 4] = fR[i];
  const dt = new THREE.DataTexture(depth, FW, FH, THREE.RGBAFormat, THREE.FloatType);
  dt.magFilter = dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
  const m = new THREE.ShaderMaterial({
    uniforms: { uD: { value: dt }, uT: time, uNight: night, uB: { value: new THREE.Vector4(X0, Z0, X1 - X0, Z1 - Z0) }, uHalf: { value: RIVER_HALF } },
    vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uD; uniform float uT, uNight, uHalf; uniform vec4 uB; varying vec3 vW;
      float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ return vn(p)*.55+vn(p*2.1+3.1)*.3+vn(p*4.3+7.7)*.15; }
      void main(){
        float d = texture2D(uD,(vW.xz-uB.xy)/uB.zw).r;
        if(d>uHalf) discard;
        vec2 flow = vec2(.92,-.38)*uT*.5;                       // the Spree flows east
        float n = fbm(vW.xz*vec2(.35,.5)-flow*.6);
        float edge = d/uHalf;
        vec3 c = mix(vec3(.05,.2,.2),vec3(.1,.33,.3),n);
        c = mix(c,vec3(.03,.12,.13),smoothstep(.2,.9,1.-edge)*.4);
        float glint = smoothstep(.72,.86,vn(vW.xz*vec2(1.1,2.6)-flow*1.3));
        c += vec3(.35,.42,.38)*glint;
        c = mix(c,c*vec3(.45,.5,.8),uNight);
        float cls = 9.;
        float lap = smoothstep(.86,.98,edge)*(.5+.5*vn(vW.xz*1.8+uT*.6));  // ripples on the walls
        if(lap>.45){ c = mix(c,vec3(.8,.84,.8),lap); cls = 10.; }
        gl_FragColor = vec4(c,cls/16.);
      }`,
  });
  const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0); g.rotateX(-Math.PI / 2); g.translate((X0 + X1) / 2, WATER_Y, (Z0 + Z1) / 2);
  return new THREE.Mesh(g, m);
}

// ---------- wind ----------
function bladeWind(s) {
  s.uniforms.uT = time;
  s.vertexShader = 'uniform float uT;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float ph = instanceMatrix[3].x*.34+instanceMatrix[3].z*.22;
    float gust = sin(uT*.75-ph)*.5+.5;
    transformed.x += (sin(uT*1.6+ph*2.)*.28+gust*.6)*.22*position.y*position.y;`);
}
function leafWind(s) {
  s.uniforms.uT = time;
  s.vertexShader = 'uniform float uT;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float ph = instanceMatrix[3].x*.9+instanceMatrix[3].z*.7+instanceMatrix[3].y*.8;
    transformed.y += sin(uT*2.1+ph)*.035;
    transformed += vec3(1.,0.,.4)*sin(uT*.8+instanceMatrix[3].x*.22)*.06;`);
}

// ---------- grass and flowers in the parks ----------
function buildGrass(scene) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.045, 0, 0, 0.045, 0, 0, 0.012, 0.6, 0, -0.045, 0, 0, 0.012, 0.6, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const N = 110000, im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLS.grass, bladeWind), N);
  const o = new THREE.Object3D(), c = new THREE.Color();
  let i = 0, guard = 0;
  while (i < N && guard++ < 4e6) {
    const x = X0 + rnd() * (X1 - X0), z = Z0 + rnd() * (Z1 - Z0);
    if (!park(x, z) || (lustgarten(x, z) && (Math.abs(x + 16) < 0.8 || Math.abs(z + 15.7) < 0.8))) continue;
    o.position.set(x, -0.02, z); o.rotation.y = rnd() * 6.28;
    const s = 0.3 + rnd() * 0.28; o.scale.set(1.5, s, 1.5); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    const v = 0.55 + rnd() * 0.75, tone = fbm(x * 0.16 + 5, z * 0.16), dk = 0.55 + 1.1 * tone;
    c.setRGB((0.16 * v + tone * 0.12) * dk, 0.36 * v * dk, 0.06 * v * dk); im.setColorAt(i++, c);
  }
  im.count = i; im.receiveShadow = true; scene.add(im);
}
function buildFlowers(scene) {
  const g = new THREE.PlaneGeometry(0.14, 0.14); g.rotateX(-Math.PI / 2 + 0.25);
  const N = 24000, im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLS.flower, bladeWind), N);
  const o = new THREE.Object3D(), c = new THREE.Color();
  let i = 0, guard = 0;
  while (i < N && guard++ < 4e6) {
    const x = X0 + rnd() * (X1 - X0), z = Z0 + rnd() * (Z1 - Z0);
    if (!park(x, z) || flowerField(x, z) < 0.57 + rnd() * 0.05 || fbm(x * 0.9, z * 0.9) < 0.47) continue;
    o.position.set(x, 0.2 + rnd() * 0.14, z); o.rotation.y = rnd() * 6.28; o.scale.setScalar(0.8 + rnd() * 0.9); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    const r = rnd(); c.setRGB(0.85, r < 0.4 ? 0.6 : 0.82, r < 0.4 ? 0.7 : 0.78); im.setColorAt(i++, c); // the last asters
  }
  im.count = i; im.receiveShadow = true; scene.add(im);
}

// ---------- lime trees in November ----------
function buildTrees(scene) {
  const spots = [];
  // Rows along both promenades, gaps for the bridge and the plaza.
  for (const side of [-1, 1]) for (let u = 0; u < 1; u += 0.0072) {
    const p = river.getPointAt(u), t = river.getTangentAt(u), x = p.x - t.z * side * (RIVER_HALF + 2.3), z = p.z + t.x * side * (RIVER_HALF + 2.3);
    if (x < X0 + 2 || x > X1 - 2 || z < Z0 + 2 || z > Z1 - 2 || streetD(x, z) < 3.6 || plaza(x, z) && side < 0 && Math.hypot(x - TOWER.x, z - TOWER.z) < 4) continue;
    spots.push({ x, z, s: 0.62 + rnd() * 0.16 });
  }
  let guard = 0;
  while (spots.length < 210 && guard++ < 20000) {                                       // the parks
    const x = X0 + rnd() * (X1 - X0), z = Z0 + rnd() * (Z1 - Z0);
    if (!park(x, z) || spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 9)) continue;
    if (lustgarten(x, z) && x > -24 && x < -8 && z > -19 && z < -12.5) continue;        // keep the lawn open
    spots.push({ x, z, s: 0.75 + rnd() * 0.4 });
  }
  const pal = [[0.98, 0.7, 0.12], [0.88, 0.55, 0.06], [1, 0.8, 0.22], [0.72, 0.56, 0.1], [0.62, 0.52, 0.16], [0.42, 0.5, 0.14], [0.8, 0.34, 0.08]];
  const leaves = [], trunks = [];
  for (const t of spots) {
    const H0 = 4.6 * t.s;
    posts.push({ x: t.x, z: t.z, r: 0.25 * t.s });
    const tg = new THREE.CylinderGeometry(0.08 * t.s, 0.2 * t.s, H0, 7); tg.translate(t.x, H0 / 2, t.z); trunks.push(tg);
    for (let b = 0; b < 3; b++) { const a = rnd() * 6.28, bg = new THREE.CylinderGeometry(0.03 * t.s, 0.07 * t.s, 2 * t.s, 5); bg.rotateZ(0.8); bg.rotateY(a); bg.translate(t.x + Math.cos(a) * 0.55 * t.s, H0 * 0.72, t.z - Math.sin(a) * 0.55 * t.s); trunks.push(bg); }
    const lobes = 9, bare = rnd() < 0.15 ? 0.45 : 1;                                     // some already half bare
    for (let l = 0; l < lobes; l++) {
      const a = rnd() * 6.28, r = rnd() ** 0.6 * 2.2 * t.s, lx = t.x + Math.cos(a) * r, lz = t.z + Math.sin(a) * r;
      const ly = H0 * 0.82 + (rnd() - 0.35) * 1.6 * t.s + (1 - r / (2.3 * t.s)) * 1.2 * t.s, lr = (0.7 + rnd() * 0.5) * t.s;
      for (let i = 0; i < 120 * bare; i++) {
        const u = rnd() * 2 - 1, th = rnd() * 6.28, q = Math.sqrt(1 - u * u), rr = lr * Math.cbrt(rnd());
        const p = pal[(rnd() * pal.length) | 0], lit = 0.72 + 0.6 * clamp(u * 0.5 + 0.5);
        leaves.push(lx + q * Math.cos(th) * rr, ly + u * rr * 0.75, lz + q * Math.sin(th) * rr, p[0] * lit, p[1] * lit, p[2] * lit);
      }
    }
  }
  const trunk = new THREE.Mesh(mergeGeometries(trunks), tag(new THREE.MeshLambertMaterial({ color: '#5a4a3c' }), CLS.wood)); trunk.castShadow = true; scene.add(trunk);
  const g = new THREE.PlaneGeometry(0.3, 0.24), count = leaves.length / 6;
  const im = new THREE.InstancedMesh(g, tag(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), CLS.leaf, leafWind), count);
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    o.position.set(leaves[i * 6], leaves[i * 6 + 1], leaves[i * 6 + 2]); o.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    c.setRGB(leaves[i * 6 + 3], leaves[i * 6 + 4], leaves[i * 6 + 5]); im.setColorAt(i, c);
  }
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
}

// ---------- landmarks ----------
function buildFernsehturm(scene) {
  const concrete = [], steel = [];
  concrete.push(part(new THREE.CylinderGeometry(0.34, 0.95, 12, 18), '#d8d4cc', 0, 6, 0));          // the shaft
  concrete.push(part(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 12), '#d8d4cc', 0, 15.6, 0));       // above the sphere
  const pav = new THREE.CylinderGeometry(4.2, 4.6, 0.9, 6); concrete.push(part(pav, '#cfc8bb', 0, 0.45, 0)); // the folded pavilion
  steel.push(part(new THREE.SphereGeometry(1.75, 28, 20), '#aeb6bd', 0, 13.2, 0));                   // the sphere
  steel.push(part(new THREE.CylinderGeometry(1.0, 0.5, 0.5, 18), '#8e969c', 0, 11.4, 0));
  for (let i = 0; i < 7; i++) steel.push(part(new THREE.CylinderGeometry(0.1, 0.12, 0.62, 8), i % 2 ? '#f2efe8' : '#e8361c', 0, 17 + i * 0.62, 0)); // red and white antenna
  const cg = mergeGeometries(concrete); cg.computeVertexNormals();
  const sg = mergeGeometries(steel); sg.computeVertexNormals();
  const a = new THREE.Mesh(cg, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.tower));
  const b = new THREE.Mesh(sg, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.metal));
  // Drawn 1.6 times the scale of the city around it, so it rises over the city as it does over Berlin.
  for (const m of [a, b]) { m.position.set(TOWER.x, 0, TOWER.z); m.scale.setScalar(1.6); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}

function buildDom(scene) {
  const stone = [], copper = [];
  stone.push(part(new THREE.BoxGeometry(9, 3.4, 7), '#d9cdb4', 0, 1.7, 0));                           // the hall
  stone.push(part(new THREE.BoxGeometry(9.4, 0.25, 7.4), '#e6dcc6', 0, 3.45, 0));
  stone.push(part(new THREE.BoxGeometry(4, 4, 0.8), '#e1d6bf', 0, 2, 3.8));                           // the portico
  stone.push(part(new THREE.CylinderGeometry(2.1, 2.1, 1.6, 24), '#d9cdb4', 0, 4.3, 0));               // the drum
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    stone.push(part(new THREE.BoxGeometry(1.2, 5, 1.2), '#d3c7ae', sx * 3.9, 2.5, sz * 2.9));         // corner towers
    const cd = new THREE.SphereGeometry(0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2); copper.push(part(cd, '#6aa58e', sx * 3.9, 5, sz * 2.9));
  }
  const dome = new THREE.SphereGeometry(2.1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 1.35, 1); copper.push(part(dome, '#5f9c86', 0, 5.1, 0));
  copper.push(part(new THREE.CylinderGeometry(0.35, 0.4, 0.8, 10), '#5f9c86', 0, 8.3, 0));             // the lantern
  copper.push(part(new THREE.SphereGeometry(0.36, 10, 8), '#d7b04a', 0, 8.9, 0));
  copper.push(part(new THREE.BoxGeometry(0.1, 0.7, 0.1), '#d7b04a', 0, 9.5, 0));                      // the gilded cross
  copper.push(part(new THREE.BoxGeometry(0.4, 0.1, 0.1), '#d7b04a', 0, 9.6, 0));
  const sgeo = mergeGeometries(stone); sgeo.computeVertexNormals();
  const cgeo = mergeGeometries(copper); cgeo.computeVertexNormals();
  const a = new THREE.Mesh(sgeo, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.stone));
  const b = new THREE.Mesh(cgeo, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.metal));
  for (const m of [a, b]) { m.position.set(DOM.x, 0, DOM.z); m.rotation.y = 0.12; m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}

// Windows on every plaster wall, worked out from the world position so they cost no geometry:
// a grid of panes per floor, shop windows on the ground floor, a cornice line between floors.
// At night some of them light up.
function facadeWindows(s) {
  s.uniforms.uNight = night;
  s.vertexShader = 'varying vec3 vWorldP;\n' + s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  s.fragmentShader = 'varying vec3 vWorldP;\nuniform float uNight;\n' + s.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 fn = normalize(cross(dFdx(vWorldP), dFdy(vWorldP)));
      float glow = 0.;
      if (abs(fn.y) < .5) {
        vec2 g = vec2((abs(fn.x) > abs(fn.z) ? vWorldP.z : vWorldP.x) / 1.25, vWorldP.y / 1.6);
        vec2 f = fract(g), id = floor(g);
        float shop = step(g.y, 1.);
        float glass = step(.24, f.x) * step(f.x, .76) * step(mix(.32, .06, shop), f.y) * step(f.y, mix(.8, .86, shop));
        glow = glass * step(.55, fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453)) * uNight;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.12, .14, .17), glass * .8);
        diffuseColor.rgb *= 1. - .2 * step(f.y, .07) * (1. - shop);
      }`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1., .78, .45) * glow * 1.4;');
}

// Berlin blocks: cream and grey plaster, with zinc and tile roofs; a few Plattenbau. Three to
// five storeys: tall enough to feel like streets when walking, low enough that the view from above
// still sees the river and the landmarks over them.
const STOREYS = 2.0;
function buildBlocks(scene) {
  const walls = [], roofs = [];
  const tones = ['#e4d9c3', '#d6cbb5', '#cfc6b8', '#e8dfcf', '#c9bba3', '#b9b4ab'];
  const roofTones = ['#9a5a43', '#7c7f84', '#8c4b38', '#6d7177', '#a76a4c'];
  for (let gz = Z0 + 3; gz < Z1 - 2; gz += 6.4) for (let gx = X0 + 3; gx < X1 - 2; gx += 6.4) {
    const x = gx + (rnd() - 0.5) * 1.4, z = gz + (rnd() - 0.5) * 1.4;
    if (riverD(x, z) < RIVER_HALF + 6.5 || streetD(x, z) < 5 || park(x, z) || plaza(x, z) || Math.hypot(x - DOM.x, z - DOM.z) < 9.5 || lustgarten(x, z)) continue;
    const plattenbau = rnd() < 0.12, w = 4.4 + rnd() * 1.2, d = 4.2 + rnd() * 1.2, h = (plattenbau ? 5.5 + rnd() * 2 : 2.6 + rnd() * 1.4) * STOREYS;
    const a = rnd() * 0.12 - 0.06;
    obstacles.push({ x, z, c: Math.cos(a), s: Math.sin(a), hw: w / 2, hd: d / 2 });
    const wall = new THREE.BoxGeometry(w, h, d); wall.rotateY(a); walls.push(part(wall, plattenbau ? '#c4c2bc' : tones[(rnd() * tones.length) | 0], x, h / 2, z));
    if (plattenbau) { const r = new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1); r.rotateY(a); roofs.push(part(r, '#8b8d90', x, h + 0.06, z)); }
    else {                                                                              // a pitched roof
      const r = new THREE.CylinderGeometry(0.01, (Math.min(w, d) / 2) * 1.42, 1.1, 4, 1); r.rotateY(Math.PI / 4 + a); r.scale(w / Math.min(w, d), 1, d / Math.min(w, d));
      roofs.push(part(r, roofTones[(rnd() * roofTones.length) | 0], x, h + 0.55, z));
    }
  }
  const wg = mergeGeometries(walls); wg.computeVertexNormals();
  const rg = mergeGeometries(roofs); rg.computeVertexNormals();
  const a = new THREE.Mesh(wg, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.wall, facadeWindows));
  // Roofs catch the light from above: colour them strongly so they read from a steep camera.
  const b = new THREE.Mesh(rg, tag(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), CLS.roof));
  for (const m of [a, b]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}

// The embankment walls, the bridge with its arches and parapets.
function buildEmbankment(scene) {
  const parts = [];
  const step = 0.6;
  for (const side of [-1, 1]) for (let u = 0; u < 1; u += step / river.getLength()) {
    const p = river.getPointAt(u), t = river.getTangentAt(u);
    const x = p.x - t.z * side * (RIVER_HALF + 0.12), z = p.z + t.x * side * (RIVER_HALF + 0.12);
    if (x < X0 || x > X1 || z < Z0 || z > Z1) continue;
    const g = new THREE.BoxGeometry(step + 0.02, 1.05, 0.28); g.rotateY(-Math.atan2(t.z, t.x)); parts.push(part(g, '#b9b2a4', x, -0.5, z));
  }
  const angle = Math.atan2(STREET.x, STREET.y);
  const deck = new THREE.BoxGeometry(4.4, 0.35, RIVER_HALF * 2 + 3); deck.rotateY(angle); parts.push(part(deck, '#c8c0b0', BRIDGE.x, -0.12, BRIDGE.z));
  for (const s of [-1, 1]) {
    const par = new THREE.BoxGeometry(0.25, 0.55, RIVER_HALF * 2 + 3); par.translate(s * 2.1, 0.25, 0); par.rotateY(angle); parts.push(part(par, '#d6cfc0', BRIDGE.x, 0, BRIDGE.z));
  }
  for (const s of [-1.2, 1.2]) {                                                       // piers in the water
    const pier = new THREE.BoxGeometry(4.6, 0.8, 0.9); pier.translate(0, -0.65, s); pier.rotateY(angle); parts.push(part(pier, '#a9a193', BRIDGE.x, 0, BRIDGE.z));
  }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  const m = new THREE.Mesh(g, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.stone)); m.castShadow = true; m.receiveShadow = true; scene.add(m);
}

// Street lamps along the promenades, spaced about their own width apart.
const lampGlow = new THREE.MeshLambertMaterial({ color: '#2a2620', emissive: '#ffd28a', emissiveIntensity: 0 });
const obstaclePosts = posts;
function buildLamps(scene) {
  const posts = [], heads = [];
  for (const side of [-1, 1]) for (let u = 0.0036; u < 1; u += 0.0072) {
    const p = river.getPointAt(u), t = river.getTangentAt(u), x = p.x - t.z * side * (RIVER_HALF + 1.0), z = p.z + t.x * side * (RIVER_HALF + 1.0);
    if (x < X0 + 1 || x > X1 - 1 || z < Z0 + 1 || z > Z1 - 1 || streetD(x, z) < 2.6) continue;
    posts.push(part(new THREE.CylinderGeometry(0.05, 0.08, 1.7, 6), '#2f3333', x, 0.85, z));
    obstaclePosts.push({ x, z, r: 0.12 });
    heads.push(part(new THREE.SphereGeometry(0.17, 8, 6), '#f5ecd8', x, 1.78, z));
  }
  const pg = mergeGeometries(posts); pg.computeVertexNormals();
  const hg = mergeGeometries(heads); hg.computeVertexNormals();
  const a = new THREE.Mesh(pg, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.metal)); a.castShadow = true;
  const b = new THREE.Mesh(hg, tag(lampGlow, CLS.foam));
  scene.add(a, b);
}

// Benches on the promenades, between the lamps, facing the water.
function buildBenches(scene) {
  const parts = [];
  for (const side of [-1, 1]) for (let u = 0.0072; u < 1; u += 0.0144) {
    const p = river.getPointAt(u), t = river.getTangentAt(u), off = RIVER_HALF + 1.35;
    const x = p.x - t.z * side * off, z = p.z + t.x * side * off;
    if (x < X0 + 1 || x > X1 - 1 || z < Z0 + 1 || z > Z1 - 1 || streetD(x, z) < 3) continue;
    const a = -Math.atan2(t.z, t.x);
    const bench = [
      part(new THREE.BoxGeometry(1.1, 0.07, 0.34), '#7a5a3e', 0, 0.25, 0),
      part(new THREE.BoxGeometry(1.1, 0.28, 0.05), '#7a5a3e', 0, 0.45, side * 0.17),
      part(new THREE.BoxGeometry(0.06, 0.24, 0.3), '#2f3333', -0.48, 0.12, 0),
      part(new THREE.BoxGeometry(0.06, 0.24, 0.3), '#2f3333', 0.48, 0.12, 0),
    ];
    for (const g of bench) { g.rotateY(a); g.translate(x, 0, z); parts.push(g); }
    obstacles.push({ x, z, c: Math.cos(a), s: Math.sin(a), hw: 0.55, hd: 0.2 });
  }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  const m = new THREE.Mesh(g, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.wood)); m.castShadow = true; m.receiveShadow = true; scene.add(m);
}

// ---------- what moves ----------
function buildTram() {
  const parts = [];
  for (const k of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(1.0, 0.95, 3.2), '#f4c20d', 0, 0.62, k * 1.68));            // BVG yellow
    parts.push(part(new THREE.BoxGeometry(1.02, 0.3, 3.0), '#3b3b38', 0, 0.85, k * 1.68));            // the window band
    parts.push(part(new THREE.BoxGeometry(0.9, 0.08, 3.0), '#dcdad2', 0, 1.13, k * 1.68));            // the roof
  }
  parts.push(part(new THREE.BoxGeometry(0.04, 0.5, 0.6), '#333', 0, 1.42, 0.6));                     // pantograph
  const g = mergeGeometries(parts); g.computeVertexNormals();
  const m = new THREE.Mesh(g, tag(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a2a00', emissiveIntensity: 0.35 }), CLS.tram));
  m.castShadow = true; return m;
}
function buildBoat() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(5.2, 0.55, 1.4), '#f1eee6', 0, 0.1, 0));
  parts.push(part(new THREE.BoxGeometry(3.6, 0.45, 1.15), '#26323a', -0.2, 0.55, 0));               // the glass cabin
  parts.push(part(new THREE.BoxGeometry(3.7, 0.08, 1.2), '#f1eee6', -0.2, 0.82, 0));
  parts.push(part(new THREE.BoxGeometry(0.5, 0.35, 0.5), '#d23a2a', 1.9, 0.52, 0));                 // the wheelhouse
  const g = mergeGeometries(parts); g.computeVertexNormals();
  const m = new THREE.Mesh(g, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.boat)); m.castShadow = true;
  return m;
}
function buildPeople(scene, n) {
  const body = new THREE.CapsuleGeometry(0.15, 0.42, 3, 8); body.translate(0, 0.38, 0);
  const head = new THREE.SphereGeometry(0.12, 8, 6); head.translate(0, 0.82, 0);
  const g = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()].map((x) => { x.deleteAttribute('uv'); return x; }));
  const im = new THREE.InstancedMesh(g, tag(new THREE.MeshBasicMaterial(), CLS.person), n);
  const coats = ['#2d3a4a', '#7a2f2a', '#3d4a35', '#1f1f22', '#a8743a', '#5a3d5c', '#d9d2c3'];
  const c = new THREE.Color();
  const walkers = Array.from({ length: n }, (_, i) => ({ u0: rnd(), speed: (0.0022 + rnd() * 0.0016) * (i % 2 ? 1 : -1), side: rnd() < 0.5 ? -1 : 1, lane: RIVER_HALF + 1.6 + rnd() * 1.3, phase: rnd() * 6 }));
  walkers.forEach((_, i) => { c.set(coats[i % coats.length]).multiplyScalar(1.2); im.setColorAt(i, c); });
  scene.add(im);
  return { im, walkers };
}

/** True where a walker of radius r can't stand: off the map, in the Spree (except on the
 * bridge), or inside a building, a tree, a lamp, a bench, the Dom or the Fernsehturm. */
export function blocked(x, z, r = 0.3) {
  if (x < X0 + 2 || x > X1 - 2 || z < Z0 + 2 || z > Z1 - 2) return true;
  if (riverD(x, z) < RIVER_HALF + 0.35) {
    const along = (x - BRIDGE.x) * STREET.x + (z - BRIDGE.z) * STREET.y;
    if (!(streetD(x, z) < 1.9 && Math.abs(along) < RIVER_HALF + 1.6)) return true;
  }
  for (const o of obstacles) {
    const dx = x - o.x, dz = z - o.z;
    if (Math.abs(o.c * dx - o.s * dz) < o.hw + r && Math.abs(o.s * dx + o.c * dz) < o.hd + r) return true;
  }
  for (const p of posts) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + r) ** 2) return true;
  return false;
}

/**
 * Builds Berlin into the scene: the same city from above and on foot.
 * Returns the sun, `light(clock, focus)` to set Berlin's light around a point, and
 * `update(t)` to move the tram, the boat, the walkers and the falling leaves.
 */
export function createBerlin(scene) {
  const sun = new THREE.DirectionalLight('#ffe7c4', 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 5, far: 220 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  const sky = new THREE.HemisphereLight('#efe6d8', '#6d6236', 1.0);
  scene.add(sun, sun.target, sky);

  scene.add(buildGround(), buildRiver());
  buildGrass(scene); buildFlowers(scene); buildTrees(scene);
  buildFernsehturm(scene); buildDom(scene); buildBlocks(scene); buildEmbankment(scene); buildLamps(scene); buildBenches(scene);
  posts.push({ x: TOWER.x, z: TOWER.z, r: 7.4 });                                         // the pavilion
  obstacles.push({ x: DOM.x, z: DOM.z + 0.3, c: Math.cos(0.12), s: Math.sin(0.12), hw: 4.8, hd: 4.3 });
  const tram = buildTram(); scene.add(tram);
  const boat = buildBoat(); scene.add(boat);
  const { im: people, walkers } = buildPeople(scene, 30);

  // Falling lime leaves, around wherever the light is focused.
  const fall = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.1), tag(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.0, 0.35), side: THREE.DoubleSide }), CLS.flower), 160);
  scene.add(fall);
  const fallS = Array.from({ length: 160 }, () => [rnd(), rnd(), rnd(), rnd()]);
  const focus = new THREE.Vector3(-1, 0, 0);

  // Berlin's light: the sun's real direction by day, kept high enough to light the streets;
  // the moon, the sky, the street lamps and the windows by night. Shadows follow the focus.
  function light(clock, at = focus) {
    focus.copy(at);
    const [lx, ly, lz] = clock.light;
    const up = Math.max(ly, 0.55);
    const flat = Math.hypot(lx, lz) || 1, k = Math.sqrt(1 - up * up) / flat;
    sun.target.position.set(at.x, 0, at.z);
    sun.position.set(at.x + lx * k * 60, up * 60, at.z + lz * k * 60);
    const day = clock.day;
    night.value = 1 - day;
    sun.intensity = 1.2 + 2.1 * day;
    sun.color.set(day > 0.5 ? '#ffe7c4' : '#9fb4ff');
    sky.intensity = 0.7 + 0.3 * day;
    sky.color.set(day > 0.5 ? '#efe6d8' : '#5a6b9a');
    lampGlow.emissiveIntensity = 2.2 * (1 - day);
  }

  const dummy = new THREE.Object3D();
  const riverLen = river.getLength();
  function update(t) {
    time.value = t;
    // The tram crosses every 26 s, from one end of the street to the other.
    const s = -70 + fract(t / 26) * 140, [tx, tz] = streetAt(s);
    tram.position.set(tx, 0, tz); tram.rotation.y = Math.atan2(STREET.x, STREET.y);
    // The tour boat goes downstream, every 70 s.
    const bu = fract(t / 70), bp = river.getPointAt(bu), bt = river.getTangentAt(bu);
    boat.position.set(bp.x + bt.z, WATER_Y + 0.05 + Math.sin(t * 1.3) * 0.03, bp.z - bt.x);
    boat.rotation.y = -Math.atan2(bt.z, bt.x);
    // People step along the promenades.
    walkers.forEach((w, i) => {
      const u = fract(w.u0 + t * w.speed * 60 / riverLen), p = river.getPointAt(u), tg = river.getTangentAt(u);
      const x = p.x - tg.z * w.side * w.lane, z = p.z + tg.x * w.side * w.lane;
      dummy.position.set(x, Math.abs(Math.sin(t * 6 + w.phase)) * 0.05, z);
      dummy.rotation.set(0, -Math.atan2(tg.z, tg.x) * (w.speed > 0 ? 1 : -1), 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      people.setMatrixAt(i, dummy.matrix);
    });
    people.instanceMatrix.needsUpdate = true;
    fallS.forEach((f, i) => {
      const k = fract(f[0] + t * (0.012 + f[3] * 0.01));
      const x = focus.x - 25 + k * 50 + Math.sin(t * 0.6 + f[1] * 9) * 0.6, z = focus.z - 18 + f[2] * 36;
      dummy.position.set(x, 0.5 + f[1] * 5 + Math.sin(t * 0.9 + f[3] * 12) * 0.35, z);
      dummy.rotation.set(t + f[0] * 9, t * 0.7, f[1]); dummy.scale.setScalar(0.8 + f[3] * 0.8); dummy.updateMatrix(); fall.setMatrixAt(i, dummy.matrix);
    });
    fall.instanceMatrix.needsUpdate = true;
  }

  return { sun, light, update };
}
