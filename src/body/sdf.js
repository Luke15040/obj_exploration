import { CONFIG } from '../config.js';
import { state, onChange } from '../state.js';
import { layoutParts } from '../parts.js';

/**
 * CPU mirror of the shader's surface — used to place add-ons on the object
 * (raycast, magnetic snapping, re-snapping when the body changes).
 * Same primitives as bodySDF/compSDF in shaders.js, minus the breathing noise
 * and the wheels (nothing mounts on a spinning wheel).
 */

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function sdRoundBox(p, b, r) {
  r = Math.min(r, b[0], b[1], b[2]);
  const q = [Math.abs(p[0]) - b[0] + r, Math.abs(p[1]) - b[1] + r, Math.abs(p[2]) - b[2] + r];
  const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
  return outside + Math.min(Math.max(q[0], q[1], q[2]), 0) - r;
}

function sdCapsule(p, a, b, r) {
  const pa = sub(p, a), ba = sub(b, a);
  const h = clamp(dot(pa, ba) / Math.max(dot(ba, ba), 1e-4), 0, 1);
  return len(sub(pa, mul(ba, h))) - r;
}

function smin(a, b, k) {
  k = Math.max(k, 1e-3);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function sdOrientedBox(p, c, h, R) {
  const d = sub(p, c);
  // world → local: multiply by Rᵀ (R columns are the local axes)
  const q = [
    Math.abs(d[0] * R[0] + d[1] * R[1] + d[2] * R[2]) - h[0],
    Math.abs(d[0] * R[3] + d[1] * R[4] + d[2] * R[5]) - h[1],
    Math.abs(d[0] * R[6] + d[1] * R[7] + d[2] * R[8]) - h[2],
  ];
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0);
}

/** Current part layout from the raw state, cached until the state changes. */
let cachedLayout = null;
onChange(() => (cachedLayout = null));
function currentLayout() {
  return (cachedLayout ??= layoutParts({
    kind: state.kind,
    shape: state.shape,
    totem: state.totem,
    knobCount: state.extras.filter((e) => e.type === 'knob').length,
    wl: [state.wheels.left.x, state.wheels.left.y],
    wr: [state.wheels.right.x, state.wheels.right.y],
    scr: [state.screen.x, state.screen.y],
    pad: state.body.padding,
    neckR: state.body.neckR,
    // add-on modules are left out: they sit behind their own mount point, and
    // letting them shape the surface they snap to would push them outward forever
    extras: [],
    wheelHalfW: CONFIG.wheel.w / 2,
    screenHalfH: CONFIG.screen.h / 2,
  }));
}

/** Case 2 primitive: where the add-ons go when there are `knobCount` knobs (null on the free skin). */
export function shapeSpots(knobCount) {
  return layoutParts({
    kind: state.kind, shape: state.shape, totem: state.totem, knobCount,
    wl: [state.wheels.left.x, state.wheels.left.y], wr: [state.wheels.right.x, state.wheels.right.y],
    scr: [state.screen.x, state.screen.y], pad: state.body.padding, neckR: state.body.neckR,
    extras: [], wheelHalfW: CONFIG.wheel.w / 2, screenHalfH: CONFIG.screen.h / 2,
  }).spots;
}

/** Distance to the mountable surface (the skin around the parts), in mm. */
/** Same as primSDF in shaders.js. */
function primSDF(p, P) {
  const q = [p[0] - P.c[0], p[1] - P.c[1]];
  const r = P.round;
  let d2;
  if (P.kind === 1) {
    const b = [Math.abs(q[0]) - P.h[0] + r, Math.abs(q[1]) - P.h[1] + r];
    d2 = Math.hypot(Math.max(b[0], 0), Math.max(b[1], 0)) + Math.min(Math.max(b[0], b[1]), 0) - r;
  } else if (P.kind === 2) {
    d2 = Math.hypot(q[0], q[1]) - P.a;
  } else if (P.kind === 4) {
    d2 = Math.max(Math.hypot(q[0], q[1]) - P.a, -(q[1] + P.h[1]));
  } else {
    d2 = -1e5;
    for (let k = 0; k < P.n; k++) {
      const an = P.rot + (2 * Math.PI * k) / P.n;
      d2 = Math.max(d2, q[0] * Math.cos(an) + q[1] * Math.sin(an) - P.a);
    }
  }
  const zc = (P.z[0] + P.z[1]) / 2, hz = (P.z[0] - P.z[1]) / 2;
  const w = [d2 + r, Math.abs(p[2] - zc) - hz + r];
  return Math.min(Math.max(w[0], w[1]), 0) + Math.hypot(Math.max(w[0], 0), Math.max(w[1], 0)) - r;
}

