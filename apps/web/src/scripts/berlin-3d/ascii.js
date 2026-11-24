// The ASCII pass shared by the Lab's Berlin pages: each glyph cell takes its colour from the
// 3D render and its character from the surface class (in alpha), its brightness and the
// direction of its edges; then, seen from above, a tilt-shift blur.

import * as THREE from 'three';

// ---------- ascii + tilt shift ----------
export const GLYPHS = " .'`,:;-~=+*oOsS$%&8#@/\\|_^v\u2014";
const GI = Object.fromEntries([...GLYPHS].map((c, i) => [c, i]));
const gg = (c) => GI[c].toFixed(1);
export function buildAtlas() {
  const tw = 64, th = 120, c = document.createElement('canvas');
  c.width = tw * GLYPHS.length; c.height = th;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 100px Menlo, Monaco, monospace';
  [...GLYPHS].forEach((ch, i) => { if (ch === '\u2014') x.fillRect(i * tw, th * 0.44, tw, th * 0.12); else x.fillText(ch, (i + 0.5) * tw, th * 0.52); });
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.flipY = false;
  return t;
}
export const asciiFrag = /* glsl */`
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
export const tiltFrag = /* glsl */`
precision highp float;
uniform sampler2D uA; uniform vec2 uRes; uniform float uScale, uStrength;
in vec2 vUv; out vec4 outColor;
void main(){
  float dy = abs(vUv.y-.46);
  float r = pow(smoothstep(.25,.6,dy),1.6)*28.*uScale*uStrength;   // uStrength fades it out at street level
  if(r<.2){ outColor = vec4(texture(uA,vUv).rgb,1.); return; }
  vec3 c = vec3(0.);
  float lod = max(log2(r/4.),0.);
  for(int i=0;i<36;i++){
    float t = float(i)+.5, a = t*2.39996, rr = sqrt(t/36.)*r;
    c += textureLod(uA,vUv+vec2(cos(a),sin(a))*rr/uRes,lod).rgb;
  }
  outColor = vec4(c/36.,1.);
}`;
