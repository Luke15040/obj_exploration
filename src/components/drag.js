import { state, moveWheel, moveScreen, setScreenSpot } from '../state.js?v=202610071438';
import { SCREEN_SPOTS, screenSlotFor } from '../parts.js?v=202610071438';
import { view } from '../view.js?v=202610071438';
import { drawMarkers } from './markers.js?v=202610071438';

/** Current centre (mm) of a part by its data-part name. */
function partPos(part) {
  if (part === 'screen' && state.kind === 'speaker') return screenSlotFor(state.screenSpot, state.speakerLib, state.screenType).slice(0, 2);
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

function movePart(part, x, y, cursor) {
  if (part === 'screen' && state.kind === 'speaker') snapScreen(cursor[0], cursor[1]);
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
    if (part === 'screen' && state.kind === 'speaker') showSpots(true);
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
    movePart(active.part, x, y, [mx, my]);
    if (active.part === 'screen' && state.kind === 'speaker') showSpots(true);
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
