import { speakerHolesGLSL } from './glsl-speaker.js?v=202610071417';
import { partsGLSL } from './glsl-parts.js?v=202610071417';

/**
 * Block-view shaders: the object as the hard primitives it is built from.
 *
 * gbufferShader (device res) — raymarches the blocks, writes id, depth, normal.
 * edgeShader    (device res) — "lines" view: a line wherever the id changes,
 *   depth jumps or the surface folds; only what the camera sees survives.
 *
 * The blocks are the real parts inside (servos, brain, speaker module, encoder…)
 * plus the provisional structure that ties them together.
 * Ids: 1 frame bar · 2/3 wheels · 4 neck · 6/7 eyes · 8 knob caps (provisional:
 *      not in the component library) · 40+i library parts (servos, boards, LED
 *      matrix, speaker, encoder…). Ids below 20 are provisional; 40 and up are real.
 */

/* ---------- shared: uniforms + scene ---------- */

const header = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uFocal;
uniform vec2  uCenterDev;
uniform vec3  uBoundC;
uniform float uBoundR;

// provisional structure (animated with springs)
uniform vec2  uWL;
uniform vec2  uWR;
uniform vec2  uScr;
uniform vec3  uScrHalf;
uniform float uEyes;

// fixed components (raw state: they follow the hand exactly)
uniform vec2  uCWL;
uniform vec2  uCWR;
uniform vec2  uCScr;
uniform float uWheelR;
uniform float uWheelHalfW;
uniform vec2  uDispHalf;
uniform float uDispOffY;

#define MAX_EXTRAS 6
uniform int   uExtraCount;
uniform vec3  uExtraP[MAX_EXTRAS];
uniform vec3  uExtraN[MAX_EXTRAS];
uniform vec4  uExtraInfo[MAX_EXTRAS];
uniform vec3  uSpk;
uniform vec3  uKnob;

uniform float uSmooth;    // fillet radius between blocks (0 = hard blocks, as in the lines view)

out vec4 outColor;
`;

const scene = speakerHolesGLSL + partsGLSL + /* glsl */ `
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdCylinder(vec3 p, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, pa = p - a;
  float baba = dot(ba, ba), paba = dot(pa, ba);
  float x = length(pa * baba - ba * paba) - r * baba;
  float y = abs(paba - baba * 0.5) - baba * 0.5;
  float x2 = x * x, y2 = y * y * baba;
  float d = (max(x, y) < 0.0) ? -min(x2, y2) : (((x > 0.0) ? x2 : 0.0) + ((y > 0.0) ? y2 : 0.0));
  return sign(d) * sqrt(abs(d)) / baba;
}

// hard union: keeps the nearer block
void pick(inout vec2 best, float d, float id) {
  if (d < best.x) best = vec2(d, id);
}

// soft union: a small fillet where blocks meet (uSmooth mm); id of the nearer block
void blend(inout vec2 best, float d, float id) {
  if (uSmooth < 0.01) { pick(best, d, id); return; }
  float h = max(uSmooth - abs(best.x - d), 0.0) / uSmooth;
  best = vec2(min(best.x, d) - h * h * uSmooth * 0.25, d < best.x ? id : best.y);
}

/** x = distance, y = block id */
vec2 scene(vec3 p) {
  vec2 b = vec2(1e9, 0.0);

  // provisional structure: frame bar, neck, eyes
  blend(b, sdCapsule(p, uChassisA, uChassisB, uChassisR), 1.0);
  if (uNeckR > 0.5) blend(b, sdCapsule(p, uNeckA, uNeckB, uNeckR), 4.0);
  if (uEyes > 0.01) {
    vec3 eh = vec3(9.0, 7.0, 10.0) * uEyes;
    float ey = uScr.y + uScrHalf.y + 7.0 * uEyes * 0.6;
    float ex = uScrHalf.x - 11.0;
    blend(b, sdBox(p - vec3(uScr.x - ex, ey, 0.0), eh), 6.0);
    blend(b, sdBox(p - vec3(uScr.x + ex, ey, 0.0), eh), 7.0);
  }

  // real parts inside: servos, brain, speaker module, encoder...
  for (int i = 0; i < uPartCount; i++) {
    pick(b, partModel(i, p).x, 40.0 + float(i));
  }
  pick(b, cablesSDF(p).x, 30.0);                                  // cables

  // not in the library, so provisional: knob caps and wheels (they spin: no blend)
  for (int i = 0; i < uExtraCount; i++) {
    if (uExtraInfo[i].y < 0.01 || uExtraInfo[i].x < 0.5) continue;
    pick(b, knobModel(i, p, uKnob).x, 8.0);
  }
  vec3 ql = p - vec3(uCWL, 0.0);
  ql.x = -ql.x;
  pick(b, wheelModel(ql).x, 2.0);
  pick(b, wheelModel(p - vec3(uCWR, 0.0)).x, 3.0);

  // speaker: hole pattern cut into the front of the speaker module
  b.x = max(b.x, -speakerHoles(p));
  return b;
}

