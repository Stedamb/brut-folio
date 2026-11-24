// Berlin in miniature, drawn as coloured ASCII and seen through a long lens from high above,
// with tilt-shift blur. Prototype for the homepage hero, adapted from the ascii-diorama skill.
//
// The Spree runs diagonally through the view. The Fernsehturm stands on the near bank, the
// Berliner Dom and the Lustgarten on the far one, lime trees in their November gold line the
// promenades, and a yellow tram crosses the bridge. A tour boat, people walking and falling
// leaves keep it alive. The sun is Berlin's own: its real direction by day, the moon and the
// street lamps by night. `?hour=<0-24>` previews another time of day.
//
// Three passes: the 3D scene into a half-float target (colour, and a glyph class in alpha),
// the glyph pass that turns each cell into a coloured character, and the tilt-shift pass.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { berlinTime, skyClock } from '../../lib/berlin-sky';

const CELL_W = 6, CELL_H = 12, DURATION = 30; // glyph cell in pixels; one camera sweep in seconds
const CLS = { grass: 1, leaf: 2, flower: 3, stone: 4, paving: 5, tower: 6, metal: 7, roof: 8, water: 9, foam: 10, person: 11, tram: 12, boat: 13, wood: 14, wall: 15 };

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const fract = (x) => x - Math.floor(x);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
  return (hash2(i, j) * (1 - u) + hash2(i + 1, j) * u) * (1 - v) + (hash2(i, j + 1) * (1 - u) + hash2(i + 1, j + 1) * u) * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.1 + 3, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3 + 5) * 0.15 + vnoise(x * 8.7, y * 8.7) * 0.07;
let seed = 1989; // the Wall came down
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const time = { value: 0 };
const night = { value: 0 };

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
const river = new THREE.CatmullRomCurve3(RIVER.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5);
const riverPts = river.getSpacedPoints(600);
const RIVER_HALF = 3.6; // water to the wall
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

const TOWER = { x: 11, z: 9.5 };
const DOM = { x: -13, z: -5 };
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
  // Drawn 1.6 times the scale of the city around it, so it rises over the miniature as it does over Berlin.
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

