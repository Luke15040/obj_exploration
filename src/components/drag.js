import { state, moveWheel, moveScreen, setScreenSpot, setScreenMount } from '../state.js?v=202610081626';
import { SCREEN_SPOTS, screenSlotFor, LIBRARY } from '../parts.js?v=202610081626';
import { view } from '../view.js?v=202610081626';
import { snapRay, currentLayout, surfaceSDF, faceAnchors } from '../body/sdf.js?v=202610081626';
import { drawMarkers } from './markers.js?v=202610081626';

/** Current centre (mm) of a part by its data-part name. */
function partPos(part) {
  if (part === 'screen' && state.kind === 'speaker') { const m = currentLayout().parts.find((p) => p.key === 'matrix'); return m ? m.c.slice(0, 2) : [0, 0]; }
  if (part === 'screen') return [state.screen.x, state.screen.y];
  const side = part === 'wheel-left' ? 'left' : 'right';
  return [state.wheels[side].x, state.wheels[side].y];
}

/** Case 2: the spots around the speaker a knob does not already take. */
function freeSpots() {
  return SCREEN_SPOTS.filter((spot) => {
    const c = screenSlotFor(spot, state.speakerLib, state.screenType);
    return !state.extras.some((e) => e.type === 'knob' && Math.hypot(e.p[0] - c[0], e.p[1] - c[1]) < 30);
  });
}

/**
 * Case 2: a coarse choice, not a position — the side of the speaker the cursor is on
 * (above / below / left / right of the speaker's centre), or the nearest free spot.
 */
function snapScreen(cx, cy) {
  const free = freeSpots();
  const side = Math.abs(cx) > Math.abs(cy) ? (cx < 0 ? 'left' : 'right') : (cy < 0 ? 'bottom' : 'top');
  if (free.includes(side)) return setScreenSpot(side);
  let best = state.screenSpot, bd = Infinity;
  for (const spot of free) {
    const c = screenSlotFor(spot, state.speakerLib, state.screenType);
    const d = Math.hypot(c[0] - cx, c[1] - cy);
    if (d < bd) { bd = d; best = spot; }
  }
  setScreenSpot(best);
}

/** Does the screen fit at p, facing n: all of its face on the surface, clear of the speaker and the knobs? */
function screenFits(p, n) {
  const size = LIBRARY[state.screenType]?.size ?? LIBRARY.matrix.size;
  const ny = n[1], v = Math.abs(ny) > 0.9 ? [0, 0, -Math.sign(ny)] : (() => { const a = [-n[0] * ny, 1 - n[1] * ny, -n[2] * ny], l = Math.hypot(...a) || 1; return a.map((x) => x / l); })();
  const u = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]];
  const hw = size[0] / 2 + 2, hh = size[1] / 2 + 2;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const q = [0, 1, 2].map((k) => p[k] + u[k] * a * hw + v[k] * b * hh - n[k] * 1.5);
    if (surfaceSDF(q) > 3) return false;   // a corner off the face
  }
  for (const e of state.extras) {
    if (e.n[0] * n[0] + e.n[1] * n[1] + e.n[2] * n[2] < 0.5) continue;   // on another face
    const q = [0, 1, 2].map((k) => e.p[k] - p[k]);
    const dx = Math.abs(q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) - hw, dy = Math.abs(q[0] * v[0] + q[1] * v[1] + q[2] * v[2]) - hh;
    if (Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) < (e.type === 'speaker' ? 18 : 8)) return false;   // over the grille / a knob
  }
  return true;
}

let screenMarks = null;   // (set by attachDrag) shows the screen's snap points while it is dragged

/**
 * Case 2: the screen is dragged over the surface and clicks to the snap points of the face under the
 * cursor, like the knobs and the speaker (the same 3×3 points, shown while dragging): the nearest one where
 * it fits, its face flush there, upright. On a geometric shape it takes the face's own direction; on the
 * free skin the nearest straight one (front, back, left, right, top). Nowhere it fits: it stays put.
 */
