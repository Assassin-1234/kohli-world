/* KOHLI●WORLD
 * The dot in the domain is the world. One body, five working parts, one camera path.
 *
 * Code: MIT, (c) 2026 Angad Kohli. The personal content is not covered; see NOTICE.md.
 */
import * as THREE from './vendor/three.module.js';

THREE.ColorManagement.enabled = false;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = matchMedia('(pointer: fine)').matches;

const DEBUG = /debug/.test(location.hash) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const body = document.body;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);
body.classList.add('loading');

/* =====================================================================
 * GLSL
 * ===================================================================== */
const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*snoise(p); p*=2.03; a*=0.5; } return s; }
`;

// Screen-space halftone: every lit surface in this world is printed, not rendered.
const HALFTONE = /* glsl */`
uniform float uCell;
float halftone(float tone, float angle){
  vec2 q = gl_FragCoord.xy / uCell;
  float s = sin(angle), c = cos(angle);
  q = mat2(c, -s, s, c) * q;
  vec2 f = fract(q) - 0.5;
  float d = length(f);
  float r = sqrt(clamp(tone, 0.0, 1.0)) * 0.68;
  float aa = max(fwidth(d) * 0.9, 0.035);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}
`;

const SPHERE_UV = /* glsl */`
vec2 sphUV(vec3 sp){
  float lon = atan(sp.z, sp.x);
  float lat = asin(clamp(sp.y, -1.0, 1.0));
  return vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
}
`;

const VERT_WORLD = /* glsl */`
varying vec3 vObj; varying vec3 vWN; varying vec3 vWPos;
void main(){
  vObj = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PLANET_FRAG = /* glsl */`
uniform sampler2D uTerrain;
uniform vec3 uLight, uInk, uBase, uRed, uCrater;
uniform float uCut, uLand, uGrat, uOpacity, uTime, uScale, uNight;
uniform vec3 uCity0, uCity1, uCity2, uLit, uHot;
float city(vec3 sp, vec3 dir, float det, float lit){
  float d = acos(clamp(dot(sp, normalize(dir)), -1.0, 1.0));
  float core = exp(-pow(d / 0.045, 2.0));
  float glow = exp(-pow(d / (0.13 + 0.03 * lit), 2.0));
  float sprawl = smoothstep(0.52, 0.78, det * 0.5 + 0.5 + glow * 0.35) * exp(-pow(d / 0.24, 2.0));
  return (core * 1.2 + glow * 0.55 + sprawl * 0.6) * (0.8 + 0.45 * lit);
}
varying vec3 vObj; varying vec3 vWN; varying vec3 vWPos;
${HALFTONE}
${SPHERE_UV}
void main(){
  vec3 sp = normalize(vObj);
  float az = atan(sp.z, sp.x);
  if (uCut > 0.002 && az > 0.0 && az < uCut) discard;

  vec4 tr = texture2D(uTerrain, sphUV(sp) * vec2(uScale, 1.0));
  float h = tr.r * 2.0 - 1.0;
  float det = tr.g * 2.0 - 1.0;
  float land = smoothstep(0.03, 0.09, h) * uLand;
  float coast = (1.0 - smoothstep(0.0, 0.018, abs(h - 0.06))) * uLand;

  vec3 n = normalize(vWN);
  vec3 v = normalize(cameraPosition - vWPos);
  float diff = clamp(dot(n, normalize(uLight)), 0.0, 1.0);
  float wrap = clamp(dot(n, normalize(uLight)) * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.6);

  float tone = diff * mix(0.30, 0.95, land) + land * det * 0.22 * diff + rim * 0.55 * wrap;

  // the impact site: one perfect crater, concentric
  float cd = acos(clamp(dot(sp, normalize(uCrater)), -1.0, 1.0));
  float rings = 0.0;
  for (int i = 1; i <= 4; i++) { float r = float(i) * 0.022; rings += 1.0 - smoothstep(0.0, 0.0035, abs(cd - r)); }
  rings *= smoothstep(0.12, 0.08, cd) * uLand;

  // graticule
  float lat = asin(clamp(sp.y, -1.0, 1.0)); float lon = az;
  float k = 3.1415927 / 12.0;
  float gl = abs(fract(lat / k + 0.5) - 0.5), go = abs(fract(lon / k + 0.5) - 0.5);
  float g = max(1.0 - smoothstep(0.0, fwidth(lat / k) * 1.2, gl), 1.0 - smoothstep(0.0, fwidth(lon / k) * 1.2, go));
  g *= uGrat * (0.35 + 0.65 * wrap);

  float dots = halftone(tone, 0.7854);
  vec3 col = mix(uBase, uInk, dots);
  col = mix(col, uInk, clamp(coast * 0.85 * (0.25 + wrap) + g * 0.45, 0.0, 1.0));
  col = mix(col, uRed, rings * (0.4 + wrap));
  if (uNight > 0.001) {
    float dark = 1.0 - smoothstep(0.05, 0.6, diff);
    float em = (city(sp, uCity0, det, uLit.x) + city(sp, uCity1, det, uLit.y) + city(sp, uCity2, det, uLit.z)) * dark * uNight;
    float he = halftone(clamp(em, 0.0, 1.0), 0.26);
    col = mix(col, uHot, he);
    col = mix(col, uInk, clamp(em - 1.0, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, uOpacity);
}`;

const CAP_FRAG = /* glsl */`
uniform vec3 uInk, uBase, uRed, uLight;
uniform float uTime, uPulse, uOpacity;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWPos;
${HALFTONE}
void main(){
  float r = length(vObj);
  float inner = 0.30 + uPulse * 0.025;
  float tone; vec3 ink = uInk; float ang = 0.7854;
  if (r > 0.93) { tone = 0.78; }
  else if (r > 0.58) { tone = 0.34 + 0.18 * sin(r * 70.0); ang = 0.2; }
  else if (r > inner) { tone = 0.62 + 0.2 * sin(r * 40.0 - uTime * 2.0); ang = 1.2; }
  else { tone = 1.0; ink = uRed; }
  float lit = 0.65 + 0.35 * abs(dot(normalize(vWN), normalize(uLight)));
  float d = halftone(tone * lit, ang);
  vec3 col = mix(uBase, ink, d);
  if (r <= inner) col = mix(uRed * 0.55, uRed, d);
  float edges = 0.0;
  edges += 1.0 - smoothstep(0.0, 0.006, abs(r - 0.93));
  edges += 1.0 - smoothstep(0.0, 0.006, abs(r - 0.58));
  edges += 1.0 - smoothstep(0.0, 0.006, abs(r - inner));
  col = mix(col, uInk, clamp(edges, 0.0, 1.0));
  gl_FragColor = vec4(col, uOpacity);
}`;

const BAKE_FRAG = /* glsl */`
varying vec2 vUv;
${NOISE}
void main(){
  float lon = (vUv.x - 0.5) * 6.2831853;
  float lat = (vUv.y - 0.5) * 3.1415927;
  vec3 sp = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  float h = fbm(sp * 1.55 + vec3(3.1, 7.7, 1.3));
  h += 0.18 * (1.0 - abs(sp.y)) - 0.08;
  float d = fbm(sp * 7.0 + 11.0);
  gl_FragColor = vec4(h * 0.5 + 0.5, d * 0.5 + 0.5, 0.0, 1.0);
}`;

const SUN_FRAG = /* glsl */`
uniform vec3 uInk, uRed, uHot;
uniform float uOpacity, uTime, uCrack, uEgg;
varying vec2 vUv;
${HALFTONE}
// a hairline crack across the face, as a zig-zag chord
float crack(vec2 p, float a, float s){
  vec2 q = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  float zig = 0.03 * sin(q.x * 34.0 + s) + 0.016 * sin(q.x * 87.0 + s * 2.3);
  return 1.0 - smoothstep(0.004, 0.012, abs(q.y - zig));
}
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float ang = atan(p.y, p.x);
  float egg = max(uEgg, 0.0);
  float e1 = clamp(egg, 0.0, 1.0);

  // yolk: the sun itself, settling a little smaller once it breaks
  float R = mix(0.46, 0.26, e1);
  float yolk = 1.0 - smoothstep(R - 0.007, R, d);

  // the white: an uneven pool spreading out from under the yolk
  float wob = 1.0 + 0.12 * sin(ang * 3.0 + 1.3) + 0.08 * sin(ang * 5.0 + 0.4) + 0.035 * sin(ang * 11.0 + 2.2);
  float WR = 0.6 * egg * wob;
  float white = (1.0 - smoothstep(WR - 0.01, WR, d)) * step(0.002, egg);

  // corona: gone once breakfast is served
  float flick = 0.08 * sin(ang * 22.0 + uTime * 0.35) + 0.05 * sin(ang * 9.0 - uTime * 0.6);
  float corona = clamp((1.0 - (d - 0.46) / 0.54) * 0.62 + flick, 0.0, 1.0) * (1.0 - clamp(e1 * 1.6, 0.0, 1.0));
  float hc = halftone(corona * corona, 0.35);

  // shading, printed in the same halftone as everything else
  float hd = halftone(1.0 - pow(d / R, 2.0) * 0.55, 0.7854);
  float edge = smoothstep(0.55, 1.0, d / max(WR, 0.001));
  float hw = halftone(0.92 - edge * 0.3, 0.35);
  float gloss = (1.0 - smoothstep(0.0, 0.05, length(p - vec2(-0.08, 0.08)))) * e1;

  // cracks appear one tap at a time, and close up as the egg spreads
  float cr = 0.0;
  if (uCrack > 0.2) cr = max(cr, crack(p, 0.4, 1.0));
  if (uCrack > 0.5) cr = max(cr, crack(p, 2.1, 4.0));
  if (uCrack > 0.85) cr = max(cr, crack(p, -1.0, 7.0));
  cr *= yolk * (1.0 - e1);

  vec3 col = mix(uRed, uHot, smoothstep(0.9, 0.5, d));
  float a = hc;
  col = mix(col, mix(uInk * 0.8, uInk, hw), white);
  a = mix(a, 1.0, white);
  vec3 yolkCol = mix(uHot, vec3(0.98, 0.5, 0.09), e1);
  vec3 yc = mix(yolkCol, uInk, hd * (1.0 - 0.72 * e1));
  yc = mix(yc, uRed * 0.45, cr);
  yc = mix(yc, uInk, gloss);
  col = mix(col, yc, yolk);
  a = mix(a, 1.0, yolk);
  gl_FragColor = vec4(col, a * uOpacity);
}`;

const POST_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uPixel, uCA, uTime;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  if (uPixel > 1.0) { vec2 b = uPixel / uRes; uv = (floor(uv / b) + 0.5) * b; }
  vec2 dir = uv - 0.5;
  vec2 off = dir * uCA * (0.35 + length(dir) * 2.0);
  vec4 cr = texture2D(tScene, uv + off);
  vec4 cg = texture2D(tScene, uv);
  vec4 cb = texture2D(tScene, uv - off);
  vec4 col = vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a)));
  float g = hash(floor(uv * uRes) + floor(uTime * 24.0)) - 0.5;
  col.rgb = max(col.rgb + g * 0.07 * col.a, 0.0);
  gl_FragColor = col;
}`;

const NODE_VERT = /* glsl */`
attribute float aLife; attribute float aKind;
uniform float uSize; uniform float uOpacity;
varying float vLife; varying float vKind;
void main(){
  vLife = aLife; vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (aKind > 0.5 ? 1.35 : 0.8) * (aLife > 0.0 ? 1.0 : 0.0);
}`;
const NODE_FRAG = /* glsl */`
uniform vec3 uInk, uRed; uniform float uOpacity; uniform float uShield;
varying float vLife; varying float vKind;
void main(){
  vec2 c = abs(gl_PointCoord - 0.5);
  float e = max(c.x, c.y);
  float a = step(0.36, e) * step(e, 0.5);
  if (vKind > 0.5) a = max(a, step(e, 0.14));
  if (a < 0.5 || vLife <= 0.0) discard;
  vec3 col = vKind > 0.5 ? uRed : uInk;
  gl_FragColor = vec4(col, min(vLife, 1.0) * uOpacity * (vKind > 1.5 ? 1.0 : uShield));
}`;

/* =====================================================================
 * Colours
 * ===================================================================== */
const C = {
  cream: new THREE.Color('#F3E8D2'),
  base: new THREE.Color('#120807'),
  red: new THREE.Color('#E0241B'),
  hot: new THREE.Color('#FFB36B'),
};

/* =====================================================================
 * Renderer
 * ===================================================================== */
const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  body.classList.remove('loading');
  body.classList.add('no-gl');
  throw e;
}
renderer.setClearColor(0x000000, 0);
let DPR = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(DPR);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 300);
const rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4 });

const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  uniforms: { tScene: { value: rt.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uPixel: { value: 1 }, uCA: { value: 0.003 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: POST_FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

/* bake the terrain once, on the GPU */
const terrainRT = new THREE.WebGLRenderTarget(2048, 1024, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping });
terrainRT.texture.wrapS = THREE.RepeatWrapping;
{
  const s = new THREE.Scene();
  const m = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: BAKE_FRAG });
  s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m));
  renderer.setRenderTarget(terrainRT);
  renderer.render(s, postCam);
  renderer.setRenderTarget(null);
  m.dispose();
}

/* =====================================================================
 * The world
 * ===================================================================== */
const world = new THREE.Group();          // planet frame (spins)
scene.add(world);

const latLon = (lat, lon, r = 1) => {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.sin(lo) * r);
};
// The globe turns the same amount on every page. Everything that has to face you
// (surface pins, cutaway, night lights) is placed where that rhythm lands.
const STEP = 1.9;                                   // ~109° per page
const ROT0 = -Math.PI / 4 - 4 * STEP;               // page 4 (core) must show the cutaway at -45°
const faceLon = page => THREE.MathUtils.radToDeg(ROT0 + page * STEP + Math.PI / 2);
const SURF = faceLon(2), NIGHT = faceLon(7);
const CRATER = latLon(22, SURF + 8);
// three lights on the night side: Ishan, Anshaj, Manya
const CITIES = [latLon(30, NIGHT + 20), latLon(-24, NIGHT + 11), latLon(6, NIGHT - 19)];

const common = () => ({
  uCell: { value: 4.0 },
  uInk: { value: C.cream }, uBase: { value: C.base }, uRed: { value: C.red },
  uLight: { value: new THREE.Vector3(-0.55, 0.45, 0.7) },
  uOpacity: { value: 1 }, uTime: { value: 0 }
});

const planetMat = new THREE.ShaderMaterial({
  uniforms: { ...common(), uTerrain: { value: terrainRT.texture }, uCut: { value: 0 }, uLand: { value: 1 }, uGrat: { value: 1 }, uCrater: { value: CRATER }, uScale: { value: 1 },
    uNight: { value: 0 }, uLit: { value: new THREE.Vector3() }, uHot: { value: C.hot },
    uCity0: { value: CITIES[0] }, uCity1: { value: CITIES[1] }, uCity2: { value: CITIES[2] } },
  vertexShader: VERT_WORLD, fragmentShader: PLANET_FRAG
});
const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), planetMat);
world.add(planet);

// cutaway faces
const capMat = new THREE.ShaderMaterial({
  uniforms: { ...common(), uPulse: { value: 0 } },
  vertexShader: VERT_WORLD, fragmentShader: CAP_FRAG, side: THREE.DoubleSide
});
capMat.uniforms.uLight = planetMat.uniforms.uLight;
capMat.uniforms.uCell = planetMat.uniforms.uCell;
const capGeo = new THREE.CircleGeometry(0.999, 128, -Math.PI / 2, Math.PI);
const capA = new THREE.Mesh(capGeo, capMat);
const capB = new THREE.Mesh(capGeo, capMat);
world.add(capA, capB);

// shield: the layer that gets attacked first, by us
const shield = new THREE.Group();
scene.add(shield);
const ico = new THREE.IcosahedronGeometry(1.42, 2);
const shieldLines = new THREE.LineSegments(new THREE.WireframeGeometry(ico),
  new THREE.LineBasicMaterial({ color: C.cream, transparent: true, opacity: 0, depthWrite: false }));
const shieldPts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', ico.attributes.position),
  new THREE.PointsMaterial({ color: C.cream, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
shield.add(shieldLines, shieldPts);

// attack streams
const NP = REDUCE ? 320 : 1100;
const P = { pos: new Float32Array(NP * 3), vel: new Float32Array(NP * 3), len: new Float32Array(NP), col: new Float32Array(NP * 3) };
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(NP * 6), pCol = new Float32Array(NP * 8);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
const streams = new THREE.LineSegments(pGeo, pMat);
streams.frustumCulled = false;
scene.add(streams);
const PAL = [[0.88, 0.14, 0.10], [0.96, 0.46, 0.16], [0.95, 0.90, 0.80], [0.66, 0.09, 0.07], [0.98, 0.72, 0.30]];
function spawn(i, warm) {
  const x = warm ? 1.6 + Math.random() * 12 : 8 + Math.random() * 6;
  const y = (Math.random() - 0.5) * 3.6, z = (Math.random() - 0.5) * 3.6;
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
  const ax = 0, ay = y * 0.22, az = z * 0.22;
  let vx = ax - x, vy = ay - y, vz = az - z;
  const l = Math.hypot(vx, vy, vz), sp = 1.9 + Math.random() * 1.8;
  P.vel[i * 3] = vx / l * sp; P.vel[i * 3 + 1] = vy / l * sp; P.vel[i * 3 + 2] = vz / l * sp;
  P.len[i] = 0.25 + Math.random() * 0.8;
  const c = PAL[(Math.random() * PAL.length) | 0];
  P.col[i * 3] = c[0]; P.col[i * 3 + 1] = c[1]; P.col[i * 3 + 2] = c[2];
}
for (let i = 0; i < NP; i++) spawn(i, true);

// impact nodes (square markers)
const NN = 48;
const nGeo = new THREE.BufferGeometry();
const nPos = new Float32Array(NN * 3), nLife = new Float32Array(NN), nKind = new Float32Array(NN);
nGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
nGeo.setAttribute('aLife', new THREE.BufferAttribute(nLife, 1));
nGeo.setAttribute('aKind', new THREE.BufferAttribute(nKind, 1));
const nMat = new THREE.ShaderMaterial({
  uniforms: { uSize: { value: 11 }, uOpacity: { value: 1 }, uShield: { value: 0 }, uInk: { value: C.cream }, uRed: { value: C.red } },
  vertexShader: NODE_VERT, fragmentShader: NODE_FRAG, transparent: true, depthWrite: false, depthTest: false
});
const nodes = new THREE.Points(nGeo, nMat);
nodes.frustumCulled = false;
scene.add(nodes);
let nodeIdx = 0;
function node(v, kind, life) {
  const i = nodeIdx = (nodeIdx + 1) % NN;
  nPos[i * 3] = v.x; nPos[i * 3 + 1] = v.y; nPos[i * 3 + 2] = v.z;
  nLife[i] = life; nKind[i] = kind;
}

// orbit, moon, gimbals
const orbit = new THREE.Group();
orbit.rotation.set(0.36, 0, 0.14);
scene.add(orbit);
const RO = 2.75;
const ringPts = [];
for (let i = 0; i <= 256; i++) { const a = i / 256 * TAU; ringPts.push(new THREE.Vector3(Math.cos(a) * RO, 0, Math.sin(a) * RO)); }
const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
const ring = new THREE.Line(ringGeo, new THREE.LineDashedMaterial({ color: C.cream, dashSize: 0.035, gapSize: 0.05, transparent: true, opacity: 0, depthWrite: false }));
ring.computeLineDistances();
orbit.add(ring);
// the orbit is also a price chart
const trace = [];
let pr = 0, prv = 0;
for (let i = 0; i <= 360; i++) {
  prv = prv * 0.9 + (Math.random() - 0.5) * 0.5; pr += prv * 0.12; pr *= 0.985;
  const a = i / 360 * TAU, r = RO + pr * 0.22;
  trace.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
}
const traceLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(trace),
  new THREE.LineBasicMaterial({ color: C.red, transparent: true, opacity: 0, depthWrite: false }));
orbit.add(traceLine);
const moonMat = new THREE.ShaderMaterial({
  uniforms: { ...common(), uTerrain: { value: terrainRT.texture }, uCut: { value: 0 }, uLand: { value: 0 }, uGrat: { value: 0.0 }, uCrater: { value: new THREE.Vector3(0, 1, 0) }, uScale: { value: 3 } },
  vertexShader: VERT_WORLD, fragmentShader: PLANET_FRAG, transparent: true
});
moonMat.uniforms.uLight = planetMat.uniforms.uLight;
moonMat.uniforms.uCell = planetMat.uniforms.uCell;
const moon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 64, 48), moonMat);
orbit.add(moon);

const gimbals = new THREE.Group();
scene.add(gimbals);
[[1.1, 0.2, 0], [-0.5, 0, 0.9], [0.2, 1.2, -0.4]].forEach(r => {
  const pts = [];
  for (let i = 0; i <= 200; i++) { const a = i / 200 * TAU; pts.push(new THREE.Vector3(Math.cos(a) * 1.78, Math.sin(a) * 1.78, 0)); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: C.cream, dashSize: 0.025, gapSize: 0.045, transparent: true, opacity: 0, depthWrite: false }));
  l.computeLineDistances();
  l.rotation.set(r[0], r[1], r[2]);
  gimbals.add(l);
});

// sun
const sunMat = new THREE.ShaderMaterial({
  uniforms: { uCell: planetMat.uniforms.uCell, uInk: { value: C.cream }, uRed: { value: C.red }, uHot: { value: C.hot }, uOpacity: { value: 0 }, uTime: { value: 0 }, uCrack: { value: 0 }, uEgg: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: SUN_FRAG, transparent: true, depthWrite: false
});
const sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sunMat);
sun.scale.setScalar(9);
scene.add(sun);

// distant dust
{
  const n = 900, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 60);
    a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  var stars = new THREE.Points(g, new THREE.PointsMaterial({ color: C.cream, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(stars);
}

/* =====================================================================
 * The path: one camera, nine chapters
 * ===================================================================== */
const DEF = {
  cam: [0, 0, 5], tgt: [0, 0, 0], shield: 0, parts: 0, cut: 0, face: 0, faceRot: 0, sway: 0.13, tilt: 0.2,
  orbit: 0, gimbal: 0, sun: 0, stars: 0, word: 0, dof: 0, dofSun: 0, night: 0,
  light: [-0.55, 0.45, 0.7], ca: 0.0026, top: [10, 7, 6], bot: [5, 3, 3]
};
const NAMES = ['Arrival', 'Premise', 'Surface', 'Shield', 'Core', 'Satellite', 'Star', 'Night side', 'Landing'];
const STOPS = [0, 0.105, 0.215, 0.33, 0.445, 0.56, 0.675, 0.79, 0.925, 1];
const LAST = NAMES.length - 1;
let KEYS = [];
let W = innerWidth, H = innerHeight, NARROW = W < 760;

function heroFrame(sel = '#gap') {
  const g = $(sel).getBoundingClientRect();
  const th = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const diam = Math.max(40, g.width * 0.98);
  const d = 2 / ((diam / H) * 2 * th);
  const unit = (2 * d * th) / H;
  const cx = g.left + g.width / 2 - W / 2, cy = g.top + g.height / 2 - H / 2;
  const ox = -cx * unit, oy = cy * unit;
  return { cam: [ox, oy, d], tgt: [ox, oy, 0] };
}

function buildKeys() {
  const n = NARROW;
  const hero = heroFrame();
  const prem = heroFrame('#gap2');
  const k = [
    { ...hero, word: 1, top: [146, 14, 9], bot: [24, 3, 2], ca: 0.0022, gimbal: 0 },
    { ...prem, dof: 1, stars: 1, top: [14, 8, 7], bot: [6, 3, 3], ca: 0.0032 },
    { cam: [0, 0.35, n ? 6.6 : 4.7], tgt: [n ? 0 : 1.15, n ? -0.75 : 0.05, 0], face: 0.9, faceRot: 0.35, sway: 0.26, stars: 1, top: [18, 8, 7], bot: [6, 3, 3] },
    { cam: [0, 0.5, n ? 13 : 8.6], tgt: [n ? 0.4 : -1.75, n ? -1.5 : 0, 0], shield: 1, parts: 1, stars: 1, top: [9, 6, 6], bot: [30, 4, 3], ca: 0.004 },
    { cam: [0.2, 1.1, n ? 7.2 : 4.7], tgt: [n ? 0 : -0.78, n ? -1.0 : -0.02, 0], cut: Math.PI / 2, face: 1, faceRot: -Math.PI / 4, sway: 0.16, tilt: 0.34, top: [92, 10, 6], bot: [14, 2, 2], light: [-0.2, 0.6, 0.8] },
    { cam: [0, 2.6, n ? 15 : 9.8], tgt: [n ? 0 : -0.9, n ? -0.9 : -0.45, 0], orbit: 1, gimbal: 0.35, stars: 1, top: [8, 6, 6], bot: [4, 3, 3] },
    { cam: [0, 0, n ? 7.5 : 6], tgt: [0, n ? 3.2 : 3.67, -6], sun: 1, dofSun: 1, light: [0, 0.5, -1], top: [214, 78, 26], bot: [96, 14, 6], ca: 0.0036 },
    { cam: [0, 0.3, n ? 8.6 : 4.7], tgt: [n ? 0 : 1.15, n ? -1.55 : 0.05, 0], face: 1, faceRot: 2.3, sway: 0.2, night: 1, stars: 1, light: [0.95, 0.28, -0.5], top: [6, 5, 8], bot: [18, 4, 3], ca: 0.003 },
    { ...hero, word: 1, gimbal: 1, top: [146, 14, 9], bot: [24, 3, 2], ca: 0.0022 },
  ];
  k.push({ ...k[LAST] });
  KEYS = k.map((o, i) => ({ ...DEF, ...o, p: STOPS[i] }));

  // One even, forward turn per page (STEP). Faces that must show are placed where this rhythm lands.
  KEYS.forEach((key, i) => { key.rot = ROT0 + Math.min(i, LAST) * STEP + (i > LAST ? 0.35 : 0); });
}

const S = {};
function sample(p) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(0.1, 0.9, (p - a.p) / (b.p - a.p));
  for (const key in DEF) {
    const va = a[key], vb = b[key];
    if (Array.isArray(va)) { S[key] = S[key] || []; for (let j = 0; j < va.length; j++) S[key][j] = lerp(va[j], vb[j], t); }
    else S[key] = lerp(va, vb, t);
  }
  S.seg = i; S.t = t;
}

/* =====================================================================
 * DOM: erosion, chapters, pins, HUD
 * ===================================================================== */
const SVGNS = 'http://www.w3.org/2000/svg';
const defs = $('#erodeDefs');
function makeErode(el, seed) {
  const id = 'e' + Math.random().toString(36).slice(2, 7);
  const f = document.createElementNS(SVGNS, 'filter');
  f.setAttribute('id', id);
  f.setAttribute('x', '-2%'); f.setAttribute('y', '-2%'); f.setAttribute('width', '104%'); f.setAttribute('height', '104%');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.innerHTML = `
    <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="3" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -24 0 0 0 24" result="m"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="1" seed="${seed + 3}" result="d"/>
    <feColorMatrix in="d" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -40 0 0 0 31" result="dm"/>
    <feComposite in="m" in2="dm" operator="in" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>`;
  defs.appendChild(f);
  const cm = f.querySelector('feColorMatrix');
  el.style.filter = `url(#${id})`;
  return { el, cm, last: -1, set(v) {
    const q = Math.round(v * 60) / 60;
    if (q === this.last) return;
    this.last = q;
    const thr = lerp(0.12, 1.02, q);
    cm.setAttribute('values', `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -24 0 0 0 ${(24 * thr).toFixed(2)}`);
    el.style.visibility = q <= 0.001 ? 'hidden' : 'visible';
  } };
}

