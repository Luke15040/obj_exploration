import { state, setStretch } from '../state.js?v=202610081630';

const NS = 'http://www.w3.org/2000/svg';
const MIN = 1, MAX = 2;           // stretch range: the fitted shape … twice as wide / tall
const BASE = 22;                  // pad px of the half size at stretch 1

/**
 * The stretch node: a pad with the object's outline as a rectangle. Drag (the corner,
 * or anywhere on the pad) to make the skin wider (x) and taller (y); the dashed square
 * is the fitted size. Double-click: back to the fit. The parts inside never change.
 */
export function createStretchPad({ onChange = () => {} } = {}) {
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
    </div>`;
  document.body.appendChild(node);
  const pad = node.querySelector('.pad');
  const shape = node.querySelector('.shape');
  const handle = node.querySelector('.handle');
  const ah = node.querySelector('.arrow.h'), av = node.querySelector('.arrow.v');
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
