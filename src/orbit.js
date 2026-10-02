import { CONFIG } from './config.js?v=202610021616';
import { view } from './view.js?v=202610021616';
import { Spring } from './body/springs.js?v=202610021616';

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
  // mouse-wheel zoom, eased
  const zoom = new Spring(1, 3.5, 1);
  let zoomTarget = 1;

  const isBackground = (e) => !e.target.closest('[data-part]');

  svg.addEventListener('pointerdown', (e) => {
    if (!isBackground(e) || e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch {} // capture can fail for synthetic pointers
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: base.yaw, pitch: base.pitch };
    document.body.classList.add('is-orbiting');
  });

  svg.addEventListener('pointermove', (e) => {
    // (a hidden or zero-size window must never feed Infinity/NaN into the camera)
    pointer.nx = view.vw > 0 ? clamp((e.clientX / view.vw) * 2 - 1, -1, 1) : 0;
    pointer.ny = view.vh > 0 ? clamp((e.clientY / view.vh) * 2 - 1, -1, 1) : 0;
    if (!drag || e.pointerId !== drag.id) return;
    const yaw = drag.yaw - (e.clientX - drag.x) * 0.35;
    base.yaw = C.yawRange ? clamp(yaw, C.yawRange[0], C.yawRange[1]) : yaw;
    base.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.3, C.pitchRange[0], C.pitchRange[1]);
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    document.body.classList.remove('is-orbiting');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('wheel', (e) => {
    if (e.defaultPrevented || e.target.closest('[data-part^="extra"]')) return;   // over a knob the wheel turns it
    e.preventDefault();
    zoomTarget = clamp(zoomTarget * Math.exp(-e.deltaY * 0.0015), 0.5, 3.5);
  }, { passive: false });

  svg.addEventListener('dblclick', (e) => {
    if (!isBackground(e)) return;
    zoomTarget = 1;
    const wrapped = ((base.yaw % 360) + 540) % 360 - 180;   // -180..180
    const front = Math.abs(wrapped) < 1 && Math.abs(base.pitch) < 1;
    setView(front ? '3/4' : 'front');
  });

  /** Front or 3/4 — reached the short way round, however many turns the yaw has made. */
  function setView(name) {
    const goal = name === 'front' ? 0 : home.yaw;
    base.yaw = goal + Math.round((base.yaw - goal) / 360) * 360;
    base.pitch = name === 'front' ? 0 : home.pitch;
  }

  function update(dt) {
    // parallax is muted while orbiting so the drag feels direct
    const k = drag ? 0 : 1;
    yaw.target = (base.yaw + pointer.nx * C.parallax[0] * k) * DEG;
    pitch.target = (base.pitch + pointer.ny * C.parallax[1] * k) * DEG;
    yaw.step(dt);
    pitch.step(dt);
    zoom.target = zoomTarget;
    zoom.step(dt);
    if (Math.abs(zoom.value - view.zoom) > 1e-4) view.setZoom(zoom.value);
    view.setCamera(yaw.value, pitch.value);
  }

  view.setCamera(yaw.value, pitch.value);
  return { update, setView };
}
