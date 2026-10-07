import { speakerHolesGLSL } from './glsl-speaker.js?v=202610071438';
import { partsGLSL } from './glsl-parts.js?v=202610071438';

/**
 * Body shaders (GLSL ES 3.00 / WebGL2).
 * Kept as JS template strings so they load with or without a bundler.
 *
 * The "dots" view is drawn by cloudShader (a point cloud on the surface).
 * The older screen-space dithered grid below is kept as an alternative
 * (debug panel → dot style). It uses three passes, all on a full-screen quad:
 *
 * levelShader  (grid res, one fragment per dot cell)
 *   raymarches the 3D scene (components + provisional body) through the
 *   cell centre → lit tone → ordered dithering → target state per cell:
 *   solid dot, ring, or empty (+ the tone, which also sets dot size).
 *
 * easeShader   (grid res, ping-pong)
 *   moves each cell's current state toward its target, so dots grow and
 *   shrink in smoothly instead of popping.
 *
 * dotShader    (device res)
 *   draws each cell as an antialiased solid dot or hollow ring, with a
 *   cursor lens and a release ripple.
 */

export const vertexShader = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/* ------------------------------------------------------------------ */

const levelCommon = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

// --- grid (device px, bottom-left origin) ---
uniform float uCell;      // device px per cell
uniform vec2  uOffset;    // device px of the lower-left corner of cell (1,1)
uniform float uSplitX;    // device px x of the compare split line
uniform float uTime;      // drift clock (already scaled by drift speed)

// --- camera (world mm) ---
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uFocal;     // device px
uniform vec2  uCenterDev; // device px of the optical centre
uniform vec3  uBoundC;    // bounding sphere for early ray rejection
uniform float uBoundR;
uniform vec3  uLight;

// --- components (animated, mm; all sit on z = 0) ---
uniform vec2  uWL;
uniform vec2  uWR;
uniform float uWheelR;
uniform float uWheelHalfW;
uniform vec2  uScr;
uniform vec3  uScrHalf;
uniform vec2  uDispHalf;
uniform float uDispOffY;

// --- body shape: an envelope grown around the real parts (see parts.js) ---
uniform float uEyes;      // 0..1, frog eyes on top of the screen
uniform float uPad;       // envelope thickness around the parts
uniform vec4  uStretch;   // stretch node: xy = centre (mm), zw = factor in x, y (1 = as fitted)
uniform float uBlend;

// --- cursor influence ---
uniform vec2  uMouse;     // mm on the z = 0 plane
uniform float uMouseAmt;
uniform float uReach;

// --- surface-mounted add-ons ---
#define MAX_EXTRAS 6
uniform int   uExtraCount;
uniform vec3  uExtraP[MAX_EXTRAS];    // contact point on the surface
uniform vec3  uExtraN[MAX_EXTRAS];    // surface normal
uniform vec4  uExtraInfo[MAX_EXTRAS]; // x = type (0 speaker, 1 knob), y = grow-in scale, z = angle (rad)
uniform vec3  uSpk;                   // speaker: hole-pattern radius, hole radius, hole depth
uniform vec3  uKnob;                  // knob:    radius, height, mounting-pad radius

// --- look ---
uniform float uSoft;
uniform float uBreathe;
uniform float uExposure;
uniform float uDriftAmt;
uniform int   uMethod;    // 0 bayer, 1 blue noise, 2 split compare
uniform bool  uRings;
uniform float uRingAmt;
uniform sampler2D uBlue;

layout(location = 0) out vec4 outColor;

// ---------- SDF primitives (Inigo Quilez) ----------

