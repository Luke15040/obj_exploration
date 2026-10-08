import { state } from '../state.js?v=202610081612';
import { view } from '../view.js?v=202610081612';

const NS = 'http://www.w3.org/2000/svg';
const OFF = 16;      // px: dimension line off the object's edge
const TICK = 4;      // px: half length of the end ticks

/**
 * The object's overall size as quiet dimension lines along its sides, like a drawing:
 * width under it, height on its right, depth along its bottom (when the view shows it).
 * Each line sits a little off the edge, with extension lines, end ticks and its size in mm.
 * Everything that sticks out counts: the skin (stretched), the knob caps and the wheels.
 */
export function createDims({ body }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'dims';
  document.body.appendChild(svg);
  const mk = (tag, cls) => { const n = document.createElementNS(NS, tag); n.setAttribute('class', cls); svg.appendChild(n); return n; };
  const lines = ['w', 'h', 'd'].map(() => ({ ext: mk('path', 'ext'), dim: mk('path', 'dim'), label: mk('text', 'lbl') }));

  // on / off: a pill beside 'tools' at the top
  let on = false;   // off at first
  const btn = document.createElement('button');
  btn.id = 'dims-toggle';
  btn.title = 'show / hide the dimensions';
  const mark = () => { btn.textContent = on ? 'dimensions ●' : 'dimensions ○'; btn.classList.toggle('on', on); };
  mark();
  btn.addEventListener('click', () => { on = !on; mark(); });
  document.body.appendChild(btn);
  const place = () => {
    const t = document.getElementById('tools-toggle');
    if (t) btn.style.left = `${Math.round(t.getBoundingClientRect().right + 8)}px`;
  };
  requestAnimationFrame(place);
  window.addEventListener('resize', place);

  /** Overall box of the object in mm: { lo: [x, y, z], hi: [x, y, z] }. */
  function extents() {
    const L = body.layout();
    if (!L) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const grow = (a, b) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], b[k]); } };
    if (L.prims?.length) {
      for (const P of L.prims) {
        const z = [P.z[1], P.z[0]];   // back, front
        if (P.kind === 1) grow([P.c[0] - P.h[0], P.c[1] - P.h[1], z[0]], [P.c[0] + P.h[0], P.c[1] + P.h[1], z[1]]);
        else if (P.kind === 4) grow([P.c[0] - P.a, P.c[1] - P.h[1], z[0]], [P.c[0] + P.a, P.c[1] + P.a, z[1]]);
        else { const r = P.kind === 2 ? P.a : P.a / Math.cos(Math.PI / P.n); grow([P.c[0] - r, P.c[1] - r, z[0]], [P.c[0] + r, P.c[1] + r, z[1]]); }
      }
    } else {
      const e = state.body.padding + 3;   // the skin around the parts (+ the soft blend)
      for (const p of L.parts) {
        const R = p.R, h = p.h;
        const ext = [0, 1, 2].map((k) => Math.abs(R[k]) * h[0] + Math.abs(R[3 + k]) * h[1] + Math.abs(R[6 + k]) * h[2] + e);
        grow(p.c.map((v, k) => v - ext[k]), p.c.map((v, k) => v + ext[k]));
      }
    }
    // the skin is stretched in x / y around the stretch centre
    const st = L.stretch;
    if (st) for (let k = 0; k < 2; k++) { lo[k] = st.c[k] + (lo[k] - st.c[k]) * st.s[k]; hi[k] = st.c[k] + (hi[k] - st.c[k]) * st.s[k]; }
    // knob caps stand out of the skin
    for (const x of state.extras) {
      if (x.type !== 'knob') continue;
      const tip = x.p.map((v, k) => v + x.n[k] * 11.5);
      grow(tip, tip);
    }
    // the wheels
    const W = L.wheels;
    if (W) for (const w of [W.l, W.r]) grow([w[0] - W.hw, w[1] - W.R, W.z - W.R], [w[0] + W.hw, w[1] + W.R, W.z + W.R]);
    return lo[0] < hi[0] ? { lo, hi } : null;
  }

  /**
   * One dimension along the box edge from a to b (mm), pushed off the object (away from c, px):
   * extension lines, the dimension line with ticks, the size in the middle just beyond it.
   */
  function drawDim(o, a, b, c, mm) {
    const p = view.project(...a), q = view.project(...b);
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 14) { o.ext.setAttribute('d', ''); o.dim.setAttribute('d', ''); o.label.textContent = ''; return; }   // seen end-on
    const u = [dx / len, dy / len];
    let n = [-u[1], u[0]];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if ((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];   // outward
    const P = [p[0] + n[0] * OFF, p[1] + n[1] * OFF], Q = [q[0] + n[0] * OFF, q[1] + n[1] * OFF];
    const f = (v) => v.toFixed(1);
    o.ext.setAttribute('d', `M${f(p[0] + n[0] * 4)} ${f(p[1] + n[1] * 4)}L${f(P[0] + n[0] * 4)} ${f(P[1] + n[1] * 4)}`
      + `M${f(q[0] + n[0] * 4)} ${f(q[1] + n[1] * 4)}L${f(Q[0] + n[0] * 4)} ${f(Q[1] + n[1] * 4)}`);
    // the line, and a short slanted tick at each end (as on a drawing)
    const t = [(u[0] + n[0]) * TICK * 0.7071, (u[1] + n[1]) * TICK * 0.7071];
    o.dim.setAttribute('d', `M${f(P[0])} ${f(P[1])}L${f(Q[0])} ${f(Q[1])}`
      + `M${f(P[0] - t[0])} ${f(P[1] - t[1])}L${f(P[0] + t[0])} ${f(P[1] + t[1])}`
      + `M${f(Q[0] - t[0])} ${f(Q[1] - t[1])}L${f(Q[0] + t[0])} ${f(Q[1] + t[1])}`);
    // the size, horizontal, just beyond the middle of the line
    const lx = mid[0] + n[0] * (OFF + 10), ly = mid[1] + n[1] * (OFF + 10);
    o.label.setAttribute('x', f(lx));
    o.label.setAttribute('y', f(ly + 3.5));
    o.label.setAttribute('text-anchor', Math.abs(n[0]) > 0.7 ? (n[0] > 0 ? 'start' : 'end') : 'middle');
    o.label.textContent = `${Math.round(mm)}`;
  }

  function update() {
    const E = on ? extents() : null;
    svg.style.display = E ? '' : 'none';
    if (!E) return;
    const { lo, hi } = E;
    const corner = (i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
    const pts = Array.from({ length: 8 }, (_, i) => ({ i, s: view.project(...corner(i)) }));
    const c = [pts.reduce((a, q) => a + q.s[0], 0) / 8, pts.reduce((a, q) => a + q.s[1], 0) / 8];
    // per axis, of its four parallel edges: width / depth = the lowest on screen, height = the rightmost
    const edge = (axisBit, pick) => {
      let best = null;
      for (const q of pts) {
        if (q.i & axisBit) continue;
        const r = pts[q.i | axisBit];
        const score = pick(q.s, r.s);
        if (!best || score > best.score) best = { a: corner(q.i), b: corner(r.i), score };
      }
      return best;
    };
    const low = (s, t) => s[1] + t[1], right = (s, t) => s[0] + t[0];
    const W = edge(1, low), H = edge(2, right), D = edge(4, low);
    drawDim(lines[0], W.a, W.b, c, hi[0] - lo[0]);
    drawDim(lines[1], H.a, H.b, c, hi[1] - lo[1]);
    drawDim(lines[2], D.a, D.b, c, hi[2] - lo[2]);
  }
  return { update };
}
