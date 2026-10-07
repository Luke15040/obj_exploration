import { CONFIG } from '../config.js?v=202610071442';
import { state, params, onChange, addExtra, updateExtra, removeExtra, mountNormal } from '../state.js?v=202610071442';
import { view } from '../view.js?v=202610071442';
import { Spring } from '../body/springs.js?v=202610071442';
import { snapRay, resnap, frontPoint, shapeSpots, faceAnchors } from '../body/sdf.js?v=202610071442';
import { FREE_SLOTS, freeKnobSpots } from '../parts.js?v=202610071442';
import { holePattern } from '../speaker-patterns.js?v=202610071442';
import { drawMarkers } from './markers.js?v=202610071442';
import { pathOf, segsOf, hull, basis, circle3, cylinderLines, facing } from './wire.js?v=202610071442';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** Three springs moving together. */
class Spring3 {
  constructor(v, f, z) { this.s = v.map((x) => new Spring(x, f, z)); }
  set target(v) { this.s.forEach((s, i) => (s.target = v[i])); }
  snap(v) { this.s.forEach((s, i) => { s.value = s.target = v[i]; s.velocity = 0; }); }
  step(dt) { this.s.forEach((s) => s.step(dt)); }
  get value() { return this.s.map((s) => s.value); }
}

/**
 * Surface-mounted add-ons: speaker (a circular hole pattern cut into the
 * surface) and knob (a small cylinder on a mounting pad).
 *
 * - "+ speaker" / "+ knob" (or keys s / k) add one: it flies in along the
 *   surface normal, lands with a little overshoot, its wireframe draws itself,
 *   the provisional body grows a mounting pad around it and a ripple runs
 *   through the dots.
 * - Drag to move it over the surface. The knob is magnetic: it is pulled onto
 *   the nearest surface even when the cursor is off the object, and clicks
 *   into place. Released in the void, a part flies back to its last spot.
 * - Scroll over a knob to turn it. Delete / Backspace removes the hovered part.
 *
 * Canonical positions live in `state.extras`; this module owns the animation.
 */