float sdRoundBox(vec3 p, vec3 b, float r) {
  r = min(r, min(b.x, min(b.y, b.z)));
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// rounded cylinder with its axis along x (a wheel)
float sdWheel(vec3 p, float r, float hw) {
  float e = 3.0;
  vec2 d = vec2(length(p.yz) - r + e, abs(p.x) - hw + e);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - e;
}

// capped cylinder between points a and b (IQ)
float sdCappedCylinder(vec3 p, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, pa = p - a;
  float baba = dot(ba, ba), paba = dot(pa, ba);
  float x = length(pa * baba - ba * paba) - r * baba;
  float y = abs(paba - baba * 0.5) - baba * 0.5;
  float x2 = x * x, y2 = y * y * baba;
  float d = (max(x, y) < 0.0) ? -min(x2, y2) : (((x > 0.0) ? x2 : 0.0) + ((y > 0.0) ? y2 : 0.0));
  return sign(d) * sqrt(abs(d)) / baba;
}

float smin(float a, float b, float k) {
  k = max(k, 1e-3);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// ---------- noise ----------

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                 mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                 mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// ---------- scene ----------

${speakerHolesGLSL}
${partsGLSL}
/** Protruding add-on geometry (knobs); idx = which add-on is closest. */
float extrasSDF(vec3 p, out float idx) {
  float d = 1e9;
  idx = 0.0;
  for (int i = 0; i < uExtraCount; i++) {
    if (uExtraInfo[i].y < 0.01 || uExtraInfo[i].x < 0.5) continue;
    float e = knobModel(i, p, uKnob).x;
    if (e < d) { d = e; idx = float(i); }
  }
  return d;
}

/**
 * Provisional enclosure: a smooth envelope around the real parts inside
 * (servos, brain, speaker module, encoder...), the frame bar and the neck.
 */
/** Case 2 primitive i: a 2D profile extruded from the front (z = uPrimZ.x) to the back. */
float primSDF(int i, vec3 p) {
  vec2 q = p.xy - uPrimC[i];
  float r = uPrimRound[i];
  float d2;
  int kind = uPrimKind[i];
  if (kind == 1) {
    vec2 b = abs(q) - uPrimH[i] + r;
    d2 = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - r;
  } else if (kind == 2) {
    d2 = length(q) - uPrimA[i];
  } else if (kind == 4) {
    d2 = max(length(q) - uPrimA[i], -(q.y + uPrimH[i].y));
  } else {
    d2 = -1e5;
    for (int k = 0; k < uPrimN[i]; k++) {
      float an = uPrimRot[i] + 6.2831853 * float(k) / float(uPrimN[i]);
      d2 = max(d2, dot(q, vec2(cos(an), sin(an))) - uPrimA[i]);
    }
  }
  vec2 Z = uPrimZ[i];
  float zc = 0.5 * (Z.x + Z.y), hz = 0.5 * (Z.x - Z.y);
  vec2 w = vec2(d2 + r, abs(p.z - zc) - hz + r);     // softened edges
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - r;
}

float bodySDF0(vec3 p) {
  if (uPrimCount > 0) {
    float d = 1e9;
    for (int i = 0; i < uPrimCount; i++) d = min(d, primSDF(i, p));
    d += sin(p.x * 0.06 + uTime * 0.9) * sin(p.y * 0.05 - uTime * 0.7) * sin(p.z * 0.07 + uTime * 0.5) * uBreathe * 0.4;
    vec2 dm = p.xy - uMouse;
    d -= uMouseAmt * uReach * 0.5 * exp(-dot(dm, dm) / (26.0 * 26.0)) * smoothstep(60.0, 0.0, abs(p.z));
    return d;
  }
  float k = uBlend;
  float d = 1e9;
  for (int i = 0; i < uPartCount; i++) {
    d = smin(d, partSDF(i, p), k);
  }
  d = smin(d, sdCapsule(p, uChassisA, uChassisB, uChassisR), k);
  if (uNeckR > 0.5) d = smin(d, sdCapsule(p, uNeckA, uNeckB, uNeckR), k);

  // eyes: two blocks growing out of the top corners of the screen
  if (uEyes > 0.01) {
    vec3 eh = vec3(9.0, 7.0, 10.0) * uEyes;
    float ey = uScr.y + uScrHalf.y + eh.y * 0.6;
    float ex = uScrHalf.x - 11.0;
    d = smin(d, sdRoundBox(p - vec3(uScr.x - ex, ey, 0.0), eh, 3.0 * uEyes), 4.0);
    d = smin(d, sdRoundBox(p - vec3(uScr.x + ex, ey, 0.0), eh, 3.0 * uEyes), 4.0);
  }

  // slow breathing of the surface: a direction, not a decision
  d += sin(p.x * 0.06 + uTime * 0.9) * sin(p.y * 0.05 - uTime * 0.7) * sin(p.z * 0.07 + uTime * 0.5) * uBreathe;

  // leans toward a nearby cursor
  vec2 dm = p.xy - uMouse;
  d -= uMouseAmt * uReach * exp(-dot(dm, dm) / (26.0 * 26.0)) * smoothstep(60.0, 0.0, abs(p.z));

  return d - uPad;
}

/** The skin, stretched in x / y around uStretch.xy by uStretch.zw (the stretch node); the parts inside stay as they are. */
float bodySDF(vec3 p) {
  vec2 s = uStretch.zw;
  if (s.x <= 0.0 || (s.x == 1.0 && s.y == 1.0)) return bodySDF0(p);
  vec3 q = vec3(uStretch.xy + (p.xy - uStretch.xy) / s, p.z);
  return bodySDF0(q) * min(s.x, s.y);
}

/**
 * Everything that is NOT a library part: the skin grown around the parts, the
 * wheels and the knob caps. All of it is provisional and drawn as points; the
 * real parts are drawn separately, solid (see the cloud shader).
 * y = 1 (provisional) — kept as vec2 for the shared marching code.
 */
vec2 scene(vec3 p) {
  float d = bodySDF(p);
  d = min(d, wheelsModel(p, uWL, uWR).x);   // wheels spin free: plain union, no blend
  float ei;
  d = min(d, extrasSDF(p, ei));             // knob caps
  return vec2(max(d, -speakerHoles(p)), 1.0);
}

vec3 calcNormal(vec3 p) {
  // tetrahedron of 4 samples, written as a loop so the scene is compiled once
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4 + uZero; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += e * scene(p + e * 0.5).x;
  }
  return normalize(n);
}

// ---------- dithering ----------

float bayer8(ivec2 p) {
  int x = p.x & 7, y = p.y & 7;
  int a = x ^ y;
  int v = ((a & 1) << 5) | ((y & 1) << 4) | ((a & 2) << 2) | ((y & 2) << 1) | ((a & 4) >> 1) | ((y & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}

float threshold(ivec2 p, bool useBlue) {
  return useBlue ? texelFetch(uBlue, p & 63, 0).r : bayer8(p);
}

`;

export const levelShader = levelCommon + /* glsl */ `
uniform float uEdgeFocus;   // 0 dots follow the light · 1 dots gather on the outline (grazing edges)
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 centerDev = (vec2(ip) - 0.5) * uCell + uOffset;

  // primary ray through the cell centre
  vec2 o = (centerDev - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;

  // early out against the bounding sphere
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  bool hit = false;
  float minD = 1e9;
  float minMat = 0.0;
  vec2 h = vec2(0.0);
  for (int i = 0; i < 96; i++) {
    h = scene(ro + rd * t);
    if (h.x < minD) { minD = h.x; minMat = h.y; }
    if (h.x < 0.25) { hit = true; break; }
    t += h.x * 0.85; // conservative: the breathing noise bends the field slightly
    if (t > tEnd) break;
  }

  bool useBlue = uMethod == 1 || (uMethod == 2 && centerDev.x >= uSplitX);
  float th = threshold(ip, useBlue);
  float th2 = hash(vec2(ip) * 0.7123 + 3.17);  // per-cell random for rings

  float solid = 0.0, ring = 0.0, tone = 0.0;

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float mat = h.y;

    // shading: key light + a little camera-facing fill
    float diff = max(dot(n, normalize(uLight)), 0.0);
    float facing = max(dot(n, -rd), 0.0);
    tone = 0.03 + 0.9 * diff + 0.12 * facing * facing;
    tone = pow(tone, 1.35); // deepen the shadow side so the volume reads

    // the dark display area on the front face of the screen
    vec3 q = p - vec3(uScr, 0.0);
    if (mat < 0.5 && q.z > uScrHalf.z - 1.5 &&
        abs(q.x) < uDispHalf.x && abs(q.y - uDispOffY) < uDispHalf.y) tone *= 0.22;

    // speaker holes read as dark pits
    if (speakerHoles(p) < 0.4) tone *= 0.1;

    // knob: indicator mark on its top face
    if (mat > 1.5) {
      int i = int(mat - 2.0 + 0.5);
      vec3 P = uExtraP[i], N = uExtraN[i];
      vec4 info = uExtraInfo[i];
      vec3 rel = p - P;
      float axial = dot(rel, N);
      vec3 radialV = rel - N * axial;
      if (axial > uKnob.y * info.y - 1.0) {
        vec3 a = abs(N.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
        vec3 u = normalize(cross(N, a));
        vec3 v = cross(N, u);
        vec3 dir = cos(info.z) * u + sin(info.z) * v;
        float along = dot(radialV, dir);
        float perp = length(radialV - dir * along);
        tone = (along > 0.0 && perp < 1.7) ? 1.0 : tone * 0.7;
      }
    }

    float isBody = step(0.5, mat) * step(mat, 1.5);

    // drifting clusters on the provisional body only
    tone += isBody * (noise3(p * 0.03 + vec3(-uTime * 0.3, uTime * 0.5, 0.0)) - 0.5) * uDriftAmt;
    tone = clamp(tone * uExposure, 0.0, 1.0);
    // edge focus: where the surface turns away (the outline as seen) takes over from the light
    float edgeness = smoothstep(0.35, 0.92, 1.0 - facing);
    float want = mix(tone, edgeness * uExposure, uEdgeFocus);

    bool on = want > th;
    solid = on ? 1.0 : 0.0;

    // the grazing edge of the body is "undecided": some dots turn into rings
    if (uRings && isBody > 0.5) {
      float band = smoothstep(0.45, 0.95, 1.0 - facing);
      if (on && band * uRingAmt > th2) { solid = 0.0; ring = 1.0; }
      else if (!on && band * uRingAmt * 0.5 > th2) ring = 1.0;
    }
  } else if (uRings && minMat > 0.5 && minMat < 1.5) {
    // near miss around the silhouette of the body: a sparse halo of rings
    float band = 1.0 - smoothstep(0.0, uSoft, minD);
    if (band * uRingAmt * 0.35 > th2) { ring = 1.0; tone = 0.5; }
  }

  outColor = vec4(solid, ring, tone, 1.0);
}
`;

/* ------------------------------------------------------------------ */

export const easeShader = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uTarget;
uniform sampler2D uPrev;
uniform float uK;       // fraction of the remaining distance to cover this frame

out vec4 outColor;

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 target = texelFetch(uTarget, ip, 0).rgb;
  vec3 prev = texelFetch(uPrev, ip, 0).rgb;
  vec3 diff = target - prev;
  // exponential approach, with a minimum step so 8-bit storage never stalls
  vec3 stepv = sign(diff) * min(abs(diff), max(abs(diff) * uK, vec3(3.0 / 255.0)));
  outColor = vec4(prev + stepv, 1.0);
}
`;

/* ------------------------------------------------------------------ */

export const dotShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uState;  // per cell: r = solid amount, g = ring amount, b = light (tone)
uniform float uCell;       // device px per cell
uniform vec2  uOffset;     // device px of cell (1,1)'s lower-left corner
uniform float uDot;        // max dot diameter as a fraction of the cell
uniform float uSizeByLight; // how much dot size follows the lighting
uniform float uLine;       // ring stroke width, device px
uniform vec3  uColor;
uniform float uAlpha;      // cross-fade with the blocks view

uniform vec2  uMouseDev;   // cursor, device px
uniform float uMouseAmt;
uniform float uLensR;      // device px

uniform vec2  uRippleDev;  // ripple origin, device px
uniform float uRippleT;    // seconds since release (large = inactive)
uniform float uScanT;      // 0..1 progress of the "thinking" scan (outside = inactive)
uniform float uHeight;     // canvas height, device px

out vec4 outColor;

void main() {
  vec2 g = (gl_FragCoord.xy - uOffset) / uCell + 1.0;
  ivec2 cell = ivec2(floor(g));
  vec3 st = texelFetch(uState, cell, 0).rgb;
  if (st.r + st.g < 0.004) { outColor = vec4(0.0); return; }

  vec2 cellCenter = (vec2(cell) - 0.5) * uCell + uOffset;

  // cursor lens: dots swell slightly under the pointer
  vec2 dm = cellCenter - uMouseDev;
  float lens = uMouseAmt * exp(-dot(dm, dm) / (uLensR * uLensR));

  // release ripple: one expanding wave of swelling dots
  float rd = length(cellCenter - uRippleDev);
  float front = uRippleT * 900.0;
  float wave = exp(-pow((rd - front) / (uCell * 2.2), 2.0)) * exp(-uRippleT * 2.5);

  // scan: a horizontal band sweeping upward while a prompt reshapes the object
  float scan = 0.0;
  if (uScanT > 0.0 && uScanT < 1.0) {
    float sy = mix(-0.1, 1.1, uScanT) * uHeight;
    scan = exp(-pow((cellCenter.y - sy) / (uCell * 3.0), 2.0)) * sin(uScanT * 3.14159);
  }

  float scale = 1.0 + 0.32 * lens + 0.45 * wave + 0.7 * scan;
  float R = 0.5 * uDot * uCell * scale;
  float dist = length(fract(g) - 0.5) * uCell;

  // solid dot grows with its eased amount
  float rs = R * st.r * mix(1.0, 0.35 + 0.65 * st.b, uSizeByLight);
  float aSolid = (1.0 - smoothstep(rs - 0.6, rs + 0.6, dist)) * step(0.01, st.r);

  // ring: fixed radius, stroke fades in with its eased amount
  float rr = R - uLine * 0.5;
  float aRing = (1.0 - smoothstep(uLine * 0.5 - 0.6, uLine * 0.5 + 0.6, abs(dist - rr))) * st.g;

  float a = max(aSolid, aRing) * uAlpha;
  outColor = vec4(uColor * a, a); // premultiplied
}
`;

/* ------------------------------------------------------------------ */

/**
 * cloudShader (device res) — the "dots" view as a point cloud on the surface.
 * Points live on a jittered 3D lattice, so they stick to the object as it turns
 * and gather naturally toward the silhouette. Only the provisional body (the
 * envelope around the real parts), the wheels and the knob caps — everything
 * that is not in the component library — are dotted. Library parts are solid
 * and show through the gaps between the points, through the speaker holes and
 * through the window over the LED matrix.
 */
export const cloudShader = levelCommon + /* glsl */ `
uniform float uAlpha;      // cross-fade with the block views
uniform float uSpacing;    // mm between cloud points
uniform float uDotR;       // dot radius, mm
uniform vec3  uDotColor;
uniform vec3  uFixedLo;    // solid parts: darkest → lightest tone band
uniform vec3  uFixedHi;
uniform vec3  uDark;       // display
uniform vec3  uSolidLight;
uniform vec3  uWinC;       // window in the skin over the LED matrix (centre, half size)
uniform vec3  uWinH;

uniform vec2  uMouseDev;   // cursor, device px
uniform float uLensR;
uniform vec2  uRippleDev;  // ripple origin, device px
uniform float uRippleT;
uniform float uScanT;      // 0..1 prompt scan progress (outside = inactive)
uniform float uHeight;     // canvas height, device px

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/**
 * Distance along the surface from p to the nearest cloud point. Only lattice
 * points within half a spacing of the tangent plane count, so the density per
 * area is the same however the surface is oriented.
 */
/**
 * Coverage of the cloud points at p (0..1). Points live on a jittered 3D
 * lattice, each wandering slowly around its home with its own size and a soft
 * twinkle, so the skin reads as a living swarm rather than a wobbling jelly.
 * Only lattice points within half a spacing of the tangent plane count.
 */
float cloudCover(vec3 p, vec3 n, float rBase, float fp, float graze, float shade) {
  vec3 c = floor(p / uSpacing);
  float cover = 0.0;
  // tone of the point: dark in the shade and towards the edge
  float tone = clamp(max(shade, 0.8 * graze), 0.0, 1.0);
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 cell = c + vec3(x, y, z);
    vec3 h = hash33(cell);
    vec3 h2 = hash33(cell + 17.31);
    // almost regular lattice (like a scan): only a breath of jitter and wander
    vec3 wander = 0.05 * vec3(sin(uTime * 0.9 + h2.x * 6.283), sin(uTime * 0.7 + h2.y * 6.283), sin(uTime * 1.1 + h2.z * 6.283));
    vec3 q = (cell + 0.5 + 0.12 * (h - 0.5) + wander) * uSpacing;
    vec3 d = q - p;
    float dn = dot(d, n);
    if (abs(dn) > 0.5 * uSpacing) continue;
    // in the light the points thin out and shrink to specks; in the shade they are big and dense
    if (h.y > mix(0.35, 1.0, smoothstep(0.0, 0.5, tone))) continue;
    float r = max(rBase * mix(0.3, 1.35, tone) * (0.9 + 0.2 * h2.x), fp * 0.6);
    float dist = length(d - n * dn);
    float a = 1.0 - smoothstep(r - fp * 0.5, r + fp * 0.5, dist);
    cover = max(cover, a);
  }
  return cover;
}

/** Flat tone bands for the solid parts (same look as the solid view). */
float bands(float x) {
  float v = x * 4.0;
  float w = fwidth(v);
  float q = floor(v) + smoothstep(1.0 - w, 1.0, fract(v));
  return clamp(q / 3.0, 0.0, 1.0);
}

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;

  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  bool hit = false;
  vec2 h = vec2(0.0);
  for (int i = 0; i < 90; i++) {
    h = scene(ro + rd * t);
    if (h.x < 0.15) { hit = true; break; }
    t += h.x * 0.85; // conservative: the breathing noise bends the field slightly
    if (t > tEnd) break;
  }
  if (!hit) { outColor = cablesOnly(ro, rd, max(0.0, -bb - sq), tEnd) * uAlpha; return; }

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  float mat = h.y;

  // openings in the skin: the speaker holes and the window over the LED matrix
  vec3 qw = p - uWinC;
  bool open = speakerHoles(p) < 0.4 ||
              (abs(qw.x) < uWinH.x && abs(qw.y) < uWinH.y && qw.z > -uWinH.z - 1.0);

  // provisional (skin, wheels, knob caps): points on the surface
  vec2 px = gl_FragCoord.xy;
  vec2 dm = px - uMouseDev;
  float lens = uMouseAmt * exp(-dot(dm, dm) / (uLensR * uLensR));
  float rdist = length(px - uRippleDev);
  float wave = exp(-pow((rdist - uRippleT * 900.0) / 40.0, 2.0)) * exp(-uRippleT * 2.5);
  float scan = 0.0;
  if (uScanT > 0.0 && uScanT < 1.0) {
    float sy = mix(-0.1, 1.1, uScanT) * uHeight;
    scan = exp(-pow((px.y - sy) / 30.0, 2.0)) * sin(uScanT * 3.14159);
  }

  float fp = t / uFocal;                                    // mm covered by one device px here
  float r = max(uDotR * (1.0 + 0.4 * lens + 0.6 * wave + 0.8 * scan), fp * 0.75);
  float graze = 1.0 - abs(dot(n, -rd));
  float shade = 1.0 - smoothstep(0.15, 0.85, max(dot(n, normalize(uLight)), 0.0));
  float a = open ? 0.0 : cloudCover(p, n, r, fp, smoothstep(0.35, 0.85, graze), shade);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool behind = false;     // a real part behind this pixel?

  // look inside: the real parts are solid
  {
    // start a little in front of the skin: flush faces (the LED matrix) may sit just outside it
    float ti = -4.0;
    int idx = 0;
    for (int i = 0; i < 44; i++) {
      vec3 pi = p + rd * ti;
      float e = partsSDF(pi, idx);
      vec2 cb = cablesSDF(pi);
      bool isCable = cb.x < e;
      e = min(e, cb.x);
      if (e < 0.05) {
        vec3 ni = vec3(0.0);
        for (int j = 0; j < 4 + uZero; j++) {
          vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
          ni += k * (isCable ? cablesSDF(pi + k * 0.3).x : partModel(idx, pi + k * 0.3).x);
        }
        ni = normalize(ni);
        // real colours, simple light: soft key + fill, a small highlight on metal, LEDs glow
        float mat = isCable ? -1.0 : partModel(idx, pi).y;
        vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
        vec3 L = normalize(uLight);
        float diff = max(dot(ni, L), 0.0);
        vec3 shaded = base * (0.62 + 0.55 * diff + 0.12 * max(ni.y, 0.0));
        shaded = mix(shaded, vec3(1.0), 0.1);                         // a little air: light, not heavy
        if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
          shaded += vec3(0.45) * pow(max(dot(reflect(-L, ni), -rd), 0.0), 20.0);
        if (mat == M_LED_LIT) shaded = base * 1.15;
        if (!isCable && idx == uHi) shaded = mix(shaded, vec3(0.95, 0.3, 0.2), 0.5); // hovered in the list
        col = min(shaded, vec3(1.0));
        alpha = 1.0;
        behind = true;
        break;
      }
      ti += max(e, 0.05);
      if (ti > 140.0) break;
    }
  }
  // the skin's points: ink over the background, white over the parts (a clear skin around them)
  vec3 dotCol = behind ? vec3(0.97) : uDotColor;
  col = mix(col, dotCol, a);
  alpha = max(alpha, a);
  outColor = vec4(col * uAlpha, alpha * uAlpha);
}
`;

/* ------------------------------------------------------------------ */

/**
 * flatShader (device res) — the "flat" view: 2D graphics in 3D, on paper.
 * Library parts are flat ink shapes (a few in accent colours); the provisional
 * skin, the wheels and the knob caps are only a grainy coloured contour; the
 * cables are coloured pencil strokes. No lighting at all.
 */
export const flatShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform vec3  uFInk;
uniform vec3  uFRed;
uniform vec3  uFBlue;
uniform vec3  uFGreen;
uniform vec3  uFOrange;
uniform vec3  uTypeColor[13];   // one colour per kind of part (flat view)
uniform float uSketch;          // 1 = hand-drawn grain and wobble ("flat"), 0 = clean ("flat 2")
uniform float uAnim;            // 1 = flat hd 2: after a view change the contour draws itself in
uniform float uDrawT;           // redraw clock 0..1
uniform sampler2D uStroke;      // when the pen passes each spot (strokes.js)
uniform float uStrokeK;
uniform sampler2D uG;           // flat hd 2: flat g-buffer with face classes (the corners)
uniform float uLineW;

float grain(vec2 px) { return hash(floor(px)); }

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;
  vec2 px = gl_FragCoord.xy;

  // 1) the provisional skin: only its contour will be drawn
  float t = t0, minD = 1e9, tMin = t0;
  bool hitS = false;
  for (int i = 0; i < 90; i++) {
    float h = scene(ro + rd * t).x;
    if (h < minD) { minD = h; tMin = t; }
    if (h < 0.15) { hitS = true; break; }
    t += h * 0.85;
    if (t > tEnd) break;
  }

  // 2) library parts and cables, seen through the skin
  float tp = t0;
  int idx = 0;
  bool hitP = false, isCable = false;
  float cableAlb = 0.0;
  for (int i = 0; i < 80; i++) {
    vec3 q = ro + rd * tp;
    float e = partsSDF(q, idx);
    vec2 cb = cablesSDF(q);
    bool c = cb.x < e;
    e = min(e, cb.x);
    if (e < 0.05) { hitP = true; isCable = c; cableAlb = cb.y; break; }
    tp += max(e, 0.05);
    if (tp > tEnd) break;
  }

  vec4 col = vec4(0.0);
  if (hitP) {
    vec3 fill;
    if (isCable) {
      // cables: pencil strokes, coloured by kind (power red, I²C blue, servo bus green)
      int code = int(cableAlb + 0.5);
      fill = code == 0 ? uFGreen : (code == 2 || code == 3 || code == 6) ? uFRed : (code == 1 || code == 7) ? uFBlue : code == 4 ? uFOrange : uFInk;
    } else {
      fill = uTypeColor[uPartType[idx]];        // every kind of part has its own colour
      if (idx == uHi) fill = uFInk;             // hovered in the list
    }
    float a = isCable ? mix(1.0, 0.75 + 0.25 * grain(px * 0.7), uSketch) : 1.0;
    col = vec4(fill * a, a);
  }

  // 3) the skin's contour, drawn on top like a coloured line on paper
  float fp = (hitS ? t : tMin) / uFocal;                       // mm per device px
  float wob = mix(1.0, 0.75 + 0.5 * noise3(vec3(px * 0.05, 0.0)), uSketch); // hand-drawn width wobble
  float w = 1.8 * fp * wob;
  float edge = 0.0;
  vec3 pe = ro + rd * (hitS ? t : tMin);
  if (!hitS) {
    edge = 1.0 - smoothstep(w * 0.5, w, minD);                 // just outside the silhouette
  } else {
    vec3 n = calcNormal(pe);
    float g = abs(dot(n, -rd));
    edge = 1.0 - smoothstep(0.16, 0.26 * wob, g);              // where the surface turns away
  }
  if (edge > 0.01) {
    float dw = wheelsModel(pe, uWL, uWR).x;
    float ei;
    float dk = extrasSDF(pe, ei);
    float ds = bodySDF(pe);
    vec3 lc = uFRed;
    if (dw < ds && dw < dk) lc = uFBlue;                       // wheels
    else if (dk < ds) lc = uFGreen;                            // knob caps
    edge *= mix(1.0, 0.55 + 0.45 * grain(px * 1.3), uSketch);                   // crayon grain
    edge *= mix(1.0, step(0.08, grain(px * 0.9 + 17.0)), uSketch);              // a few missing specks
    // flat hd 2: until the pen gets here the contour is only a faint pencil guide
    if (uAnim > 0.5 && uDrawT < 1.0) {
      float ts = texelFetch(uStroke, clamp(ivec2(px * uStrokeK), ivec2(0), textureSize(uStroke, 0) - 1), 0).r;
      if (uDrawT < ts) { lc = uFInk; edge *= 0.16 * smoothstep(0.0, 0.1, uDrawT); }
    }
    col = col * (1.0 - edge) + vec4(lc, 1.0) * edge;
  }
  // flat hd 2: the corners (where the faces turn), a lighter crayon, after the profile
  if (uAnim > 0.5 && hitS) {
    ivec2 p = ivec2(px);
    ivec2 gl2 = textureSize(uG, 0) - 1;
    vec4 g = texelFetch(uG, p, 0);
    float sraw = floor(g.r * 255.0 + 0.5), sid = mod(sraw, 10.0), face = floor(sraw / 10.0);
    bool crease = false;
    if (sid > 0.0 && floor(g.b * 255.0 + 0.5) == 0.0) {
      for (int k = 0; k < 8; k++) {
        float an = float(k) * 0.7853982;
        float mraw = floor(texelFetch(uG, clamp(p + ivec2(round(vec2(cos(an), sin(an)) * max(1.0, 0.6 * uLineW))), ivec2(0), gl2), 0).r * 255.0 + 0.5);
        if (mod(mraw, 10.0) == sid && floor(mraw / 10.0) != face) { crease = true; break; }
      }
    }
    if (crease) {
      float ts = uDrawT < 1.0 ? texelFetch(uStroke, clamp(ivec2(px * uStrokeK), ivec2(0), textureSize(uStroke, 0) - 1), 0).r : 0.0;
      float a = (uDrawT >= ts ? 1.0 : 0.0) * mix(1.0, 0.55 + 0.45 * grain(px * 1.3), uSketch);
      col = mix(col, vec4(mix(uFRed, vec3(1.0), 0.35), 1.0), a);
    }
  }
  // flat hd 2: the speaker holes (their walls have their own id in the g-buffer), in the same crayon
  if (uAnim > 0.5) {
    ivec2 ph = ivec2(px);
    ivec2 glh = textureSize(uG, 0) - 1;
    bool in5 = mod(floor(texelFetch(uG, ph, 0).r * 255.0 + 0.5), 10.0) == 5.0;
    bool hole = false;
    for (int k = 0; k < 8; k++) {
      float an = float(k) * 0.7853982;
      float sn = mod(floor(texelFetch(uG, clamp(ph + ivec2(round(vec2(cos(an), sin(an)) * max(1.0, 0.7 * uLineW))), ivec2(0), glh), 0).r * 255.0 + 0.5), 10.0);
      if ((sn == 5.0) != in5) { hole = true; break; }
    }
    if (hole) {
      float ts = uDrawT < 1.0 ? texelFetch(uStroke, clamp(ivec2(px * uStrokeK), ivec2(0), textureSize(uStroke, 0) - 1), 0).r : 0.0;
      float a = (uDrawT >= ts ? 1.0 : 0.0) * mix(1.0, 0.6 + 0.4 * grain(px * 1.3), uSketch);
      col = mix(col, vec4(uFRed, 1.0), a);
    }
  }
  outColor = col * uAlpha;
}
`;

/* ------------------------------------------------------------------ */

/**
 * "pixel", pass 1: one texel per screen cell, with what covers that cell's centre.
 *   R = skin id (0 none · 1 body · 2 wheel), G = part id (0 none · 1 + index),
 *   B = skin tone (light), A = part tone (light)
 * Texel (i + 1) holds cell i, so the cells just off-screen exist too.
 */
export const pixelShader = levelCommon + /* glsl */ `
uniform float uCellPx;
uniform vec2  uGridOff;

void main() {
  vec2 cell = floor(gl_FragCoord.xy) - 1.0;
  vec2 cc = (cell + 0.5) * uCellPx + uGridOff;
  vec2 o = (cc - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;
  vec3 L = normalize(uLight);

  float sid = 0.0, stone = 0.0;
  float t = t0;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float h = scene(p).x;
    if (h < 0.15) {
      sid = wheelsModel(p, uWL, uWR).x < bodySDF(p) + 0.5 ? 2.0 : 1.0;
      stone = max(dot(calcNormal(p), L), 0.0);
      break;
    }
    t += h * 0.85;
    if (t > tEnd) break;
  }

  float pid = 0.0, ptone = 0.0;
  float tp = t0;
  int idx = 0;
  for (int i = 0; i < 70; i++) {
    vec3 p = ro + rd * tp;
    float e = partsSDF(p, idx);
    if (e < 0.08) {
      pid = 1.0 + float(idx);
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * partModel(idx, p + k * 0.4).x;
      }
      ptone = max(dot(normalize(n), L), 0.0);
      break;
    }
    tp += max(e, 0.08);
    if (tp > tEnd) break;
  }
  outColor = vec4(sid / 255.0, pid / 255.0, stone, ptone);
}
`;

/**
 * "pixel", pass 2 (device res): the mosaic. Parts are solid cells in their colour
 * (lighter where lit), each closed by a stepped dark contour along the cell borders;
 * the skin is a red halftone driven by the light, closed by a solid red silhouette;
 * wheels are blue. 1 px gutters between the cells.
 */
export const pixelDrawShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uG;
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uLineW;      // contour half-width, device px
uniform int   uHi;
uniform int   uPartType[12];
uniform vec3  uTypeColor[13];
uniform vec3  uPRed;
uniform vec3  uPPink;
uniform vec3  uPLight;
uniform vec3  uPBlue;
uniform vec3  uPInk;

out vec4 outColor;

ivec2 lim;
vec4 cellAt(ivec2 c) {
  vec4 v = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
  return vec4(floor(v.rg * 255.0 + 0.5), v.ba);
}

void main() {
  lim = textureSize(uG, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  vec2 local = (f - floor(f)) * uCellPx;

  int sx = local.x < 0.5 * uCellPx ? -1 : 1;
  int sy = local.y < 0.5 * uCellPx ? -1 : 1;
  float dx = min(local.x, uCellPx - local.x);
  float dy = min(local.y, uCellPx - local.y);

  vec4 a = cellAt(c);
  vec4 bx = cellAt(c + ivec2(sx, 0));
  vec4 by = cellAt(c + ivec2(0, sy));
  vec4 bd = cellAt(c + ivec2(sx, sy));
  bool onX = dx < uLineW, onY = dy < uLineW;
  bool corner = onX && onY;

  // silhouette: solid, closed, a little thicker
  bool wX = dx < uLineW * 1.6, wY = dy < uLineW * 1.6;
  bool silX = wX && (a.x == 0.0) != (bx.x == 0.0);
  bool silY = wY && (a.x == 0.0) != (by.x == 0.0);
  bool silC = wX && wY && ((a.x == 0.0) != (bd.x == 0.0) || (a.x == 0.0) != (bx.x == 0.0) || (a.x == 0.0) != (by.x == 0.0));
  if (silX || silY || silC) {
    float s = max(max(a.x, bx.x), max(by.x, bd.x));
    vec3 ink = (a.y > 0.0 || bx.y > 0.0 || by.y > 0.0) ? uPRed : (s > 1.5 && a.x != 1.0 && bx.x != 1.0 ? uPBlue : uPRed);
    outColor = vec4(ink * uAlpha, uAlpha);
    return;
  }
  if (a.x == 0.0 && a.y == 0.0) { outColor = vec4(0.0); return; }

  // part contours: wherever the part on the two sides differs
  bool pX = onX && a.y != bx.y, pY = onY && a.y != by.y;
  bool pC = corner && (a.y != bd.y || a.y != bx.y || a.y != by.y) && (a.y > 0.0 || bx.y > 0.0 || by.y > 0.0 || bd.y > 0.0);
  if (pX || pY || pC) { outColor = vec4(uPInk * uAlpha, uAlpha); return; }
  // wheel ↔ body
  if ((onX && a.x != bx.x && bx.x > 0.0) || (onY && a.x != by.x && by.x > 0.0)) { outColor = vec4(uPBlue * uAlpha, uAlpha); return; }

  // 1 px gutter between cells
  if (local.x < 1.0 || local.y < 1.0) { outColor = vec4(0.0); return; }

  if (a.y > 0.0) {
    int i = int(a.y - 1.0 + 0.5);
    vec3 col = i == uHi ? uPInk : uTypeColor[uPartType[i]];
    col *= a.w > 0.55 ? 1.12 : a.w > 0.2 ? 0.95 : 0.78;          // lit · side · shade
    outColor = vec4(min(col, vec3(1.0)) * uAlpha, uAlpha);
    return;
  }

  // skin: halftone from the light, three bands
  bool wheel = a.x > 1.5;
  vec3 ink = wheel ? uPBlue : uPRed;
  float tone = 0.15 + 0.85 * a.z;
  vec3 base = tone > 0.66 || wheel ? uPLight : uPPink;
  float fill = tone > 0.66 ? 0.22 : tone > 0.4 ? 0.5 : 0.82;
  float sub = uCellPx / 4.0;
  vec2 g = mod(local, sub) - 0.5 * sub;
  float r = sub * 0.5 * fill;
  float dotA = 1.0 - smoothstep(r - 0.6, r + 0.6, length(g));
  outColor = vec4(mix(base, ink, dotA) * uAlpha, uAlpha);
}
`;



/* ------------------------------------------------------------------ */

/**
 * "flat 2", pass 1 (device res): what is seen in two layers, as ids and depths.
 *   R = skin layer id (0 none · 1 skin · 2 wheel tread · 3 knob cap · 4 wheel face), G = its depth
 *   B = part layer id (0 none · 20+code cable · 40+index part),  A = its depth
 * Wheels and knob caps are plain cylinders here, so the drawing stays essential.
 */
export const flat2GbufferShader = levelCommon + /* glsl */ `
uniform float uNear;
uniform float uFar;
uniform float uFaces;     // 1 = skin id += 10 × face class (flat hd creases)

float simpleWheel(vec3 q) {
  vec2 d = vec2(length(q.yz) - 45.0, abs(q.x) - 15.0);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// skin scene with simple wheels / caps; y = layer id
vec2 skinScene(vec3 p) {
  vec2 r = vec2(bodySDF(p), 1.0);
  vec3 ql = p - vec3(uWL, 0.0), qr = p - vec3(uWR, 0.0);
  float wl = simpleWheel(ql), wr = simpleWheel(qr);
  if (min(wl, wr) < r.x) {
    vec3 q = wl < wr ? ql : qr;
    // the flat faces get their own id, so the rim between face and tread is drawn
    r = vec2(min(wl, wr), abs(q.x) > 14.7 ? 4.0 : 2.0);
  }
  float ei;
  float k = extrasSDF(p, ei);
  if (k < r.x) r = vec2(k, 3.0);
  // the speaker holes are part of the shell: their walls get their own id, so each hole is drawn
  float hole = -speakerHoles(p);
  return hole > r.x ? vec2(hole, 5.0) : r;
}

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  float sid = 0.0, sdep = 1.0;
  float t = t0;
  for (int i = 0; i < 90; i++) {
    vec2 h = skinScene(ro + rd * t);
    if (h.x < 0.15) { sid = h.y; sdep = clamp((t - uNear) / (uFar - uNear), 0.0, 1.0); break; }
    t += h.x * 0.85;
    if (t > tEnd) break;
  }
  if (uFaces > 0.5 && sid > 0.0) {
    vec3 p = ro + rd * t, n = vec3(0.0);
    for (int j = 0; j < 4 + uZero; j++) {
      vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
      n += k * skinScene(p + k * 0.5).x;
    }
    vec3 a = abs(n);
    float face = a.x > a.y && a.x > a.z ? (n.x > 0.0 ? 1.0 : 2.0) : a.y > a.z ? (n.y > 0.0 ? 3.0 : 4.0) : (n.z > 0.0 ? 5.0 : 6.0);
    sid += 10.0 * face;
  }

  float pid = 0.0, pdep = 1.0;
  float tp = t0;
  int idx = 0;
  for (int i = 0; i < 80; i++) {
    vec3 q = ro + rd * tp;
    float e = partsSDF(q, idx);
    vec2 cb = cablesSDF(q);
    bool c = cb.x < e;
    e = min(e, cb.x);
    if (e < 0.05) {
      pid = c ? 20.0 + cb.y : 40.0 + float(idx);
      pdep = clamp((tp - uNear) / (uFar - uNear), 0.0, 1.0);
      break;
    }
    tp += max(e, 0.05);
    if (tp > tEnd) break;
  }
  outColor = vec4(sid / 255.0, sdep, pid / 255.0, pdep);
}
`;

/**
 * "flat 2", pass 2: flat colour fills for the parts, then clean ink-like lines of
 * constant width wherever the id changes or the depth jumps — part outlines in a
 * darker shade of the part, skin red, wheels blue, knob caps green.
 */
export const flat2EdgeShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uG;
uniform float uAlpha;
uniform float uLineW;          // line half-width, device px
uniform int   uPartType[12];
uniform vec3  uTypeColor[13];
uniform int   uHi;
uniform vec3  uFInk;
uniform vec3  uFRed;
uniform vec3  uFBlue;
uniform vec3  uFGreen;
uniform vec3  uFOrange;

out vec4 outColor;

float id8(float v) { return floor(v * 255.0 + 0.5); }

vec3 skinColor(float id) { return id > 4.5 ? uFRed : id > 3.5 ? uFBlue : id > 2.5 ? uFGreen : id > 1.5 ? uFBlue : uFRed; }

vec3 partColor(float id) {
  if (id < 40.0) {
    int code = int(id - 20.0 + 0.5);
    return code == 0 ? uFGreen : (code == 2 || code == 3 || code == 6) ? uFRed : (code == 1 || code == 7) ? uFBlue : code == 4 ? uFOrange : uFInk;
  }
  int i = int(id - 40.0 + 0.5);
  return i == uHi ? uFInk : uTypeColor[uPartType[i]];
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lim = textureSize(uG, 0) - 1;
  vec4 c = texelFetch(uG, p, 0);
  float sid = id8(c.r), pid = id8(c.b);

  // look around on a small ring for a change of id or a jump in depth
  bool sEdge = false, pEdge = false;
  float sEdgeId = sid, pEdgeId = pid;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    ivec2 q = clamp(p + ivec2(round(vec2(cos(a), sin(a)) * uLineW)), ivec2(0), lim);
    vec4 n = texelFetch(uG, q, 0);
    float nsid = id8(n.r), npid = id8(n.b);
    if (nsid != sid || (sid > 0.0 && abs(n.g - c.g) > 0.012)) {
      sEdge = true;
      if (sEdgeId == 0.0) sEdgeId = nsid;
    }
    if (npid != pid || (pid > 0.0 && abs(n.a - c.a) > 0.012)) {
      pEdge = true;
      if (pEdgeId == 0.0 || (npid > 0.0 && n.a < c.a)) pEdgeId = npid > 0.0 ? npid : pEdgeId;
    }
  }

  vec4 col = vec4(0.0);
  if (pid > 0.0) col = vec4(partColor(pid), 1.0);                          // flat fill
  if (pEdge && pEdgeId > 0.0) col = vec4(partColor(pEdgeId) * 0.55, 1.0);  // outline, darker
  if (sEdge && sEdgeId > 0.0) col = vec4(skinColor(sEdgeId), 1.0);         // skin contour on top
  outColor = col * uAlpha;
}
`;

/* ------------------------------------------------------------------ */

/**
 * "empty", pass 1: one texel per screen cell (graph-paper square), with what
 * covers that cell's centre.
 *   R = skin id (0 none · 1 body · 2 wheel), G = part id (0 none · 1 + index),
 *   B = depth of that part
 * Texel (i + 1) holds cell i, so the cells just off-screen exist too.
 */
export const emptyCellShader = levelCommon + /* glsl */ `
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uNear;
uniform float uFar;
uniform float uFaces;     // 1 = also store which face each cell sees (sketch view)
uniform float uPartEps;   // cross: > 0 → b = depth where a part or cable first comes this close (mm), for the hifi pass

void main() {
  vec2 cell = floor(gl_FragCoord.xy) - 1.0;
  vec2 cc = (cell + 0.5) * uCellPx + uGridOff;
  vec2 o = (cc - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  float sid = 0.0;
  float t = t0;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float h = scene(p).x;
    if (h < 0.15) {
      sid = wheelsModel(p, uWL, uWR).x < bodySDF(p) + 0.5 ? 2.0 : 1.0;
      break;
    }
    t += h * 0.85;
    if (t > tEnd) break;
  }

  float pid = 0.0;
  float tp = t0;
  int idx = 0;
  float near = 1.0;   // cross: where the ray first passes close to a part or a cable (1 = never)
  for (int i = 0; i < 70; i++) {
    vec3 q = ro + rd * tp;
    float e = partsSDF(q, idx);
    float m = e;
    if (uPartEps > 0.0 && near >= 1.0) {
      m = min(e, cablesSDF(q).x);
      if (m < uPartEps) near = clamp((tp - uNear) / (uFar - uNear), 0.0, 1.0);
    }
    if (e < 0.08) { pid = 1.0 + float(idx); break; }
    tp += max(near >= 1.0 ? m : e, 0.08);
    if (tp > tEnd) break;
  }
  float pdep = uPartEps > 0.0 ? near : pid > 0.0 ? clamp((tp - uNear) / (uFar - uNear), 0.0, 1.0) : 1.0;
  // face class 1..6 = ±x, ±y, ±z: where it changes on the same skin, the sketch draws a crease
  float face = 0.0;
  if (uFaces > 0.5 && sid > 0.0) {
    vec3 p = ro + rd * t, n = vec3(0.0);
    for (int j = 0; j < 4 + uZero; j++) {
      vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
      n += k * scene(p + k * 0.6).x;
    }
    vec3 a = abs(n);
    face = a.x > a.y && a.x > a.z ? (n.x > 0.0 ? 1.0 : 2.0) : a.y > a.z ? (n.y > 0.0 ? 3.0 : 4.0) : (n.z > 0.0 ? 5.0 : 6.0);
  }
  outColor = vec4(sid / 255.0, pid / 255.0, pdep, uFaces > 0.5 ? face / 255.0 : 1.0);
}
`;

/**
 * "empty", pass 2 (device res): graph paper, and stepped ink lines along the
 * cell borders wherever the cells on the two sides differ — the silhouette, the
 * wheels, and every library part (hovered one in red). No fills.
 */
export const emptyEdgeShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uG;
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uLineW;      // ink line half-width, device px
uniform int   uHi;         // hovered part index, -1 none
uniform vec3  uInk;
uniform vec3  uHiInk;
uniform vec3  uPaper;      // graph-paper line colour

out vec4 outColor;

ivec2 lim;
vec2 cellAt(ivec2 c) {
  vec4 v = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
  return floor(v.rg * 255.0 + 0.5);
}

void main() {
  lim = textureSize(uG, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  vec2 local = (f - floor(f)) * uCellPx;          // 0..cell px

  // nearest grid line in x and y, and which neighbour lies across it
  int sx = local.x < 0.5 * uCellPx ? -1 : 1;
  int sy = local.y < 0.5 * uCellPx ? -1 : 1;
  float dx = min(local.x, uCellPx - local.x);
  float dy = min(local.y, uCellPx - local.y);

  vec2 a = cellAt(c);
  vec2 bx = cellAt(c + ivec2(sx, 0));
  vec2 by = cellAt(c + ivec2(0, sy));
  vec2 bd = cellAt(c + ivec2(sx, sy));

  bool skinX = a.x != bx.x, skinY = a.x != by.x;
  bool partX = a.y != bx.y, partY = a.y != by.y;
  float hi = float(uHi + 1);
  bool hiX = uHi >= 0 && partX && (a.y == hi || bx.y == hi);
  bool hiY = uHi >= 0 && partY && (a.y == hi || by.y == hi);

  bool onX = dx < uLineW, onY = dy < uLineW;
  bool ink = (onX && (skinX || partX)) || (onY && (skinY || partY));
  bool red = (onX && hiX) || (onY && hiY);
  // corners: the vertex is inked when the four cells around it are not all the same
  if (onX && onY && !ink) {
    ink = a != bx || a != by || a != bd;
    red = uHi >= 0 && (a.y == hi || bx.y == hi || by.y == hi || bd.y == hi) &&
          (a.y != bx.y || a.y != by.y || a.y != bd.y);
  }

  if (ink) {
    outColor = vec4((red ? uHiInk : uInk) * uAlpha, uAlpha);
    return;
  }
  // graph paper: hairlines on every cell border
  float g = 1.0 - smoothstep(0.0, 1.0, min(dx, dy));
  outColor = vec4(uPaper, 1.0) * g * 0.8 * uAlpha;
}
`;

/* ------------------------------------------------------------------ */

/**
 * blobShader (device res) — the "blob" view: metaballs. Every library part is a
 * soft ellipsoid in its own colour, the wheels and knob caps too; they melt into
 * each other (smooth union, colours blending where they meet). Soft light, a warm
 * highlight, film grain on the surface and a grainy halo around the silhouette.
 */
export const blobShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform float uMerge;          // smooth-union radius, mm
uniform float uSwell;          // mm added around each part
uniform vec3  uBlobColor[13];  // per part type
uniform vec3  uBlobWheel;
uniform vec3  uBlobKnob;

// iq's ellipsoid bound (good enough for marching)
float sdEllipsoid(vec3 q, vec3 r) {
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}

// smooth union that also blends colour
void blend(inout float d, inout vec3 col, float d2, vec3 col2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d) / k, 0.0, 1.0);
  d = mix(d2, d, h) - k * h * (1.0 - h);
  col = mix(col2, col, h);
}

float blobs(vec3 p, out vec3 col) {
  float d = 1e5;
  col = vec3(0.0);
  for (int i = 0; i < uPartCount; i++) {
    float fi = float(i);
    // each blob breathes a little on its own
    vec3 wob = vec3(sin(uTime * 1.3 + fi * 1.7), sin(uTime * 1.1 + fi * 2.3), sin(uTime * 0.9 + fi * 0.7)) * 1.2;
    vec3 q = transpose(uPartR[i]) * (p - uPartC[i] - wob);
    vec3 r = uPartH[i] + uSwell;
    vec3 c = uBlobColor[uPartType[i]];
    if (i == uHi) c = mix(c, vec3(1.0), 0.45);   // hovered in the components list
    float e = sdEllipsoid(q, r);
    if (d > 1e4) { d = e; col = c; }
    else blend(d, col, e, c, uMerge);
  }
  // wheels: flat round discs (parked far away when there are none)
  for (int w = 0; w < 2; w++) {
    vec2 wc = w == 0 ? uWL : uWR;
    float e = sdEllipsoid(p - vec3(wc, 0.0), vec3(uWheelHalfW + 2.0, uWheelR, uWheelR));
    blend(d, col, e, uBlobWheel, uMerge * 0.6);
  }
  // knob caps
  float ei;
  float k = extrasSDF(p, ei);
  if (k < 1e8) blend(d, col, k - 2.0, uBlobKnob, uMerge * 0.5);
  return d;
}

float blobD(vec3 p) { vec3 c; return blobs(p, c); }

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  float minD = 1e9, tMin = t;
  bool hit = false;
  vec3 col;
  for (int i = 0; i < 90; i++) {
    float h = blobs(ro + rd * t, col);
    if (h < minD) { minD = h; tMin = t; }
    if (h < 0.1) { hit = true; break; }
    t += h * 0.9;
    if (t > tEnd) break;
  }

  // static film grain
  float g = hash(gl_FragCoord.xy * 0.731 + 17.0);
  float g2 = hash(gl_FragCoord.xy * 1.37 + 3.0);

  if (!hit) {
    // grainy halo just outside the silhouette
    float halo = 1.0 - smoothstep(0.0, 6.0, minD);
    halo *= halo * halo;
    blobs(ro + rd * tMin, col);
    float a = step(g, halo * 0.55);
    outColor = vec4(col * a * 0.9, a * 0.9) * uAlpha;
    return;
  }

  vec3 p = ro + rd * t;
  vec2 e = vec2(0.6, -0.6);
  vec3 n = normalize(e.xyy * blobD(p + e.xyy) + e.yyx * blobD(p + e.yyx) +
                     e.yxy * blobD(p + e.yxy) + e.xxx * blobD(p + e.xxx));
  vec3 L = normalize(uLight);
  float diff = max(dot(n, L), 0.0);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
  float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 12.0);

  vec3 c = col * (0.5 + 0.65 * diff);
  c = mix(c, vec3(1.0), spec * 0.85);              // a soft, almost white highlight
  c = mix(c, col * 0.55, rim * 0.5);               // the edge turns deeper
  c += (g - 0.5) * 0.16;                           // grain
  // towards the edge the surface dissolves into grain
  float a = 1.0 - step(1.0 - rim * rim * 0.7, g2) * 0.7;
  outColor = vec4(clamp(c, 0.0, 1.0) * a, a) * uAlpha;
}
`;

/* ------------------------------------------------------------------ */

/**
 * pixel2Shader (device res) — the "pixel 2" view (single pass, no contours): everything as a mosaic of square
 * cells in screen space (one ray per cell).
 *  - library parts seen through the skin: solid cells in their part colour
 *  - skin: red halftone driven by the light (light faces sparse, shade dense),
 *    silhouette cells solid red so the outline reads
 *  - wheels: the same halftone in blue, so they separate from the body
 * Cables are drawn on top in SVG as thin lines (ui/diagram.js), part numbers too.
 */
export const pixel2Shader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform float uCellPx;     // cell size, device px
uniform vec2  uGridOff;    // grid origin, device px
uniform vec3  uPRed;
uniform vec3  uPPink;
uniform vec3  uPLight;
uniform vec3  uPBlue;
uniform vec3  uTypeColor[13];

void main() {
  vec2 cell = floor((gl_FragCoord.xy - uGridOff) / uCellPx);
  vec2 local = gl_FragCoord.xy - (cell * uCellPx + uGridOff);       // 0..cell size
  vec2 cc = (cell + 0.5) * uCellPx + uGridOff;                       // cell centre

  // one ray per cell (through its centre)
  vec2 o = (cc - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  // the skin
  float t = t0, minD = 1e9, tMin = t0;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float h = scene(ro + rd * t).x;
    if (h < minD) { minD = h; tMin = t; }
    if (h < 0.15) { hit = true; break; }
    t += h * 0.85;
    if (t > tEnd) break;
  }
  float cellMm = uCellPx * (hit ? t : tMin) / uFocal;
  bool rim = !hit && minD < 0.3 * cellMm;                            // cells the silhouette grazes
  if (!hit && !rim) { outColor = vec4(0.0); return; }

  // 1 px gutter between cells
  if (local.x < 1.0 || local.y < 1.0) { outColor = vec4(0.0); return; }

  // a library part behind this cell? then the cell takes its colour
  float tp = t0;
  int idx = 0;
  for (int i = 0; i < 70; i++) {
    float e = partsSDF(ro + rd * tp, idx);
    if (e < 0.08) {
      vec3 pc = idx == uHi ? vec3(0.08) : uTypeColor[uPartType[idx]];
      outColor = vec4(pc * uAlpha, uAlpha);
      return;
    }
    tp += max(e, 0.08);
    if (tp > tEnd) break;
  }

  vec3 pHit = ro + rd * (hit ? t : tMin);
  bool wheel = wheelsModel(pHit, uWL, uWR).x < bodySDF(pHit) + 0.5;
  vec3 ink = wheel ? uPBlue : uPRed;

  // outline: silhouette cells and cells where the surface turns away are solid
  float tone = 0.0, facing = 0.0;
  if (hit) {
    vec3 n = calcNormal(pHit);
    facing = abs(dot(n, -rd));
    tone = clamp(0.15 + 0.85 * max(dot(n, normalize(uLight)), 0.0), 0.0, 1.0);
  }
  if (rim || facing < 0.28) { outColor = vec4(ink * uAlpha, uAlpha); return; }

  // halftone from the light only: three clear bands, so the volume reads
  vec3 base = tone > 0.66 ? uPLight : uPPink;
  float fill = tone > 0.66 ? 0.22 : tone > 0.4 ? 0.5 : 0.82;
  if (wheel) base = uPLight;
  float sub = uCellPx / 4.0;
  vec2 g = mod(local, sub) - 0.5 * sub;
  float r = sub * 0.5 * fill;
  float dotA = 1.0 - smoothstep(r - 0.6, r + 0.6, length(g));
  outColor = vec4(mix(base, ink, dotA) * uAlpha, uAlpha);
}
`;

/* ------------------------------------------------------------------ */

/**
 * orbitalShader (device res) — the "orbital" view: the provisional shape (skin,
 * wheels, knob caps) as a soft cloud of density, like an orbital plot: darker
 * where the body is thick, fading out at its edges, no hard surface at all.
 * The parts are drawn on top as ink outlines (orbitalEdgeShader).
 */
export const orbitalShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform float uDensity;   // opacity per mm inside the body
uniform float uFade;      // mm of fade at the edge
uniform vec3  uInk;

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  // skip the empty space in front, then integrate the density through the body
  float t = t0;
  for (int i = 0; i < 60; i++) {
    float h = scene(ro + rd * t).x;
    if (h < uFade) break;
    t += max(h - uFade * 0.5, 0.5);
    if (t > tEnd) { outColor = vec4(0.0); return; }
  }
  float dt = 2.2;
  t += dt * hash(gl_FragCoord.xy);          // jittered start: no banding
  float acc = 0.0;
  vec3 pIn = vec3(0.0);
  bool entered = false;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    float d = scene(p).x;
    if (!entered && d < 0.0) { entered = true; pIn = p; }
    acc += smoothstep(uFade, -uFade * 2.5, d) * dt;
    t += d > uFade * 2.0 ? max(d - uFade, dt) : dt;   // hop over gaps
    if (t > tEnd || acc > 400.0) break;
  }
  float a = 1.0 - exp(-acc * uDensity);

  // form: the light on the surface where the ray goes in (dark in the shade, light in the light)
  float shade = 0.75;
  if (entered) {
    vec3 n = calcNormal(pIn);
    float lit = max(dot(n, normalize(uLight)), 0.0);
    float rim = 1.0 - abs(dot(n, -rd));
    shade = clamp(1.0 - 0.8 * lit + 0.35 * rim, 0.15, 1.0);
  }
  float v = a * shade;

  // grain: every device pixel is ink or paper, with the density as its chance
  float g = hash(gl_FragCoord.xy * 0.913 + floor(uTime * 0.0) );
  float ink = step(g, v * 1.05);
  float soft = v * 0.25;                    // a faint tone under the grain keeps it calm
  float alpha = max(ink * 0.92, soft);
  outColor = vec4(uInk * alpha, alpha) * uAlpha;
}
`;

/**
 * "orbital", pass 2: thin ink outlines of the library parts only (from the flat 2
 * g-buffer: part layer ids 40+i), no fills, nothing else.
 */
export const orbitalEdgeShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uG;
uniform float uAlpha;
uniform float uLineW;
uniform int   uHi;
uniform vec3  uInk;
uniform vec3  uHiInk;

out vec4 outColor;

float pidAt(ivec2 q) {
  vec4 v = texelFetch(uG, q, 0);
  float id = floor(v.b * 255.0 + 0.5);
  return id >= 40.0 ? id : 0.0;          // parts only (cables count as nothing)
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lim = textureSize(uG, 0) - 1;
  vec4 c = texelFetch(uG, p, 0);
  float pid = pidAt(p);
  bool edge = false;
  float eid = pid;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    ivec2 q = clamp(p + ivec2(round(vec2(cos(an), sin(an)) * uLineW)), ivec2(0), lim);
    float n = pidAt(q);
    float nd = texelFetch(uG, q, 0).a;
    if (n != pid || (pid > 0.0 && abs(nd - c.a) > 0.012)) {
      edge = true;
      if (eid == 0.0) eid = n;
    }
  }
  if (!edge || eid == 0.0) { outColor = vec4(0.0); return; }
  vec3 col = int(eid - 40.0 + 0.5) == uHi ? uHiInk : uInk;
  outColor = vec4(col, 1.0) * uAlpha;
}
`;

/* ------------------------------------------------------------------ */

/**
 * "pixel 3d", pass 2 (device res; pass 1 = emptyCellShader, one texel per cell):
 * the provisional shape as solid flat pixels — stepped silhouette, one colour for
 * the skin, one for the wheels, no grid — and the library parts on top as real
 * 3D models, lit, in playful colours (one per kind of part), cables too.
 */
export const pixel3dShader = levelCommon + /* glsl */ `
uniform sampler2D uG;
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform vec3  uSkinCol;
uniform vec3  uWheelCol;
uniform vec3  uTypeColor[13];
uniform float uMono;      // 1 = the grey version: tone-on-tone shape with a dot pattern
uniform float uMonoParts; // 1 = the parts in greys too (look a); 0 = parts keep their colours (look b)
uniform vec3  uDotCol;
uniform float uDotStep;   // dot pitch, device px
uniform float uDots;      // 1 = the dot pattern on the grey shape (look a only)

void main() {
  // the shape: whole cells
  ivec2 lim = textureSize(uG, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  float sid = floor(texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0).r * 255.0 + 0.5);
  vec4 col = sid > 0.0 ? vec4(sid > 1.5 ? uWheelCol : uSkinCol, 1.0) : vec4(0.0);
  if (uMono > 0.5 && uDots > 0.5 && sid > 0.0) {
    // a fine, even dot pattern over the pixelated shape
    vec2 g = mod(gl_FragCoord.xy - uGridOff, uDotStep) - 0.5 * uDotStep;
    float r = max(0.7, uDotStep * 0.17);
    col.rgb = mix(col.rgb, uDotCol, 1.0 - smoothstep(r - 0.5, r + 0.5, length(g)));
  }

  // the parts: 3D, at full resolution, always in front of the flat shape
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = max(0.0, -bb - sq), tEnd = -bb + sq;
    int idx = 0;
    for (int i = 0; i < 100; i++) {
      vec3 p = ro + rd * t;
      float e = partsSDF(p, idx);
      vec2 cb = cablesSDF(p);
      bool isCable = cb.x < e;
      e = min(e, cb.x);
      if (e < 0.05) {
        vec3 n = vec3(0.0);
        for (int j = 0; j < 4 + uZero; j++) {
          vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
          n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
        }
        n = normalize(n);
        float mat = isCable ? -1.0 : partModel(idx, p).y;
        vec3 base = isCable ? cableColor(cb.y) : uTypeColor[uPartType[idx]];
        // details keep a hint of their material: dark parts deepen the colour, metal shines
        if (!isCable) {
          float lum = dot(matColor(mat), vec3(0.333));
          base *= mix(0.72, 1.12, smoothstep(0.1, 0.7, lum));
        }
        vec3 L = normalize(uLight);
        float diff = max(dot(n, L), 0.0);
        vec3 shaded = base * (0.55 + 0.6 * diff + 0.15 * max(n.y, 0.0));
        float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), mat == M_METAL || mat == M_RIM || mat == M_GOLD ? 24.0 : 10.0);
        shaded += vec3(spec * (mat == M_METAL || mat == M_RIM || mat == M_GOLD ? 0.6 : 0.22));
        if (mat == M_LED_LIT) shaded = matColor(mat) * 1.2;
        if (uMonoParts > 0.5) {
          // warm mauve greys (like the reference), softer contrast; lit LEDs turn white
          float l = dot(shaded, vec3(0.299, 0.587, 0.114));
          shaded = vec3(0.32 + 0.52 * l) * vec3(1.0, 0.965, 0.98);
          if (mat == M_LED_OFF) shaded = vec3(0.37, 0.355, 0.36);     // dark cells, so the lit face reads
          if (mat == M_LED_LIT || mat == M_WHITE) shaded = vec3(0.965, 0.96, 0.95);
        }
        if (!isCable && idx == uHi) shaded = mix(shaded, vec3(0.1), 0.6);
        col = vec4(min(shaded, vec3(1.0)), 1.0);
        break;
      }
      t += max(e, 0.05);
      if (t > tEnd) break;
    }
  }
  outColor = col * uAlpha;
}
`;

/**
 * sketchShader (device res) — the "sketch" view: the provisional shape stays a
 * stepped pencil drawing on graph paper (silhouette in ink, creases between the
 * faces in a softer pencil, from the per-cell g-buffer of emptyCellShader), while
 * the library parts are drawn high fidelity: real colours, lit 3D, with a thin ink
 * contour so they sit in the same drawing.
 */
export const sketchShader = levelCommon + /* glsl */ `
uniform sampler2D uG;
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uLineW;      // ink half-width, device px
uniform vec3  uInk;
uniform vec3  uSoftInk;
uniform vec3  uHiInk;
uniform vec3  uPaper;