const wordEro = makeErode($('#word'), 4);
const dofEl = $('#dof'), dofSunEl = $('#dofSun');
const dofEro = makeErode(dofEl, 9);
const dofSunEro = makeErode(dofSunEl, 13);
const chapters = $$('.ch').map(el => ({
  el, i: +el.dataset.ch,
  ero: el.querySelector('.erode') ? makeErode(el.querySelector('.erode'), 20 + +el.dataset.ch) : null,
  parts: [...el.querySelectorAll('.label, .copy, .kicker, .hero-line, .thesis, .readout, .people li')],
  scrib: el.querySelector('.scribble path'), vis: -1
}));

// pins on the surface + strata in the cutaway
const pinsEl = $('#pins');
const PINS = [
  { v: CRATER, ch: 2, t: 'Impact site / 10.9', s: 'International-level 10m air rifle, ages 15 to 19. National bronze, 80+ other medals.' },
  { v: latLon(-30, SURF - 32), ch: 2, t: 'First commit / 2019', s: 'Started out of curiosity. Never stopped.' },
  { v: latLon(56, SURF + 40), ch: 2, t: 'HQ / Audexis Pvt. Ltd.', s: 'Founded it. Defence and government software.' },
  { v: new THREE.Vector3(0.965 * Math.cos(0.82), 0.965 * Math.sin(0.82), 0), ch: 4, lead: 150, t: 'Crust' },
  { v: new THREE.Vector3(0.76 * Math.cos(0.4), 0.76 * Math.sin(0.4), 0), ch: 4, lead: 170, t: 'Mantle' },
  { v: new THREE.Vector3(0.45 * Math.cos(0.02), 0.45 * Math.sin(0.02), 0), ch: 4, lead: 240, t: 'Outer core / trained daily' },
  { v: new THREE.Vector3(0.08, -0.27, 0), ch: 4, lead: 330, t: 'Inner core / 100 kg bench' },
  { v: CITIES[0], ch: 7, t: 'IB', city: 0 },
  { v: CITIES[1], ch: 7, t: 'AM', city: 1 },
  { v: CITIES[2], ch: 7, t: 'MT', city: 2 },
].map(p => {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = `<i class="lead"></i><span class="tx">${p.t}${p.s ? `<small>${p.s}</small>` : ''}</span>`;
  if (p.lead) el.querySelector('.lead').style.width = (NARROW ? Math.round(p.lead * 0.35) : p.lead) + 'px';
  pinsEl.appendChild(el);
  return { ...p, el, o: -1 };
});

