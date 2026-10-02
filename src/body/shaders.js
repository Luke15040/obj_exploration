import { speakerHolesGLSL } from './glsl-speaker.js?v=202610021616';
import { partsGLSL } from './glsl-parts.js?v=202610021616';

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

out vec4 outColor;

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

float bodySDF(vec3 p) {
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

    bool on = tone > th;
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
uniform vec3  uTypeColor[12];   // one colour per kind of part (flat view)
uniform float uSketch;          // 1 = hand-drawn grain and wobble ("flat"), 0 = clean ("flat 2")

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
    col = col * (1.0 - edge) + vec4(lc, 1.0) * edge;
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
uniform vec3  uTypeColor[12];
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
uniform vec3  uTypeColor[12];
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
  for (int i = 0; i < 70; i++) {
    float e = partsSDF(ro + rd * tp, idx);
    if (e < 0.08) { pid = 1.0 + float(idx); break; }
    tp += max(e, 0.08);
    if (tp > tEnd) break;
  }
  float pdep = pid > 0.0 ? clamp((tp - uNear) / (uFar - uNear), 0.0, 1.0) : 1.0;
  outColor = vec4(sid / 255.0, pid / 255.0, pdep, 1.0);
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
uniform vec3  uBlobColor[12];  // per part type
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
uniform vec3  uTypeColor[12];

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
uniform vec3  uTypeColor[12];
uniform float uMono;      // 1 = the grey version: tone-on-tone shape with a dot pattern
uniform float uMonoParts; // 1 = the parts in greys too (look a); 0 = parts keep their colours (look b)
uniform vec3  uDotCol;
uniform float uDotStep;   // dot pitch, device px

void main() {
  // the shape: whole cells
  ivec2 lim = textureSize(uG, 0) - 1;
  vec2 f = (gl_FragCoord.xy - uGridOff) / uCellPx;
  ivec2 c = ivec2(floor(f));
  float sid = floor(texelFetch(uG, clamp(c + 1, ivec2(0), lim), 0).r * 255.0 + 0.5);
  vec4 col = sid > 0.0 ? vec4(sid > 1.5 ? uWheelCol : uSkinCol, 1.0) : vec4(0.0);
  if (uMono > 0.5 && sid > 0.0) {
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

/* ------------------------------------------------------------------ */

/**
 * glassShader (device res) — the "glass" view: the provisional shape (skin,
 * wheels, knob caps) as frosted glass — refraction, a grainy frost that blurs
 * what is behind it, an iridescent rim, a sharp highlight — and the library
 * parts inside as bright, playful 3D objects, hazier the deeper they sit.
 */
export const glassShader = levelCommon + /* glsl */ `
uniform float uAlpha;
uniform vec3  uTypeColor[12];
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
