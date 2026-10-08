import { state, setWheelD } from '../state.js?v=202610081630';

const MIN = 64, MAX = 130;   // (below 64 mm the wheels can't reach past the servos to the floor)   // wheel diameter range, mm

/**
 * The wheels node (case 2, once the object moves): the wheel diameter. A side view of the
 * wheel drawn to scale against a faint 130 mm circle, a slider, and the size in mm.
 */
export function createWheelPad({ onChange = () => {}, layout = () => null } = {}) {
  const node = document.createElement('div');
  node.className = 'node whl tool hidden';
  node.innerHTML = `<div class="tab">wheels</div>
    <div class="card">
      <svg class="wheel" viewBox="-36 -36 72 72" aria-hidden="true">
        <circle class="max" r="${MAX / 4}"/>
        <g class="w"><circle class="tyre"/><circle class="rim"/><circle class="hub"/><path class="spokes"/></g>
      </svg>
      <input type="range" min="${MIN}" max="${MAX}" step="1" aria-label="wheel diameter">
      <div class="value"><span class="k">diameter</span><span class="v"></span></div>
    </div>`;
  document.body.appendChild(node);
  const range = node.querySelector('input');
  const v = node.querySelector('.value .v');

  function draw() {
    // the wheels in use: the chosen size, or the smallest that still reaches the floor with this shape
    const minD = layout()?.wheels?.minD ?? 0;
    const D = Math.max(state.wheelD, minD), r = D / 4;   // 1 unit = 4 mm
    const tooSmall = minD > state.wheelD + 0.5;
    node.classList.toggle('at-min', tooSmall);
    node.querySelector('.tyre').setAttribute('r', r);
    node.querySelector('.rim').setAttribute('r', r * 0.7);
    node.querySelector('.hub').setAttribute('r', Math.max(1.5, r * 0.18));
    const sp = [0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      return `M${(Math.cos(a) * r * 0.2).toFixed(2)} ${(Math.sin(a) * r * 0.2).toFixed(2)}L${(Math.cos(a) * r * 0.68).toFixed(2)} ${(Math.sin(a) * r * 0.68).toFixed(2)}`;
    }).join('');
    node.querySelector('.spokes').setAttribute('d', sp);
    v.textContent = `Ø ${Math.round(D)} mm`;
    if (document.activeElement !== range) range.value = D;
  }
  draw();
  setInterval(draw, 400);   // the shape can change under it
  range.addEventListener('input', () => { setWheelD(Number(range.value)); draw(); onChange(); });
  return node;
}
