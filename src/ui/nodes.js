import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { view } from '../view.js';
import { SPEAKER_PATTERNS, holePattern } from '../speaker-patterns.js';
import { setSpeakerPattern, setScreenType, setPower, setSpeakerLib } from '../state.js';
import { SCREENS } from '../config.js';
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
  let onShape = () => {};

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
  tray.innerHTML = '<div class="thumb"><img alt=""></div><div class="tray-text"><b></b><span class="hint">drag the reference ↙</span></div>';
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
  spk.className = 'node spk tool hidden';
  const holesSvg = (name) => holePattern(name)
    .map(([x, y]) => `<circle cx="${(32 + 17 * x).toFixed(1)}" cy="${(24 + 17 * y).toFixed(1)}" r="2.3"/>`).join('');
  spk.innerHTML = `<div class="tab">speaker</div>
    <div class="card">
      <div class="picker">
        <button class="arrow" data-step="-1" title="previous pattern">‹</button>
        <div class="viz"><svg viewBox="0 0 64 48">${holesSvg(state.speakerPattern)}</svg></div>
        <button class="arrow" data-step="1" title="next pattern">›</button>
      </div>
      <div class="seg types"><button data-spk="speaker" title="Seeed 4Ω 5W · 50 × 45 × 22">5 w</button><button data-spk="speakerSmall" title="Seeed 6Ω 2W · 28 × 31 × 15">2 w</button></div>
      <div class="seg voices" hidden>${['beep', 'chirp', 'hum'].map((v) => `<button data-voice="${v}">${v}</button>`).join('')}</div>
    </div>`;
  document.body.appendChild(spk);
  const spkLink = makeLink('ink');
  const viz = spk.querySelector('.viz');
  // ‹ › cycle the grille pattern
  spk.querySelectorAll('.arrow').forEach((b) => b.addEventListener('click', () => {
    const i = SPEAKER_PATTERNS.indexOf(state.speakerPattern);
    const next = SPEAKER_PATTERNS[(i + Number(b.dataset.step) + SPEAKER_PATTERNS.length) % SPEAKER_PATTERNS.length];
    setSpeakerPattern(next);
    viz.querySelector('svg').innerHTML = holesSvg(next);
    const e = currentSpeaker();
    if (e) { const [x, y] = view.project(...e.p); body.ripple(x, y); }
  }));
  const sound = { voice: 'chirp', volume: 0.6, pitch: 0.5 };

  const currentSpeaker = () => state.extras.find((e) => e.type === 'speaker');
  const syncSound = () => {
    spk.querySelectorAll('.voices button').forEach((b) => b.classList.toggle('on', b.dataset.voice === sound.voice));
    spk.querySelectorAll('.types button').forEach((b) => b.classList.toggle('on', b.dataset.spk === state.speakerLib));
    const e = currentSpeaker();
    if (e) e.sound = { voice: sound.voice }; // read by snapshot() for the later CAD step
  };
  // picking a sound plays it
  spk.querySelectorAll('.voices button').forEach((b) =>
    b.addEventListener('click', () => { sound.voice = b.dataset.voice; syncSound(); play(); }));
  // which speaker: the two Seeed enclosed speakers that plug into the HAT
  spk.querySelectorAll('.types button').forEach((b) => b.addEventListener('click', () => {
    setSpeakerLib(b.dataset.spk);
    syncSound();
    const e = currentSpeaker();
    if (e) { const [x, y] = view.project(...e.p); body.ripple(x, y); }
  }));
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

  /* ---------- screen node: pick the display from the library ---------- */

  const SCREEN_ORDER = Object.keys(SCREENS);
  /** The board drawn to scale (1 unit = 1 mm): outline, mounting holes, lit area. */
  function screenSvg(type) {
    const sc = SCREENS[type], cx = 32, cy = 24;
    const x0 = cx - sc.w / 2, y0 = cy - sc.h / 2;
    const hx = type === 'oled' ? 15.25 : 23.15, hy = type === 'oled' ? 14 : 17;
    const holes = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => `<circle class="hole" cx="${cx + sx * hx}" cy="${cy + sy * hy}" r="1.25"/>`).join('');
    const D = sc.display, dy = cy - D.offsetY;
    let face = '';
    if (type === 'matrix') {
      // the 13 × 9 LEDs, lit ones as drawn on the matrix
      face = state.leds.map((on, i) => `<rect class="${on ? 'px on' : 'px'}" x="${cx - 19.5 + (i % 13) * 3 + 0.6}" y="${dy - 13.5 + Math.floor(i / 13) * 3 + 0.6}" width="1.8" height="1.8"/>`).join('');
    } else {
      const pins = Array.from({ length: 8 }, (_, k) => `<circle class="hole" cx="${cx - 8.9 + k * 2.54}" cy="${cy - 14.6}" r="0.6"/>`).join('');
      face = pins + `<rect class="px mono" x="${cx - 7.6}" y="${dy - 4.7}" width="3.2" height="4.4"/><rect class="px mono" x="${cx + 4.4}" y="${dy - 4.7}" width="3.2" height="4.4"/>`
        + `<path class="smile" d="M${cx - 5} ${dy + 1.8} Q${cx} ${dy + 6} ${cx + 5} ${dy + 1.8}"/>`;
    }
    return `<rect class="board" x="${x0}" y="${y0}" width="${sc.w}" height="${sc.h}" rx="2"/>${holes}`
      + `<rect class="glass" x="${cx - D.w / 2 - 1}" y="${dy - D.h / 2 - 1}" width="${D.w + 2}" height="${D.h + 2}" rx="0.8"/>${face}`;
  }
  const scr = document.createElement('div');
  scr.className = 'node scr tool hidden';
  scr.innerHTML = `<div class="tab">screen</div>
    <div class="card">
      <div class="picker">
        <button class="arrow" data-step="-1" title="previous screen">‹</button>
        <div class="viz"><svg viewBox="0 0 64 48"></svg></div>
        <button class="arrow" data-step="1" title="next screen">›</button>
      </div>
      <div class="pick-name"></div>
    </div>`;
  document.body.appendChild(scr);
  const scrLink = makeLink('ink');
  const drawScreenNode = () => {
    const sc = SCREENS[state.screenType];
    scr.querySelector('.pick-name').textContent = sc.label;
    scr.querySelector('svg').innerHTML = screenSvg(state.screenType);
  };
  drawScreenNode();
  scr.querySelectorAll('.arrow').forEach((b) => b.addEventListener('click', () => {
    const i = SCREEN_ORDER.indexOf(state.screenType);
    setScreenType(SCREEN_ORDER[(i + Number(b.dataset.step) + SCREEN_ORDER.length) % SCREEN_ORDER.length]);
    drawScreenNode();
    const sp = screenPart();
    if (sp) { const [x, y] = view.project(...sp.c); body.ripple(x, y); }
  }));
  const screenPart = () => body.layout()?.parts.find((q) => q.key === 'matrix');



  /* ---------- energy source node: battery or wall ---------- */

  // drawn like the screen boards (1 unit = 1 mm-ish, hairline): the LiPo pack, or the PD module with its cable out
  const ENERGY = {
    battery: { label: 'battery', svg: `<rect class="board" x="14" y="14" width="36" height="20" rx="2.5"/>
        <path class="board" d="M50 20h3v8h-3"/><path class="bolt" d="M33.5 17.5 27.5 25h5l-2 6.5 6.5-8h-5z"/>` },
    wall: { label: 'wall-powered', svg: `<rect class="board" x="8" y="18" width="22" height="10" rx="1.5"/>
        <rect class="glass" x="9.5" y="20.5" width="5" height="5" rx="1"/>
        <path class="cable" d="M30 23h8c6 0 6 10 12 10h6"/>
        <path class="board" d="M50 28v10M54 28v10"/><rect class="board" x="47" y="24" width="10" height="5" rx="1"/>` },
  };
  const ENERGY_ORDER = ['battery', 'wall'];
  const eng = document.createElement('div');
  eng.className = 'node eng tool hidden';
  eng.innerHTML = `<div class="tab">energy source</div>
    <div class="card">
      <div class="picker">
        <button class="arrow" data-step="-1" title="previous">‹</button>
        <div class="viz"><svg viewBox="0 0 64 48"></svg></div>
        <button class="arrow" data-step="1" title="next">›</button>
      </div>
      <div class="pick-name"></div>
    </div>`;
  document.body.appendChild(eng);
  const engLink = makeLink('ink');
  const shpLink = makeLink('ink');
  const drawEnergy = () => {
    eng.querySelector('svg').innerHTML = ENERGY[state.power].svg;
    eng.querySelector('.pick-name').textContent = ENERGY[state.power].label;
  };
  drawEnergy();
  eng.querySelectorAll('.arrow').forEach((b) => b.addEventListener('click', () => {
    const i = ENERGY_ORDER.indexOf(state.power);
    setPower(ENERGY_ORDER[(i + Number(b.dataset.step) + ENERGY_ORDER.length) % ENERGY_ORDER.length]);
    drawEnergy();
    const p = body.layout()?.parts.find((q) => q.key === 'battery');
    if (p) { const [x, y] = view.project(...p.c); body.ripple(x, y); }
  }));

  /* ---------- shape node (case 2): the skin's form ---------- */

  const FORMS = [
    ['free', 'free form', '<path d="M6 13.5c-1.5-4 1.5-8.5 6-8 3 .3 3.2 2.6 5.6 3.6 2.4 1 2.2 5.2-.6 7.4-2.4 1.9-4.6 3-7.4 2.4C7.6 18.5 6.7 15.4 6 13.5z"/>'],
    ['box', 'square', '<rect x="5" y="5" width="14" height="14" rx="1.5"/>'],
    ['pentagon', 'pentagon', '<path d="M12 4.5l7.6 5.5-2.9 9H7.3l-2.9-9z"/>'],
    ['hexagon', 'hexagon', '<path d="M8 5h8l4 7-4 7H8l-4-7z"/>'],
    ['dome', 'semicircle', '<path d="M4.5 17a7.5 7.5 0 0 1 15 0z"/>'],
    ['totem', 'modular', '<rect x="8" y="3.5" width="8" height="5" rx="1"/><circle cx="12" cy="12.5" r="3.2"/><path d="M6.5 20.5 12 15.9l5.5 4.6z"/>'],
  ];
  const shp = document.createElement('div');
  shp.className = 'node shp tool hidden';
  shp.innerHTML = `<div class="tab">primitives</div>
    <div class="card">
      <div class="forms">${FORMS.map(([k, label, icon]) => `<button data-form="${k}" title="${label}"><svg viewBox="0 0 24 24">${icon}</svg></button>`).join('')}</div>
    </div>`;
  document.body.appendChild(shp);
  const drawShape = () => {
    shp.querySelectorAll('[data-form]').forEach((b) => b.classList.toggle('on', b.dataset.form === state.shape));
  };
  drawShape();
  shp.querySelector('.forms').addEventListener('click', (e) => {
    const k = e.target.closest('[data-form]')?.dataset.form;
    if (!k) return;
    onShape(k);                 // modular re-rolls on every click
    drawShape();
  });

  /* ---------- the tool list: one icon per tool the object has; click opens / closes it ---------- */

  const TOOL_ICONS = {
    screen: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="11" rx="1.5"/><path d="M9.5 19.5h5M12 16.5v3"/></svg>',
    speaker: '<svg viewBox="0 0 24 24"><path d="M5 9.5h3l4.5-4v13l-4.5-4H5z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    energy: '<svg viewBox="0 0 24 24"><path d="M13 3.5 6.5 13.5H12l-1 7 6.5-10H12z"/></svg>',
    shape: '<svg viewBox="0 0 24 24"><path d="M12 4.5l7.6 5.5-2.9 9H7.3l-2.9-9z"/></svg>',   // primitives
  };
  const TOOLS = { shape: shp, screen: scr, speaker: spk, energy: eng };
  const toolbox = document.createElement('div');
  toolbox.id = 'toolbox';
  const TOOL_NAMES = { shape: 'primitives', screen: 'screen', speaker: 'speaker', energy: 'energy source' };
  toolbox.innerHTML = '<span class="lbl">log</span>' + Object.keys(TOOLS).map((k) => `<button data-tool="${k}" title="${TOOL_NAMES[k]}" aria-label="${TOOL_NAMES[k]}">${TOOL_ICONS[k]}</button>`).join('');
  document.body.appendChild(toolbox);
  // open / closed per tool; screen and speaker open by themselves when they arrive (prompts), energy on demand
  const open = { shape: true, screen: true, speaker: true, energy: false };
  const placed = {};      // tools the user dragged somewhere: { left, top } in px (otherwise they stack on the right)

  /**
   * Node header (look 1): the title in a dark tab with a slanted edge, and on the frame a drag
   * grip and a button — × closes a tool; − tucks the references away (before the grip, as on
   * the reference card). In look 2 the header melts away and the label sits on the border again.
   */
  const decorate = (node, glyph, title, onPress, buttonFirst = false) => {
    const tab = node.querySelector('.tab');
    const hdr = document.createElement('div');
    hdr.className = 'hdr';
    node.insertBefore(hdr, tab);
    hdr.appendChild(tab);
    const ctl = document.createElement('div');
    ctl.className = 'ctl';
    const grip = '<span class="grip" aria-hidden="true"></span>';
    const btn = `<button class="x" title="${title}" aria-label="${title}">${glyph}</button>`;
    ctl.innerHTML = buttonFirst ? btn + grip : grip + btn;
    hdr.appendChild(ctl);
    ctl.querySelector('.x').addEventListener('click', onPress);
  };
  for (const [k, node] of Object.entries(TOOLS)) decorate(node, '×', 'close', () => { open[k] = false; });
  decorate(ref, '−', 'hide', () => ref.classList.add('hidden'), true);


  // drag a tool by its label (or any empty part of its card)
  for (const [k, node] of Object.entries(TOOLS)) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .leds, svg')) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const off = [e.clientX - r.left, e.clientY - r.top];
      node.classList.add('dragging');
      const move = (ev) => {
        const left = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - off[0]));
        const top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - off[1]));
        placed[k] = { left, top };
      };
      const up = () => {
        node.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    // double-click the label: back to its place in the stack
    node.querySelector('.tab').addEventListener('dblclick', () => { delete placed[k]; });
  }

  // show / hide all the tools at once (pill next to the case switch)
  let toolsOn = true;
  const toolsBtn = document.createElement('button');
  toolsBtn.id = 'tools-toggle';
  document.body.appendChild(toolsBtn);
  const markTools = () => { toolsBtn.textContent = toolsOn ? 'tools ●' : 'tools ○'; toolsBtn.classList.toggle('on', toolsOn); };
  markTools();
  toolsBtn.addEventListener('click', () => { toolsOn = !toolsOn; markTools(); });
  const placeToolsBtn = () => {
    const cs = document.getElementById('casetoggle');
    if (cs) toolsBtn.style.left = `${Math.round(cs.getBoundingClientRect().right + 12)}px`;
  };
  requestAnimationFrame(placeToolsBtn);
  window.addEventListener('resize', placeToolsBtn);
  const had = { shape: false, screen: false, speaker: false, energy: false };
  toolbox.addEventListener('click', (e) => {
    const k = e.target.closest('[data-tool]')?.dataset.tool;
    if (k) open[k] = !open[k];
  });

  /* ---------- natural placement of the tool nodes ---------- */

  // a node gets a good spot once, when it appears, and then stays put (until the case changes,
  // or a double-click on its label asks for a new spot)
  let placedKind = state.kind;
  function placeNodes() {
    const lookNow = state.kind + (document.body.classList.contains('look-2') ? '2' : '1');   // the nodes change size with the look
    if (lookNow !== placedKind) {
      placedKind = lookNow;
      for (const k in placed) if (placed[k].auto) delete placed[k];
    }
    const pending = ['shape', 'screen', 'speaker', 'energy'].filter((k) => !TOOLS[k].classList.contains('hidden') && !placed[k]);
    for (const k of ['shape', 'screen', 'speaker', 'energy']) {
      const n = TOOLS[k];
      if (n.classList.contains('hidden') || !placed[k]) continue;
      n.style.left = `${placed[k].left}px`; n.style.right = 'auto'; n.style.top = `${placed[k].top}px`;
    }
    if (!pending.length) return;
    const L = body.layout();
    if (!L) return;
    // the object's footprint on screen
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (p) => { const [x, y] = view.project(p[0], p[1], p[2]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    for (const p of L.parts) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) grow([p.c[0] + sx * p.h[0], p.c[1] + sy * p.h[1], p.c[2] + sz * p.h[2]]);
    if (state.kind === 'robot') for (const w of [state.wheels.left, state.wheels.right]) for (const d of [-45, 45]) { grow([w.x, w.y + d, 0]); grow([w.x + d / 3, w.y, 0]); }
    if (!isFinite(x0)) return;
    const cx = (x0 + x1) / 2;
    const e = currentSpeaker();
    const pw = L.parts.find((q) => q.key === 'battery');
    const sp = screenPart();
    const target = { shape: null, screen: sp?.c, speaker: e?.p, energy: pw?.c };
    const prefer = { shape: 'left', screen: 'right', speaker: 'right', energy: 'left' };   // when a part sits in the middle
    const vw = window.innerWidth, vh = window.innerHeight;
    const rightEdge = vw - 20;
    const list = document.querySelector('.node.bom')?.getBoundingClientRect();
    const gap = Math.max(60, Math.min(140, (x1 - x0) * 0.35));
    // nodes already in place are obstacles
    const taken = Object.entries(placed).filter(([k]) => !TOOLS[k].classList.contains('hidden'))
      .map(([k, p]) => ({ x: p.left, y: p.top, w: TOOLS[k].offsetWidth, h: TOOLS[k].offsetHeight }));
    const items = pending.map((k) => {
      const t = target[k];
      const [px, py] = t ? view.project(t[0], t[1], t[2]) : [cx, (y0 + y1) / 2];
      return { k, py, side: Math.abs(px - cx) < 24 ? prefer[k] : px < cx ? 'left' : 'right', w: TOOLS[k].offsetWidth, h: TOOLS[k].offsetHeight };
    }).sort((p, q) => p.py - q.py);
    const hits = (x, y, w, h) => taken.find((r) => x < r.x + r.w + 12 && x + w + 12 > r.x && y < r.y + r.h + 14 && y + h + 14 > r.y);
    const offList = (x, y, w, h) => !(list && x < list.right + 12 && y + h > list.top - 12 && y < list.bottom + 12);
    for (const it of items) {
      // try the part's side first, then the other one; on each, the nearest free height to the part
      let x, y, found = false;
      for (const side of [it.side, it.side === 'left' ? 'right' : 'left']) {
        x = Math.max(20, Math.min(rightEdge - it.w, side === 'left' ? x0 - gap - it.w : x1 + gap));
        const want = it.py - it.h / 2 - 40;
        const top = 56, bottom = vh - it.h - 80;                           // below the top bar, above the prompts and the log
        for (let d = 0; d <= vh && !found; d += 12) {
          for (const cand of [want + d, want - d]) {
            const yy = Math.max(top, Math.min(bottom, cand));
            if (!hits(x, yy, it.w, it.h) && offList(x, yy, it.w, it.h)) { y = yy; found = true; break; }
          }
        }
        if (found) break;
      }
      if (!found) y = Math.max(56, it.py - it.h / 2 - 40);
      placed[it.k] = { left: Math.round(x), top: Math.round(y), auto: true };
      taken.push({ x, y, w: it.w, h: it.h });
      const n = TOOLS[it.k];
      n.style.left = `${placed[it.k].left}px`; n.style.right = 'auto'; n.style.top = `${placed[it.k].top}px`;
    }
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
    // the offered image sits right of the references node, under its connector (free space)
    tray.style.left = `${Math.round(rb.right + 24)}px`;
    tray.style.top = `${Math.round(rb.top + 70)}px`;

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

    // which tools the object has right now
    const e = currentSpeaker();
    const avail = { shape: state.kind === 'speaker', screen: state.kind === 'robot' || state.withScreen, speaker: !!e, energy: true };
    if (!shp.classList.contains('hidden')) drawShape();
    toolbox.style.display = toolsOn ? '' : 'none';
    for (const k in avail) {
      if (avail[k] && !had[k] && k !== 'energy') open[k] = true;   // a new part opens its tool
      had[k] = avail[k];
      const btn = toolbox.querySelector(`[data-tool="${k}"]`);
      btn.style.display = avail[k] ? '' : 'none';
      btn.classList.toggle('on', avail[k] && open[k]);
      const show = toolsOn && avail[k] && open[k];
      if (show && TOOLS[k].classList.contains('hidden')) { TOOLS[k].classList.remove('hidden'); if (k === 'speaker') syncSound(); if (k === 'energy') drawEnergy(); }
      if (!show && !TOOLS[k].classList.contains('hidden')) TOOLS[k].classList.add('hidden');
    }
    // the open nodes sit around the object, each on the side of its part and near its height
    placeNodes();

    const linkTo = (node, L, on, p) => {
      if (!on) { drawLink(L, false, 0, 0, 0, 0, 'S', dt); return; }
      const nb = node.getBoundingClientRect();
      const [x, y2] = view.project(...p);
      // leave from the side that faces the part
      const fromRight = nb.left + nb.width / 2 < x;
      drawLink(L, true, fromRight ? nb.right : nb.left, nb.top + 40, x, y2, 'S', dt);
    };
    const sp = screenPart();
    linkTo(scr, scrLink, !scr.classList.contains('hidden') && !!sp, sp ? [sp.c[0] + sp.h[0], sp.c[1], sp.c[2]] : [0, 0, 0]);
    linkTo(spk, spkLink, !spk.classList.contains('hidden') && !!e, e ? e.p : [0, 0, 0]);
    const pw = body.layout()?.parts.find((q) => q.key === 'battery');
    linkTo(eng, engLink, !eng.classList.contains('hidden') && !!pw, pw ? pw.c : [0, 0, 0]);
    // shape → the front of the object, at its middle height
    const Lp = body.layout();
    if (Lp && Lp.parts.length) {
      const lo = [0, 1, 2].map((k) => Math.min(...Lp.parts.map((q) => q.c[k] - q.h[k])));
      const hi = [0, 1, 2].map((k) => Math.max(...Lp.parts.map((q) => q.c[k] + q.h[k])));
      linkTo(shp, shpLink, !shp.classList.contains('hidden'), [lo[0], (lo[1] + hi[1]) / 2, hi[2] * 0.5]);
    } else linkTo(shp, shpLink, false, [0, 0, 0]);
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
    set onShape(fn) { onShape = fn; },
  };
}
