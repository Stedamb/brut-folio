// Berlin 3D, in coloured ASCII: one city, seen two ways. It opens seen from high above
// through a long tilt-shift lens; press E (or the button) and the camera
// swoops down to the Spree's promenade to walk the same streets at eye level. Esc flies back up.
//
// The city and its life come from berlin.js, the glyph and tilt-shift passes from ascii.js.
// Walking: click to look around with the mouse (Esc lets go), WASD or the arrows to walk,
// Shift to hurry; on touch, drag on the left half to walk and on the right half to look.
// R shows the plain 3D scene. `?hour=<0-24>` previews another time, `?walk` opens on foot,
// `?at=x,z,heading` starts the walk elsewhere, `?light` prints coloured cells on a light
// ground, and Space pauses the view from above.

import * as THREE from 'three';
import { berlinTime, skyClock } from '../../lib/berlin-sky';
import { RIVER_HALF, TOWER, blocked, createBerlin, river, time } from './berlin.js';
import { GLYPHS, asciiFrag, buildAtlas, tiltFrag } from './ascii.js';

const DURATION = 30; // one sweep of the view from above, in seconds
const EYE = 0.85, RADIUS = 0.3, WALK = 2.4, RUN = 5.2; // units are about 1.9 m; speeds per second
const LOOK = 0.0022;
const FLIGHT = 3.2; // seconds to fly down to the street, or back up

const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);

/**
 * `onMode` hears 'above', 'flying' and 'walk', so the page can show the right controls.
 * @param {HTMLElement} host
 * @param {{ onMode?: (mode: string) => void }} [options]
 */