// "redraw": after every view change the provisional drawing grows back out around the parts
uniform float uRedraw;     // 0 → 1
uniform vec2  uRedrawC;    // device px: projected centre of the parts
uniform float uRedrawR;    // device px: radius that covers the whole object
float revealMask(float soft) {
  if (uRedraw >= 1.0) return 1.0;
  vec2 d = gl_FragCoord.xy - uRedrawC;
  float a = atan(d.y, d.x);
  float wob = 0.06 * sin(a * 5.0 + 1.3) + 0.04 * sin(a * 11.0 - 0.7);
  return smoothstep(0.0, soft, uRedraw * uRedrawR * (1.0 + wob) - length(d));
}

ivec2 lim;
vec2 cellAt(ivec2 c) {
  vec4 v = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
  return floor(vec2(v.r, v.a) * 255.0 + 0.5);   // (skin id, face class)
}

void main() {
  lim = textureSize(uG, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  vec2 local = (f - floor(f)) * uCellPx;
  int sx = local.x < 0.5 * uCellPx ? -1 : 1;
  int sy = local.y < 0.5 * uCellPx ? -1 : 1;
  float dx = min(local.x, uCellPx - local.x);
  float dy = min(local.y, uCellPx - local.y);
  vec2 a = cellAt(c), bx = cellAt(c + ivec2(sx, 0)), by = cellAt(c + ivec2(0, sy)), bd = cellAt(c + ivec2(sx, sy));

  // silhouette (skin id changes) in ink, creases (face changes on the same skin) in pencil
  bool onX = dx < uLineW, onY = dy < uLineW;
  bool sil = (onX && a.x != bx.x) || (onY && a.x != by.x);
  if (onX && onY && !sil) sil = a.x != bx.x || a.x != by.x || a.x != bd.x;
  float wS = 0.6 * uLineW;
  bool cX = dx < wS && a.x == bx.x && a.x > 0.0 && a.y != bx.y;
  bool cY = dy < wS && a.x == by.x && a.x > 0.0 && a.y != by.y;
  bool crease = cX || cY;

  vec4 col = vec4(uPaper, 1.0) * (1.0 - smoothstep(0.0, 1.0, min(dx, dy))) * 0.8;   // graph paper
  float rv = revealMask(uCellPx);
  if (sil) col = mix(col, vec4(uInk, 1.0), rv);
  else if (crease) col = mix(col, vec4(uSoftInk, 1.0), rv);

  // the library parts: real colours, lit, full resolution, with an ink contour
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = max(0.0, -bb - sq), tEnd = -bb + sq;
    float nearE = 1e9, nearT = 0.0;
    int idx = 0, nearIdx = -1;
    bool hit = false;
    for (int i = 0; i < 110; i++) {
      vec3 p = ro + rd * t;
      float e = partsSDF(p, idx);
      vec2 cb = cablesSDF(p);
      bool isCable = cb.x < e;
      float m = min(e, cb.x);
      if (!isCable && e < nearE) { nearE = e; nearT = t; nearIdx = idx; }
      if (m < 0.05) {
        vec3 n = vec3(0.0);
        for (int j = 0; j < 4 + uZero; j++) {
          vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
          n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
        }
        n = normalize(n);
        float mat = isCable ? -1.0 : partModel(idx, p).y;
        vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
        vec3 L = normalize(uLight);
        float diff = max(dot(n, L), 0.0);
        vec3 shaded = base * (0.6 + 0.55 * diff + 0.12 * max(n.y, 0.0));
        shaded = mix(shaded, vec3(1.0), 0.08);
        if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
          shaded += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
        if (mat == M_LED_LIT) shaded = base * 1.15;
        if (!isCable && idx == uHi) shaded = mix(shaded, uHiInk, 0.45);
        // grazing edge of the part = its contour line
        float rim = isCable ? 0.0 : 1.0 - smoothstep(0.12, 0.3, abs(dot(n, -rd)));
        col = vec4(mix(min(shaded, vec3(1.0)), uInk, rim * 0.85), 1.0);
        hit = true;
        break;
      }
      t += max(m, 0.05);
      if (t > tEnd) break;
    }
    // just outside a part: its ink contour
    if (!hit && nearIdx >= 0 && nearE < uLineW * 1.3 * nearT / uFocal)
      col = vec4(nearIdx == uHi ? uHiInk : uInk, 1.0);
  }
  outColor = col * uAlpha;
}
`;

/**
 * flatHdShader (device res) — the "flat hd" view: flat 1's clean constant-width
 * lines (skin red, wheels blue, knob caps green) with a bit more drawing in it —
 * a pale flat tint per face and thin creases where the faces turn — and the
 * library parts high fidelity: real colours, lit 3D, with a dark outline.
 * Reads the flat 1 g-buffer (uFaces = 1).
 */
export const flatHdShader = levelCommon + /* glsl */ `
uniform sampler2D uG;
uniform float uAlpha;
uniform float uLineW;
uniform vec3  uFInk;
uniform vec3  uFRed;
uniform vec3  uFBlue;
uniform vec3  uFGreen;
uniform vec3  uFill;      // pale tint of the faces
uniform float uDrawT;     // redraw timeline 0 → 1 (linear; 1 = drawing finished)
uniform sampler2D uStroke; // when the pen passes each line cell (strokes.js), 0..1
uniform float uStrokeK;    // stroke-texture cells per device px

