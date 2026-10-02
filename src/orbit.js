import { CONFIG } from './config.js';
import { view } from './view.js';
import { Spring } from './body/springs.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Orbit camera control.
 * - drag on empty space to rotate
 * - double-click empty space to toggle front view / 3/4 view
 * - the camera follows the cursor slightly (parallax)
 * Angles ease with springs, so every change is fluid.
 */
export function createOrbit(svg) {
  const C = CONFIG.camera;
  const home = { yaw: C.yaw, pitch: C.pitch }; // degrees
  const base = { ...home };
  const yaw = new Spring(base.yaw * DEG, 3.2, 0.85);
  const pitch = new Spring(base.pitch * DEG, 3.2, 0.85);
  const pointer = { nx: 0, ny: 0 }; // -1..1 from the viewport centre
  let drag = null;

  const isBackground = (e) => !e.target.closest('[data-part]');

  svg.addEventListener('pointerdown', (e) => {
    if (!isBackground(e) || e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch {} // capture can fail for synthetic pointers
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: base.yaw, pitch: base.pitch };
    document.body.classList.add('is-orbiting');
  });

  svg.addEventListener('pointermove', (e) => {
    pointer.nx = (e.clientX / view.vw) * 2 - 1;
    pointer.ny = (e.clientY / view.vh) * 2 - 1;
    if (!drag || e.pointerId !== drag.id) return;
    base.yaw = clamp(drag.yaw - (e.clientX - drag.x) * 0.35, C.yawRange[0], C.yawRange[1]);
    base.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.3, C.pitchRange[0], C.pitchRange[1]);
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    document.body.classList.remove('is-orbiting');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('dblclick', (e) => {
    if (!isBackground(e)) return;
    const front = Math.abs(base.yaw) < 1 && Math.abs(base.pitch) < 1;
    setView(front ? '3/4' : 'front');
  });

  function setView(name) {
    if (name === 'front') { base.yaw = 0; base.pitch = 0; }
    else { base.yaw = home.yaw; base.pitch = home.pitch; }
  }

  function update(dt) {
    // parallax is muted while orbiting so the drag feels direct
    const k = drag ? 0 : 1;
    yaw.target = (base.yaw + pointer.nx * C.parallax[0] * k) * DEG;
    pitch.target = (base.pitch + pointer.ny * C.parallax[1] * k) * DEG;
    yaw.step(dt);
    pitch.step(dt);
    view.setCamera(yaw.value, pitch.value);
  }

  view.setCamera(yaw.value, pitch.value);
  return { update, setView };
}