// people: hovering a name brightens their light
const litTarget = [0, 0, 0];
$$('.people li').forEach((li, i) => {
  li.addEventListener('pointerenter', () => { litTarget[i] = 1; });
  li.addEventListener('pointerleave', () => { litTarget[i] = 0; });
});


const CORNERS = [
  ['Sovereign body', 'Population 01', 'Est. 2019', 'Under construction'],
  ['Premise', 'One world', 'Five working parts', 'One owner'],
  ['Surface / habitable', 'Lat / lon live', 'Drag to rotate', 'Based in India'],
  ['Shield / layer engaged', 'Autonomous adversary', 'Probes / continuous', 'Weak points / found first'],
  ['Cutaway', 'Iron core / exposed', 'Trained daily', 'Progress / measurable'],
  ['Satellite', 'The system / autonomous', 'Strategy / repeatable', 'Risk / controlled'],
  ['Star', 'SunnySideUp', 'With Manya', 'Starting with cars'],
  ['Night side', 'Lights on / 03', 'Brightness / equal', 'Hours / always on'],
  ['Landing permitted', 'Visitors / welcome', 'Est. 2019 / still under construction', '© 2026 Angad Kohli'],
];
const cornerEls = ['#cTL', '#cTR', '#cBL', '#cBR'].map(s => $(s));
let cornerCh = -1, cornerTimer = 0;
/* ---------- analytics ----------
 * Umami, self-hosted, proxied same-origin at /u/ (auto-track is off in the tag).
 * Each chapter reached counts as a page view (/#premise ... /#landing), so bounce = left without scrolling
 * and visit time is real. Automated browsers and software-rendered WebGL (headless browsers on GPU-less
 * servers) are never counted. */
