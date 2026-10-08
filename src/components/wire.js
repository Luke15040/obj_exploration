import { view } from '../view.js?v=202610081626';

/**
 * Shared wireframe helpers: projection-aware primitives drawn as SVG paths.
 */

export const f1 = (n) => n.toFixed(1);

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** A face is visible when the camera is on its outer side. */
export function facing(normal, point) {
  const c = view.cam.pos;
  return normal[0] * (c[0] - point[0]) + normal[1] * (c[1] - point[1]) + normal[2] * (c[2] - point[2]) > 0;
}

export const pathOf = (pts, close = false) =>
  pts.length ? 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join(' L') + (close ? ' Z' : '') : '';

export const segsOf = (pairs) =>
  pairs.map(([a, b]) => `M${f1(a[0])} ${f1(a[1])} L${f1(b[0])} ${f1(b[1])}`).join(' ');

/** Convex hull (monotone chain) of projected points: the grab area of a part. */
export function hull(pts) {
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Orthonormal pair (u, v) perpendicular to n. Same convention as the shader. */
export function basis(n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, a));
  return [u, cross(n, u)];
}

/** Projected circle of radius r around c, in the plane perpendicular to n. */
export function circle3(c, n, r, N = 40) {
  const [u, v] = basis(n);
  return Array.from({ length: N }, (_, k) => {
    const a = (k / N) * Math.PI * 2;
    const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    return view.project(c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa);
  });
}

/**
 * Cylinder wireframe: two caps (visible / hidden) + the two silhouette lines.
 * c = centre, n = unit axis, r = radius, hw = half length.
 */
export function cylinderLines(c, n, r, hw, N = 40) {
  const caps = [-1, 1].map((s) => {
    const cc = [c[0] + n[0] * s * hw, c[1] + n[1] * s * hw, c[2] + n[2] * s * hw];
    return { c: cc, pts: circle3(cc, n, r, N), visible: facing([n[0] * s, n[1] * s, n[2] * s], cc) };
  });

  // silhouette: side normal m(θ) = cosθ·u + sinθ·w perpendicular to the view vector
  const [u, w] = basis(n);
  const vv = [view.cam.pos[0] - c[0], view.cam.pos[1] - c[1], view.cam.pos[2] - c[2]];
  const a0 = Math.atan2(dot(vv, w), dot(vv, u)) + Math.PI / 2;
  const sil = [a0, a0 + Math.PI].map((a) => {
    const m = [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)];
    const at = (s) => view.project(c[0] + n[0] * s * hw + m[0] * r, c[1] + n[1] * s * hw + m[1] * r, c[2] + n[2] * s * hw + m[2] * r);
    return [at(-1), at(1)];
  });

  return { caps, sil, pts: caps[0].pts.concat(caps[1].pts), center: view.project(...c) };
}

/** Box wireframe split into visible / hidden edges, plus the front-face display. */
export function boxLines(c, h, display) {
  const corner = (i) => [c[0] + (i & 1 ? h[0] : -h[0]), c[1] + (i & 2 ? h[1] : -h[1]), c[2] + (i & 4 ? h[2] : -h[2])];
  const P = Array.from({ length: 8 }, (_, i) => corner(i));
  const S = P.map((p) => view.project(...p));

  // face visibility per axis/sign
  const vis = {};
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const n = [0, 0, 0];
      n[axis] = sign;
      const fc = c.slice();
      fc[axis] += sign * h[axis];
      vis[`${axis}${sign}`] = facing(n, fc);
    }
  }

  const shown = [], hidden = [];
  for (let i = 0; i < 8; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const j = i | (1 << axis);
      if (j === i) continue;
      // an edge borders the two faces of the axes it doesn't run along
      const others = [0, 1, 2].filter((a) => a !== axis);
      const visible = others.some((a) => vis[`${a}${i & (1 << a) ? 1 : -1}`]);
      (visible ? shown : hidden).push([S[i], S[j]]);
    }
  }

  // display rectangle on the front face (z+)
  let disp = null;
  if (display && vis['21']) {
    const z = c[2] + h[2];
    const dx = display.w / 2, dy = display.h / 2, oy = c[1] + display.offsetY;
    disp = [[-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]].map(([x, y]) => view.project(c[0] + x, oy + y, z));
  }
  return { shown, hidden, disp, pts: S, center: view.project(...c) };
}