// "redraw": after every view change the provisional drawing grows back out around the parts
uniform float uRedraw;     // 0 → 1
uniform vec2  uRedrawC;    // device px: projected centre of the parts
uniform float uRedrawR;    // device px: radius that covers the whole object
float revealMask(float soft) {
  if (uRedraw >= 1.0) return 1.0;
  vec2 d = gl_FragCoord.xy - uRedrawC;
  float a = atan(d.y, d.x);
  float wob = 0.06 * sin(a * 5.0 + 1.3) + 0.04 * sin(a * 11.0 - 0.7);
  return smoothstep(0.0, soft, uRedraw * uRedrawR * (1.0 + wob) - length(d));
}

float id8(float v) { return floor(v * 255.0 + 0.5); }
uniform vec3  uLine;      // one blue for the whole shape (body, wheels, knob caps, holes)
uniform float uCreases;   // flat hd 2: also the lines where the faces turn (the corners)
vec3 skinColor(float id) { return uLine; }

vec4 partShade(vec2 frag) {
  vec2 o = (frag - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) return vec4(0.0);
  float sq = sqrt(disc);
  float t = max(0.0, -bb - sq), tEnd = -bb + sq;
  int idx = 0;
  for (int i = 0; i < 110; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    float m = min(e, cb.x);
    if (m < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
      vec3 L = normalize(uLight);
      vec3 shaded = base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      shaded = mix(shaded, vec3(1.0), 0.08);
      if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
        shaded += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
      if (mat == M_LED_LIT) shaded = base * 1.15;
      if (!isCable && idx == uHi) shaded = mix(shaded, uFRed, 0.45);
      return vec4(min(shaded, vec3(1.0)), 1.0);
    }
    t += max(m, 0.05);
    if (t > tEnd) break;
  }
  return vec4(0.0);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lim = textureSize(uG, 0) - 1;
  vec4 c = texelFetch(uG, p, 0);
  float sraw = id8(c.r), pid = id8(c.b);
  float sid = mod(sraw, 10.0), face = floor(sraw / 10.0);

  bool sEdge = false, pEdge = false, crease = false;
  float sEdgeId = sid, pEdgeId = pid;
  float rC = max(1.0, 0.6 * uLineW);
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    vec2 dir = vec2(cos(a), sin(a));
    vec4 n = texelFetch(uG, clamp(p + ivec2(round(dir * uLineW)), ivec2(0), lim), 0);
    float nraw = id8(n.r), nsid = mod(nraw, 10.0), npid = id8(n.b);
    if (nsid != sid || (sid > 0.0 && abs(n.g - c.g) > 0.012)) {
      sEdge = true;
      if (sEdgeId == 0.0) sEdgeId = nsid;
    }
    if (npid != pid || (pid > 0.0 && abs(n.a - c.a) > 0.012)) {
      pEdge = true;
      if (pEdgeId == 0.0 || (npid > 0.0 && n.a < c.a)) pEdgeId = npid > 0.0 ? npid : pEdgeId;
    }
    vec4 m = texelFetch(uG, clamp(p + ivec2(round(dir * rC)), ivec2(0), lim), 0);
    float mraw = id8(m.r);
    if (mod(mraw, 10.0) == sid && sid > 0.0 && floor(mraw / 10.0) != face) crease = true;
  }

  // ---- the redraw, like a hand drawing it again (all 1 when idle) ----
  //  0.00–0.14  a faint pencil underdrawing of the shape appears
  //  (the parts never redraw: they stay, the shape is drawn again around them)
  //  0.16–0.70  a pen draws the silhouette stroke by stroke, along the lines (strokes.js)
  //  0.62–1.00  the faces are tinted with a looser hatch the other way
  float T = uDrawT;
  vec2 d = gl_FragCoord.xy - uRedrawC;
  float rad = length(d);
  float u = fract((1.5707963 - atan(d.y, d.x)) / 6.2831853);        // 0..1 clockwise from 12 o'clock
  float pUnder = smoothstep(0.0, 0.14, T);
  float pTint  = smoothstep(0.62, 1.0, T);
  float hatchB = fract(dot(gl_FragCoord.xy, vec2(0.7071, -0.7071)) / 11.0);
  // how long ago the pen passed here (< 0 = not yet)
  float since = T >= 1.0 ? 1.0 : T - texelFetch(uStroke, clamp(ivec2(gl_FragCoord.xy * uStrokeK), ivec2(0), textureSize(uStroke, 0) - 1), 0).r;

  vec4 col = vec4(0.0);
  // pale tint per face, hatched in
  if (sid > 0.0 && pid == 0.0 && hatchB < pTint * 1.02)
    col = vec4(uFill, 1.0) * (face == 3.0 ? 0.6 : face == 5.0 ? 0.32 : 0.2);
  if (pid > 0.0) {                                   // the parts stay: only the shape is redrawn
    vec4 ps = partShade(gl_FragCoord.xy);
    if (ps.a > 0.0) col = ps;
  }
  if (pEdge && pEdgeId > 0.0) col = vec4(uFInk, 1.0);              // part outline
  // flat hd 2: the corners, a lighter blue, drawn by the pen after the profile
  if (uCreases > 0.5 && crease && pid == 0.0 && since >= 0.0)
    col = vec4(mix(uLine, uFill, 0.35), 1.0);
  // the contour: underdrawing first, then the pen
  if (sEdge && sEdgeId > 0.0) {
    if (since >= 0.0) {
      col = vec4(skinColor(sEdgeId), 1.0);
    } else if (T < 1.0) {
      col = mix(col, vec4(uFInk, 1.0), 0.16 * pUnder);                          // pencil guide
    }
  }
  // (no fat pen tip: the line is always laid down at its own width)
  outColor = col * uAlpha;
}
`;

/**
 * milkShader (device res) — the "milk" view (ref: a soft-robot octopus cast in
 * milky silicone): the provisional shape is a SOLID, smooth, milky-white body —
 * soft light, a cool shadow side, a whiter rim — and the library parts sit
 * inside it, high-fidelity models each in its own clear colour (CONFIG.milk),
 * veiled by the silicone the deeper they are.
 */
export const milkShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform vec3  uTypeColor[13];
uniform vec3  uMilk;      // the silicone, lit side
uniform vec3  uMilkShade; // the silicone, shadow side
uniform float uVeil;      // how fast the silicone hides what is inside (per mm)

bool partHit(vec3 ro, vec3 rd, float t, float tEnd, out vec3 col, out float dist) {
  int idx = 0;
  for (int i = 0; i < 110; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    e = min(e, cb.x);
    if (e < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : uTypeColor[uPartType[idx]];
      // the model's details stay readable: darker materials deepen the colour, light ones lift it
      if (!isCable) base *= mix(0.7, 1.12, smoothstep(0.1, 0.7, dot(matColor(mat), vec3(0.333))));
      vec3 L = normalize(uLight);
      col = base * (0.62 + 0.5 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      col += vec3(pow(max(dot(reflect(-L, n), -rd), 0.0), 16.0) * 0.25);
      if (mat == M_LED_LIT) col = matColor(mat) * 1.2;
      if (!isCable && idx == uHi) col = mix(col, vec3(0.12), 0.55);
      col = min(col, vec3(1.0));
      dist = t;
      return true;
    }
    t += max(e, 0.05);
    if (t > tEnd) break;
  }
  return false;
}

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t0 = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  float t = t0;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float h = scene(ro + rd * t).x;
    if (h < 0.15) { hit = true; break; }
    t += h * 0.85;
    if (t > tEnd) break;
  }

  vec3 pc; float pd;
  bool ph = partHit(ro, rd, t0, tEnd, pc, pd);
  if (!hit) {
    // outside the silicone (a cable to the wall, a part poking out): as it is
    outColor = (ph ? vec4(pc, 1.0) : vec4(0.0)) * uAlpha;
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 L = normalize(uLight);
  float cosv = clamp(dot(n, -rd), 0.0, 1.0);
  // soft wrapped light: the silicone never goes dark
  float wrap = clamp((dot(n, L) + 0.45) / 1.45, 0.0, 1.0);
  vec3 skin = mix(uMilkShade, uMilk, wrap);
  skin += vec3(0.06) * max(n.y, 0.0);
  // the rim: thicker silicone seen edge-on, a touch greyer, then a thin bright edge
  float rim = pow(1.0 - cosv, 2.2);
  skin = mix(skin, uMilkShade * 0.93, rim * 0.55);
  skin += vec3(pow(max(dot(reflect(-L, n), -rd), 0.0), 40.0) * 0.18);

  vec3 col = skin;
  if (ph && pd >= t - 0.5) {
    // a part inside: seen through the milk, clearer where it sits close under the surface
    float depth = max(0.0, pd - t);
    float vis = exp(-depth * uVeil) * (1.0 - 0.6 * rim);
    col = mix(skin, mix(pc, skin, 0.12), vis);
  } else if (ph) {
    col = pc;   // in front of the silicone
  }
  outColor = vec4(min(col, vec3(1.0)), 1.0) * uAlpha;
}
`;