export function createExtras(svg, { onPulse, offsets = () => [], dotGrid = null } = {}) {
  const P = CONFIG.palette;
  const T = CONFIG.extras;
  const layer = el('g', { class: 'extras' }, svg);
  const anchorLayer = el('g', { class: 'snap-anchors', 'pointer-events': 'none' }, svg);   // the face's snap points, shown while dragging
  const rt = new Map(); // id → runtime (springs, svg nodes)
  let hovered = null;
  let drag = null;
  let clock = 0;

  /* ---------- toolbar ---------- */

  const bar = document.createElement('div');
  bar.id = 'toolbar';
  bar.innerHTML = `
    <button data-add="speaker">+ speaker</button>
    <button data-add="knob">+ knob</button>
    <span class="hint">drag to move · scroll turns knob · del removes</span>`;
  // the toolbar is not shown any more (add-ons come from the prompts and the shapes); keys s / k still work
  bar.addEventListener('click', (e) => {
    const type = e.target.closest('[data-add]')?.dataset.add;
    if (type) spawn(type);
  });
  const refreshBar = () => bar.classList.toggle('full', state.extras.length >= T.max);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') spawn('speaker');
    if (k === 'k') spawn('knob');
    if ((k === 'delete' || k === 'backspace') && hovered != null) despawn(hovered);
  });

  /* ---------- spawning ---------- */

  /** A free spot on the front of the body for a new part. */
  function defaultSpot(type) {
    if (state.kind === 'speaker') {
      const nk = state.extras.filter((e) => e.type === 'knob').length;
      if (state.shape !== 'free') {
        // a primitive decides by itself: the speaker on the front, the new knob on the next face
        const spots = shapeSpots(type === 'knob' ? nk + 1 : nk);
        const sp = type === 'speaker' ? spots[0] : spots[spots.length - 1];
        return { p: sp.p, n: sp.n };
      }
      const spots = type === 'speaker' ? [FREE_SLOTS.speaker] : freeKnobSpots(nk + 1);
      for (const [x, y] of spots) {
        const hit = frontPoint(x, y);
        if (!hit) continue;
        const free = state.extras.every((e) => Math.hypot(e.p[0] - hit.p[0], e.p[1] - hit.p[1]) > T[type].r + T[e.type].r + 4);
        if (free) return hit;
      }
    }
    const WL = state.wheels.left, WR = state.wheels.right;
    const box2 = state.kind === 'speaker';
    const cx = box2 ? 0 : 0.5 * (WL.x + WR.x), yc = box2 ? (type === 'knob' ? -6 : 0) : 0.5 * (WL.y + WR.y);
    const r = T[type].r;
    const xs = box2
      ? (type === 'speaker' ? [0, -26, 26] : [42, -42, 36, -36])
      : (type === 'speaker' ? [0, -26, 26, -40, 40] : [26, -26, 14, -14, 0]);
    for (const dx of xs) {
      const hit = frontPoint(cx + dx, yc - 2);
      if (!hit) continue;
      const free = state.extras.every((e) => Math.hypot(e.p[0] - hit.p[0], e.p[1] - hit.p[1]) > r + T[e.type].r + 4);
      if (free) return hit;
    }
    return frontPoint(cx, yc - 2) ?? { p: [cx, yc, 30], n: [0, 0, 1] };
  }

  function spawn(type) {
    if (state.extras.length >= T.max) return;
    const spot = defaultSpot(type);
    const e = addExtra(type, spot.p, spot.n);
    const r = createRuntime(e);
    if (type === 'speaker') {
      // the hole pattern opens up in place
      r.landAt = 0.15;
    } else {
      // start outside, along the normal, and fly in
      r.pos.snap(add(spot.p, mul(spot.n, 90)));
      r.landAt = 0.32;
    }
    refreshBar();
  }

  function despawn(id) {
    const r = rt.get(id);
    if (!r || r.removing) return;
    r.removing = true;
    r.scale.target = 0;
    r.scale.damping = 1;
    const [px, py] = view.project(...r.pos.value);
    onPulse?.(px, py);
    if (hovered === id) hovered = null;
  }

  function createRuntime(e) {
    const g = el('g', { class: 'part extra', 'data-part': `extra-${e.id}` }, layer);
    const r = {
      id: e.id,
      type: e.type,
      g,
      hit: el('path', { class: 'hit', fill: 'transparent', stroke: 'none' }, g),
      hidden: el('path', { class: 'shape hidden', fill: 'none', stroke: P.lineSoft }, g),
      soft: el('path', { class: 'shape', fill: 'none', stroke: P.lineSoft }, g),
      main: el('path', { class: 'shape primary', fill: 'none', stroke: P.line, pathLength: 1 }, g),
      accent: el('path', { class: 'shape accent', fill: 'none', stroke: P.line }, g),
      magnet: el('path', { class: 'magnet', fill: 'none', stroke: P.label }, layer),
      burst: el('path', { class: 'burst', fill: 'none', stroke: P.dot }, layer),
      label: el('text', { class: 'anno label', fill: P.label }, g),
      pos: new Spring3(e.p, 4.5, 0.62),   // visible contact point
      nrm: new Spring3(e.n, 5, 0.8),      // visible normal
      scale: new Spring(0, 3.2, 0.45),    // pops in with overshoot
      angle: new Spring(e.angle, 6, 0.7),
      draw: 0,          // wireframe draw-in progress 0..1
      burstT: 9,        // time since the last click-in
      burstAt: e.p,
      burstN: e.n,
      landAt: null,     // seconds until the landing pulse
      removing: false,
      float: null,      // detached drag target
    };
    r.scale.target = 1;

    g.addEventListener('pointerenter', () => (hovered = e.id));
    g.addEventListener('pointerleave', () => { if (hovered === e.id) hovered = null; });
    g.addEventListener('pointerdown', (ev) => startDrag(ev, r));
    g.addEventListener('wheel', (ev) => {
      if (r.type !== 'knob') return;
      ev.preventDefault();
      const ex = state.extras.find((x) => x.id === r.id);
      const [lo, hi] = T.knob.angleRange;
      updateExtra(r.id, { angle: clamp(ex.angle - ev.deltaY * 0.25, lo, hi) });
    }, { passive: false });

    rt.set(e.id, r);
    return r;
  }

  /* ---------- dragging + magnetic snapping ---------- */

  function startDrag(ev, r) {
    if (ev.button !== 0 || r.removing) return;
    ev.preventDefault();
    ev.stopPropagation();
    try { r.g.setPointerCapture(ev.pointerId); } catch {}
    drag = { id: r.id, pointerId: ev.pointerId, attached: true };
    r.g.classList.add('dragging');
    document.body.classList.add('is-dragging');
  }

  svg.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const r = rt.get(drag.id);
    const { o, d } = view.ray(ev.clientX, ev.clientY);
    // cursor depth: the object's mid plane (z = 0), or the camera plane when viewing side-on
    const fwd = view.cam.fwd;
    const plane = { c: view.cam.target, n: Math.abs(fwd[2]) > 0.35 ? [0, 0, 1] : fwd };
    const res = snapRay(o, d, T[r.type].snap, plane);

    if (res.attached) {
      if (!drag.attached) clickIn(r, res);        // re-attached: magnetic click
      drag.attached = true;
      r.float = res.pulled ? res.from : null;     // keep the field line while pulled
      // not free: the part clicks to the nearest snap point of the face it is on
      // (snap points already taken by another part are skipped). In the cross view the
      // snap points are the dots drawn on the shape: the nearest ones around the cursor.
      const others = state.extras.filter((x) => x.id !== r.id);
      // (a speaker grille is wide: keep a knob off all of it)
      const free = (A) => !others.some((o) => Math.hypot(o.p[0] - A.p[0], o.p[1] - A.p[1], o.p[2] - A.p[2]) < (o.type === 'speaker' || r.type === 'speaker' ? 36 : 24));
      const anchors = (params.view === 'cross' && dotGrid ? dotAnchors(ev.clientX, ev.clientY) : faceAnchors(res.n)).filter(free);
      let best = null, bd = Infinity;
      for (const A of anchors) {
        const dd = Math.hypot(A.p[0] - res.p[0], A.p[1] - res.p[1], A.p[2] - res.p[2]);
        if (dd < bd) { bd = dd; best = A; }
      }
      drag.anchors = anchors;
      if (best && best !== drag.anchor) {
        if (drag.anchor) r.scale.velocity += 2.5;   // a small click at every new snap
        drag.anchor = best;
      }
      // no free snap point here (e.g. over the speaker): the part stays where it was
      if (best) updateExtra(r.id, { p: best.p, n: best.n });
    } else {
      drag.attached = false;
      drag.anchors = null;
      r.float = res.p;                            // hover in the air at the cursor
    }
  });

  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const r = rt.get(drag.id);
    r.g.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    if (r.float && !drag.attached) {
      // dropped in the void: fly back to the last attached spot
      r.float = null;
    } else {
      r.float = null;
      const [px, py] = view.project(...state.extras.find((x) => x.id === r.id).p);
      onPulse?.(px, py);
    }
    drag = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  function clickIn(r, res) {
    r.burstT = 0;
    r.burstAt = res.p;
    r.burstN = res.n;
    r.scale.velocity += 4; // a little thunk
  }

  /* ---------- follow the body when it changes shape ---------- */

  onChange(() => {
    for (const e of state.extras) {
      if (drag && drag.id === e.id) continue;
      const s = resnap(e.p, e.n);
      e.p = s.p; // silent update (no emit) to avoid a feedback loop
      e.n = mountNormal(s.n);
    }
  });

  /** Cross view: the dots under / around the cursor, cast onto the surface. */
  function dotAnchors(x, y) {
    const g = dotGrid();
    const i0 = Math.round((x - g.ox) / g.cell - 0.5), j0 = Math.round((y - g.oyTop) / g.cell - 0.5);
    const out = [];
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      const { o, d } = view.ray(g.ox + (i + 0.5) * g.cell, g.oyTop + (j + 0.5) * g.cell);
      const h = snapRay(o, d, 0, null);
      if (h.attached) out.push({ p: h.p, n: h.n });
    }
    return out;
  }

  /* ---------- per frame ---------- */

  function update(dt) {
    clock += dt;
    for (const r of rt.values()) {
      const e = state.extras.find((x) => x.id === r.id);
      if (e) {
        const floatN = mul(view.cam.fwd, -1); // facing the viewer while in the air
        r.pos.target = r.float && drag && !drag.attached ? r.float : e.p;
        r.nrm.target = r.float && drag && !drag.attached ? floatN : e.n;
        r.angle.target = e.angle;
      }
      r.pos.step(dt);
      r.nrm.step(dt);
      r.scale.step(dt);
      r.angle.step(dt);
      r.draw = Math.min(1, r.draw + dt / 0.7);
      r.burstT += dt;

      if (r.landAt != null) {
        r.landAt -= dt;
        if (r.landAt <= 0) {
          r.landAt = null;
          const [px, py] = view.project(...e.p);
          onPulse?.(px, py);
          r.burstT = 0;
          r.burstAt = e.p;
          r.burstN = e.n;
        }
      }

      if (r.removing && r.scale.value < 0.02) {
        r.g.remove();
        r.magnet.remove();
        r.burst.remove();
        rt.delete(r.id);
        removeExtra(r.id);
        refreshBar();
      }
    }
  }

  /** Wireframes, labels, magnet line and click-in burst. */
  // the faces turned toward the camera: in the cross 2 view their snap points are always shown
  const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function visibleAnchors() {
    const f = view.cam.fwd, out = [];
    for (const a of AXES) if (-(a[0] * f[0] + a[1] * f[1] + a[2] * f[2]) > 0.25) out.push(...faceAnchors(a));
    return out;
  }

  /** Snap markers (markers.js): while dragging, the face's points; in cross 2 always, as dots. */
  function renderAnchors() {
    const dragging = drag && drag.attached && drag.anchors;
    const idle = (params.view === 'cross2' || (params.view === 'density' && params.densSnaps === 'always')) && !dragging;
    const list = dragging ? drag.anchors : idle ? visibleAnchors() : [];
    drawMarkers(anchorLayer, list.map((A) => {
      const [x, y] = view.project(...A.p);
      return { x, y, p: A.p, n: A.n, on: !!dragging && A === drag.anchor };
    }), { idle: params.view === 'cross2' || (params.view === 'density' && params.densSnaps === 'always') });
  }

  function render() {
    renderAnchors();
    const offs = offsets();
    let ri = 0;
    for (const r of rt.values()) {
      const def = T[r.type];
      const s = Math.max(0, r.scale.value);
      const n = norm(r.nrm.value);
      const off = offs[ri++] ?? 0;                        // slid out to make room for its module
      const p = r.pos.value.map((v, k) => v + n[k] * off);
      let pts, center;

      if (r.type === 'speaker') {
        // hole pattern (the same list the shader gets)
        const [u, v] = basis(n);
        const sg = state.speakerLib === 'speakerSmall' ? def.small : def;   // the small speaker has a smaller grille
        const R = sg.r * s, hr = Math.max(0.05, sg.hole * s);
        const holes = holePattern(state.speakerPattern).map(([x, y]) => add(p, add(mul(u, x * R), mul(v, y * R))));
        const visible = facing(n, p);
        const rings = holes.map((h) => pathOf(circle3(h, n, hr, 12), true)).join(' ');
        r.main.setAttribute('d', visible ? rings : '');
        r.hidden.setAttribute('d', visible ? '' : rings);
        r.soft.setAttribute('d', '');
        r.accent.setAttribute('d', '');
        r.main.removeAttribute('stroke-dasharray');
        pts = circle3(p, n, R + hr + 3, 24);
        center = view.project(...p);
      } else {
        const h = def.h * s;
        const c = add(p, mul(n, h / 2));
        const L = cylinderLines(c, n, Math.max(0.01, def.r * s), Math.max(0.01, h / 2), 36);
        const top = L.caps[1]; // the cap away from the surface
        r.main.setAttribute('d', L.caps.filter((k) => k.visible).map((k) => pathOf(k.pts, true)).join(' ') + ' ' + segsOf(L.sil));
        r.hidden.setAttribute('d', L.caps.filter((k) => !k.visible).map((k) => pathOf(k.pts, true)).join(' '));
        // wireframe draws itself in
        if (r.draw < 1) r.main.setAttribute('stroke-dasharray', `${easeOut(r.draw)} 1`);
        else r.main.removeAttribute('stroke-dasharray');
        // indicator line on the top face
        const [u, v] = basis(n);
        const a = (r.angle.value * Math.PI) / 180;
        const dir = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
        const a0 = view.project(...add(top.c, mul(dir, def.r * s * 0.25)));
        const a1 = view.project(...add(top.c, mul(dir, def.r * s * 0.85)));
        r.accent.setAttribute('d', segsOf([[a0, a1]]));
        r.soft.setAttribute('d', '');
        pts = L.pts;
        center = L.center;
      }

      r.hit.setAttribute('d', s > 0.05 ? pathOf(hull(pts), true) : '');
      let x0 = Infinity, y0 = Infinity;
      for (const q of pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); }
      r.label.setAttribute('x', x0);
      r.label.setAttribute('y', y0 - 8);
      r.label.textContent = r.type === 'knob' ? `knob ${Math.round(r.angle.value)}°` : 'speaker';

      // magnet: dashed field line from the cursor's closest point to the part
      if (r.float && drag?.id === r.id) {
        const a0 = view.project(...r.float);
        r.magnet.setAttribute('d', segsOf([[a0, center]]));
        r.magnet.style.opacity = drag.attached ? 0.9 : 0.35;
      } else {
        r.magnet.setAttribute('d', '');
      }

      // click-in burst: a ring that expands over the surface and fades
      if (r.burstT < 0.6) {
        const k = easeOut(r.burstT / 0.6);
        r.burst.setAttribute('d', pathOf(circle3(r.burstAt, r.burstN, (def.r + 4) * (1.1 + 1.6 * k), 40), true));
        r.burst.style.opacity = 1 - k;
      } else {
        r.burst.setAttribute('d', '');
      }
    }
  }

  /** What the shader needs: visible pose + grow-in scale of each part. */
  function renderList() {
    return [...rt.values()].map((r) => ({
      type: r.type,
      p: r.pos.value,
      n: norm(r.nrm.value),
      scale: Math.max(0, r.scale.value),
      angle: r.angle.value,
    }));
  }

  return {
    update,
    render,
    renderList,
    spawn,
    /** Number of live add-ons of a type (ignores ones being removed). */
    count: (type) => [...rt.values()].filter((r) => r.type === type && !r.removing).length,
    /** Remove every add-on with its shrink animation. */
    clear: () => [...rt.keys()].forEach(despawn),
  };
}
