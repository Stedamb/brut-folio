// Berlin in miniature, drawn as coloured ASCII and seen through a long lens from high above,
// with tilt-shift blur. A Lab experiment, adapted from the ascii-diorama skill.
//
// The city and its life come from berlin.js, the glyph and tilt-shift passes from ascii.js.
// `?hour=<0-24>` previews another time of day, `?light` prints coloured cells on a light
// ground, `?raw` shows the 3D scene without glyphs, and Space pauses.

import * as THREE from 'three';
import { berlinTime, skyClock } from '../../lib/berlin-sky';
import { TOWER, createBerlin, time } from './berlin.js';
import { GLYPHS, asciiFrag, buildAtlas, tiltFrag } from './ascii.js';

const CELL_W = 6, CELL_H = 12, DURATION = 30; // glyph cell in pixels; one camera sweep in seconds

export async function initDiorama(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

  const scene = new THREE.Scene();
  const berlin = createBerlin(scene);

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
  const vtx = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
  const ascii = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vtx, fragmentShader: asciiFrag, depthTest: false, depthWrite: false,
    uniforms: { uScene: { value: null }, uAtlas: { value: buildAtlas() }, uGrid: { value: new THREE.Vector2() }, uTime: time, uN: { value: GLYPHS.length }, uPaper: { value: new THREE.Vector3(0.96, 0.96, 0.96) }, uLightMode: { value: 0 } } });
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

  const params = new URLSearchParams(location.search);
  const hour = params.get('hour');
  const raw = params.has('raw'); // the 3D scene without glyphs, for building it
  ascii.uniforms.uLightMode.value = params.has('light') ? 1 : 0; // glyphs on dark by default; ?light for coloured cells on light
  const now = () => (hour !== null && Number(hour) >= 0 && Number(hour) <= 24 ? berlinTime(Number(hour)) : new Date());

  function drawFrame(t) {
    berlin.update(t);
    placeCamera(t);
    if (raw) { renderer.setRenderTarget(null); renderer.setClearColor(0x87a0b0, 1); renderer.clear(); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    quad.material = ascii; renderer.setRenderTarget(art); renderer.render(post, postCam);
    quad.material = tilt; renderer.setRenderTarget(null); renderer.render(post, postCam);
  }

  let paused = false, clock = 0, last = performance.now(), lit = -1;
  addEventListener('keydown', (e) => { if (e.code === 'Space') { paused = !paused; e.preventDefault(); } });
  const loop = (stamp) => {
    if (!paused) clock += Math.max(0, Math.min(0.1, (stamp - last) / 1000)); // a frame's stamp can predate now()
    last = stamp;
    if (Math.floor(clock / 60) !== lit) { lit = Math.floor(clock / 60); berlin.light(skyClock(now())); } // the sun moves
    if (!paused) drawFrame(clock); // paused, the last frame stays
    requestAnimationFrame(loop);
  };
  berlin.light(skyClock(now()));
  requestAnimationFrame(loop);
}