/**
 * "live" (2D, on black; ref: a sparse point-cloud scan). No 3D shading at all:
 *   pass 1 — emptyCellShader at a few device px per cell (skin id, part id, face)
 *   pass 2 — liveEdgeShader, same grid: how close each cell is to an outline
 *            (silhouette or part contour) or a crease, and whether it is inside
 *   pass 3 — liveDrawShader, full res: one point per cell, jittered and wandering;
 *            a point lives with a probability that rises near the outlines, so the
 *            drawing gathers on its contours like a living cloud; a few stray
 *            stars elsewhere. Parts are points too, a little brighter.
 * Texel (i + 1) holds cell i, as in the empty view.
 */
export const liveEdgeShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uG;
uniform int uZero;
uniform float uEdgeW;      // how far (cells) the outline's pull reaches
out vec4 outColor;

ivec2 lim;
vec3 cellAt(ivec2 t) {
  vec4 v = texelFetch(uG, clamp(t, ivec2(0), lim), 0);
  return floor(vec3(v.r, v.a, v.g) * 255.0 + 0.5);   // (skin id, face, part id)
}

void main() {
  lim = textureSize(uG, 0) - 1;
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec3 a = cellAt(t);
  float dSil = 9.0, dCrease = 9.0;
  for (int m = 0; m < 49 + uZero; m++) {
    ivec2 d = ivec2(m % 7 - 3, m / 7 - 3);
    vec3 b = cellAt(t + d);
    float l = length(vec2(d));
    if (b.x != a.x || b.z != a.z) dSil = min(dSil, l);
    else if (a.x > 0.0 && b.y != a.y) dCrease = min(dCrease, l);
  }
  float ew = uEdgeW > 0.0 ? uEdgeW : 1.7;
  outColor = vec4(1.0 - smoothstep(0.0, ew, dSil - 0.5), 1.0 - smoothstep(0.0, ew * 0.75, dCrease - 0.5),
                  a.x > 0.0 ? 1.0 : 0.0, a.z > 0.0 ? 1.0 : 0.0);
}
`;

export const liveDrawShader = levelCommon + /* glsl */ `
uniform sampler2D uE;      // per-cell closeness to the outlines (liveEdgeShader)
uniform sampler2D uG;      // full-res flat g-buffer: skin id / depth / part id / depth
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uDotPx;      // point radius, device px
uniform float uLineW;      // profile half-width, device px
uniform vec3  uSkinCol;
uniform vec3  uLineCol;

// the library parts, high fidelity: real colours, lit
vec4 realPart(vec3 ro, vec3 rd, float t, float tEnd, out float dist) {
  int idx = 0;
  dist = 1e9;
  for (int i = 0; i < 110 + uZero; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    float m = min(e, cb.x);
    if (m < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
      vec3 L = normalize(uLight);
      vec3 shaded = base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      shaded = mix(shaded, vec3(1.0), 0.08);
      if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
        shaded += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
      if (mat == M_LED_LIT) shaded = base * 1.15;
      if (!isCable && idx == uHi) shaded = mix(shaded, vec3(0.95, 0.3, 0.2), 0.45);
      dist = t;
      return vec4(min(shaded, vec3(1.0)), 1.0);
    }
    t += max(m, 0.05);
    if (t > tEnd) break;
  }
  return vec4(0.0);
}


vec3 hash32(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}
float id8(float v) { return floor(v * 255.0 + 0.5); }

void main() {
  // the cloud: one point per cell, gathering on the outlines
  ivec2 lim = textureSize(uE, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  float cover = 0.0;
  for (int m = 0; m < 9; m++) {
    ivec2 q = c + ivec2(m % 3 - 1, m / 3 - 1);
    vec4 e = texelFetch(uE, clamp(q + 1, ivec2(0), lim), 0);
    vec3 h = hash32(vec2(q) + 0.5);
    vec3 h2 = hash32(vec2(q) * 1.37 + 11.1);
    float edge = max(e.r, 0.65 * e.g);
    bool inside = e.b > 0.5 || e.a > 0.5;
    float live = inside ? mix(0.1, 1.0, edge) : 0.35 * e.r + 0.012;
    if (h.z > live) continue;
    vec2 home = vec2(q) + 0.5 + (h.xy - 0.5) * mix(0.8, 0.3, edge);
    vec2 pos = home + mix(0.22, 0.1, edge) * vec2(sin(uTime * 0.7 + h2.x * 6.283), cos(uTime * 0.55 + h2.y * 6.283));
    float r = uDotPx * (0.7 + 0.6 * h2.z) * (inside ? 1.0 : 0.8);
    float d = length(f - pos) * uCellPx;
    float a = (1.0 - smoothstep(r - 0.6, r + 0.6, d)) * (0.6 + 0.4 * sin(uTime * 1.9 + h2.y * 40.0));
    if (!inside && e.r < 0.05) a *= 0.6;
    cover = max(cover, a);
  }
  vec4 col = vec4(uSkinCol, 1.0) * cover;

  // the parts, high fidelity (only where the g-buffer says there is one)
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 glim = textureSize(uG, 0) - 1;
  vec4 g = texelFetch(uG, p, 0);
  float sid = mod(id8(g.r), 10.0), pid = id8(g.b);
  if (pid > 0.0) {
    vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
    vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
    vec3 ro = uCamPos;
    vec3 oc = ro - uBoundC;
    float bb = dot(oc, rd);
    float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
    if (disc > 0.0) {
      float sq = sqrt(disc), pd;
      vec4 part = realPart(ro, rd, max(0.0, -bb - sq), -bb + sq, pd);
      if (part.a > 0.0) col = part;
    }
  }

  // the profile: a clean white line where the shape ends (or folds over itself)
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    vec4 n = texelFetch(uG, clamp(p + ivec2(round(vec2(cos(an), sin(an)) * uLineW)), ivec2(0), glim), 0);
    float nsid = mod(id8(n.r), 10.0);
    if ((nsid == 0.0) != (sid == 0.0) || (sid > 0.0 && nsid > 0.0 && abs(n.g - g.g) > 0.02)) { col = vec4(uLineCol, 1.0); break; }
  }
  outColor = col * uAlpha;
}
`;

/**
 * markerShader (device res) — the "marker" view (ref: a felt-pen drawing of stacked
 * primitives, "Balance"): the shape as flat, saturated marker fills, one colour per
 * kind of face (front blue · sides red · top salmon), with stepped, slightly wobbly
 * pixel edges, marker streaks along each face's stroke direction, ink pooling at the
 * edges and paper grain. Pass 1 = emptyCellShader (uFaces = 1) at a few px per cell.
 * The library parts stay high fidelity on top. After a view change (uDrawT) the
 * shape is painted back in, stroke by stroke, around the parts.
 */
export const markerShader = levelCommon + /* glsl */ `
uniform sampler2D uG;
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform vec3  uFront;
uniform vec3  uSide;
uniform vec3  uTop;
uniform vec3  uBack;
uniform vec3  uTypeColor[13];   // marker colours per kind of part
uniform float uDrawT;
uniform vec2  uRedrawC;
uniform float uRedrawR;
uniform float uWobble;     // device px: the parts tremble a little, like drawn by hand
// the library parts, high fidelity: real colours, lit
vec4 realPart(vec3 ro, vec3 rd, float t, float tEnd, out float dist) {
  int idx = 0;
  dist = 1e9;
  for (int i = 0; i < 110 + uZero; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    float m = min(e, cb.x);
    if (m < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
      vec3 L = normalize(uLight);
      vec3 shaded = base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      shaded = mix(shaded, vec3(1.0), 0.08);
      if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
        shaded += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
      if (mat == M_LED_LIT) shaded = base * 1.15;
      if (!isCable && idx == uHi) shaded = mix(shaded, vec3(0.95, 0.3, 0.2), 0.45);
      dist = t;
      return vec4(min(shaded, vec3(1.0)), 1.0);
    }
    t += max(m, 0.05);
    if (t > tEnd) break;
  }
  return vec4(0.0);
}


ivec2 lim;
vec2 cellAt(ivec2 c) {
  vec4 v = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
  return floor(vec2(v.r, v.a) * 255.0 + 0.5);   // (skin id, face)
}

