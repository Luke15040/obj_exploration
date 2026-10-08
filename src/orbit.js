import { CONFIG } from './config.js?v=202610081603';
import { view } from './view.js?v=202610081603';
import { Spring } from './body/springs.js?v=202610081603';
import { params } from './state.js?v=202610081603';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Camera control — no orbit: a few essential drawn views, and every change is a
 * cut that redraws the drawing around the parts (params.redraw), never a turn.
 *   step k (yaw = k · 45°): even k = orthographic elevation (front, side, back, side),
 *                           odd k  = axonometric view from above, in between
 *   top = the plan view
 * - drag on empty space: every `snap.dragPx` px sideways = one step; drag down = plan, up = back
 *   (cross view: a FREE turn instead — only the parts are drawn while it turns; on release
 *   the camera glides to the nearest essential view and the shape is built there)
 * - arrow keys: ← → step, ↑ plan, ↓ back from the plan
 * - double-click empty space toggles front / axonometric
 */
export function createOrbit(svg) {
  const C = CONFIG.camera;
  const S = C.snap;
  const view0 = { k: Math.round(C.yaw / S.yaw), top: false };
  let cur = { ...view0 };
  const pointer = { nx: 0, ny: 0 }; // -1..1 from the viewport centre
  let drag = null;
  // no zoom for the user: one fixed framing, a little closer than the fit (CONFIG.camera.zoom)
  const zoom = new Spring(C.zoom ?? 1, 3.5, 1);
  const zoomTarget = C.zoom ?? 1;

  const odd = (k) => ((k % 2) + 2) % 2 === 1;
  /** yaw / pitch (degrees) of a view */
  function angles(v) {
    if (v.free) return v.free;                                                   // a free resting angle (cross)
    if (v.top) return { yaw: Math.round(v.k / 2) * 2 * S.yaw, pitch: S.top };   // plan squared to the elevations
    return { yaw: v.k * S.yaw, pitch: odd(v.k) ? S.axo : 0 };
  }
  const listeners = [];
  // cross and flat hd 2: the parts glide to the new view first (the shape is not drawn meanwhile),
  // then the shape is built around them; the other views cut straight to the new drawing
  const GLIDE_VIEWS = ['cross', 'flathd', 'flathd2', 'marker', 'density', 'particles', 'picasso'];
  let glide = null;   // { from: {yaw, pitch}, t }
  let leave = null;   // cross: the shape goes away first, tile by tile ({ t } 0..1)
  let shown = angles(cur);
  function go(v) {
    if (v.k === cur.k && v.top === cur.top && !cur.free) return;
    cur = { ...v };
    if (params.view === 'cross' && !glide && params.crossAnim !== 'cut') {
      if (!leave) leave = { t: params.outT || 0 };     // (already leaving: just carry on to the new target)
    } else if (GLIDE_VIEWS.includes(params.view)) {
      glide = { from: { ...shown }, t: 0 };
      params.moving = true;                            // the body hides the shape while the parts move
    } else {
      glide = null;
      params.moving = false;
      params.redraw++;                                 // the body redraws the drawing around the parts
    }
    for (const f of listeners) f(cur);
  }
  /** Cut to a view by its step 0..7 (taken the short way round), or to the plan. */
  function goTo(k8, top) {
    if (top) return go({ k: cur.k, top: true });
    const d = ((((k8 - cur.k) % 8) + 12) % 8) - 4;      // -4..3
    go({ k: cur.k + d, top: false });
  }

  const isBackground = (e) => !e.target.closest('[data-part]');

  svg.addEventListener('pointerdown', (e) => {
    if (!isBackground(e) || e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch {} // capture can fail for synthetic pointers
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: { ...cur }, free: params.view === 'cross' || params.view === 'flathd2' || params.view === 'density', turning: false, start: { ...shown } };
    document.body.classList.add('is-orbiting');
  });

  svg.addEventListener('pointermove', (e) => {
    // (a hidden or zero-size window must never feed Infinity/NaN into the camera)
    pointer.nx = view.vw > 0 ? clamp((e.clientX / view.vw) * 2 - 1, -1, 1) : 0;
    pointer.ny = view.vh > 0 ? clamp((e.clientY / view.vh) * 2 - 1, -1, 1) : 0;
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.free) {
      // cross: a free turn, the parts only (the shape goes, a few loose voxels stay around)
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.turning && Math.hypot(dx, dy) < 4) return;
      if (!drag.turning) {
        drag.turning = true;
        glide = null; leave = null;
        drag.start = { ...shown };
        if (!params.moving) turnOut = { t: params.outT || 0 };   // the tiles shrink away while it already turns
      }
      turn = { yaw: drag.start.yaw - dx * S.freeYaw, pitch: clamp(drag.start.pitch + dy * S.freePitch, S.freeMin, S.top) };
      // angle snap 10° / 20°: the turn clicks from step to step (the camera glides between them)
      const step = { 10: 10, 20: 20 }[params.angleSnap];
      if (step) turn = { yaw: Math.round(turn.yaw / step) * step, pitch: clamp(Math.round(turn.pitch / step) * step, S.freeMin, S.top) };
      return;
    }
    // whole views only: the drag picks the next drawing, it never turns the object
    const steps = -Math.round((e.clientX - drag.x) / S.dragPx);
    const dy = Math.round((e.clientY - drag.y) / S.dragPx);
    const top = drag.from.top ? dy <= 0 : dy >= 1;    // drag down → look from above (plan); up → back
    go({ k: drag.from.k + (top ? 0 : steps), top });
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.free && drag.turning) (params.angleSnap === 'views' ? settle() : rest());
    drag = null;
    document.body.classList.remove('is-orbiting');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);


  svg.addEventListener('dblclick', (e) => {
    if (!isBackground(e)) return;
    const front = !cur.top && ((cur.k % 8) + 8) % 8 === 0;
    setView(front ? '3/4' : 'front');
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') go({ k: cur.k + (e.key === 'ArrowLeft' ? 1 : -1), top: false });
    else if (e.key === 'ArrowUp') go({ k: cur.k, top: true });
    else if (e.key === 'ArrowDown') go({ k: cur.k, top: false });
    else return;
    e.preventDefault();
  });

  let turn = null;   // cross: the free angles while the user turns the object ({ yaw, pitch }, degrees)
  let turnOut = null; // cross: the shape shrinking away as a free turn starts ({ t } 0..1)
  const endTurnOut = () => { if (turnOut) { turnOut = null; params.outT = 0; } };
  /** After a free turn: glide to the nearest essential view, then the shape is built there. */
  function settle() {
    endTurnOut();
    const t = turn ?? shown;
    turn = null;
    let v;
    if (t.pitch > (S.axo + S.top) / 2) v = { k: 2 * Math.round(t.yaw / (2 * S.yaw)), top: true };
    else if (t.pitch < S.axo / 2) v = { k: 2 * Math.round(t.yaw / (2 * S.yaw)), top: false };              // an elevation
    else v = { k: 2 * Math.round((t.yaw - S.yaw) / (2 * S.yaw)) + 1, top: false };                          // an axonometric view
    cur = v;
    glide = { from: { ...t }, t: 0 };
    params.moving = true;
    for (const f of listeners) f(cur);
  }

  /** After a free turn (angle snap free / 10° / 20°): stay at that angle, and build the shape there. */
  function rest() {
    endTurnOut();
    const t = turn ?? shown;
    turn = null;
    cur = { k: Math.round(t.yaw / S.yaw), top: false, free: { ...t } };
    glide = { from: { ...shown }, t: 0 };   // the last bit of the step, then the shape
    params.moving = true;
    for (const f of listeners) f(cur);
  }

  /** Front or axonometric — the nearest one, however many turns have been made. */
  function setView(name) {
    if (name === 'front') go({ k: Math.round(cur.k / 8) * 8, top: false });
    else go({ k: Math.round((cur.k - view0.k) / 8) * 8 + view0.k, top: false });
  }

  function update(dt) {
    zoom.target = zoomTarget;
    zoom.step(dt);
    if (Math.abs(zoom.value - view.zoom) > 1e-4) view.setZoom(zoom.value);
    const a = angles(cur);
    if (turnOut) {
      turnOut.t = Math.min(1, turnOut.t + dt / (params.view === 'flathd2' || params.view === 'density' ? S.turnOutFlat ?? S.turnOut : S.turnOut));
      params.outT = turnOut.t;
      if (turnOut.t >= 1) { endTurnOut(); params.moving = true; }
    }
    if (leave) {
      // the shape leaves (the camera holds still), then the parts glide
      leave.t = Math.min(1, leave.t + dt / CONFIG.cross.out);
      params.outT = leave.t;
      if (leave.t >= 1) { leave = null; glide = { from: { ...shown }, t: 0 }; params.moving = true; params.outT = 0; }
    }
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / C.glide);
      const e = glide.t < 0.5 ? 4 * glide.t ** 3 : 1 - (-2 * glide.t + 2) ** 3 / 2;   // ease in-out
      shown = { yaw: glide.from.yaw + (a.yaw - glide.from.yaw) * e, pitch: glide.from.pitch + (a.pitch - glide.from.pitch) * e };
      // the shape starts building a little before the parts arrive (C.buildAt of the glide), not after
      if (!glide.built && glide.t >= (C.buildAt ?? 1)) { glide.built = true; params.moving = false; params.redraw++; }
      if (glide.t >= 1) glide = null;
    } else if (turn) {
      // turning freely (cross): follow the pointer closely (and glide across the snap steps)
      const k = 1 - Math.exp(-dt * 22);
      shown = { yaw: shown.yaw + (turn.yaw - shown.yaw) * k, pitch: shown.pitch + (turn.pitch - shown.pitch) * k };
    } else if (!leave) {
      shown = a;
    }
    view.setCamera(shown.yaw * DEG, shown.pitch * DEG);
  }

  update(0);
  return { update, setView, goTo, current: () => ({ ...cur }), onChange: (f) => listeners.push(f) };
}