export async function initBerlin(host, { onMode = (_mode) => {} } = {}) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  // Small glyphs, drawn at the screen's own resolution: 4×8 on high-density screens, 5×10 otherwise.
  const CELL_W = dpr >= 2 ? 4 : 5, CELL_H = CELL_W * 2;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });

  const scene = new THREE.Scene();
  const fog = new THREE.Fog('#d9d3c7', 45, 170);                                            // the far city fades, on foot
  const berlin = createBerlin(scene);
  const camera = new THREE.PerspectiveCamera(23, 1, 5, 400);
  camera.rotation.order = 'YXZ';

  // --- the view from above: an eased sweep there and back, so the loop never jumps ---
  const TARGET = new THREE.Vector3(TOWER.x - 5, 12, TOWER.z - 7);
  const dio = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const aim = new THREE.PerspectiveCamera(); // a camera's lookAt faces -z, as the view does
  function abovePose(t) {
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t / DURATION);
    const az = THREE.MathUtils.degToRad(-7 + 14 * k), el = THREE.MathUtils.degToRad(30 + 1.4 * Math.sin(k * Math.PI)), R = 104 - 3 * k;
    dio.pos.set(TARGET.x + Math.sin(az) * Math.cos(el) * R, TARGET.y + Math.sin(el) * R, TARGET.z + Math.cos(az) * Math.cos(el) * R);
    aim.position.copy(dio.pos); aim.lookAt(TARGET); dio.quat.copy(aim.quaternion);
  }

  // --- the walker: at the railing on the Dom's bank, upstream of the bridge, between two lamps,
  // facing the Fernsehturm across the Spree; or wherever ?at= says ---
  const p0 = river.getPointAt(0.3), t0 = river.getTangentAt(0.3), off = RIVER_HALF + 0.55;
  const x0 = p0.x + t0.z * off, z0 = p0.z - t0.x * off;
  const player = { x: x0, z: z0, yaw: Math.atan2(TOWER.x - x0, -(TOWER.z - z0)), pitch: 0.22, bob: 0 };
  const params = new URLSearchParams(location.search);
  const at = params.get('at')?.split(',').map(Number);
  if (at && at.length >= 2 && at.every(Number.isFinite)) {
    player.x = at[0]; player.z = at[1];
    if (at.length > 2) player.yaw = (at[2] * Math.PI) / 180;
  }
  const sx = player.x, sz = player.z;
  for (let i = 0; blocked(player.x, player.z, RADIUS) && i < 400; i++) {                 // step out of anything in the way
    player.x = sx + Math.cos(i * 0.7) * i * 0.05; player.z = sz + Math.sin(i * 0.7) * i * 0.05;
  }
  const walker = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function walkerPose() {
    walker.pos.set(player.x, EYE + Math.sin(player.bob) * 0.025, player.z);
    walker.quat.setFromEuler(euler.set(player.pitch, -player.yaw, 0));
  }

  // --- modes: 0 is the view from above, 1 is on foot; the flight eases between them ---
  let blend = params.has('walk') ? 1 : 0, want = blend;
  let mode = '';
  const setMode = (next) => { if (next !== mode) { mode = next; onMode(mode); } };
  const enter = () => { want = 1; };
  const leave = () => { want = 0; if (document.pointerLockElement) document.exitPointerLock(); };

  // --- passes ---
  let rt, art;
  const vtx = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
  const ascii = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: asciiFrag, depthTest: false, depthWrite: false,
    uniforms: { uScene: { value: null }, uAtlas: { value: buildAtlas() }, uGrid: { value: new THREE.Vector2() }, uTime: time, uN: { value: GLYPHS.length }, uPaper: { value: new THREE.Vector3(0.96, 0.96, 0.96) }, uLightMode: { value: params.has('light') ? 1 : 0 } } });
  const tilt = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: tiltFrag, depthTest: false, depthWrite: false,
    uniforms: { uA: { value: null }, uRes: { value: new THREE.Vector2() }, uScale: { value: dpr }, uStrength: { value: 1 } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ascii); quad.frustumCulled = false;
  const post = new THREE.Scene(); post.add(quad); const postCam = new THREE.Camera();
  const size = new THREE.Vector2();

  function resize() {
    const W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    renderer.getDrawingBufferSize(size);
    camera.aspect = W / H;
    TARGET.x = W / H < 1 ? TOWER.x - 1 : TOWER.x - 5;                                     // portrait: the tower in the middle
    rt?.dispose(); art?.dispose();
    rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    art = new THREE.WebGLRenderTarget(size.x, size.y, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    ascii.uniforms.uScene.value = rt.texture;
    ascii.uniforms.uGrid.value.set(Math.floor(W / CELL_W), Math.floor(H / CELL_H));
    tilt.uniforms.uA.value = art.texture;
    tilt.uniforms.uRes.value.copy(size);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const hour = params.get('hour');
  let raw = params.has('raw');
  const now = () => (hour !== null && Number(hour) >= 0 && Number(hour) <= 24 ? berlinTime(Number(hour)) : new Date());

  // --- input ---
  const keys = new Set();
  const walking = () => want === 1 && blend > 0.999;
  const look = (dx, dy) => {
    player.yaw += dx * LOOK;
    player.pitch = Math.max(-1.2, Math.min(1.25, player.pitch - dy * LOOK));
  };
  let paused = false;
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyR') { raw = !raw; return; }
    if ((e.code === 'KeyE' || e.code === 'Enter') && want === 0) { enter(); return; }
    if (e.code === 'Escape' && want === 1 && !document.pointerLockElement) { leave(); return; }
    if (e.code === 'Space' && want === 0) { paused = !paused; e.preventDefault(); return; }
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const canvas = renderer.domElement;
  let dragging = false;
  canvas.addEventListener('mousedown', () => { if (walking()) { dragging = true; canvas.requestPointerLock?.(); } });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', (e) => { if (walking() && (document.pointerLockElement === canvas || dragging)) look(e.movementX, e.movementY); });

  // Touch: the left half is a joystick from wherever the finger lands, the right half looks.
  const stick = { id: -1, x0: 0, y0: 0, dx: 0, dy: 0 };
  const glance = { id: -1, x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    if (!walking()) return;
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth / 2 && stick.id < 0) Object.assign(stick, { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, dy: 0 });
      else if (glance.id < 0) Object.assign(glance, { id: t.identifier, x: t.clientX, y: t.clientY });
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { stick.dx = (t.clientX - stick.x0) / 60; stick.dy = (t.clientY - stick.y0) / 60; }
      if (t.identifier === glance.id) { look((t.clientX - glance.x) * 1.6, (t.clientY - glance.y) * 1.6); glance.x = t.clientX; glance.y = t.clientY; }
    }
    if (walking()) e.preventDefault();
  }, { passive: false });
  const release = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) Object.assign(stick, { id: -1, dx: 0, dy: 0 });
      if (t.identifier === glance.id) glance.id = -1;
    }
  };
  canvas.addEventListener('touchend', release);
  canvas.addEventListener('touchcancel', release);

  function walk(dt) {
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    if (stick.id >= 0) { f -= Math.max(-1, Math.min(1, stick.dy)); s += Math.max(-1, Math.min(1, stick.dx)); }
    const len = Math.hypot(f, s);
    if (len < 0.05) return;
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') || len > 1.3 ? RUN : WALK) * Math.min(1, len) / len;
    const fx = Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const dx = (fx * f - fz * s) * speed * dt, dz = (fz * f + fx * s) * speed * dt;
    // Slide along whatever is in the way: try each axis on its own.
    if (!blocked(player.x + dx, player.z, RADIUS)) player.x += dx;
    if (!blocked(player.x, player.z + dz, RADIUS)) player.z += dz;
    player.bob += Math.hypot(dx, dz) * 5.5;
  }

  // --- a frame ---
  const focus = new THREE.Vector3(), home = new THREE.Vector3(-1, 0, 0), ground = new THREE.Vector3();
  let clockLit = skyClock(now());
  function drawFrame(t, dt) {
    blend = want > blend ? Math.min(1, blend + dt / FLIGHT) : Math.max(0, blend - dt / FLIGHT);
    setMode(blend <= 0 ? 'above' : blend >= 1 ? 'walk' : 'flying');
    if (walking()) walk(dt);
    berlin.update(t);

    abovePose(t); walkerPose();
    const e = smoother(blend);
    camera.position.lerpVectors(dio.pos, walker.pos, e);
    camera.position.y += Math.sin(e * Math.PI) * 10;                                     // a swoop, not a straight line
    camera.quaternion.slerpQuaternions(dio.quat, walker.quat, e);
    camera.fov = 23 + (66 + (camera.aspect < 1 ? 12 : 0) - 23) * e;
    camera.near = 0.05 + 4.95 * (1 - e) ** 3;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    scene.fog = e > 0.5 ? fog : null;
    tilt.uniforms.uStrength.value = 1 - e;

    focus.lerpVectors(home, ground.set(player.x, 0, player.z), e);
    berlin.light(clockLit, focus);                                                        // shadows follow the walker
    if (raw) { renderer.setRenderTarget(null); renderer.setClearColor(0xcfd8de, 1); renderer.clear(); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    quad.material = ascii; renderer.setRenderTarget(art); renderer.render(post, postCam);
    quad.material = tilt; renderer.setRenderTarget(null); renderer.render(post, postCam);
  }

  let clock = 0, last = performance.now(), lit = -1;
  const loop = (stamp) => {
    const dt = Math.max(0, Math.min(0.1, (stamp - last) / 1000)); // a frame's stamp can predate now()
    last = stamp;
    const still = paused && want === 0 && blend === 0;
    if (!still) clock += dt;
    if (Math.floor(clock / 60) !== lit) {                                                // the sun moves
      lit = Math.floor(clock / 60);
      clockLit = skyClock(now());
      fog.color.set(clockLit.day > 0.5 ? '#d9d3c7' : '#20263a');
    }
    if (!still) drawFrame(clock, dt);                                                    // paused, the last frame stays
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { enter, leave };
}