void main() {
  lim = textureSize(uG, 0) - 1;
  vec2 px = gl_FragCoord.xy;
  // a hand-made edge: the cell lookup wobbles a little, so the steps are not ruler-straight
  vec2 wob = vec2(noise3(vec3(px * 0.035, 1.3)), noise3(vec3(px * 0.035, 7.1))) - 0.5;
  vec2 f = (px + wob * uCellPx * 0.9 - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  vec2 A = cellAt(c);

  vec4 col = vec4(0.0);
  if (A.x > 0.0) {
    float face = A.y;
    vec3 base = face == 5.0 ? uFront : (face == 1.0 || face == 2.0) ? uSide : face == 3.0 ? uTop : uBack;
    if (A.x > 1.5) base = uSide;                                  // wheels
    // each face is filled with strokes in its own direction
    float ang = face == 5.0 ? 0.35 : face == 3.0 ? -0.9 : face == 1.0 || face == 2.0 ? 1.35 : 0.8;
    vec2 dir = vec2(cos(ang), sin(ang)), nrm = vec2(-dir.y, dir.x);
    float along = dot(px, dir), across = dot(px, nrm);
    // streaks: the pen's lanes (across) with slow variation along the stroke
    float lane = noise3(vec3(across * 0.22, along * 0.012, face * 3.1));
    float fine = noise3(vec3(across * 0.9, along * 0.05, face * 1.7));
    float tone = 0.86 + 0.16 * lane + 0.06 * fine;
    // ink pools where the pen turns at the edge of a face
    bool edge = false;
    for (int k = 0; k < 4; k++) {
      ivec2 o = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
      vec2 B = cellAt(c + o);
      if (B.x != A.x || B.y != A.y) edge = true;
    }
    if (edge) tone *= 0.88;
    // paper grain through the ink
    tone *= 0.94 + 0.08 * hash(floor(px));

    // after a view change the shape forms around the parts: it grows out of them, cell by
    // cell, with an irregular front that carries a little more ink
    bool painted = true;
    if (uDrawT < 1.0) {
      float dp = 9.0;                                             // cells to the nearest part
      if (texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0).g > 0.0) dp = 0.0;
      else for (int m = 0; m < 72 + uZero; m++) {
        float r = float(m / 8 + 1) * ceil(4.0 / uCellPx);          // (rings ~4 px apart, whatever the cell)
        float an = float(m % 8) * 0.7853982 + r * 0.37;
        ivec2 qq = c + ivec2(round(vec2(cos(an), sin(an)) * r));
        if (texelFetch(uG, clamp(qq + 1, ivec2(0), lim), 0).g > 0.0) { dp = r; break; }
      }
      float front = uDrawT * 1.2 - 0.1;
      float need = dp / (9.0 * ceil(4.0 / uCellPx)) + (noise3(vec3(vec2(c) * 0.35 * uCellPx / 3.5, face)) - 0.5) * 0.22;
      painted = front >= need;
      if (painted && front - need < 0.06) tone *= 0.82;           // the growing edge, wet
    }
    col = painted ? vec4(base * tone, 1.0) : vec4(0.0);
  }

  // the parts, drawn in the same felt pen: one marker colour per kind of part, a lighter and
  // a darker tone for the faces turned up / away, streaks, stepped edges, grain
  // (the ray is cast from the centre of a half cell, so their edges step like the shape's)
  vec2 pw = px + uWobble * vec2(sin(px.y * 0.045 + uTime * 7.0) + 0.5 * sin(px.y * 0.11 - uTime * 5.0),
                                cos(px.x * 0.05 + uTime * 6.0) + 0.5 * cos(px.x * 0.13 + uTime * 4.0));
  vec2 pq = (floor((pw - uGridOff) / (uCellPx * 0.5)) + 0.5) * uCellPx * 0.5 + uGridOff;
  vec2 o = (pq - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = max(0.0, -bb - sq), tEnd = -bb + sq;
    int idx = 0;
    for (int i = 0; i < 110 + uZero; i++) {
      vec3 p = ro + rd * t;
      float e = partsSDF(p, idx);
      vec2 cb = cablesSDF(p);
      bool isCable = cb.x < e;
      float mm = min(e, cb.x);
      if (mm < 0.05) {
        vec3 n = vec3(0.0);
        for (int j = 0; j < 4 + uZero; j++) {
          vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
          n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
        }
        n = normalize(n);
        float mat = isCable ? -1.0 : partModel(idx, p).y;
        vec3 base = isCable ? mix(uSide, vec3(0.1), 0.25) : uTypeColor[uPartType[idx]];
        // flat tones, no gloss: up-facing lighter, away-facing darker; dark details stay darker
        float lit = dot(n, normalize(vec3(-0.4, 0.9, 0.5)));
        float tone2 = lit > 0.35 ? 1.08 : lit > -0.2 ? 0.92 : 0.74;
        if (!isCable) tone2 *= mix(0.78, 1.04, smoothstep(0.1, 0.6, dot(matColor(mat), vec3(0.333))));
        if (mat == M_LED_LIT) base = vec3(0.98, 0.5, 0.55);
        float ang2 = 0.35 + float(idx) * 0.7;
        vec2 dir2 = vec2(cos(ang2), sin(ang2));
        float lane2 = noise3(vec3(dot(px, vec2(-dir2.y, dir2.x)) * 0.25, dot(px, dir2) * 0.012, float(idx) * 2.3));
        tone2 *= (0.88 + 0.16 * lane2) * (0.94 + 0.08 * hash(floor(px) + 3.0));
        if (!isCable && idx == uHi) base = mix(base, uSide, 0.5);
        col = vec4(min(base * tone2, vec3(1.0)), 1.0);
        break;
      }
      t += max(mm, 0.05);
      if (t > tEnd) break;
    }
  }
  outColor = col * uAlpha;
}
`;

/**
 * densityShader (device res) — the "density" view (ref: kernel-density contour plots).
 * The shape is the density of the parts on screen: every part (its projected box)
 * spreads a soft halo, the halos add up, and the sum is cut into flat bands — pale
 * outside, darker where the parts crowd. A slow noise warp gives the wavy, living
 * edges of a density plot. Recomputed every frame from the projected parts, so when
 * the view changes the parts glide and the bands re-form around them. The parts
 * stay high fidelity on top.
 */
export const densityShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform vec4  uRect[12];     // per part: centre (device px), half size (device px)
uniform float uRectW[12];    // weight (bigger parts weigh more)
uniform int   uRectN;
uniform float uSigma;        // spread of a halo, device px
uniform vec3  uRamp[8];      // band colours, outside → inside (0 = page tint, unused)
uniform float uLevels;       // number of bands
uniform float uHaze;         // smoke: 0.3 at rest, more while the view changes
uniform float uMotion;       // 0..1: how much the shape keeps moving at rest (warp amount and speed)
uniform vec2  uJelly;        // device px: how far the blob lags behind the parts (mean of their springs)
uniform sampler2D uG;        // the shape, one texel per cell (emptyCellShader, with faces)
uniform float uCellPx;
uniform vec2  uGridOff;
uniform sampler2D uP;        // full-res flat g-buffer: which part is seen where (for the outlines)
uniform float uLineW;
uniform vec3  uLineCol;
uniform int   uShowSil;      // 1 = the object's outline
uniform int   uShowParts;    // 1 = the parts' outlines
uniform int   uPass;         // 0 = the density field, blended with last frame's (a fluid with memory) · 1 = draw
uniform sampler2D uPrev;     // pass 0: last frame's field · pass 1: this frame's field
uniform float uK;            // pass 0: how much of the new field goes in this frame (1 = no memory)
float unpackD(vec4 t) { return t.r + t.g / 255.0; }
vec4 packD(float d) { d = clamp(d, 0.0, 0.9999) * 255.0; return vec4(floor(d) / 255.0, fract(d), 0.0, 1.0); }
// the library parts, high fidelity: real colours, lit
vec4 realPart(vec3 ro, vec3 rd, float t, float tEnd, out float dist) {
  int idx = 0;
  dist = 1e9;
  for (int i = 0; i < 110 + uZero; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    float m = min(e, cb.x);
    if (m < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
      vec3 L = normalize(uLight);
      vec3 shaded = base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      shaded = mix(shaded, vec3(1.0), 0.08);
      if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
        shaded += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
      if (mat == M_LED_LIT) shaded = base * 1.15;
      if (!isCable && idx == uHi) shaded = mix(shaded, vec3(0.95, 0.3, 0.2), 0.45);
      dist = t;
      return vec4(min(shaded, vec3(1.0)), 1.0);
    }
    t += max(m, 0.05);
    if (t > tEnd) break;
  }
  return vec4(0.0);
}

void drawMain(vec2 px);

void main() {
  vec2 px = gl_FragCoord.xy;
  if (uPass == 1) { drawMain(px); return; }
  // a slow, organic warp: the bands wobble like a kernel density estimate
  float mt = uTime * (0.04 + 0.5 * uMotion);
  vec2 w = vec2(noise3(vec3(px / (uSigma * 1.6), mt)), noise3(vec3(px / (uSigma * 1.6) + 9.3, mt))) - 0.5;
  vec2 q = px + w * uSigma * (0.35 + 1.5 * uMotion);
  float dsum = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uRectN) break;
    vec2 d = abs(q - uRect[i].xy) - uRect[i].zw;
    float dist = length(max(d, 0.0));                       // 0 inside the part's box
    dsum += uRectW[i] * exp(-dist * dist / (2.0 * uSigma * uSigma));
  }
  float partsD = 1.0 - exp(-dsum * 0.9);                    // saturates where the parts crowd

  // the shape itself, blurred: so the outer bands follow the object's silhouette
  ivec2 lim = textureSize(uG, 0) - 1;
  float skin = 0.0, up = 0.0, side = 0.0;
  float R = uSigma * 0.38, rot = hash(floor(px)) * 6.2832;
  for (int i = 0; i < 16 + uZero; i++) {
    float a = float(i) * 2.39996 + rot, r = sqrt((float(i) + 0.5) / 16.0) * R;
    vec2 sp = q - uJelly + vec2(cos(a), sin(a)) * r;
    ivec2 c = ivec2(floor((sp - uGridOff) / uCellPx));
    vec4 g = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
    float sid = floor(g.r * 255.0 + 0.5), face = floor(g.a * 255.0 + 0.5);
    if (sid > 0.0 || g.g > 0.0) {
      // each kind of face sits at its own level, so the faces fall into different bands
      skin += face == 3.0 ? 0.42 : (face == 1.0 || face == 2.0) ? 0.78 : 0.6;
    }
  }
  skin /= 16.0; up /= 16.0; side /= 16.0;
  // the faces bend the bands: tops rise, sides sink — so the volume reads
  float dens = clamp(skin + 0.3 * partsD, 0.0, 1.0);
  // the field remembers: it flows toward the new one instead of jumping (liquid, not stepped)
  float prev = unpackD(texelFetch(uPrev, ivec2(px), 0));
  outColor = packD(mix(prev, dens, uK));
}

void drawMain(vec2 px) {
  float dens = unpackD(texelFetch(uPrev, ivec2(px), 0));
  // smoky, grainy band edges: the level is dithered by grain and a soft drifting haze
  float haze = noise3(vec3(px / (uSigma * 0.55), uTime * 0.3 * uMotion + 3.0)) - 0.5;   // (still when motion is 0)
  float v = dens * uLevels + (hash(floor(px) + floor(uTime * 8.0 * uMotion) * 13.1) - 0.5) * 0.14 + haze * uHaze;
  float band = floor(v);
  vec4 col = vec4(0.0);
  if (band >= 1.0) {
    int bi = int(min(band, 7.0));
    col = vec4(uRamp[clamp(int(floor(float(bi) * 7.0 / max(uLevels, 1.0) + 0.5)), 1, 7)], 1.0);   // fewer, wider bands keep the full ramp
    col.rgb *= 0.98 + 0.04 * hash(floor(px) + 17.0);          // a light grain in the ink
  }

  // the parts: white outlines only, the density shows through them
  ivec2 pp = ivec2(gl_FragCoord.xy);
  ivec2 plim = textureSize(uP, 0) - 1;
  float pid = floor(texelFetch(uP, pp, 0).b * 255.0 + 0.5);
  bool line = false;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    float npid = floor(texelFetch(uP, clamp(pp + ivec2(round(vec2(cos(an), sin(an)) * uLineW)), ivec2(0), plim), 0).b * 255.0 + 0.5);
    if (uShowParts == 1 && npid != pid && max(npid, pid) >= 40.0) { line = true; break; }   // part edges (not the cables' own)
  }
  // …and the object's own outline: where the shape ends (body, wheels, knob caps)
  float sid0 = floor(texelFetch(uP, pp, 0).r * 255.0 + 0.5);
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    float nsid = floor(texelFetch(uP, clamp(pp + ivec2(round(vec2(cos(an), sin(an)) * uLineW)), ivec2(0), plim), 0).r * 255.0 + 0.5);
    if (uShowSil == 1 && (nsid == 0.0) != (sid0 == 0.0)) { line = true; break; }
  }
  if (line) col = vec4(uLineCol, 1.0);
  outColor = vec4(col.rgb * col.a, col.a) * uAlpha;
}
`;

/**
 * particlesShader (device res) — the "particles" view (ref: a framed dot grid on black).
 * Clean and still, in 2D: a strict grid of big dots — some filled, some hollow rings —
 * on the cells that fall inside the shape (and its parts), a crisp white outline of the
 * object, and the parts as thin white outlines. Reads the per-cell texture of
 * emptyCellShader (uG) and the full-res flat g-buffer (uP). No jitter, no wobble.
 */
export const particlesShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uG;      // per cell: skin id, part id
uniform sampler2D uP;      // full-res flat g-buffer: outlines
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uFill;       // chance of a dot on a cell inside the shape
uniform float uPartFill;   // … on a cell with a part
uniform float uRingFrac;   // share of hollow rings
uniform float uDotR;       // dot radius, fraction of a cell
uniform float uLineW;
uniform vec3  uInk;
uniform vec3  uLineCol;
uniform vec3  uPartLine;
out vec4 outColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  vec2 px = gl_FragCoord.xy;
  ivec2 lim = textureSize(uG, 0) - 1;
  vec2 f = (px - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  vec4 g = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
  bool skin = g.r > 0.0, part = g.g > 0.0;
  vec4 col = vec4(0.0);
  if (skin || part) {
    float h = h21(vec2(c) + 0.37), h2 = h21(vec2(c) * 1.71 + 9.1);
    if (h < (part ? uPartFill : uFill)) {
      vec2 d = (f - (vec2(c) + 0.5)) * uCellPx;
      float r = uDotR * uCellPx, l = length(d);
      float a = h2 < uRingFrac ? 1.0 - smoothstep(0.5, 1.3, abs(l - r + 0.6))   // a hollow ring
                               : 1.0 - smoothstep(r - 0.7, r + 0.7, l);          // a dot
      col = vec4(uInk, 1.0) * a;
    }
  }
  // the outlines: the object (crisp white) and its parts (thinner, grey)
  ivec2 pp = ivec2(px);
  ivec2 plim = textureSize(uP, 0) - 1;
  vec4 g0 = texelFetch(uP, pp, 0);
  float sid0 = floor(g0.r * 255.0 + 0.5), pid0 = floor(g0.b * 255.0 + 0.5);
  bool sil = false, pl = false;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    vec4 gn = texelFetch(uP, clamp(pp + ivec2(round(vec2(cos(an), sin(an)) * uLineW)), ivec2(0), plim), 0);
    float sidn = floor(gn.r * 255.0 + 0.5), pidn = floor(gn.b * 255.0 + 0.5);
    if ((sidn == 0.0) != (sid0 == 0.0)) sil = true;
    if (pidn != pid0 && max(pidn, pid0) >= 40.0) pl = true;
  }
  if (pl) col = vec4(uPartLine, 1.0);
  if (sil) col = vec4(uLineCol, 1.0);
  outColor = col * uAlpha;
}
`;

/**
 * picassoShader (device res) — the "picasso" view (ref: Picasso's bull lithographs).
 * One sure ink contour of brush-like, varying width; thin construction lines where the
 * faces turn; the parts as grainy lithographic black patches scratched with paper
 * white, with a thin contour; a dry-brush speckle on the side faces; and the black
 * ground stroke under the object. Reads the flat g-buffer with faces (uG). After a view
 * change the pen redraws the lines (uStroke, strokes.js), then speckle and ground come.
 */
export const picassoShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uG;
uniform sampler2D uStroke;
uniform float uStrokeK;
uniform float uDrawT;
uniform float uAlpha;
uniform float uLineW;
uniform vec3  uInk;
uniform vec4  uGround;     // device px: x0, x1, y, half thickness
out vec4 outColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float id8(float v) { return floor(v * 255.0 + 0.5); }

void main() {
  vec2 px = gl_FragCoord.xy;
  ivec2 p = ivec2(px);
  ivec2 lim = textureSize(uG, 0) - 1;
  vec4 c = texelFetch(uG, p, 0);
  float sraw = id8(c.r), sid = mod(sraw, 10.0), face = floor(sraw / 10.0), pid = id8(c.b);
  float T = uDrawT;
  float since = T >= 1.0 ? 1.0 : T - texelFetch(uStroke, clamp(ivec2(px * uStrokeK), ivec2(0), textureSize(uStroke, 0) - 1), 0).r;

  // the brush: its width swells and thins along the line
  float wB = uLineW * (0.7 + 1.1 * vnoise(px * 0.025));
  bool sil = false, crease = false, pedge = false;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    vec2 dir = vec2(cos(an), sin(an));
    vec4 n = texelFetch(uG, clamp(p + ivec2(round(dir * wB)), ivec2(0), lim), 0);
    float nraw = id8(n.r), nsid = mod(nraw, 10.0), npid = id8(n.b);
    if ((nsid == 0.0) != (sid == 0.0) || (sid > 0.0 && nsid > 0.0 && abs(n.g - c.g) > 0.02)) sil = true;
    vec4 m = texelFetch(uG, clamp(p + ivec2(round(dir * max(1.0, 0.45 * uLineW))), ivec2(0), lim), 0);
    float mraw = id8(m.r), mpid = id8(m.b);
    if (mod(mraw, 10.0) == sid && sid > 0.0 && floor(mraw / 10.0) != face && pid == 0.0) crease = true;
    if (mpid != pid && max(mpid, pid) >= 40.0) pedge = true;
  }

  vec4 col = vec4(0.0);
  // dry-brush speckle on the side faces (after the lines)
  if (sid > 0.0 && pid == 0.0 && (face == 1.0 || face == 2.0)) {
    float dens = 0.18 * smoothstep(0.35, 0.8, vnoise(px * vec2(0.035, 0.012)));
    if (h21(floor(px)) < dens * smoothstep(0.6, 0.9, T)) col = vec4(uInk, 0.8);
  }
  // the parts: lithographic black, scratched with paper white (always there: they never leave)
  if (pid >= 40.0) {
    float scratch = vnoise(px * vec2(0.9, 0.06) + pid * 3.1) * vnoise(px * 0.05 + pid);
    float grain = h21(floor(px) + pid);
    bool white = scratch > 0.42 || grain > 0.93;
    col = white ? vec4(0.0) : vec4(uInk, 1.0);
  }
  if (pid >= 20.0 && pid < 40.0) col = vec4(uInk, 1.0);                 // cables: ink lines
  if (pedge) col = vec4(uInk, 1.0);
  // construction lines and the contour, drawn by the pen
  if (crease && since >= 0.0) col = vec4(uInk, 0.75);
  if (sil && since >= 0.0) col = vec4(uInk, 1.0);

  // the ground: a black brush stroke under the object, laid left to right after the contour
  float gx = (px.x - uGround.x) / max(uGround.y - uGround.x, 1.0);
  if (gx > -0.05 && gx < 1.05) {
    float th = uGround.w * (0.55 + 0.9 * vnoise(vec2(px.x * 0.03, 2.0)));
    float off = (vnoise(vec2(px.x * 0.012, 7.0)) - 0.5) * uGround.w * 2.0;
    float dy = abs(px.y - uGround.z - off);
    float ends = smoothstep(-0.05, 0.08, gx) * smoothstep(1.05, 0.9, gx);
    bool laid = T >= 1.0 || gx < (T - 0.62) / 0.3;
    if (dy < th * ends && laid && vnoise(px * vec2(0.6, 0.15)) > 0.18) col = vec4(uInk, 1.0);
  }
  outColor = vec4(col.rgb * col.a, col.a) * uAlpha;
}
`;

/**
 * overlayShader (device res) — optional layers over the "dots grid" view (lab): the
 * parts high fidelity, the parts' outlines, the object's outline. Reads the full-res
 * flat g-buffer (uP) for the lines; raymarches the parts only where one is seen.
 */
