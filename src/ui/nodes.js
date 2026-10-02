import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { view } from '../view.js';
import { refImageURL, REF_LABELS } from './refimages.js';
import { playVoice } from './sound.js';

const NS = 'http://www.w3.org/2000/svg';
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * Node cards around the object, as in the main screen of the tool:
 * - "references": a 2×2 grid of slots. Dropping a reference image into a slot
 *   sends it down the connector to the object, which then takes that shape.
 *   Filled slots can be clicked to apply that reference again.
 * - "speaker": appears while a speaker is on the object; pick one of three
 *   sounds, which plays it (each note ripples out from the speaker).
 * Connectors are drawn every frame, so they follow the object as it moves.
 */
export function createNodes({ body }) {
  /** Called with a reference id ('frog' | 'walle') when it should be applied. */
  let onApply = () => {};

  // connector layer, between the 3D parts and the cards
  const links = document.createElementNS(NS, 'svg');
  links.id = 'links';
  document.body.appendChild(links);
  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    links.appendChild(n);
    return n;
  };
  const makeLink = (cls) => ({
    path: mk('path', { class: `link ${cls}` }),
    a: mk('circle', { class: `link-dot ${cls}`, r: 3.2 }),
    b: mk('circle', { class: `link-dot ${cls}`, r: 3.2 }),
    drawT: 0, // draw-in progress
  });

  /* ---------- references node ---------- */

  const ref = document.createElement('div');
  ref.className = 'node ref hidden';
  ref.innerHTML = `<div class="tab">references</div>
    <div class="card"><div class="slots">${'<div class="slot">+</div>'.repeat(4)}</div></div>`;
  document.body.appendChild(ref);
  const slots = [...ref.querySelectorAll('.slot')];
  const refLink = makeLink('pink');
  const pulse = mk('circle', { class: 'link-pulse', r: 4.5 });
  let pulseT = -1; // 0..1 while a reference travels to the object
  let pendingApply = null;

  slots.forEach((slot) => {
    slot.addEventListener('click', () => {
      if (slot.dataset.ref) send(slot.dataset.ref);
    });
  });

  /** Animate a dot along the connector, then apply the reference. */
  function send(id) {
    pulseT = 0;
    pendingApply = id;
  }

  /* ---------- offered image (dragged into a slot) ---------- */

  const tray = document.createElement('div');
  tray.className = 'tray hidden';
  tray.innerHTML = '<div class="thumb"><img alt=""></div><div class="tray-text"><b></b></div>';
  document.body.appendChild(tray);
  const thumb = tray.querySelector('.thumb');
  const thumbImg = thumb.querySelector('img');
  let offered = null;

  function offerImage(id) {
    offered = id;
    thumbImg.src = refImageURL(id);
    tray.querySelector('b').textContent = REF_LABELS[id];
    tray.classList.remove('hidden');
  }

  thumb.addEventListener('pointerdown', (e) => {
    if (!offered) return;
    e.preventDefault();
    const r = thumb.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = `<img src="${thumbImg.src}" alt="">`;
    document.body.appendChild(ghost);
    const off = [e.clientX - r.left, e.clientY - r.top];
    const place = (x, y) => { ghost.style.left = `${x - off[0]}px`; ghost.style.top = `${y - off[1]}px`; };
    place(e.clientX, e.clientY);
    thumb.classList.add('lifted');
    document.body.classList.add('is-dragging-ref');

    const slotAt = (x, y) => slots.find((s) => {
      const b = s.getBoundingClientRect();
      return x >= b.left - 8 && x <= b.right + 8 && y >= b.top - 8 && y <= b.bottom + 8;
    });
    const move = (ev) => {
      place(ev.clientX, ev.clientY);
      const hit = slotAt(ev.clientX, ev.clientY);
      slots.forEach((s) => s.classList.toggle('hover', s === hit));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-dragging-ref');
      slots.forEach((s) => s.classList.remove('hover'));
      const hit = slotAt(ev.clientX, ev.clientY);
      const target = (hit ?? thumb).getBoundingClientRect();
      // glide into the slot (or back to the tray)
      ghost.classList.add('settle');
      ghost.style.left = `${target.left}px`;
      ghost.style.top = `${target.top}px`;
      ghost.style.width = `${target.width}px`;
      ghost.style.height = `${target.height}px`;
      setTimeout(() => {
        ghost.remove();
        thumb.classList.remove('lifted');
        if (!hit) return;
        hit.innerHTML = `<img src="${thumbImg.src}" alt="${REF_LABELS[offered]}">`;
        hit.dataset.ref = offered;
        hit.classList.add('filled', 'pop');
        setTimeout(() => hit.classList.remove('pop'), 500);
        tray.classList.add('hidden');
        send(offered);
        offered = null;
      }, 260);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* ---------- speaker node ---------- */

  const spk = document.createElement('div');
  spk.className = 'node spk hidden';
  const holes = [[0, 1], [0.5, 6], [1, 12]]
    .flatMap(([rr, n]) => Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      return `<circle cx="${(30 + 20 * rr * Math.cos(a)).toFixed(1)}" cy="${(30 + 20 * rr * Math.sin(a)).toFixed(1)}" r="3"/>`;
    })).join('');
  spk.innerHTML = `<div class="tab">speaker</div>
    <div class="card">
      <div class="viz"><svg viewBox="0 0 60 60">${holes}</svg></div>
      <div class="seg">${['beep', 'chirp', 'hum'].map((v) => `<button data-voice="${v}">${v}</button>`).join('')}</div>
    </div>`;
  document.body.appendChild(spk);
  const spkLink = makeLink('ink');
  const viz = spk.querySelector('.viz');
  const sound = { voice: 'chirp', volume: 0.6, pitch: 0.5 };

  const currentSpeaker = () => state.extras.find((e) => e.type === 'speaker');
  const syncSound = () => {
    spk.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.voice === sound.voice));
    const e = currentSpeaker();
    if (e) e.sound = { voice: sound.voice }; // read by snapshot() for the later CAD step
  };
  // picking a sound plays it
  spk.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => { sound.voice = b.dataset.voice; syncSound(); play(); }));
  syncSound();

  function play() {
    const e = currentSpeaker();
    playVoice(sound, () => {
      viz.classList.remove('beat');
      void viz.offsetWidth; // restart the CSS animation
      viz.classList.add('beat');
      if (e) {
        const [x, y] = view.project(...e.p);
        body.ripple(x, y);
      }
    });
  }

  /* ---------- connectors ---------- */

  /** Path with rounded elbows: horizontal, then vertical into the target (L), or H-V-H (S). */
  function elbow(x1, y1, x2, y2, kind) {
    const r = Math.min(26, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
    const sx = Math.sign(x2 - x1) || 1, sy = Math.sign(y2 - y1) || 1;
    if (r < 2) return `M${x1} ${y1} L${x2} ${y2}`;
    if (kind === 'L') {
      return `M${x1} ${y1} H${x2 - sx * r} Q${x2} ${y1} ${x2} ${y1 + sy * r} V${y2}`;
    }
    const xm = (x1 + x2) / 2;
    return `M${x1} ${y1} H${xm - sx * r} Q${xm} ${y1} ${xm} ${y1 + sy * r} V${y2 - sy * r} Q${xm} ${y2} ${xm + sx * r} ${y2} H${x2}`;
  }

  function drawLink(L, visible, x1, y1, x2, y2, kind, dt) {
    L.drawT = visible ? Math.min(1, L.drawT + dt / 0.6) : 0;
    const on = visible && L.drawT > 0;
    for (const n of [L.path, L.a, L.b]) n.style.display = on ? '' : 'none';
    if (!on) return;
    L.path.setAttribute('d', elbow(x1, y1, x2, y2, kind));
    const len = L.path.getTotalLength();
    const k = easeOut(L.drawT);
    L.path.style.strokeDasharray = `${len}`;
    L.path.style.strokeDashoffset = `${len * (1 - k)}`;
    L.a.setAttribute('cx', x1); L.a.setAttribute('cy', y1);
    const end = L.path.getPointAtLength(len * k);
    L.b.setAttribute('cx', end.x); L.b.setAttribute('cy', end.y);
  }

  function update(dt) {
    // references → top of the screen
    const refOn = !ref.classList.contains('hidden');
    const rb = ref.getBoundingClientRect();
    const S = CONFIG.screen;
    const top = view.project(state.screen.x, state.screen.y + S.h / 2 + 2, 0);
    drawLink(refLink, refOn, rb.right, rb.top + 44, top[0], top[1], 'L', dt);

    // reference travelling down the connector
    if (pulseT >= 0 && refOn) {
      pulseT += dt / 0.6;
      const len = refLink.path.getTotalLength();
      const pt = refLink.path.getPointAtLength(len * easeOut(pulseT));
      pulse.style.display = '';
      pulse.setAttribute('cx', pt.x);
      pulse.setAttribute('cy', pt.y);
      if (pulseT >= 1) {
        pulseT = -1;
        pulse.style.display = 'none';
        body.ripple(top[0], top[1]);
        onApply(pendingApply);
      }
    } else {
      pulse.style.display = 'none';
    }

    // speaker node follows the speaker's presence; connector to its contact point
    const e = currentSpeaker();
    if (e && spk.classList.contains('hidden')) { spk.classList.remove('hidden'); syncSound(); }
    if (!e && !spk.classList.contains('hidden')) spk.classList.add('hidden');
    if (e) {
      const sb = spk.getBoundingClientRect();
      const [x, y] = view.project(...e.p);
      drawLink(spkLink, true, sb.left, sb.top + 40, x, y, 'S', dt);
    } else {
      drawLink(spkLink, false, 0, 0, 0, 0, 'S', dt);
    }
  }

  return {
    update,
    showReferences: () => ref.classList.remove('hidden'),
    offerImage,
    /** Hide the references node, empty its slots and withdraw any offered image. */
    reset() {
      ref.classList.add('hidden');
      tray.classList.add('hidden');
      offered = null;
      pulseT = -1;
      slots.forEach((s) => { s.innerHTML = '+'; delete s.dataset.ref; s.classList.remove('filled'); });
    },
    set onApply(fn) { onApply = fn; },
  };
}
