import { CONFIG } from '../config.js?v=202610071420';
import { state } from '../state.js?v=202610071420';
import { screenSlotFor } from '../parts.js?v=202610071420';
import { view } from '../view.js?v=202610071420';
import { pathOf, segsOf, hull, cylinderLines, circle3, boxLines } from './wire.js?v=202610071420';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

const setAttrs = (node, attrs) => { for (const k in attrs) node.setAttribute(k, attrs[k]); };
const line = (node, x1, y1, x2, y2) => setAttrs(node, { x1, y1, x2, y2 });
const fmt = (v) => (Math.abs(v) < 0.05 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1));
/* ---------- geometry → projected line sets ---------- */

/** Wheel: a cylinder along x, plus a small hub circle on each visible cap. */
function wheelLines(c, r, hw) {
  const L = cylinderLines(c, [1, 0, 0], r, hw);
  L.hubs = L.caps.filter((k) => k.visible).map((k) => circle3(k.c, [1, 0, 0], r * 0.28, 20));
  return L;
}

/**
 * The fixed hardware parts as hairline 3D wireframes in SVG, projected with the
 * same camera as the dot field. Hidden edges are dashed. No fill: the dots read
 * through. Each part also carries annotations: corner ticks, a centre crosshair
 * and live x / y offsets from the default pose.
 */
export function createComponents(svg) {
  const P = CONFIG.palette;
  const I = CONFIG.initial;

  const guides = el('g', { class: 'guides', stroke: P.guide }, svg);
  const guideL = el('line', {}, guides);
  const guideR = el('line', {}, guides);

  const makePart = (name) => {
    const g = el('g', { class: 'part', 'data-part': name }, svg);
    return {
      g,
      hit: el('path', { class: 'hit', fill: 'transparent', stroke: 'none' }, g),
      hidden: el('path', { class: 'shape hidden', fill: 'none', stroke: P.lineSoft }, g),
      soft: el('path', { class: 'shape', fill: 'none', stroke: P.lineSoft }, g),
      main: el('path', { class: 'shape primary', fill: 'none', stroke: P.line }, g),
      halo: el('rect', { class: 'halo' }, g),
      tickTR: el('path', { class: 'anno tick', stroke: P.label, fill: 'none' }, g),
      tickBL: el('path', { class: 'anno tick', stroke: P.label, fill: 'none' }, g),
      crossH: el('line', { class: 'anno cross', stroke: P.label }, g),
      crossV: el('line', { class: 'anno cross', stroke: P.label }, g),
      labelY: el('text', { class: 'anno label', fill: P.label }, g),
      labelX: el('text', { class: 'anno label', fill: P.label, 'text-anchor': 'end' }, g),
      box: null, // last projected bounding box
    };
  };

  const parts = {
    'wheel-left': makePart('wheel-left'),
    'wheel-right': makePart('wheel-right'),
    screen: makePart('screen'),
  };

  /** Hit area, halo, ticks, crosshair and labels from the projected points. */
  function annotate(part, pts, center, dx, dy) {
    part.hit.setAttribute('d', pathOf(hull(pts), true));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    part.box = { x0, y0, x1, y1 };

    const o = 7, t = 5;
    setAttrs(part.halo, { x: x0 - o, y: y0 - o, width: x1 - x0 + 2 * o, height: y1 - y0 + 2 * o, rx: 3 });
    part.tickTR.setAttribute('d', `M${x1 + o - t} ${y0 - o} H${x1 + o} V${y0 - o + t}`);
    part.tickBL.setAttribute('d', `M${x0 - o} ${y1 + o - t} V${y1 + o} H${x0 - o + t}`);
    line(part.crossH, center[0] - 5, center[1], center[0] + 5, center[1]);
    line(part.crossV, center[0], center[1] - 5, center[0], center[1] + 5);
    setAttrs(part.labelY, { x: x0 - o, y: y0 - o - 6 });
    setAttrs(part.labelX, { x: x1 + o, y: y1 + o + 13 });
    part.labelY.textContent = `y ${fmt(dy)}`;
    part.labelX.textContent = `x ${fmt(dx)}`;
  }

  let active = null;

  function render() {
    const W = CONFIG.wheel, S = CONFIG.screen;

    for (const side of ['left', 'right']) {
      const part = parts[`wheel-${side}`];
      part.g.style.display = state.kind === 'speaker' ? 'none' : '';
      const pos = state.wheels[side];
      const L = wheelLines([pos.x, pos.y, 0], W.h / 2, W.w / 2);
      part.main.setAttribute('d', L.caps.filter((k) => k.visible).map((k) => pathOf(k.pts, true)).join(' ') + ' ' + segsOf(L.sil));
      part.hidden.setAttribute('d', L.caps.filter((k) => !k.visible).map((k) => pathOf(k.pts, true)).join(' '));
      part.soft.setAttribute('d', L.hubs.map((h) => pathOf(h, true)).join(' '));
      const homeX = side === 'left' ? -I.wheelHalfTrack : I.wheelHalfTrack;
      annotate(part, L.pts, L.center, pos.x - homeX, pos.y - I.wheelY);
    }

    const sp = parts.screen;
    // case 2: the screen can be grabbed too (it snaps between its spots around the speaker)
    const grab2 = state.kind === 'speaker' && state.withScreen && state.shape !== 'totem';
    sp.g.style.display = state.kind === 'speaker' && !grab2 ? 'none' : '';
    const sc = grab2 ? screenSlotFor(state.screenSpot, state.speakerLib, state.screenType) : [state.screen.x, state.screen.y, 0];
    const B = boxLines([sc[0], sc[1], 0], [S.w / 2, S.h / 2, S.d / 2], S.display);
    sp.main.setAttribute('d', segsOf(B.shown));
    sp.hidden.setAttribute('d', segsOf(B.hidden));
    sp.soft.setAttribute('d', B.disp ? pathOf(B.disp, true) : '');
    annotate(sp, B.pts, B.center, grab2 ? 0 : state.screen.x - I.screenX, grab2 ? 0 : state.screen.y - I.screenY);

    renderGuides();
  }

  /** Horizontal guides at the dragged part's centre height, from the edges toward it. */
  function renderGuides() {
    guides.classList.toggle('on', !!active);
    if (!active || !parts[active].box) return;
    const { x0, x1, y0, y1 } = parts[active].box;
    const y = (y0 + y1) / 2;
    const gap = 60;
    line(guideL, 0, y, Math.max(0, x0 - gap), y);
    line(guideR, Math.min(view.vw, x1 + gap), y, view.vw, y);
  }

  return {
    render,
    setActive(part) {
      active = part;
      renderGuides();
    },
  };
}