const CHAPTER_SLUGS = ['', 'premise', 'surface', 'shield', 'core', 'satellite', 'star', 'night-side', 'landing'];
const human = (() => {
  try {
    if (navigator.webdriver) return false;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return !/swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(gpu);
  } catch (e) { return true; }
})();
const tracked = new Set();
function umami(fn) {
  if (!human) return;
  try { if (window.umami) fn(window.umami); } catch (e) { /* tracker unavailable */ }
}
function track(name) {
  if (tracked.has(name)) return;
  tracked.add(name);
  umami(u => u.track(name));
}
function trackChapter(ch) {
  if (tracked.has('ch' + ch)) return;
  tracked.add('ch' + ch);
  const slug = CHAPTER_SLUGS[ch];
  umami(u => u.track(p => ({ ...p, url: slug ? '/#' + slug : '/', title: NAMES[ch] + ' · KOHLI●WORLD' })));
}
trackChapter(0);  // the tag is deferred and sits before this module, so window.umami is already set (unless blocked)
function setCorners(ch) {
  if (ch === cornerCh) return;
  cornerCh = ch;
  trackChapter(ch);
  cornerEls.forEach(e => e.classList.add('swap'));
  clearTimeout(cornerTimer);
  cornerTimer = setTimeout(() => {
    cornerEls.forEach((e, i) => { e.textContent = CORNERS[ch][i]; e.classList.remove('swap'); });
  }, 260);
  $('#chapN').textContent = String(ch).padStart(2, '0');
  $('#chapName').textContent = NAMES[ch];
}

