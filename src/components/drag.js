import { state, moveWheel, moveScreen } from '../state.js?v=202610021927';
import { view } from '../view.js?v=202610021927';

/** Current centre (mm) of a part by its data-part name. */
function partPos(part) {
  if (part === 'screen') return [state.screen.x, state.screen.y];
  const side = part === 'wheel-left' ? 'left' : 'right';
  return [state.wheels[side].x, state.wheels[side].y];
}

function movePart(part, x, y) {
  if (part === 'screen') moveScreen(x, y);
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
    movePart(active.part, x, y);
  });

  const end = (e) => {
    if (!active || e.pointerId !== active.id) return;
    active.node.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    const { part } = active;
    active = null;
    hooks.onEnd?.(part, e);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}
