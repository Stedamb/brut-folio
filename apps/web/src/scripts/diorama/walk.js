// A walk through Berlin in ASCII: the diorama's city at eye level, with the blocks raised to
// their real height. Start on the promenade by the Dom, with the Fernsehturm across the Spree.
//
// Desktop: click to look around with the mouse (Esc lets go), WASD or the arrows to walk,
// Shift to hurry. Touch: drag on the left half to walk, on the right half to look.
// R switches between ASCII and the plain 3D scene. `?hour=<0-24>` previews another time,
// `?at=x,z,heading` starts somewhere else.

import * as THREE from 'three';
import { berlinTime, skyClock } from '../../lib/berlin-sky';
import { RIVER_HALF, TOWER, blocked, createBerlin, river, time } from './berlin.js';
import { GLYPHS, asciiFrag, buildAtlas } from './ascii.js';

const CELL_W = 6, CELL_H = 12;
const EYE = 0.85, RADIUS = 0.3, WALK = 2.4, RUN = 5.2; // units: about 1.9 m; speeds per second
const LOOK = 0.0022;

export async function initWalk(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d9d3c7', 45, 170);                                            // the far city fades
  const berlin = createBerlin(scene, { tall: true });

  const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 400);
  camera.rotation.order = 'YXZ';

  // Start at the railing on the Dom's bank, upstream of the bridge and between two lamps,
  // facing the Fernsehturm across the Spree. If something stands there, step out in a
  // widening spiral until the ground is free.
  const p0 = river.getPointAt(0.3), t0 = river.getTangentAt(0.3), off = RIVER_HALF + 0.55;
  const x0 = p0.x + t0.z * off, z0 = p0.z - t0.x * off;
  const player = { x: x0, z: z0, yaw: Math.atan2(TOWER.x - x0, -(TOWER.z - z0)), pitch: 0.22, bob: 0 };
  // `?at=x,z,heading` starts somewhere else, heading in degrees clockwise from the Spree's view.
  const at = new URLSearchParams(location.search).get('at')?.split(',').map(Number);
  if (at && at.length >= 2 && at.every(Number.isFinite)) {
    player.x = at[0]; player.z = at[1];
    if (at.length > 2) player.yaw = (at[2] * Math.PI) / 180;
  }
  const sx = player.x, sz = player.z;
  for (let i = 0; blocked(player.x, player.z, RADIUS) && i < 400; i++) {
    player.x = sx + Math.cos(i * 0.7) * i * 0.05; player.z = sz + Math.sin(i * 0.7) * i * 0.05;
  }

  let W = 0, HH = 0, rt;
  const vtx = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
  const ascii = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: asciiFrag, depthTest: false, depthWrite: false,
    uniforms: { uScene: { value: null }, uAtlas: { value: buildAtlas() }, uGrid: { value: new THREE.Vector2() }, uTime: time, uN: { value: GLYPHS.length }, uPaper: { value: new THREE.Vector3(0.96, 0.96, 0.96) }, uLightMode: { value: 0 } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ascii); quad.frustumCulled = false;
  const post = new THREE.Scene(); post.add(quad); const postCam = new THREE.Camera();

  function resize() {
    W = Math.max(1, host.clientWidth); HH = Math.max(1, host.clientHeight);
    renderer.setSize(W, HH, false);
    camera.aspect = W / HH; camera.fov = W / HH < 1 ? 78 : 66; camera.updateProjectionMatrix();
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(W, HH, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    ascii.uniforms.uScene.value = rt.texture;
    ascii.uniforms.uGrid.value.set(Math.floor(W / CELL_W), Math.floor(HH / CELL_H));
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const params = new URLSearchParams(location.search);
  const hour = params.get('hour');
  let raw = params.has('raw');
  const now = () => (hour !== null && Number(hour) >= 0 && Number(hour) <= 24 ? berlinTime(Number(hour)) : new Date());

  // --- input ---
  const keys = new Set();
  const look = (dx, dy) => {
    player.yaw += dx * LOOK;
    player.pitch = Math.max(-1.2, Math.min(1.25, player.pitch - dy * LOOK));
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) { raw = !raw; return; }
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const canvas = renderer.domElement;
  let dragging = false;
  canvas.addEventListener('mousedown', () => { dragging = true; canvas.requestPointerLock?.(); });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas || dragging) look(e.movementX, e.movementY);
  });

  // Touch: the left half is a joystick from wherever the finger lands, the right half looks.
  const stick = { id: -1, x0: 0, y0: 0, dx: 0, dy: 0 };
  const glance = { id: -1, x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
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
    e.preventDefault();
  }, { passive: false });
  const release = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) Object.assign(stick, { id: -1, dx: 0, dy: 0 });
      if (t.identifier === glance.id) glance.id = -1;
    }
  };
  canvas.addEventListener('touchend', release);
  canvas.addEventListener('touchcancel', release);

  // --- walking ---
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

  const focus = new THREE.Vector3();
  let clockLit = skyClock(now());
  function drawFrame(t, dt) {
    walk(dt);
    berlin.update(t);
    camera.position.set(player.x, EYE + Math.sin(player.bob) * 0.025, player.z);
    camera.rotation.set(player.pitch, -player.yaw, 0);
    camera.updateMatrixWorld();
    focus.set(player.x, 0, player.z);
    berlin.light(clockLit, focus);                                                        // shadows follow the walker
    if (raw) { renderer.setRenderTarget(null); renderer.setClearColor(0xcfd8de, 1); renderer.clear(); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(post, postCam);
  }

  let clock = 0, last = performance.now(), lit = -1;
  const loop = (stamp) => {
    const dt = Math.max(0, Math.min(0.1, (stamp - last) / 1000)); // a frame's stamp can predate now()
    clock += dt; last = stamp;
    if (Math.floor(clock / 60) !== lit) {                                                // the sun moves
      lit = Math.floor(clock / 60);
      clockLit = skyClock(now());
      scene.fog.color.set(clockLit.day > 0.5 ? '#d9d3c7' : '#20263a');
    }
    drawFrame(clock, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