// Berlin blocks: cream and grey plaster, with zinc and tile roofs; a few Plattenbau.
function buildBlocks(scene) {
  const walls = [], roofs = [];
  const tones = ['#e4d9c3', '#d6cbb5', '#cfc6b8', '#e8dfcf', '#c9bba3', '#b9b4ab'];
  const roofTones = ['#9a5a43', '#7c7f84', '#8c4b38', '#6d7177', '#a76a4c'];
  for (let gz = Z0 + 3; gz < Z1 - 2; gz += 6.4) for (let gx = X0 + 3; gx < X1 - 2; gx += 6.4) {
    const x = gx + (rnd() - 0.5) * 1.4, z = gz + (rnd() - 0.5) * 1.4;
    if (riverD(x, z) < RIVER_HALF + 6.5 || streetD(x, z) < 5 || park(x, z) || plaza(x, z) || Math.hypot(x - DOM.x, z - DOM.z) < 9.5 || lustgarten(x, z)) continue;
    const plattenbau = rnd() < 0.12, w = 4.4 + rnd() * 1.2, d = 4.2 + rnd() * 1.2, h = plattenbau ? 5.5 + rnd() * 2 : 2.6 + rnd() * 1.4;
    const a = rnd() * 0.12 - 0.06;
    const wall = new THREE.BoxGeometry(w, h, d); wall.rotateY(a); walls.push(part(wall, plattenbau ? '#c4c2bc' : tones[(rnd() * tones.length) | 0], x, h / 2, z));
    if (plattenbau) { const r = new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1); r.rotateY(a); roofs.push(part(r, '#8b8d90', x, h + 0.06, z)); }
    else {                                                                              // a pitched roof
      const r = new THREE.CylinderGeometry(0.01, (Math.min(w, d) / 2) * 1.42, 1.1, 4, 1); r.rotateY(Math.PI / 4 + a); r.scale(w / Math.min(w, d), 1, d / Math.min(w, d));
      roofs.push(part(r, roofTones[(rnd() * roofTones.length) | 0], x, h + 0.55, z));
    }
  }
  const wg = mergeGeometries(walls); wg.computeVertexNormals();
  const rg = mergeGeometries(roofs); rg.computeVertexNormals();
  const a = new THREE.Mesh(wg, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.wall));
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
function buildLamps(scene) {
  const posts = [], heads = [];
  for (const side of [-1, 1]) for (let u = 0.0036; u < 1; u += 0.0072) {
    const p = river.getPointAt(u), t = river.getTangentAt(u), x = p.x - t.z * side * (RIVER_HALF + 1.0), z = p.z + t.x * side * (RIVER_HALF + 1.0);
    if (x < X0 + 1 || x > X1 - 1 || z < Z0 + 1 || z > Z1 - 1 || streetD(x, z) < 2.6) continue;
    posts.push(part(new THREE.CylinderGeometry(0.05, 0.08, 1.7, 6), '#2f3333', x, 0.85, z));
    heads.push(part(new THREE.SphereGeometry(0.17, 8, 6), '#f5ecd8', x, 1.78, z));
  }
  const pg = mergeGeometries(posts); pg.computeVertexNormals();
  const hg = mergeGeometries(heads); hg.computeVertexNormals();
  const a = new THREE.Mesh(pg, tag(new THREE.MeshLambertMaterial({ vertexColors: true }), CLS.metal)); a.castShadow = true;
  const b = new THREE.Mesh(hg, tag(lampGlow, CLS.foam));
  scene.add(a, b);
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

// ---------- ascii + tilt shift ----------
const GLYPHS = " .'`,:;-~=+*oOsS$%&8#@/\\|_^v\u2014";
const GI = Object.fromEntries([...GLYPHS].map((c, i) => [c, i]));
const gg = (c) => GI[c].toFixed(1);
function buildAtlas() {
  const tw = 64, th = 120, c = document.createElement('canvas');
  c.width = tw * GLYPHS.length; c.height = th;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 100px Menlo, Monaco, monospace';
  [...GLYPHS].forEach((ch, i) => { if (ch === '\u2014') x.fillRect(i * tw, th * 0.44, tw, th * 0.12); else x.fillText(ch, (i + 0.5) * tw, th * 0.52); });
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.flipY = false;
  return t;
}
const asciiFrag = /* glsl */`
precision highp float;
uniform sampler2D uScene, uAtlas; uniform vec2 uGrid; uniform float uTime, uN; uniform vec3 uPaper; uniform float uLightMode;
in vec2 vUv; out vec4 outColor;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float lum(vec3 c){ return dot(c,vec3(.25,.6,.15)); }
vec3 grade(vec3 c){
  c = max(c,0.); c = c/(1.+c*.12); c = pow(c,vec3(1./2.2));
  c = mix(c,c*c*(3.-2.*c),.5);
  float l = lum(c); c = mix(vec3(l),c,1.28);
  return clamp(c,0.,1.);
}
void main(){
  vec2 g = vUv*uGrid, cell = floor(g), cuv = (cell+.5)/uGrid;
  ivec2 sz = textureSize(uScene,0);
  float lodC = log2(float(sz.y)/uGrid.y)+.05;
  vec3 col = grade(textureLod(uScene,cuv,lodC).rgb);
  float cls = floor(texelFetch(uScene,ivec2(cuv*vec2(sz)),0).a*16.+.5);
  float L = lum(col);
  vec2 e = 1./uGrid;
  float lx0=lum(grade(textureLod(uScene,cuv-vec2(e.x,0),lodC).rgb)), lx1=lum(grade(textureLod(uScene,cuv+vec2(e.x,0),lodC).rgb));
  float ly0=lum(grade(textureLod(uScene,cuv-vec2(0,e.y),lodC).rgb)), ly1=lum(grade(textureLod(uScene,cuv+vec2(0,e.y),lodC).rgb));
  vec2 grad = vec2(lx1-lx0,(ly1-ly0)*.55); float mag = length(grad);
  float a4 = mod(atan(grad.y,grad.x)+.3927,3.14159)/.7854;
  float edgeG = a4<1.?${gg('|')}:a4<2.?${gg('\\')}:a4<3.?${gg('\u2014')}:${gg('/')};
  float w = vn(cell*vec2(.05,.09)+vec2(-uTime*.28,uTime*.07))*2.-1.;
  float gl = ${gg('.')};
  if(cls<.5){         // the sky: plain paper, as on the rest of the site
    outColor = vec4(uPaper,1.); return;
  } else if(cls<1.5){ // grass, leaning with the wind
    gl = L<.1?${gg('.')}:L<.17?${gg(':')}:(w<-.2?${gg('\\')}:w>.2?${gg('/')}:${gg('|')});
  } else if(cls<2.5){ // leaves
    gl = L<.12?${gg('.')}:L<.24?${gg(':')}:L<.38?${gg('*')}:L<.5?${gg('+')}:${gg('o')};
  } else if(cls<3.5){ // flowers
    gl = L<.34?${gg(':')}:L<.55?${gg('*')}:L<.76?${gg('%')}:${gg('#')};
  } else if(cls<4.5){ // stone: the embankment, the bridge, the Dom
    gl = L<.18?${gg(':')}:L<.34?${gg('=')}:L<.55?${gg('#')}:${gg('\u2014')};
    if(mag>.16) gl = edgeG;
  } else if(cls<5.5){ // paving and asphalt
    gl = L<.16?${gg('.')}:L<.3?${gg(',')}:L<.48?${gg(':')}:L<.66?${gg('=')}:${gg('\u2014')};
    if(mag>.22) gl = edgeG;
  } else if(cls<6.5){ // the tower's concrete
    gl = L<.2?${gg(':')}:L<.42?${gg('|')}:${gg('#')};
    if(mag>.14) gl = edgeG;
  } else if(cls<7.5){ // steel and copper
    gl = L<.2?${gg(':')}:L<.38?${gg('o')}:L<.6?${gg('O')}:${gg('@')};
  } else if(cls<8.5){ // roofs
    gl = L<.18?${gg(':')}:L<.32?${gg('=')}:L<.5?${gg('^')}:${gg('#')};
    if(mag>.2) gl = edgeG;
  } else if(cls<9.5){ // the Spree
    gl = L<.16?${gg('-')}:L<.3?(w>0.?${gg('~')}:${gg('-')}):L<.5?${gg('~')}:${gg('=')};
  } else if(cls<10.5){ // ripples on the walls, lamp light
    gl = L<.6?${gg('*')}:L<.82?${gg('%')}:${gg('#')};
  } else if(cls<11.5){ // people
    gl = L<.3?${gg('&')}:${gg('$')};
  } else if(cls<12.5){ // the tram
    gl = L<.3?${gg('=')}:L<.6?${gg('8')}:${gg('#')};
    if(mag>.25) gl = edgeG;
  } else if(cls<13.5){ // the boat
    gl = L<.25?${gg('=')}:L<.6?${gg('S')}:${gg('#')};
  } else if(cls<14.5){ // wood
    gl = L<.14?${gg(':')}:(mag>.1?edgeG:(L<.34?${gg('|')}:${gg('#')}));
  } else {            // plaster walls
    gl = L<.16?${gg(':')}:L<.32?${gg('|')}:L<.52?${gg('=')}:${gg('#')};
    if(mag>.18) gl = edgeG;
  }
  vec2 gv = g-cell, dx = dFdx(g), dy = dFdy(g);
  float ink = smoothstep(.12,.78,textureGrad(uAtlas,vec2((gl+gv.x)/uN,1.-gv.y),dx/uN,dy).r);
  vec3 blur = grade(textureLod(uScene,vUv,lodC+1.2).rgb);
  if(uLightMode>.5){
    // Light mode: each cell is painted in the scene's own colour, lifted and saturated, and its
    // glyph prints in a deeper shade of the same hue, like coloured type on tinted paper.
    float l = lum(col);
    vec3 vivid = clamp(mix(vec3(l),col,1.35),0.,1.);
    vec3 cellBg = mix(vivid,vec3(1.),.18)*1.08+.04;
    vec3 glyph = vivid*vivid*.62;
    outColor = vec4(mix(mix(cellBg,blur*1.1+.06,.35),glyph,ink*.95),1.);
  } else {
    float bg = cls>4.5 && cls<5.5 ? .42 : .3;                       // big bright paving stays light
    outColor = vec4(mix(blur*bg,col*1.4+.02,ink),1.);
  }
}`;
const tiltFrag = /* glsl */`
precision highp float;
uniform sampler2D uA; uniform vec2 uRes;
in vec2 vUv; out vec4 outColor;
void main(){
  float dy = abs(vUv.y-.46);
  float r = pow(smoothstep(.25,.6,dy),1.6)*28.;
  if(r<.2){ outColor = vec4(texture(uA,vUv).rgb,1.); return; }
  vec3 c = vec3(0.);
  float lod = max(log2(r/4.),0.);
  for(int i=0;i<36;i++){
    float t = float(i)+.5, a = t*2.39996, rr = sqrt(t/36.)*r;
    c += textureLod(uA,vUv+vec2(cos(a),sin(a))*rr/uRes,lod).rgb;
  }
  outColor = vec4(c/36.,1.);
}`;

export async function initDiorama(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#ffe7c4', 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 5, far: 220 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  const sky = new THREE.HemisphereLight('#efe6d8', '#6d6236', 1.0);
  scene.add(sun, sun.target, sky);

  scene.add(buildGround(), buildRiver());
  buildGrass(scene); buildFlowers(scene); buildTrees(scene);
  buildFernsehturm(scene); buildDom(scene); buildBlocks(scene); buildEmbankment(scene); buildLamps(scene);
  const tram = buildTram(); scene.add(tram);
  const boat = buildBoat(); scene.add(boat);
  const { im: people, walkers } = buildPeople(scene, 14);

  // Falling lime leaves.
  const fall = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.1), tag(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.0, 0.35), side: THREE.DoubleSide }), CLS.flower), 160);
  scene.add(fall);
  const fallS = Array.from({ length: 160 }, () => [rnd(), rnd(), rnd(), rnd()]);

  const camera = new THREE.PerspectiveCamera(23, 1, 5, 400);
  const TARGET = new THREE.Vector3(TOWER.x - 5, 12, TOWER.z - 7);
  function placeCamera(t) {
    // An eased sweep there and back, so the loop never jumps.
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t / DURATION);
    const az = THREE.MathUtils.degToRad(-7 + 14 * k), el = THREE.MathUtils.degToRad(30 + 1.4 * Math.sin(k * Math.PI)), R = 104 - 3 * k;
    camera.position.set(TARGET.x + Math.sin(az) * Math.cos(el) * R, TARGET.y + Math.sin(el) * R, TARGET.z + Math.cos(az) * Math.cos(el) * R);
    camera.lookAt(TARGET); camera.updateMatrixWorld();
  }

  let W = 0, HH = 0, rt, art;
  const atlas = buildAtlas();
  const vtx = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
  const ascii = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: asciiFrag, depthTest: false, depthWrite: false,
    uniforms: { uScene: { value: null }, uAtlas: { value: atlas }, uGrid: { value: new THREE.Vector2() }, uTime: time, uN: { value: GLYPHS.length }, uPaper: { value: new THREE.Vector3(0.96, 0.96, 0.96) }, uLightMode: { value: 1 } } });
  const tilt = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: tiltFrag, depthTest: false, depthWrite: false,
    uniforms: { uA: { value: null }, uRes: { value: new THREE.Vector2() } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ascii); quad.frustumCulled = false;
  const post = new THREE.Scene(); post.add(quad); const postCam = new THREE.Camera();

  function resize() {
    W = Math.max(1, host.clientWidth); HH = Math.max(1, host.clientHeight);
    renderer.setSize(W, HH, false);
    camera.aspect = W / HH; camera.updateProjectionMatrix();
    TARGET.x = W / HH < 1 ? TOWER.x - 1 : TOWER.x - 5;                                  // portrait: the tower in the middle
    rt?.dispose(); art?.dispose();
    rt = new THREE.WebGLRenderTarget(W, HH, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    art = new THREE.WebGLRenderTarget(W, HH, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    ascii.uniforms.uScene.value = rt.texture;
    ascii.uniforms.uGrid.value.set(Math.floor(W / CELL_W), Math.floor(HH / CELL_H));
    tilt.uniforms.uA.value = art.texture;
    tilt.uniforms.uRes.value.set(W, HH);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  // Berlin's light: the sun's real direction by day, kept high enough to light the streets;
  // the moon, the sky and the street lamps by night.
  const params = new URLSearchParams(location.search);
  const hour = params.get('hour');
  const raw = params.has('raw'); // the 3D scene without glyphs, for building it
  ascii.uniforms.uLightMode.value = params.has('light') ? 1 : 0; // glyphs on dark by default; ?light for coloured cells on light
  const now = () => (hour !== null && Number(hour) >= 0 && Number(hour) <= 24 ? berlinTime(Number(hour)) : new Date());
  function light() {
    const clock = skyClock(now());
    const [lx, ly, lz] = clock.light;
    const up = Math.max(ly, 0.55);
    const flat = Math.hypot(lx, lz) || 1, s = Math.sqrt(1 - up * up) / flat;
    sun.position.set(lx * s * 60, up * 60, lz * s * 60); sun.target.position.set(0, 0, 0);
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
  function drawFrame(t) {
    time.value = t; placeCamera(t);
    // The tram crosses every 26 s, off screen to off screen.
    const s = -70 + fract(t / 26) * 140, [tx, tz] = streetAt(s);
    tram.position.set(tx, 0, tz); tram.rotation.y = Math.atan2(STREET.x, STREET.y);
    // The tour boat goes downstream, every 70 s.
    const bu = fract(t / 70), bp = river.getPointAt(bu), bt = river.getTangentAt(bu);
    const off = -1.0;
    boat.position.set(bp.x - bt.z * off, WATER_Y + 0.05 + Math.sin(t * 1.3) * 0.03, bp.z + bt.x * off);
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
      const x = -24 + k * 50 + Math.sin(t * 0.6 + f[1] * 9) * 0.6, z = -18 + f[2] * 36;
      dummy.position.set(x, 0.5 + f[1] * 5 + Math.sin(t * 0.9 + f[3] * 12) * 0.35, z);
      dummy.rotation.set(t + f[0] * 9, t * 0.7, f[1]); dummy.scale.setScalar(0.8 + f[3] * 0.8); dummy.updateMatrix(); fall.setMatrixAt(i, dummy.matrix);
    });
    fall.instanceMatrix.needsUpdate = true;

    if (raw) { renderer.setRenderTarget(null); renderer.setClearColor(0x87a0b0, 1); renderer.clear(); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    quad.material = ascii; renderer.setRenderTarget(art); renderer.render(post, postCam);
    quad.material = tilt; renderer.setRenderTarget(null); renderer.render(post, postCam);
  }

  let paused = false, clock = 0, last = performance.now(), lit = -1;
  addEventListener('keydown', (e) => { if (e.code === 'Space') { paused = !paused; e.preventDefault(); } });
  const loop = (now) => {
    if (!paused) clock += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (Math.floor(clock / 60) !== lit) { lit = Math.floor(clock / 60); light(); } // the sun moves
    if (!paused) drawFrame(clock); // paused, the last frame stays
    requestAnimationFrame(loop);
  };
  light();
  requestAnimationFrame(loop);
}
