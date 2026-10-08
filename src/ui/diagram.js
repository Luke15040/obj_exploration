import { view } from '../view.js?v=202610081630';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Overlay for the "pixel" view: each real part as a magenta circle with a red
 * ring (sized by the part), each cable as a thin lime line with small dark
 * knots at its bends — drawn over the halftone mosaic of the skin.
 */
export function createDiagram(svg, { body }) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'diagram');
  svg.appendChild(g);
  const lines = document.createElementNS(NS, 'g');
  const knots = document.createElementNS(NS, 'g');
  const dots = document.createElementNS(NS, 'g');
  g.append(lines, knots, dots);
  const pool = { line: [], knot: [], dot: [] };

  const node = (kind, parent, tag) => (i) => {
    if (!pool[kind][i]) {
      const n = document.createElementNS(NS, tag);
      parent.appendChild(n);
      pool[kind][i] = n;
    }
    pool[kind][i].style.display = '';
    return pool[kind][i];
  };
  const lineAt = node('line', lines, 'polyline');
  const knotAt = node('knot', knots, 'circle');
  const dotAt = node('dot', dots, 'circle');
  const hideFrom = (kind, n) => { for (let i = n; i < pool[kind].length; i++) pool[kind][i].style.display = 'none'; };

  function update() {
    const L = body.layout();
    if (!L || !document.body.classList.contains('mode-pixel')) return;

    let k = 0;
    L.cables.forEach((c, i) => {
      const pts = c.points.map((p) => view.project(p[0], p[1], p[2]));
      lineAt(i).setAttribute('points', pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
      for (const j of [0, 3, 5, pts.length - 1]) {
        const n = knotAt(k++);
        n.setAttribute('cx', pts[j][0].toFixed(1));
        n.setAttribute('cy', pts[j][1].toFixed(1));
        n.setAttribute('r', 1.8);
      }
    });
    hideFrom('line', L.cables.length);
    hideFrom('knot', k);

    // circles: biggest parts first, so the small ones stay on top
    const order = L.parts.map((p, i) => i).sort((a, b) => Math.max(...L.parts[b].h) - Math.max(...L.parts[a].h));
    order.forEach((idx, n) => {
      const p = L.parts[idx];
      const [x, y] = view.project(p.c[0], p.c[1], p.c[2]);
      const r = Math.min(14, Math.max(5, Math.max(...p.h) * view.scale * 0.2));
      const c = dotAt(n);
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', y.toFixed(1));
      c.setAttribute('r', r.toFixed(1));
    });
    hideFrom('dot', L.parts.length);
  }

  return { update };
}