export const overlayShader = levelCommon + /* glsl */ `
uniform sampler2D uP;
uniform float uAlpha;
uniform float uLineW;
uniform vec3  uLineCol;
uniform int   uShowSil;
uniform int   uShowPartLines;
uniform int   uShowParts;
// the library parts, high fidelity: real colours, lit
vec4 realPart(vec3 ro, vec3 rd, float t, float tEnd, out float dist) {
  int idx = 0;
  dist = 1e9;
  for (int i = 0; i < 110 + uZero; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    float m = min(e, cb.x);
    if (m < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : matColor(mat);
      vec3 L = normalize(uLight);
      vec3 shaded = base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      shaded = mix(shaded, vec3(1.0), 0.08);
      if (mat == M_METAL || mat == M_RIM || mat == M_GOLD)
        shaded += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
      if (mat == M_LED_LIT) shaded = base * 1.15;
      if (!isCable && idx == uHi) shaded = mix(shaded, vec3(0.95, 0.3, 0.2), 0.45);
      dist = t;
      return vec4(min(shaded, vec3(1.0)), 1.0);
    }
    t += max(m, 0.05);
    if (t > tEnd) break;
  }
  return vec4(0.0);
}


void main() {
  vec2 px = gl_FragCoord.xy;
  ivec2 pp = ivec2(px);
  ivec2 plim = textureSize(uP, 0) - 1;
  vec4 g0 = texelFetch(uP, pp, 0);
  float sid0 = floor(g0.r * 255.0 + 0.5), pid0 = floor(g0.b * 255.0 + 0.5);
  vec4 col = vec4(0.0);
  if (uShowParts == 1 && pid0 > 0.0) {
    vec2 o = (px - uCenterDev) / uFocal;
    vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
    vec3 ro = uCamPos;
    vec3 oc = ro - uBoundC;
    float bb = dot(oc, rd);
    float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
    if (disc > 0.0) {
      float sq = sqrt(disc), pd;
      vec4 part = realPart(ro, rd, max(0.0, -bb - sq), -bb + sq, pd);
      if (part.a > 0.0) col = part;
    }
  }
  bool sil = false, pl = false;
  for (int k = 0; k < 8; k++) {
    float an = float(k) * 0.7853982;
    vec4 gn = texelFetch(uP, clamp(pp + ivec2(round(vec2(cos(an), sin(an)) * uLineW)), ivec2(0), plim), 0);
    float sidn = floor(gn.r * 255.0 + 0.5), pidn = floor(gn.b * 255.0 + 0.5);
    if ((sidn == 0.0) != (sid0 == 0.0)) sil = true;
    if (pidn != pid0 && max(pidn, pid0) >= 40.0) pl = true;
  }
  if (uShowPartLines == 1 && pl) col = vec4(uLineCol, 1.0);
  if (uShowSil == 1 && sil) col = vec4(uLineCol, 1.0);
  outColor = col * uAlpha;
}
`;

/**
 * The "cross" view (ref: rounded pixel islands on a dot grid, and the grey pixel 3d):
 * the shape as whole cells with rounded outer corners in light greys (front · top ·
 * sides), one dot per cell centre on page and shape alike (the snap points), and the
 * parts high fidelity on top.
 *
 * Three passes, so the heavy raymarching runs only when something changes:
 *   1. emptyCellShader (uFaces = 1), one texel per cell — every frame (cheap)
 *   2. crossHifiShader, full res, into two textures — ONLY when the camera, the layout,
 *      the add-ons or the part style change (body.js keeps a key): the parts, lit, and
 *      the outside (knob caps, speaker holes)
 *   3. crossShader — every frame: cells + marks + those two textures. No SDF code at all.
 */
const crossHifiSrc = levelCommon + /* glsl */ `
// part styles, from the most real to the most abstract (the same numbers in crossShader):
// 0 colour · 1 grey · 2 flat · 3 vector · 4 line · 5 boxes · 6 tiles (flat hd 2 colours, drawn by crossShader)
// 7 outline · 8 grid line (drawn by crossShader from the cells) · 9 dots · 10 crosses (both from the grey shading)
// 11 flat 1 (the first flat: the lit grey cut into three tones, no outlines)
uniform int   uPartStyle;
uniform vec3  uPartTint;   // look a: the greys in warm mauve greys (1 = neutral)
uniform vec3  uTypeColor[13];   // one flat colour per kind of part (vector, boxes, tiles)
uniform float uOuterOn;    // 1 = also draw the outside (knob caps, speaker holes)
uniform int   uSteps;      // raymarch steps for the parts (fewer while the camera moves)
uniform vec2  uDepthRange; // near, far (mm from the camera) for the depth kept in outMeta
uniform sampler2D uG;      // the cell pass: b = depth where a part or cable first comes near (1 = none)
uniform float uCellPx;
uniform vec2  uGridOff;
uniform vec2  uCellRange;  // near, far of that depth (mm along the ray)
uniform vec3  uHiCol;      // the highlighted part's colour (the node's palette); 0 = its 'colour' style colour
layout(location = 1) out vec4 outOuter;
layout(location = 2) out vec4 outMeta;   // for the outlines: part id, depth, face class

#if !defined(BOXES) && !defined(OUTER)
// the library parts: the first hit (part index, point, normal, material); false if none
bool marchParts(vec3 ro, vec3 rd, float t, float tEnd, out int hitIdx, out vec3 hitP, out vec3 hitN, out float hitMat, out bool hitCable, out float hitT) {
  int idx = 0;
  hitIdx = -1; hitCable = false; hitMat = 0.0; hitP = ro; hitN = vec3(0.0, 0.0, 1.0); hitT = 0.0;
  for (int i = 0; i < uSteps + uZero; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    float m = min(e, cb.x);
    if (m < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      hitN = normalize(n);
      hitMat = isCable ? cb.y : partModel(idx, p).y;   // a cable keeps its colour code here
      hitCable = isCable;
      hitIdx = idx;
      hitP = p;
      hitT = t;
      return true;
    }
    t += max(m, 0.05);
    if (t > tEnd) break;
  }
  return false;
}

#endif
#if defined(BOXES) && !defined(OUTER)
// boxes: every part as its own bounding box (softly rounded), nothing else
bool marchBoxes(vec3 ro, vec3 rd, float t, float tEnd, out int hitIdx, out vec3 hitP, out vec3 hitN, out float hitT) {
  hitIdx = -1; hitP = ro; hitN = vec3(0.0, 0.0, 1.0); hitT = 0.0;
  for (int i = 0; i < 80 + uZero; i++) {
    vec3 p = ro + rd * t;
    float d = 1e9;
    int id = 0;
    for (int k = 0; k < uPartCount; k++) {
      float e = pRBox(transpose(uPartR[k]) * (p - uPartC[k]), uPartH[k], 1.2);
      if (e < d) { d = e; id = k; }
    }
    if (d < 0.05) {
      vec3 q = transpose(uPartR[id]) * (p - uPartC[id]);
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * pRBox(q + k * 0.3, uPartH[id], 1.2);
      }
      hitN = normalize(uPartR[id] * n);
      hitIdx = id; hitP = p; hitT = t;
      return true;
    }
    t += max(d, 0.05);
    if (t > tEnd) break;
  }
  return false;
}

#endif
#ifdef OUTER
// the outside: the first hit on the skin. kind 1 = skin / wheel, 2 = knob cap, 3 = speaker hole
float outerHit(vec3 ro, vec3 rd, float t, float tEnd, out vec3 p, out float kind) {
  kind = 0.0;
  p = ro;
  for (int i = 0; i < 100 + uZero; i++) {
    p = ro + rd * t;
    float h = scene(p).x;
    if (h < 0.08) {
      float ei;
      kind = extrasSDF(p, ei) < 0.3 ? 2.0 : (bodySDF(p) < -0.25 && speakerHoles(p) < 0.5) ? 3.0 : 1.0;
      return t;
    }
    t += h * 0.85;
    if (t > tEnd) break;
  }
  return 1e9;
}

#endif

const vec3 INK = vec3(0.13, 0.125, 0.12);

void main() {
  outColor = vec4(0.0);
  outOuter = vec4(0.0);
  outMeta = vec4(0.0);
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc <= 0.0) return;
  float sq = sqrt(disc), t0 = max(0.0, -bb - sq), t1 = -bb + sq;

#ifndef OUTER
  // only near a part: the cell pass says where something comes close (3×3 cells around this
  // pixel); nothing there → no march at all, otherwise start right before the nearest of them
  ivec2 lim = textureSize(uG, 0) - 1;
  ivec2 cc = ivec2(floor((gl_FragCoord.xy - uGridOff) / uCellPx));
  float near = 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++)
    near = min(near, texelFetch(uG, clamp(cc + ivec2(i, j) + 1, ivec2(0), lim), 0).b);
  int hi; vec3 hp, n; float mat = 0.0, ht; bool cable = false;
  bool hit = false;
  if (near < 1.0) {
    float ts = max(t0, uCellRange.x + near * (uCellRange.y - uCellRange.x) - 6.0);
#ifdef BOXES
    hit = marchBoxes(ro, rd, ts, t1, hi, hp, n, ht);
#else
    hit = marchParts(ro, rd, ts, t1, hi, hp, n, mat, cable, ht);
#endif
  }
  if (hit) {
    vec3 L = normalize(uLight);
    vec3 base = cable ? cableColor(mat) : matColor(mat);
    bool led = !cable && uPartStyle != 5 && mat == M_LED_LIT;    // the lit LEDs (the face)
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    // face class, as the shape's tiles: 1 front / back · 2 top · 3 side
    float fc = n.y > 0.6 ? 2.0 : abs(n.x) > abs(n.z) ? 3.0 : 1.0;
    float faceK = fc == 2.0 ? 1.12 : fc == 3.0 ? 0.8 : 1.0;
    vec3 typeC = cable ? cableColor(mat) : uTypeColor[uPartType[hi]];
    vec3 col;
    // the shading each style starts from: outline = line's paper; dots / crosses = grey's tones
    int cs = uPartStyle == 7 ? 4 : uPartStyle >= 9 ? 1 : uPartStyle;
    if (cs == 0) {                               // colour: real materials, lit
      col = base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0));
      col = mix(col, vec3(1.0), 0.08);
      if (!cable && (mat == M_METAL || mat == M_RIM || mat == M_GOLD))
        col += vec3(0.45) * pow(max(dot(reflect(-L, n), -rd), 0.0), 20.0);
      if (led) col = base * 1.15;
    } else if (cs == 1) {                        // grey: the same light, no colour
      float l = dot(base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0)), vec3(0.299, 0.587, 0.114));
      col = vec3(0.16 + 0.8 * min(l, 1.0)) * uPartTint;
    } else if (cs == 2) {                        // flat: three tones by material × one per face (like the tiles)
      float lv = lum > 0.6 ? 0.9 : lum > 0.3 ? 0.58 : 0.3;
      col = vec3(min(lv * faceK, 0.97)) * uPartTint;
    } else if (cs == 3) {                        // vector: one flat colour per kind of part, dark details deeper
      col = typeC * (lum < 0.3 && !cable ? 0.72 : 1.0) * mix(1.0, faceK, 0.55);
    } else if (cs == 4) {                        // line: white paper, only ink (the outlines come in crossShader)
      col = vec3(0.975, 0.97, 0.96);
    } else if (cs == 11) {                       // flat 1: the lit grey cut into three tones
      float l = dot(base * (0.6 + 0.55 * max(dot(n, L), 0.0) + 0.12 * max(n.y, 0.0)), vec3(0.299, 0.587, 0.114));
      col = (l > 0.62 ? vec3(0.95) : l > 0.34 ? vec3(0.58) : vec3(0.27)) * uPartTint;
    } else {                                     // boxes: plain blocks in the part's colour
      col = typeC * faceK;
    }
    if (led && cs != 0) col = cs == 3 || cs == 5 ? INK : vec3(0.17) * uPartTint;   // the face reads dark
    // the part a node points at (hover / click): in its own 'colour' style colour, the face still reads
    if (!cable && hi == uHi) {
      vec3 hc = dot(uHiCol, vec3(1.0)) > 0.0 ? uHiCol : typeC;
      col = led ? INK : hc * (lum < 0.3 ? 0.84 : 1.0) * mix(1.0, faceK, 0.45);
    }
    col = min(col, vec3(1.0));
    bool tileLike = uPartStyle == 6 || uPartStyle == 8;   // drawn from the cells, no 3D layer
    if (!tileLike) {
      outColor = vec4(col, 1.0);
      float dep = clamp((ht - uDepthRange.x) / (uDepthRange.y - uDepthRange.x), 0.0, 1.0);
      outMeta = vec4((cable ? 250.0 : float(hi + 1)) / 255.0, dep, fc / 255.0, 1.0);
    }
    // the screen's face is on the outside (flush with the skin): it stays in the outside view too
    if (!cable && uPartStyle != 5 && (uPartType[hi] == 6 || uPartType[hi] == 11)) {
      vec3 q = transpose(uPartR[hi]) * (hp - uPartC[hi]);
      bool face = uPartType[hi] == 6
        ? abs(q.x) < 19.8 && abs(q.y) < 13.8 && q.z > 1.4                    // LED matrix: the LED field
        : abs(q.x) < 17.3 && abs(q.y + 3.0) < 11.6 && q.z > 2.5;             // OLED: the glass panel
      if (face) outOuter = vec4(tileLike ? (led ? INK : vec3(0.93)) : col, 1.0);
    }
  }
#endif

#ifdef OUTER
  if (uOuterOn > 0.5) {
    vec3 sp;
    float kind;
    outerHit(ro, rd, t0, t1, sp, kind);
    if (kind > 1.5) {
      vec3 n2 = calcNormal(sp);
      vec3 L = normalize(uLight);
      vec3 c;
      if (kind < 2.5) {     // knob cap: dark rubber, lit like the parts
        c = matColor(M_RUBBER) * (0.6 + 0.55 * max(dot(n2, L), 0.0) + 0.12 * max(n2.y, 0.0));
        c = mix(c, vec3(1.0), 0.1) + vec3(0.12) * pow(max(dot(reflect(-L, n2), -rd), 0.0), 12.0);
      } else {              // speaker hole: a dark well, its wall a touch lighter
        c = mix(vec3(0.17, 0.17, 0.2), vec3(0.32, 0.32, 0.36), 1.0 - abs(dot(n2, -rd)));
      }
      if (uPartStyle != 0) c = vec3(dot(c, vec3(0.299, 0.587, 0.114))) * uPartTint;   // the drawn styles: greys
      outOuter = vec4(min(c, vec3(1.0)), 1.0);
    }
  }
  if (outOuter.a == 0.0) discard;   // (drawn over the parts pass: only the caps and holes)
#endif
}
`;

/**
 * The hifi pass in variants, each compiled with only the code it runs (ANGLE / D3D runs
 * the skipped branches of a big shader anyway, so one shader for everything paid for all):
 * BOXES = the boxes style instead of the real parts · OUTER = the outside alone (caps, holes), a second
 * pass into the outer target only — kept apart so no program carries both the part models and the skin.
 */
export const crossHifiVariant = (defs) => crossHifiSrc.replace('#version 300 es', '#version 300 es\n' + defs.map((d) => `#define ${d}`).join('\n'));

/**
 * crossMaskShader — before the hifi pass, into its depth buffer: depth 0 where a part (or,
 * with the outside on, the skin) is within a cell or so, 1 elsewhere. The hifi pass then runs
 * with the depth test, so the GPU drops every other pixel BEFORE the heavy shader runs
 * (a branch inside that shader saves nothing on ANGLE / D3D: the loops run anyway).
 */
