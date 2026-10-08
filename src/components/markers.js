import { CONFIG } from '../config.js?v=202610081630';
import { params } from '../state.js?v=202610081630';
import { view } from '../view.js?v=202610081630';
import { basis } from './wire.js?v=202610081630';

/**
 * Snap markers — one visual language for every snap point (add-ons on a face, the
 * screen around the speaker). params.snapStyle picks the shape: cross · dot · ring ·
 * bracket; the colour follows the line colour of the current view.
 */
const P = CONFIG.palette;
const VIEW_INK = { flathd: '#2f2fa8', sketch: '#2f2fa8', empty: '#2f2fa8', flathd2: P.flat.red, flat: P.flat.red, live: '#f4f2ec', density: '#ffffff', particles: '#f4f2ec', picasso: '#141312' };

// (flat hd 2: the colour chosen for its drawing)
export const markerInk = () => (params.view === 'flathd2' ? CONFIG.flatLineCols?.[params.flatOutCol !== 'same' ? params.flatOutCol : params.flatLineCol] : null) || VIEW_INK[params.view] || P.flat.ink;   // (the outside's colour: the snaps are where it goes)

/** SVG path data of one marker of size k (px) at (x, y). */
export function markerPath(style, x, y, k) {
  if (style === 'dot') return `M${x + k * 0.45} ${y}a${k * 0.45} ${k * 0.45} 0 1 0 ${-k * 0.9} 0a${k * 0.45} ${k * 0.45} 0 1 0 ${k * 0.9} 0`;
  if (style === 'ring') return `M${x + k} ${y}a${k} ${k} 0 1 0 ${-2 * k} 0a${k} ${k} 0 1 0 ${2 * k} 0`;
  if (style === 'bracket') {
    const t = k * 0.55;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => `M${x + sx * k} ${y + sy * (k - t)}V${y + sy * k}H${x + sx * (k - t)}`).join('');
  }
  return `M${x - k} ${y}H${x + k}M${x} ${y - k}V${y + k}`;   // cross
}

/**
 * The same marker lying ON the surface: built in the face's plane (point p, normal n,
 * size k in mm) and projected, so it foreshortens with the face like a printed mark.
 */
export function markerPath3(style, p, n, k) {
  const [u, v] = basis(n);
  const at = (a, b) => { const q = view.project(p[0] + u[0] * a + v[0] * b, p[1] + u[1] * a + v[1] * b, p[2] + u[2] * a + v[2] * b); return `${q[0].toFixed(1)} ${q[1].toFixed(1)}`; };
  const poly = (pts, close) => 'M' + pts.map(([a, b]) => at(a, b)).join('L') + (close ? 'Z' : '');
  const circle = (r, N) => poly(Array.from({ length: N }, (_, i) => [r * Math.cos((i / N) * 6.2832), r * Math.sin((i / N) * 6.2832)]), true);
  if (style === 'dot') return circle(k * 0.45, 12);
  if (style === 'ring') return circle(k, 24);
  if (style === 'bracket') {
    const t = k * 0.55;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => poly([[sa * k, sb * (k - t)], [sa * k, sb * k], [sa * (k - t), sb * k]])).join('');
  }
  return poly([[-k, 0], [k, 0]]) + poly([[0, -k], [0, k]]);   // cross
}

/**
 * Draw a list of markers into an SVG group: items = [{ x, y, on, p?, n? }]; `on` = the one in use.
 * With a surface point p and normal n the marker lies on the surface, in perspective.
 * `idle` draws them as the quiet grey pattern of the cross 2 view (same style, smaller).
 */
export function drawMarkers(group, items, { idle = false } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  while (group.childNodes.length > items.length) group.lastChild.remove();
  while (group.childNodes.length < items.length) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    group.appendChild(p);
  }
  const style = params.snapStyle || 'cross';
  const ink = markerInk();
  items.forEach((m, i) => {
    const node = group.childNodes[i];
    const st = style;
    const kpx = m.on ? 6.5 : idle ? 3.4 : 4;
    node.setAttribute('d', m.p && m.n ? markerPath3(st, m.p, m.n, kpx / Math.max(0.1, view.scale)) : markerPath(st, m.x, m.y, kpx));
    const quiet = idle && !m.on && params.view === 'cross2' ? CONFIG.cross.dot : ink;   // (density: white, like its lines)
    node.setAttribute('stroke', quiet);
    node.setAttribute('fill', st === 'dot' ? quiet : 'none');
    node.setAttribute('stroke-width', m.on ? 1.4 : 1);
    node.setAttribute('opacity', m.on || idle ? 1 : 0.5);
  });
}
