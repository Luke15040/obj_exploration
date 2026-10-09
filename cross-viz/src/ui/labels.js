import { view } from '../view.js?v=202610091649';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Part numbers for the flat / pixel / empty views: a number on each part, matching
 * the # in the components list, only where the part is not covered by another.
 * Positions follow the live layout.
 */
/** Does the segment a→b pass through the oriented box of part q? */
function hitsBox(a, b, q) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const o = [a[0] - q.c[0], a[1] - q.c[1], a[2] - q.c[2]];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const ax = [q.R[k * 3], q.R[k * 3 + 1], q.R[k * 3 + 2]];   // local axis k (column)
    const od = o[0] * ax[0] + o[1] * ax[1] + o[2] * ax[2];
    const dd = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
    const h = q.h[k];
    if (Math.abs(dd) < 1e-9) { if (Math.abs(od) > h) return false; continue; }
    let ta = (-h - od) / dd, tb = (h - od) / dd;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// candidate spots on a part (fractions of its half size), centre first
const SPOTS = [[0, 0, 0]];
for (const r of [0.45, 0.75]) for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1])
  if (x || y || z) SPOTS.push([x * r, y * r, z * r]);

export function createPartLabels(svg, { body }) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'part-labels');
  svg.appendChild(g);
  const pool = [];

  function update() {
    const L = body.layout();
    if (!L || !(document.body.classList.contains('mode-flat') || document.body.classList.contains('mode-pixel') || document.body.classList.contains('mode-empty') || document.body.classList.contains('mode-orbital'))) return;
    L.parts.forEach((p, i) => {
      let t = pool[i];
      if (!t) {
        t = document.createElementNS(NS, 'text');
        g.appendChild(t);
        pool[i] = t;
      }
      // the number goes on a visible spot of the part: its centre if nothing covers it,
      // otherwise the nearest uncovered point of a few on the part; none → hidden
      const cam = view.cam.pos;
      let spot = null;
      for (const f of SPOTS) {
        const q = [0, 1, 2].map((k) => p.c[k] + p.R[k] * p.h[0] * f[0] + p.R[3 + k] * p.h[1] * f[1] + p.R[6 + k] * p.h[2] * f[2]);
        if (!L.parts.some((o, j) => j !== i && hitsBox(cam, q, o))) { spot = q; break; }
      }
      t.textContent = String(i + 1);
      t.style.display = spot ? '' : 'none';
      if (!spot) return;
      const [x, y] = view.project(spot[0], spot[1], spot[2]);
      t.setAttribute('x', x.toFixed(1));
      t.setAttribute('y', y.toFixed(1));
    });
    for (let i = L.parts.length; i < pool.length; i++) pool[i].style.display = 'none';
  }

  return { update };
}