vec3 calcNormal(vec3 p) {
  // tetrahedron of 4 samples, written as a loop so the scene is compiled once
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4 + uZero; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += e * scene(p + e * 0.25).x;
  }
  return normalize(n);
}

/** Real parts carry their own surface detail in their models, so ids stay as they are. */
float detailId(vec3 p, float id) {
  return id;
}

/** Primary ray through this pixel, clipped to the bounding sphere. Returns false on a miss. */
bool primaryRay(out vec3 ro, out vec3 rd, out float t, out float tEnd) {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) return false;
  float sq = sqrt(disc);
  t = max(0.0, -bb - sq);
  tEnd = -bb + sq;
  return true;
}
`;

/* ---------- g-buffer (for the lines view) ---------- */

export const gbufferShader = header + /* glsl */ `
uniform float uNear;
uniform float uFar;
` + scene + /* glsl */ `
// octahedral normal encoding into two 0..1 values
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 s = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  vec2 o = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * s;
  return o * 0.5 + 0.5;
}

void main() {
  vec3 ro, rd;
  float t, tEnd;
  if (!primaryRay(ro, rd, t, tEnd)) { outColor = vec4(0.0); return; }

  vec2 h = vec2(1e9, 0.0);
  bool hit = false;
  for (int i = 0; i < 128; i++) {
    h = scene(ro + rd * t);
    if (h.x < 0.05) { hit = true; break; }
    t += h.x;
    if (t > tEnd) break;
  }
  if (!hit) { outColor = vec4(0.0); return; }

  vec3 p = ro + rd * t;
  float id = detailId(p, h.y);
  float depth = clamp((t - uNear) / (uFar - uNear), 0.0, 1.0);
  outColor = vec4(id / 255.0, depth, octEncode(calcNormal(p)));
}
`;

/* ---------- lines view ---------- */

export const edgeShader = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uG;
uniform float uAlpha;
uniform vec3  uFixed;   // line colour for fixed parts
uniform vec3  uBody;    // line colour for provisional blocks

out vec4 outColor;

float idOf(vec4 g) { return floor(g.r * 255.0 + 0.5); }

vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lim = textureSize(uG, 0) - 1;
  vec4 c = texelFetch(uG, p, 0);
  float idc = idOf(c);
  if (idc == 0.0) { outColor = vec4(0.0); return; }
  float dc = c.g;
  vec3 nc = octDecode(c.ba);

  bool edge = false;
  ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  for (int k = 0; k < 4; k++) {
    vec4 q = texelFetch(uG, clamp(p + offs[k], ivec2(0), lim), 0);
    float idq = idOf(q);
    float dq = idq > 0.0 ? q.g : 2.0; // background = infinitely far
    // draw on the nearer side only, so lines stay one pixel wide
    if (dc > dq) continue;
    if (abs(dc - dq) < 1e-4 && idc < idq) continue;
    if (idq != idc || abs(dc - dq) > 0.015 || (idq > 0.0 && dot(nc, octDecode(q.ba)) < 0.8)) edge = true;
  }
  if (!edge) { outColor = vec4(0.0); return; }
  vec3 col = idc >= 20.0 ? uFixed : uBody;
  outColor = vec4(col * uAlpha, uAlpha);
}
`;