// index
const indexEl = $('#index'), indexBtn = $('#indexBtn');
NAMES.forEach((n, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<button data-i="${i}"><span>${n}</span><small>${String(i).padStart(2, '0')}</small></button>`;
  $('#indexList').appendChild(li);
});
function toggleIndex(open) {
  const o = open ?? indexEl.hidden;
  indexEl.hidden = !o;
  indexBtn.setAttribute('aria-expanded', o);
  indexBtn.textContent = o ? 'Close' : 'Index';
  if (o) lenis?.stop(); else lenis?.start();
}
indexBtn.addEventListener('click', () => toggleIndex());
$('#indexList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  toggleIndex(false);
  goTo(STOPS[+b.dataset.i]);
});
$('#home').addEventListener('click', e => { e.preventDefault(); goTo(0); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !indexEl.hidden) toggleIndex(false); });

// grain texture
{
  const c = document.createElement('canvas'); c.width = c.height = 220;
  const g = c.getContext('2d'); const im = g.createImageData(220, 220);
  for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  g.fillStyle = 'rgba(0,0,0,.9)';
  for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(Math.random() * 220, Math.random() * 220, Math.random() * 1.6 + 0.4, 0, TAU); g.fill(); }
  $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
}

/* =====================================================================
 * Scroll
 * ===================================================================== */
let lenis = null;
if (window.Lenis && !REDUCE) {
  lenis = new window.Lenis({ lerp: 0.075, wheelMultiplier: 0.85, touchMultiplier: 1.4 });
  lenis.stop();
}
function maxScroll() { return Math.max(1, document.documentElement.scrollHeight - innerHeight); }
function goTo(p) {
  const y = p * maxScroll();
  if (lenis) lenis.scrollTo(y, { duration: 2.2, easing: t => 1 - Math.pow(1 - t, 4) });
  else scrollTo({ top: y, behavior: REDUCE ? 'auto' : 'smooth' });
}

/* =====================================================================
 * Pointer: crosshair, lat/lon, drag to spin, ping
 * ===================================================================== */
const ptr = { x: innerWidth / 2, y: innerHeight / 2, in: false, down: false, lx: 0, moved: 0 };
const cross = $('#cross'), crossX = $('#crossX'), crossY = $('#crossY'), crossGeo = $('#crossGeo');
const cxLine = cross.querySelector('.cx'), cyLine = cross.querySelector('.cy');
const ray = new THREE.Raycaster();
const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
const ndc = new THREE.Vector2();
let spinVel = 0, userSpin = 0;

addEventListener('pointermove', e => {
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.in = true;
  if (ptr.down) { const dx = e.clientX - ptr.lx; ptr.lx = e.clientX; spinVel += dx * 0.0042; ptr.moved += Math.abs(dx); }
}, { passive: true });
addEventListener('pointerleave', () => { ptr.in = false; });
canvas.addEventListener('pointerdown', e => { ptr.down = true; ptr.lx = e.clientX; ptr.moved = 0; });
addEventListener('pointerup', e => {
  if (ptr.down && ptr.moved < 4) { if (S.sun > 0.6 && hitSun(e.clientX, e.clientY)) tapSun(); else ping(e.clientX, e.clientY); }
  ptr.down = false;
});
// sunny side up: three taps crack the sun, then it's breakfast
const egg = { taps: 0, crack: 0, v: 0, x: 0, kick: 0, kv: 0 };
const sunPos = new THREE.Vector3(), sunEdge = new THREE.Vector3();
function hitSun(x, y) {
  sun.getWorldPosition(sunPos);
  sunEdge.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(sun.scale.x * 0.5 * 0.46).add(sunPos).project(camera);
  const c = sunPos.clone().project(camera);
  const cx = (c.x * 0.5 + 0.5) * W, cy = (-c.y * 0.5 + 0.5) * H;
  const r = Math.abs((sunEdge.x * 0.5 + 0.5) * W - cx);
  return Math.hypot(x - cx, y - cy) < r * 1.05;
}
function tapSun() {
  egg.taps++;
  egg.kv += egg.taps < 3 ? 3.2 : 5;
  if (egg.taps === 3) { CORNERS[6][3] = 'Breakfast / served'; cornerCh = -1; track('sun-cracked'); }
}
function hitWorld(x, y) {
  ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
  return hit;
}
function ping(x, y) {
  const hit = hitWorld(x, y);
  if (!hit) return;
  node(hit.clone().multiplyScalar(1.004), 2, 2.4);
  const local = world.worldToLocal(hit.clone()).normalize();
  if (local.angleTo(CRATER) < 0.022) breach(hit);
}

/* ---------- the hacker trail ----------
 * console -> robots.txt -> /vault/ (read the headers) -> security.txt -> back here.
 * The key is derived from the crater's coordinates; the vault's contents are encrypted with it. */
const KEY_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function craterLabel() {
  const lat = THREE.MathUtils.radToDeg(Math.asin(CRATER.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(CRATER.z, CRATER.x));
  return `${Math.abs(lat).toFixed(2)}${lat >= 0 ? 'N' : 'S'}/${Math.abs(lon).toFixed(2)}${lon >= 0 ? 'E' : 'W'}`;
}
let breached = false;
async function breach(hit) {
  for (let i = 0; i < 6; i++) setTimeout(() => node(hit.clone().multiplyScalar(1.004 + i * 0.012), 1, 3.2), i * 90);
  rot.v += 0.8;
  if (breached || !(window.crypto && crypto.subtle)) return;
  breached = true;
  track('crater-breached');
  const d =new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('breach/' + craterLabel())));
  let k = '';
  for (let i = 0; i < 12; i++) k += KEY_ALPHA[d[i] % 32];
  k = k.match(/.{4}/g).join('-');
  console.log('%cBREACH CONFIRMED / ' + craterLabel().replace('/', ' '), 'color:#F3E8D2;background:#E0241B;font:700 12px/1.6 monospace;padding:4px 10px');
  console.log('%cThe shield was always thinnest here. Clearance key: %c' + k, 'color:#F3E8D2;font:12px monospace', 'color:#FFB36B;font:700 13px monospace');
  console.log('%cTake it to the door you found.', 'color:#a99;font:italic 11px monospace');
}

function greet() {
  // no background: consoles paint it line by line, which shreds the shape. Signal red reads on light and dark.
  // monospace cells are ~0.6em wide and ~1.2em tall in the console, hence cols = 2 x rows for a round disc.
  const ramp = ' .:-=+*#%@';
  const rows = 21, cols = 42, out = [];
  for (let y = 0; y < rows; y++) {
    let row = '';
    for (let x = 0; x < cols; x++) {
      const nx = (x + 0.5 - cols / 2) / (cols / 2), ny = (y + 0.5 - rows / 2) / (rows / 2);
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) { row += ' '; continue; }
      const nz = Math.sqrt(1 - r2);
      const a = 0.9, px = nx * Math.cos(a) + nz * Math.sin(a), pz = -nx * Math.sin(a) + nz * Math.cos(a), py = ny;
      const n = Math.sin(px * 4.6 + 0.4) * Math.cos(py * 5.2 - 0.3) + 0.7 * Math.sin(pz * 5.9 + py * 3.3) + 0.4 * Math.sin(px * 9.7 - pz * 8.1 + py * 2);
      const l = 0.12 + 0.88 * Math.max(0, -0.5 * nx - 0.45 * ny + 0.74 * nz);
      const v = n > 0.35 ? 0.25 + 0.75 * l : 0.32 * l;
      row += ramp[Math.max(1, Math.min(ramp.length - 1, Math.floor(v * ramp.length)))];
    }
    out.push(row.replace(/\s+$/, ''));
  }
  console.log('%c' + out.join('\n'), 'color:#E0241B;font:11px monospace');
  console.log('%cKOHLI\u25CFWORLD', 'color:#F3E8D2;background:#8F0D08;font:800 18px/1.3 sans-serif;padding:4px 14px');
  console.log('%cSHIELD: ENGAGED\nAUTONOMOUS ADVERSARY: YOU', 'color:#E0241B;font:700 11px/1.6 monospace');
  console.log('%cEvery world tells robots more than it tells people.', 'color:#a99;font:italic 11px monospace');
}
greet();

// clearance, once earned in the vault, shows on every visit
let cleared = false;
try { cleared = localStorage.getItem('kw.clearance') === 'granted'; } catch (e) { /* storage blocked */ }
if (cleared) $('#clearance').hidden = false;
function geo(hit) {
  const l = world.worldToLocal(hit.clone()).normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(l.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(l.z, l.x));
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

/* =====================================================================
 * Resize
 * ===================================================================== */
function resize() {
  W = innerWidth; H = innerHeight; NARROW = W < 760;
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  rt.setSize(Math.round(W * DPR), Math.round(H * DPR));
  postMat.uniforms.uRes.value.set(W * DPR, H * DPR);
  planetMat.uniforms.uCell.value = (NARROW ? 3.4 : 4.2) * DPR;
  nMat.uniforms.uSize.value = 11 * DPR;
  buildKeys();
}
addEventListener('resize', resize);

/* =====================================================================
 * Loader: the world arrives as a mosaic, then resolves
 * ===================================================================== */
const ldN = $('#ldN');
const PIX = [96, 72, 56, 44, 34, 26, 20, 15, 11, 8, 6, 4, 3, 2, 1];
let intro = 0, loadT = 0, loaded = false;
const LOAD_DUR = REDUCE ? 0.3 : 2.6;
$('#loader').classList.add('see-through');

/* =====================================================================
 * Frame
 * ===================================================================== */
const v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
let last = performance.now(), time = 0, msAvg = 0;
const rot = { x: 0, v: 0, lean: 0, speed: 0, drift: 0, init: false };
let pScroll = 0;
const tmpTarget = new THREE.Vector3();
const toCSS = a => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
const bgEl = $('#bg');
let flagged = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  const realDt = Math.min(0.5, (now - last) / 1000);
  last = now; time += dt;
  const t0 = DEBUG ? performance.now() : 0;
  if (lenis) lenis.raf(now);

  // load sequence
  if (!loaded) {
    loadT += realDt;
    const k = clamp(loadT / LOAD_DUR, 0, 1);
    ldN.textContent = String(Math.round(k * 100)).padStart(3, '0');
    postMat.uniforms.uPixel.value = PIX[Math.min(PIX.length - 1, Math.floor(Math.pow(k, 0.8) * PIX.length))] * DPR;
    if (k >= 1) {
      loaded = true;
      body.classList.remove('loading');
      lenis?.start();
    }
  } else {
    intro = Math.min(1, intro + realDt / 1.5);
    postMat.uniforms.uPixel.value = 1;
  }

  // scroll position → state
  pScroll = clamp((lenis ? lenis.scroll : scrollY) / maxScroll(), 0, 1);
  sample(pScroll);

  // background
  const darkLoad = loaded ? smooth(0, 0.6, intro) : 0;
  const top = S.top.map(c => c * darkLoad + 10 * (1 - darkLoad));
  const bot = S.bot.map(c => c * darkLoad + 6 * (1 - darkLoad));
  bgEl.style.background = `radial-gradient(120% 90% at 50% 0%, ${toCSS(top)} 0%, ${toCSS(bot)} 78%)`;

  // camera
  camera.position.set(S.cam[0], S.cam[1], S.cam[2]);
  tmpTarget.set(S.tgt[0], S.tgt[1], S.tgt[2]);
  camera.lookAt(tmpTarget);

  // world rotation
  // scroll turns the world one even step per page; a soft spring gives it weight
  const scrollRot = lerp(KEYS[S.seg].rot, KEYS[S.seg + 1].rot, S.t);
  const lockW = clamp(S.face / 0.9, 0, 1);
  // idle drift: a slow turn on its own that eases off (~30s), capped below one page step,
  // and folded back into the page turn on the way into a locked page, so scrolling down only ever turns forward
  const DMAX = STEP * 0.8;
  // turns on its own, and scrolling pushes it along in the direction you scroll (even mid-page)
  const vel = lenis ? lenis.velocity : 0;
  const push = 0.1 + vel * 0.012;
  rot.drift += dt * push * (push > 0 ? 1 - rot.drift / DMAX : 1) * (1 - lockW);
  rot.drift = clamp(rot.drift, 0, DMAX);
  if (lockW > 0.999) rot.drift = 0;
  const rotTarget = scrollRot + rot.drift * (1 - lockW);
  if (!rot.init) { rot.x = rotTarget; rot.init = true; }
  const kS = 46, cS = 2 * Math.sqrt(kS) * 0.78;
  rot.v += (kS * (rotTarget - rot.x) - cS * rot.v) * dt;
  rot.x += rot.v * dt;
  // drag: your own spin, which eases back to the path when you let go
  userSpin += spinVel; spinVel *= 0.9;
  if (!ptr.down) userSpin *= Math.exp(-dt * 1.6);
  // lean into the scroll: the faster you travel, the more the world tilts with you
  const sv = lenis ? clamp(lenis.velocity * 0.0045, -0.24, 0.24) : 0;
  rot.lean += (sv - rot.lean) * Math.min(1, dt * 5);
  // never frozen at rest: a slow, bounded drift
  const sway = S.sway * Math.sin(time * 0.3) + S.sway * 0.35 * Math.sin(time * 0.71);
  world.rotation.set(S.tilt + sway * 0.12 + rot.lean, rot.x + sway + userSpin, 0.06 - rot.lean * 0.35);
  rot.speed = Math.abs(rot.v) + Math.abs(spinVel) * 30;

  // uniforms
  const L = planetMat.uniforms.uLight.value.set(S.light[0], S.light[1], S.light[2]).normalize();
  planetMat.uniforms.uCut.value = S.cut;
  planetMat.uniforms.uTime.value = time;
  capMat.uniforms.uTime.value = time;
  capMat.uniforms.uPulse.value = Math.pow(0.5 + 0.5 * Math.sin(time * TAU * 0.95), 6);
  capA.visible = capB.visible = S.cut > 0.003;
  capB.rotation.y = -S.cut;
  postMat.uniforms.uCA.value = S.ca * (1 + (ptr.down ? 0.6 : 0)) + Math.min(rot.speed * 0.0022, 0.007);
  postMat.uniforms.uTime.value = time;

  // shield + attack streams
  shieldLines.material.opacity = S.shield * 0.2;
  shieldPts.material.opacity = S.shield * 0.7;
  shield.rotation.y = time * 0.04;
  shield.visible = S.shield > 0.005;
  pMat.opacity = S.parts;
  streams.visible = S.parts > 0.005;
  if (streams.visible) {
    const run = REDUCE ? 0.3 : 1;
    for (let i = 0; i < NP; i++) {
      const o = i * 3;
      P.pos[o] += P.vel[o] * dt * run; P.pos[o + 1] += P.vel[o + 1] * dt * run; P.pos[o + 2] += P.vel[o + 2] * dt * run;
      const r = Math.hypot(P.pos[o], P.pos[o + 1], P.pos[o + 2]);
      if (r < 1.42) {
        v3.set(P.pos[o], P.pos[o + 1], P.pos[o + 2]).setLength(1.42);
        if (Math.random() < 0.05) {
          node(v3, 1, 4.5);
          flagged++;
        } else if (Math.random() < 0.3) node(v3, 0, 0.6);
        spawn(i, false);
      }
      const sp = Math.hypot(P.vel[o], P.vel[o + 1], P.vel[o + 2]), ln = P.len[i] / sp;
      const j = i * 6;
      pPos[j] = P.pos[o]; pPos[j + 1] = P.pos[o + 1]; pPos[j + 2] = P.pos[o + 2];
      pPos[j + 3] = P.pos[o] - P.vel[o] * ln; pPos[j + 4] = P.pos[o + 1] - P.vel[o + 1] * ln; pPos[j + 5] = P.pos[o + 2] - P.vel[o + 2] * ln;
      const k = i * 8, fade = smooth(14, 9, P.pos[o]);
      pCol[k] = P.col[o]; pCol[k + 1] = P.col[o + 1]; pCol[k + 2] = P.col[o + 2]; pCol[k + 3] = 0.95 * fade;
      pCol[k + 4] = P.col[o]; pCol[k + 5] = P.col[o + 1]; pCol[k + 6] = P.col[o + 2]; pCol[k + 7] = 0;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }
  for (let i = 0; i < NN; i++) if (nLife[i] > 0) nLife[i] -= dt;
  nGeo.attributes.position.needsUpdate = true;
  nGeo.attributes.aLife.needsUpdate = true;
  nMat.uniforms.uShield.value = S.shield;

  // orbit
  const ov = S.orbit;
  orbit.visible = ov > 0.005;
  ring.material.opacity = ov * 0.55;
  traceLine.material.opacity = ov * 0.9;
  moonMat.uniforms.uOpacity.value = ov;
  const ma = 0.55 + (pScroll - STOPS[5]) * 7 + time * 0.035;
  moon.position.set(Math.cos(ma) * RO, 0, Math.sin(ma) * RO);
  orbit.rotation.y = time * 0.01;
  gimbals.visible = S.gimbal > 0.005;
  gimbals.children.forEach((g, i) => { g.material.opacity = S.gimbal * 0.4; g.rotation.z += dt * (0.05 + i * 0.03); });
  stars.material.opacity = S.stars * 0.5;

  // sun
  sun.visible = S.sun > 0.005;
  sunMat.uniforms.uOpacity.value = S.sun;
  sunMat.uniforms.uTime.value = time;
  const rise = smooth(STOPS[6] - 0.09, STOPS[6] + 0.03, pScroll);
  sun.position.set(0, lerp(0.6, 7.2, rise), -13);
  sun.quaternion.copy(camera.quaternion);
  // the egg: a wobble per tap, then the white spreads out with a little overshoot
  egg.crack += (Math.min(egg.taps, 3) / 3 - egg.crack) * Math.min(1, dt * 10);
  egg.v += (90 * ((egg.taps >= 3 ? 1 : 0) - egg.x) - 2 * Math.sqrt(90) * 0.42 * egg.v) * dt;
  egg.x += egg.v * dt;
  egg.kv += (-140 * egg.kick - 2 * Math.sqrt(140) * 0.3 * egg.kv) * dt;
  egg.kick += egg.kv * dt;
  sunMat.uniforms.uCrack.value = egg.crack;
  sunMat.uniforms.uEgg.value = egg.x;
  sun.scale.setScalar(9 * (1 + egg.kick * 0.035));

  // night side
  const pu = planetMat.uniforms;
  pu.uNight.value = S.night;
  for (let i = 0; i < 3; i++) {
    const cur = pu.uLit.value.getComponent(i);
    pu.uLit.value.setComponent(i, cur + (litTarget[i] - cur) * Math.min(1, dt * 6));
  }

  // render
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);

  updateDOM(dt);
  if (DEBUG) { msAvg = msAvg * 0.9 + (performance.now() - t0) * 0.1; window.__kw = { ms: msAvg, S, p: pScroll, rot, keys: KEYS, crater: () => { const c = CRATER.clone().applyMatrix4(world.matrixWorld).project(camera); return [(c.x * 0.5 + 0.5) * W, (-c.y * 0.5 + 0.5) * H]; }, go: q => lenis ? lenis.scrollTo(q * maxScroll(), { immediate: true }) : scrollTo(0, q * maxScroll()) }; }
}

function updateDOM(dt) {
  const p = pScroll;
  const introK = loaded ? intro : 0;

  // which chapter are we nearest
  let ch = 0, best = 9;
  for (let i = 0; i <= LAST; i++) { const d = Math.abs(p - STOPS[i]); if (d < best) { best = d; ch = i; } }
  if (p > 0.97) ch = LAST;
  setCorners(ch);

  const vis = i => {
    let d = Math.abs(p - STOPS[i]);
    if (i === LAST) d = Math.min(d, Math.abs(p - 1));
    return 1 - smooth(0.022, 0.054, d);
  };

  // type behind the world
  wordEro.set(Math.min(smooth(0.45, 1, S.word), introK));
  dofEro.set(smooth(0.45, 1, S.dof));
  dofEl.style.opacity = S.dof > 0.01 ? 1 : 0;
  dofSunEro.set(smooth(0.45, 1, S.dofSun));
  dofSunEl.style.opacity = S.dofSun > 0.01 ? 1 : 0;

  // chapters
  for (const c of chapters) {
    let v = vis(c.i);
    if (c.i === 0) v = Math.min(v, introK);
    if (Math.abs(v - c.vis) < 0.002) continue;
    c.vis = v;
    c.el.classList.toggle('on', v > 0.001);
    c.el.style.opacity = 1;
    if (c.ero) c.ero.set(smooth(0.05, 0.95, v));
    c.parts.forEach((e, k) => {
      const lv = smooth(0.25 + k * 0.08, 0.85 + k * 0.05, v);
      e.style.opacity = lv.toFixed(3);
      e.style.translate = `0 ${((1 - lv) * 14).toFixed(1)}px`;
    });
    if (c.scrib) c.scrib.style.strokeDashoffset = (1 - smooth(0.7, 1, v)).toFixed(3);
    const card = c.el.querySelector('.end-card, .end-foot');
    if (card) c.el.querySelectorAll('.end-card, .end-foot').forEach(e => { e.style.opacity = smooth(0.4, 0.9, v).toFixed(3); });
  }

  // pins
  const camDir = v4.copy(camera.position).normalize();
  for (const pin of PINS) {
    const cv = vis(pin.ch);
    let o = 0;
    if (cv > 0.01) {
      v3.copy(pin.v).applyMatrix4(world.matrixWorld);
      const facing = pin.ch === 4 ? 1 : smooth(0.15, 0.45, v3.clone().normalize().dot(v4.copy(camera.position).sub(v3).normalize()));
      o = smooth(0.5, 1, cv) * facing;
      if (o > 0.01) {
        v3.project(camera);
        const x = (v3.x * 0.5 + 0.5) * W, y = (-v3.y * 0.5 + 0.5) * H;
        pin.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
    if (Math.abs(o - pin.o) > 0.004) { pin.el.style.opacity = o.toFixed(3); pin.o = o; }
    if (pin.city != null) pin.el.classList.toggle('hot', litTarget[pin.city] > 0);
  }

  // crosshair + geo readout
  const showCross = FINE && ptr.in && loaded && indexEl.hidden;
  cross.classList.toggle('on', showCross);
  if (showCross) {
    cxLine.style.transform = `translateY(${ptr.y}px)`;
    cyLine.style.transform = `translateX(${ptr.x}px)`;
    crossY.style.top = ptr.y + 'px'; crossX.style.top = ptr.y + 'px';
    crossY.textContent = `${String(Math.round(ptr.y)).padStart(3, '0')} Y`;
    crossX.textContent = `X ${String(Math.round(ptr.x)).padStart(3, '0')}`;
    const hit = hitWorld(ptr.x, ptr.y);
    if (S.sun > 0.6 && hitSun(ptr.x, ptr.y)) { crossGeo.style.opacity = 0; canvas.style.cursor = 'pointer'; }
    else if (hit && S.sun < 0.5) {
      crossGeo.textContent = geo(hit);
      crossGeo.style.transform = `translate(${ptr.x + 14}px, ${ptr.y + 12}px)`;
      crossGeo.style.opacity = 1;
      canvas.style.cursor = 'grab';
    } else { crossGeo.style.opacity = 0; canvas.style.cursor = ''; }
  }

  $('#scrollHint').style.opacity = loaded && !cleared ? (1 - smooth(0.005, 0.03, p)) * introK : 0;
  const eta = $('#eta');
  void 0;
}

/* =====================================================================
 * Start
 * ===================================================================== */
resize();
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { resize(); });
requestAnimationFrame(frame);
