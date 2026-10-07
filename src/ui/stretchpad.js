import { state, setStretch } from '../state.js?v=202610071423';

const NS = 'http://www.w3.org/2000/svg';
const MIN = 1, MAX = 2;           // stretch range: the fitted shape … twice as wide / tall
const BASE = 22;                  // pad px of the half size at stretch 1

/**
 * The stretch node: a pad with the object's outline as a rectangle. Drag (the corner,
 * or anywhere on the pad) to make the skin wider (x) and taller (y); the dashed square
 * is the fitted size. Double-click: back to the fit. The parts inside never change.
 */
export function createStretchPad({ onChange = () => {}, layout = () => null, pad: skinPad = () => 6 } = {}) {
  const node = document.createElement('div');
  node.className = 'node str tool hidden';
  node.innerHTML = `<div class="tab">stretch</div>
    <div class="card">
      <svg class="pad" viewBox="-56 -56 112 112" aria-label="stretch">
        <rect class="frame" x="-${BASE * MAX}" y="-${BASE * MAX}" width="${BASE * MAX * 2}" height="${BASE * MAX * 2}" rx="3"/>
        <rect class="fit" x="-${BASE}" y="-${BASE}" width="${BASE * 2}" height="${BASE * 2}" rx="2"/>
        <rect class="shape" rx="2"/>
        <path class="arrow h"/><path class="arrow v"/>
        <circle class="handle" r="3.2"/>
      </svg>
      <div class="val"></div>
      <div class="value"><span class="k">minimum</span><span class="v min">–</span></div>
      <div class="value tight"><span class="k">now</span><span class="v now">–</span></div>
    </div>`;
  document.body.appendChild(node);
  const pad = node.querySelector('.pad');
  const shape = node.querySelector('.shape');
  const handle = node.querySelector('.handle');
  const ah = node.querySelector('.arrow.h'), av = node.querySelector('.arrow.v');
  const val = node.querySelector('.val');
  const minEl = node.querySelector('.min'), nowEl = node.querySelector('.now');

  /**
   * The smallest shape that still holds the parts: the fitted profile (a primitive) or the
   * parts' box plus the skin's padding (the free skin) — width × height in mm, at stretch 1.
   */
  function minSize() {
    const L = layout();
    if (!L) return null;
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    const grow = (x0, y0, x1, y1) => { lo[0] = Math.min(lo[0], x0); lo[1] = Math.min(lo[1], y0); hi[0] = Math.max(hi[0], x1); hi[1] = Math.max(hi[1], y1); };
    if (L.prims?.length) {
      for (const P of L.prims) {
        if (P.kind === 1) grow(P.c[0] - P.h[0], P.c[1] - P.h[1], P.c[0] + P.h[0], P.c[1] + P.h[1]);
        else if (P.kind === 4) grow(P.c[0] - P.a, P.c[1] - P.h[1], P.c[0] + P.a, P.c[1] + P.a);
        else { const r = P.kind === 2 ? P.a : P.a / Math.cos(Math.PI / P.n); grow(P.c[0] - r, P.c[1] - r, P.c[0] + r, P.c[1] + r); }
      }
    } else {
      const e = skinPad();
      for (const p of L.parts) {
        const R = p.R, h = p.h;
        const ex = Math.abs(R[0]) * h[0] + Math.abs(R[3]) * h[1] + Math.abs(R[6]) * h[2];
        const ey = Math.abs(R[1]) * h[0] + Math.abs(R[4]) * h[1] + Math.abs(R[7]) * h[2];
        grow(p.c[0] - ex - e, p.c[1] - ey - e, p.c[0] + ex + e, p.c[1] + ey + e);
      }
    }
    return lo[0] < hi[0] ? [hi[0] - lo[0], hi[1] - lo[1]] : null;
  }
  function drawSize() {
    const m = minSize();
    if (!m) return;
    const [sx, sy] = state.stretch;
    minEl.textContent = `${Math.round(m[0])} × ${Math.round(m[1])} mm`;
    nowEl.textContent = `${Math.round(m[0] * sx)} × ${Math.round(m[1] * sy)} mm`;
  }
  setInterval(drawSize, 400);   // the parts can change under it (a knob, a screen, a shape)

  function draw() {
    const [sx, sy] = state.stretch;
    const w = BASE * sx, h = BASE * sy;
    shape.setAttribute('x', -w); shape.setAttribute('y', -h);
    shape.setAttribute('width', 2 * w); shape.setAttribute('height', 2 * h);
    handle.setAttribute('cx', w); handle.setAttribute('cy', -h);
    // double arrows across the middle, inside the shape
    const a = w - 6, b = h - 6;
    ah.setAttribute('d', `M${-a} 0H${a}M${-a + 3} -3L${-a} 0L${-a + 3} 3M${a - 3} -3L${a} 0L${a - 3} 3`);
    av.setAttribute('d', `M0 ${-b}V${b}M-3 ${-b + 3}L0 ${-b}L3 ${-b + 3}M-3 ${b - 3}L0 ${b}L3 ${b - 3}`);
    val.textContent = `w ×${sx.toFixed(2)} · h ×${sy.toFixed(2)}`;
    drawSize();
  }
  draw();

  const clamp = (v) => Math.min(MAX, Math.max(MIN, v));
  function at(e) {
    const r = pad.getBoundingClientRect();
    const k = 112 / r.width;
    const x = (e.clientX - (r.left + r.width / 2)) * k, y = (e.clientY - (r.top + r.height / 2)) * k;
    setStretch(clamp(Math.abs(x) / BASE), clamp(Math.abs(y) / BASE));
    draw();
    onChange();
  }
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pad.setPointerCapture(e.pointerId);
    at(e);
    const move = (ev) => at(ev);
    const up = () => { pad.removeEventListener('pointermove', move); pad.removeEventListener('pointerup', up); };
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
  });
  pad.addEventListener('dblclick', () => { setStretch(1, 1); draw(); onChange(); });
  return node;
}