function mountScreen(ev) {
  const { o, d } = view.ray(ev.clientX, ev.clientY);
  const fwd = view.cam.fwd;
  const res = snapRay(o, d, 24, { c: view.cam.target, n: Math.abs(fwd[2]) > 0.35 ? [0, 0, 1] : fwd });
  if (!res.attached) return;
  let n = res.n;
  if (Math.abs(n[2]) > 0.6) n = [0, 0, Math.sign(n[2])];
  else if (state.shape === 'free') { const k = Math.abs(n[0]) >= Math.abs(n[1]) ? 0 : 1; n = [0, 0, 0]; n[k] = Math.sign(res.n[k]); }
  else { const l = Math.hypot(n[0], n[1]) || 1; n = [n[0] / l, n[1] / l, 0]; }
  if (n[1] < -0.5) return;   // not underneath
  // the face's snap points, and a 10 mm grid around the cursor on the face (the screen is big: of the face's
  // 3×3 points often only one leaves it room) — only where it fits
  const ny = n[1], v = Math.abs(ny) > 0.9 ? [0, 0, -Math.sign(ny)] : (() => { const q = [-n[0] * ny, 1 - n[1] * ny, -n[2] * ny], l = Math.hypot(...q) || 1; return q.map((x) => x / l); })();
  const u = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]];
  const G = 10, cu = Math.round((res.p[0] * u[0] + res.p[1] * u[1] + res.p[2] * u[2]) / G), cv = Math.round((res.p[0] * v[0] + res.p[1] * v[1] + res.p[2] * v[2]) / G);
  const dn = res.p[0] * n[0] + res.p[1] * n[1] + res.p[2] * n[2];
  const grid = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const a = (cu + i) * G, b = (cv + j) * G;
    grid.push({ p: [0, 1, 2].map((k) => u[k] * a + v[k] * b + n[k] * dn) });
  }
  const anchors = [...faceAnchors(n), ...grid].filter((A) => screenFits(A.p, n));
  let best = null, bd = Infinity;
  for (const A of anchors) {
    const dd = Math.hypot(A.p[0] - res.p[0], A.p[1] - res.p[1], A.p[2] - res.p[2]);
    if (dd < bd) { bd = dd; best = A; }
  }
  screenMarks?.(anchors.map((A) => { const [x, y] = view.project(...A.p); return { x, y, p: A.p, n, on: A === best }; }));
  if (best) setScreenMount({ p: best.p.slice(), n });
}

function movePart(part, x, y, cursor, ev) {
  if (part === 'screen' && state.kind === 'speaker') { if (state.shape === 'totem') snapScreen(cursor[0], cursor[1]); else mountScreen(ev); }
  else if (part === 'screen') moveScreen(x, y);
  else moveWheel(part === 'wheel-left' ? 'left' : 'right', x, y);
}

/**
 * Pointer dragging for every `[data-part]` group inside the SVG.
 * Free 2D drag by default; hold Shift to lock to the dominant axis
 * (usually vertical: raise/lower). Clamping lives in state.js.
 *
 * @param {{ onStart?: (part: string) => void, onEnd?: (part: string, e: PointerEvent) => void }} hooks
 */
export function attachDrag(svg, hooks = {}) {
  let active = null; // { part, node, id, offset:[dx,dy], start:[x,y], axis }
  // case 2: the screen's spots, shown while it is dragged
  const spots = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  spots.setAttribute('class', 'screen-spots');
  spots.setAttribute('pointer-events', 'none');
  svg.appendChild(spots);
  screenMarks = (list) => drawMarkers(spots, list);   // (case 2: the face's snap points while the screen is dragged)
  const showSpots = (on) => drawMarkers(spots, !on ? [] : freeSpots().map((spot) => {
    const c = screenSlotFor(spot, state.speakerLib, state.screenType);
    const [x, y] = view.project(c[0], c[1], 0);
    return { x, y, p: [c[0], c[1], 0.5], n: [0, 0, 1], on: spot === state.screenSpot };
  }));

  svg.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('[data-part]');
    if (!node || e.button !== 0 || node.dataset.part.startsWith('extra-')) return; // add-ons: see extras.js
    e.preventDefault();
    try { node.setPointerCapture(e.pointerId); } catch {} // capture can fail for synthetic pointers

    const part = node.dataset.part;
    const [mx, my] = view.toMm(e.clientX, e.clientY);
    const [px, py] = partPos(part);
    active = { part, node, id: e.pointerId, offset: [px - mx, py - my], start: [px, py], axis: null };
    node.classList.add('dragging');
    document.body.classList.add('is-dragging');
    if (part === 'screen' && state.kind === 'speaker' && state.shape === 'totem') showSpots(true);
    hooks.onStart?.(part);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    const [mx, my] = view.toMm(e.clientX, e.clientY);
    let x = mx + active.offset[0];
    let y = my + active.offset[1];

    if (e.shiftKey) {
      // pick the axis once the movement is clear, then keep it
      const dx = x - active.start[0], dy = y - active.start[1];
      if (!active.axis && Math.hypot(dx, dy) > 2) active.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
      if (active.axis === 'y') x = active.start[0];
      if (active.axis === 'x') y = active.start[1];
    } else {
      active.axis = null;
    }
    movePart(active.part, x, y, [mx, my], e);
    if (active.part === 'screen' && state.kind === 'speaker' && state.shape === 'totem') showSpots(true);
  });

  const end = (e) => {
    if (!active || e.pointerId !== active.id) return;
    active.node.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    showSpots(false);
    const { part } = active;
    active = null;
    hooks.onEnd?.(part, e);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}