export function surfaceSDF(p, L = currentLayout()) {
  if (L.prims?.length) return Math.min(...L.prims.map((P) => primSDF(p, P)));
  const S = CONFIG.screen, SB = state.body, SC = state.screen;
  const k = SB.blend;
  let d = Infinity;
  for (const part of L.parts) {
    // envelope box, pushed back along local z where a face must stay flush (the matrix)
    const c = part.env ? part.c.map((v, i) => v - part.R[6 + i] * part.env) : part.c;
    d = smin(d, sdOrientedBox(p, c, part.h, part.R), k);
  }
  d = smin(d, sdCapsule(p, L.chassis.a, L.chassis.b, L.chassis.r), k);
  if (L.neck.r > 0.5) d = smin(d, sdCapsule(p, L.neck.a, L.neck.b, L.neck.r), k);
  if (SB.eyes > 0.01) {
    const eh = [9 * SB.eyes, 7 * SB.eyes, 10 * SB.eyes];
    const ey = SC.y + S.h / 2 + eh[1] * 0.6, ex = S.w / 2 - 11;
    d = smin(d, sdRoundBox(sub(p, [SC.x - ex, ey, 0]), eh, 3 * SB.eyes), 4);
    d = smin(d, sdRoundBox(sub(p, [SC.x + ex, ey, 0]), eh, 3 * SB.eyes), 4);
  }
  return d - SB.padding;
}

export function normalAt(p) {
  const e = 0.4;
  const n = [
    surfaceSDF(add(p, [e, 0, 0])) - surfaceSDF(add(p, [-e, 0, 0])),
    surfaceSDF(add(p, [0, e, 0])) - surfaceSDF(add(p, [0, -e, 0])),
    surfaceSDF(add(p, [0, 0, e])) - surfaceSDF(add(p, [0, 0, -e])),
  ];
  const l = len(n) || 1;
  return mul(n, 1 / l);
}

/** Slide a point onto the surface along the gradient. */
function settle(p) {
  for (let i = 0; i < 4; i++) {
    const d = surfaceSDF(p);
    p = sub(p, mul(normalAt(p), d));
    if (Math.abs(d) < 0.05) break;
  }
  return p;
}

/**
 * March a ray against the surface.
 * - direct hit → attached there
 * - miss → the cursor's 3D position is taken on a plane through the object
 *   centre facing the camera (`plane = { c, n }`); if that point is within
 *   `snapR` of the surface it is magnetically pulled onto the nearest surface
 *   point (`pulled: true`, `from` = the cursor point)
 * - otherwise → detached; `p` is that cursor point
 */
export function snapRay(o, d, snapR, plane) {
  let t = 0;
  let minD = Infinity, tMin = 0;
  const tMax = CONFIG.camera.distance + 500;
  for (let i = 0; i < 220 && t < tMax; i++) {
    const p = add(o, mul(d, t));
    const dist = surfaceSDF(p);
    if (dist < minD) { minD = dist; tMin = t; }
    if (dist < 0.15) {
      const hp = settle(p);
      return { attached: true, pulled: false, p: hp, n: normalAt(hp) };
    }
    t += Math.max(dist * 0.9, 0.4);
  }

  // where the cursor "is" in 3D: on the camera-facing plane through the object
  let q = add(o, mul(d, tMin));
  if (plane) {
    const denom = dot(d, plane.n);
    if (Math.abs(denom) > 1e-3) q = add(o, mul(d, dot(sub(plane.c, o), plane.n) / denom));
  }
  const dq = surfaceSDF(q);
  if (dq < snapR) {
    const hp = settle(q);
    return { attached: true, pulled: true, p: hp, n: normalAt(hp), from: q };
  }
  return { attached: false, p: q, minD: dq };
}

/** Re-find the surface near a mounted point (after the body changed shape). */
export function resnap(p, n) {
  const start = add(p, mul(n, 30));
  let t = 0;
  for (let i = 0; i < 80 && t < 90; i++) {
    const q = sub(start, mul(n, t));
    const dist = surfaceSDF(q);
    if (dist < 0.15) {
      const hp = settle(q);
      return { p: hp, n: normalAt(hp) };
    }
    t += Math.max(dist * 0.9, 0.3);
  }
  // fell off (e.g. the body shrank away): settle onto whatever is closest
  const hp = settle(p);
  return { p: hp, n: normalAt(hp) };
}

/** Front-facing surface point straight behind (x, y), searching from the viewer side. */
export function frontPoint(x, y) {
  const r = snapRay([x, y, 400], [0, 0, -1], 0);
  return r.attached ? r : null;
}