export const crossMaskShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uG;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform float uSkin;     // 1 = the skin's cells count too (the outside layer needs them)
out vec4 outColor;
void main() {
  ivec2 lim = textureSize(uG, 0) - 1;
  ivec2 cc = ivec2(floor((gl_FragCoord.xy - uGridOff) / uCellPx));
  bool on = false;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 v = texelFetch(uG, clamp(cc + ivec2(i, j) + 1, ivec2(0), lim), 0);
    on = on || v.b < 1.0 || (uSkin > 0.5 && v.r > 0.0);
  }
  gl_FragDepth = on ? 0.0 : 1.0;
  outColor = vec4(0.0);
}
`;

export const crossShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uG;      // per cell: skin id, part id, -, face
uniform sampler2D uParts;  // hifi pass: the parts (opaque where hit)
uniform sampler2D uOuterTex; // hifi pass: knob caps and speaker holes
uniform sampler2D uMeta;   // hifi pass: part id, depth, face class (for the outlines)
uniform float uAlpha;
uniform float uCellPx;
uniform vec2  uGridOff;
uniform vec3  uLightFill;  // front faces
uniform vec3  uTopFill;    // faces looking up
uniform vec3  uSideFill;   // side faces
uniform vec3  uWheelFill;
uniform vec3  uDotCol;     // dots on the shape
uniform vec3  uPageDot;    // dots on the page
uniform float uPattern;    // 1 = the dot on every cell (cross) · 0 = none: only the snap points, in SVG (cross 2)
uniform int   uMark;       // pattern mark, as the snap toggle: 0 dot · 1 cross · 2 ring · 3 bracket
uniform float uDrawT;      // cross: after a view change the shape builds up cell by cell (1 = built)
uniform float uOutT;       // cross: before it, the shape leaves cell by cell (0 = all there)
uniform int   uAnim;       // cross transition: 0 scatter (shrink) · 1 wipe · 2 ripple · 3 cut · 4 pop · 5 flicker
uniform int   uPartStyle;  // the parts: 0 colour · 1 grey · 2 flat · 3 vector · 4 line · 5 boxes · 6 tiles (flat hd 2 colours)
uniform vec3  uPartCell;   // cells style: tile colour
uniform vec3  uTypeColor[13];   // 'flat hd 2' style: one flat colour per kind of part
uniform int   uPartType[12];
uniform vec2  uRedrawC;    // device px: projected centre of the object
uniform float uRedrawR;
uniform float uOuter;      // outside slider: how much the outside shows (knob caps, speaker holes, the screen's face)
uniform float uInside;     // inside slider: how much the parts inside the shape show (1 = all, 0 = hidden by the skin)
uniform float uHifiScale;  // the hifi layer's resolution (0.5 while the camera moves)
uniform float uGhost;      // 0..1: while the object turns, a few loose voxels of the shape stay around the parts
uniform float uFrost;      // 0..1: how frosted the parts look INSIDE the shape (blurred and hazed toward its tone)
uniform float uFrostFollow; // 1 = the frost goes with the tiles, pixel by pixel (parts clear where the shape has left)
uniform float uVoxAmt;     // share of the shape's cells kept as loose voxels during a view change (0..1)
uniform float uVoxShimmer; // how much the voxels pulse while it turns (0 still … 1 they blink out and back)
uniform float uTime;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

ivec2 lim;
vec2 cellAt(ivec2 c) {
  vec4 v = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0);
  return floor(vec2(v.r, v.a) * 255.0 + 0.5);   // (skin id, face)
}

// how far tile c has arrived in the view-change animation, 0 (gone) .. 1 (all there)
// scatter (shrink) = grows / shrinks from its centre · pop = whole tile, off / on;
// (also: 1 wipe left→right · 2 ripple from the middle · 3 cut)
// the loose voxels: a sparse, fixed few of the shape's cells (the same ones every time)
bool isVoxel(ivec2 c) { return hash(vec2(c) * 0.731 + 7.3) < uVoxAmt; }
// how big a voxel is right now (in tile units, 0..1): it stays while the object turns, breathing a little
float voxG(ivec2 c) {
  if (uGhost <= 0.01 || !isVoxel(c)) return 0.0;
  float h = hash(vec2(c) * 0.731 + 7.3), h2 = hash(vec2(c) * 1.917 + 2.1);
  float life = 0.5 + 0.5 * sin(uTime * (1.6 + 1.4 * h2) * (1.0 + 1.5 * uVoxShimmer) + h * 60.0);
  return (0.62 + 0.3 * h2) * uGhost * mix(1.0 - uVoxShimmer, 1.0, life);
}

float tileG(ivec2 c) {
  vec2 cc = (vec2(c) + 0.5) * uCellPx + uGridOff;
  float across = clamp((cc.x - (uRedrawC.x - 0.75 * uRedrawR)) / (1.5 * uRedrawR), 0.0, 1.0);
  float ring = clamp(length(cc - uRedrawC) / (0.8 * uRedrawR), 0.0, 1.0);
  float h = uAnim == 1 ? across * 0.85 : uAnim == 2 ? ring * 0.85 : uAnim == 3 ? 0.0 : hash(vec2(c) * 0.73 + 4.1) * 0.85;
  if (isVoxel(c) && uAnim != 3) h = 0.0;   // the voxels that stayed are where the shape starts building again
  float hOut = uAnim == 2 ? (1.0 - ring) * 0.85 : h;
  float sp = uAnim == 3 || uAnim == 4 ? 0.001 : 0.15;
  float gi = clamp((uDrawT - h) / sp, 0.0, 1.0);
  float go = clamp((uOutT - hOut) / sp, 0.0, 1.0);
  if (uAnim == 4) return gi >= 1.0 && go <= 0.0 ? 1.0 : 0.0;
  float g = min(gi, 1.0 - go);
  return 1.0 - (1.0 - g) * (1.0 - g);
}
// a tile's size: its own arrival, but never smaller than its voxel (shrinks down to it, grows on from it)
float gEff(ivec2 c) { return max(tileG(c), voxG(c)); }

void main() {
  lim = textureSize(uG, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  vec2 local = f - floor(f);
  vec2 A = cellAt(c);
  vec2 A0 = A;                             // before the tiles round off / leave
  float hide = A.x > 0.0 ? 1.0 - uInside : 0.0;   // how much the skin hides what is behind it

  // in and out (after a view change), tile by tile: how far tile q has arrived (1 = all there)
  bool anim = uDrawT < 1.0 || uOutT > 0.0;
  float g = A.x > 0.0 && anim ? gEff(c) : 1.0;
  // each tile is a rounded square of half size 0.5·g: a corner is rounded when the two
  // neighbours on its sides are not (yet) there — a whole tile's corner is a quarter circle,
  // a shrunk one (leaving, arriving, a voxel) a filleted square
  if (A.x > 0.0) {
    ivec2 q = ivec2(local.x < 0.5 ? -1 : 1, local.y < 0.5 ? -1 : 1);
    ivec2 nx = c + ivec2(q.x, 0), ny = c + ivec2(0, q.y);
    bool ox = cellAt(nx).x == 0.0 || (anim && gEff(nx) < 1.0);
    bool oy = cellAt(ny).x == 0.0 || (anim && gEff(ny) < 1.0);
    vec2 lc = abs(local - 0.5);
    float hg = 0.5 * g, rr = hg * mix(0.6, 1.0, smoothstep(0.9, 1.0, g));
    if (max(lc.x, lc.y) > hg || (ox && oy && length(max(lc - (hg - rr), 0.0)) > rr)) A = vec2(0.0);
  }

  // the shape: light greys, one per kind of face (like the grey pixel 3d)
  vec4 col = vec4(0.0);
  if (A.x > 1.5) col = vec4(uWheelFill, 1.0);
  else if (A.x > 0.0) col = vec4(A.y == 3.0 ? uTopFill : (A.y == 1.0 || A.y == 2.0) ? uSideFill : uLightFill, 1.0);

  // a mark per cell centre, on the page and on the shape (on the shape they are the snap points):
  // the dot soft and round; the line marks crisp — centred on a whole pixel and one pixel wide
  vec2 d = gl_FragCoord.xy - ((vec2(c) + 0.5) * uCellPx + uGridOff);
  vec2 dp = gl_FragCoord.xy - (floor((vec2(c) + 0.5) * uCellPx + uGridOff) + 0.5);
  vec2 ad = abs(dp);
  float r = max(0.8, uCellPx * 0.07), k = clamp(floor(uCellPx * 0.12), 2.0, 3.0);
  float m;
  if (uMark == 1) m = (ad.x < 0.5 && ad.y < k + 0.5) || (ad.y < 0.5 && ad.x < k + 0.5) ? 1.0 : 0.0;    // cross
  else if (uMark == 2) m = 1.0 - smoothstep(0.15, 0.85, abs(length(dp) - k));                          // ring
  else if (uMark == 3) {                                                                                 // bracket corners
    float e = max(ad.x, ad.y);
    m = abs(e - k) < 0.5 && min(ad.x, ad.y) > k * 0.45 ? 1.0 : 0.0;
  }
  else m = 1.0 - smoothstep(r - 0.5, r + 0.5, length(d));                                                // dot
  if (uMark != 0) m *= 0.7;            // a line mark carries more ink than a dot: a lighter tone keeps it fine
  float dot1 = m * uPattern;
  if (dot1 > 0.0) col = mix(col, vec4(A.x > 0.0 ? uDotCol : uPageDot, 1.0), dot1);

  if (uPartStyle == 6) {
    // parts as tiles of the same grid, in their flat hd 2 colours, rounded like the shape's (no 3D at all)
    float pc = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0).g;
    if (pc > 0.0) {                                   // (the parts never leave: they turn with the view)
      ivec2 q = ivec2(local.x < 0.5 ? -1 : 1, local.y < 0.5 ? -1 : 1);
      bool ox = texelFetch(uG, clamp(c + ivec2(q.x, 0) + 1, ivec2(0), lim), 0).g == 0.0;
      bool oy = texelFetch(uG, clamp(c + ivec2(0, q.y) + 1, ivec2(0), lim), 0).g == 0.0;
      if (!(ox && oy && length(local - 0.5) > 0.5)) {
        int pidx = int(floor(pc * 255.0 + 0.5)) - 1;
        vec4 pcol = vec4(uTypeColor[uPartType[clamp(pidx, 0, 11)]], 1.0);
        if (dot1 > 0.0) pcol.rgb = mix(pcol.rgb, vec3(0.93), dot1 * 0.8);   // the marks run on, light on dark
        col = mix(col, pcol, 1.0 - hide);
      }
    }
  } else if (uPartStyle == 8) {
    // grid line: the parts' outline stepped along the cell borders — the outline follows the pattern
    float pc = texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0).g;
    if (pc > 0.0) {
      float w = max(1.0, uCellPx * 0.06) / uCellPx;      // ink width, in cells
      float ink = 0.0;
      for (int i = 0; i < 4; i++) {
        ivec2 o = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
        float pn = texelFetch(uG, clamp(c + o + 1, ivec2(0), lim), 0).g;
        float dEdge = i == 0 ? 1.0 - local.x : i == 1 ? local.x : i == 2 ? 1.0 - local.y : local.y;
        if (pn != pc && dEdge < w) ink = 1.0;
      }
      float fr = (uFrostFollow > 0.5 ? A.x : A0.x) > 0.0 ? uFrost : 0.0;
      col = mix(col, vec4(0.13, 0.125, 0.12, 1.0), ink * (1.0 - hide) * (1.0 - 0.7 * fr));
    }
  } else if (uPartStyle == 9 || uPartStyle == 10) {
    // dots / crosses: the page's own mark, grown in ink on every cell a part covers — bigger where the part is darker
    ivec2 hc = ivec2(((vec2(c) + 0.5) * uCellPx + uGridOff) * uHifiScale);
    vec4 pv = texelFetch(uParts, clamp(hc, ivec2(0), textureSize(uParts, 0) - 1), 0);
    if (pv.a > 0.0) {
      float dark = 1.0 - dot(pv.rgb, vec3(0.299, 0.587, 0.114));
      float fr = (uFrostFollow > 0.5 ? A.x : A0.x) > 0.0 ? uFrost : 0.0;
      float amt = clamp(0.2 + 0.95 * dark, 0.0, 1.0) * (1.0 - 0.6 * fr);
      float ink;
      if (uPartStyle == 9) {
        float rr = 0.4 * uCellPx * amt;
        ink = 1.0 - smoothstep(rr - 0.6, rr + 0.6, length(d));
      } else {
        float arm = 0.42 * uCellPx * amt, th = max(0.75, uCellPx * 0.05 * (0.6 + amt));
        ink = (ad.x < th && ad.y < arm) || (ad.y < th && ad.x < arm) ? 1.0 : 0.0;
      }
      col = mix(col, vec4(0.13, 0.125, 0.12, 1.0), ink * (1.0 - hide));
    }
  } else {
    // parts: high fidelity, from the hifi pass; behind the skin they fade as the outside comes in
    ivec2 hp = ivec2(gl_FragCoord.xy * uHifiScale);
    vec4 part = texelFetch(uParts, hp, 0);
    // frost: inside the shape the parts are seen as through frosted glass — blurred, hazed toward the shape's tone
    float fr = (uFrostFollow > 0.5 ? A.x : A0.x) > 0.0 ? uFrost : 0.0;
    if (fr > 0.01) {
      ivec2 limP = textureSize(uParts, 0) - 1;
      float R = fr * uCellPx * 0.9 * uHifiScale;
      float rot = hash(gl_FragCoord.xy) * 6.2831853;
      vec4 acc = vec4(part.rgb * part.a, part.a);
      for (int k = 0; k < 12; k++) {
        float a = float(k) * 2.39996 + rot, rr = R * sqrt((float(k) + 0.5) / 12.0);
        vec4 sv = texelFetch(uParts, clamp(hp + ivec2(round(vec2(cos(a), sin(a)) * rr)), ivec2(0), limP), 0);
        acc += vec4(sv.rgb * sv.a, sv.a);
      }
      part = vec4(acc.rgb / max(acc.a, 1e-3), acc.a / 13.0);
      part.rgb = mix(part.rgb, col.rgb, fr * 0.55);
      part.a *= 1.0 - fr * 0.3;
    }
    // the drawn styles get outlines: the silhouette of each part (and depth jumps) in full ink,
    // the folds between its faces lighter — drawn on the far side, so every line is one pixel
    if ((uPartStyle == 2 || uPartStyle == 4 || uPartStyle == 5 || uPartStyle == 7) && part.a > 0.0 && fr < 0.6) {   // (vector: flat colour only, no lines)
      vec4 m0 = texelFetch(uMeta, hp, 0);
      float sil = 0.0, fold = 0.0;
      ivec2 lim2 = textureSize(uMeta, 0) - 1;
      for (int i = 0; i < 4; i++) {
        ivec2 o = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
        vec4 m = texelFetch(uMeta, clamp(hp + o, ivec2(0), lim2), 0);
        if (m.r == 0.0 || (m.r != m0.r && m.g < m0.g) || m.g < m0.g - 2.5 / 255.0) sil = 1.0;
        else if (m.b != m0.b && m.r == m0.r) fold = 1.0;
      }
      vec3 ink = vec3(0.13, 0.125, 0.12);
      vec3 silC = uPartStyle == 2 ? part.rgb * 0.55 : ink;          // flat: the outline is its own tone, darker
      vec3 foldC = uPartStyle == 2 || uPartStyle == 5 ? part.rgb * 0.8 : mix(part.rgb, ink, 0.55);
      float lk = 1.0 - fr / 0.6;                                     // the lines melt into the frost
      if (uPartStyle == 7) {
        // outline: only the silhouettes, the shape shows through
        part = vec4(silC, sil * lk);
      } else {
        part.rgb = mix(part.rgb, foldC, fold * (1.0 - sil) * lk);
        part.rgb = mix(part.rgb, silC, sil * lk);
      }
    } else if (uPartStyle == 7) part.a = 0.0;
    col = mix(col, vec4(part.rgb, 1.0), part.a * (1.0 - hide));
  }

  // the outside: knob caps and speaker holes (they follow their tile in and out)
  vec4 outer = texelFetch(uOuterTex, ivec2(gl_FragCoord.xy * uHifiScale), 0) * uOuter * g;
  col = outer + col * (1.0 - outer.a);
  outColor = col * uAlpha;
}
`;

/* ------------------------------------------------------------------ */

/**
 * glassShader (device res) — the "glass" view: the provisional shape (skin,
 * wheels, knob caps) as frosted glass — refraction, a grainy frost that blurs
 * what is behind it, an iridescent rim, a sharp highlight — and the library
 * parts inside as bright, playful 3D objects, hazier the deeper they sit.
 */
export const glassShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform vec3  uTypeColor[13];
uniform float uFrost;     // how much the glass scatters the rays (radians)

vec3 iridescence(float x) {
  return 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + x));
}

// the parts, shaded bright and playful (same look as the pixel 3d view)
bool shadeParts(vec3 ro, vec3 rd, float tEnd, out vec3 col, out float dist) {
  float t = 0.0;
  int idx = 0;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float e = partsSDF(p, idx);
    vec2 cb = cablesSDF(p);
    bool isCable = cb.x < e;
    e = min(e, cb.x);
    if (e < 0.05) {
      vec3 n = vec3(0.0);
      for (int j = 0; j < 4 + uZero; j++) {
        vec3 k = 0.5773 * (2.0 * vec3(float(((j + 3) >> 1) & 1), float((j >> 1) & 1), float(j & 1)) - 1.0);
        n += k * (isCable ? cablesSDF(p + k * 0.3).x : partModel(idx, p + k * 0.3).x);
      }
      n = normalize(n);
      float mat = isCable ? -1.0 : partModel(idx, p).y;
      vec3 base = isCable ? cableColor(cb.y) : uTypeColor[uPartType[idx]];
      if (!isCable) base *= mix(0.75, 1.12, smoothstep(0.1, 0.7, dot(matColor(mat), vec3(0.333))));
      vec3 L = normalize(uLight);
      float diff = max(dot(n, L), 0.0);
      col = base * (0.6 + 0.55 * diff + 0.15 * max(n.y, 0.0));
      col += vec3(pow(max(dot(reflect(-L, n), -rd), 0.0), 14.0) * 0.3);
      if (mat == M_LED_LIT) col = matColor(mat) * 1.25;
      if (!isCable && idx == uHi) col = mix(col, vec3(0.1), 0.6);
      dist = t;
      return true;
    }
    t += max(e, 0.05);
    if (t > tEnd) break;
  }
  return false;
}

void main() {
  vec2 o = (gl_FragCoord.xy - uCenterDev) / uFocal;
  vec3 rd = normalize(uCamFwd + uCamRight * o.x + uCamUp * o.y);
  vec3 ro = uCamPos;
  vec3 oc = ro - uBoundC;
  float bb = dot(oc, rd);
  float disc = bb * bb - (dot(oc, oc) - uBoundR * uBoundR);
  if (disc < 0.0) { outColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t = max(0.0, -bb - sq);
  float tEnd = -bb + sq;

  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float h = scene(ro + rd * t).x;
    if (h < 0.15) { hit = true; break; }
    t += h * 0.85;
    if (t > tEnd) break;
  }
  if (!hit) { outColor = cablesOnly(ro, rd, max(0.0, -bb - sq), tEnd) * uAlpha; return; }

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  float cosv = abs(dot(n, -rd));
  float fres = pow(1.0 - cosv, 3.0);

  // into the glass: refracted, then scattered a little (frost) — a grainy blur
  vec2 hj = vec2(hash(gl_FragCoord.xy * 0.37 + 1.3), hash(gl_FragCoord.xy * 0.71 + 7.1)) - 0.5;
  vec3 rr = refract(rd, n, 1.0 / 1.45);
  if (dot(rr, rr) < 0.5) rr = rd;
  vec3 tu = normalize(cross(rr, abs(rr.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 tv = cross(rr, tu);
  rr = normalize(rr + (tu * hj.x + tv * hj.y) * uFrost);

  vec3 glassTint = vec3(0.86, 0.9, 0.95);
  vec3 col;
  float alpha;
  vec3 pc; float dist;
  if (shadeParts(p + rr * 0.3, rr, tEnd - t, pc, dist)) {
    // deeper = hazier, and the frost veils everything a bit
    float haze = 1.0 - exp(-dist * 0.018);
    col = mix(pc, glassTint, 0.18 + 0.55 * haze);
    alpha = 1.0;
  } else {
    col = glassTint;
    alpha = 0.34;
  }
  // thickness at the edge: the glass darkens a little toward the rim, so it reads on a light page
  col = mix(col, vec3(0.5, 0.56, 0.68), smoothstep(0.25, 0.9, 1.0 - cosv) * 0.35);

  // the glass surface: iridescent rim, soft sheen, a sharp highlight
  vec3 L = normalize(uLight);
  vec3 irid = iridescence(fres * 1.4 + n.y * 0.25 + 0.15);
  col = mix(col, mix(vec3(1.0), irid, 0.75), fres * 0.85);
  float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 60.0);
  float sheen = pow(max(dot(n, normalize(L + vec3(0.0, 0.6, 0.0))), 0.0), 6.0) * 0.12;
  col += vec3(spec * 0.9 + sheen);
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.04;                 // frost grain
  alpha = max(alpha, 0.25 + 0.65 * fres + spec);
  alpha = clamp(alpha, 0.0, 1.0);
  outColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha) * uAlpha;
}
`;
