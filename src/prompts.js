import { CONFIG } from './config.js?v=202610081612';
import { state, params, setPose, getPose, setShape, setKind, setShape2, updateExtra, setWithScreen, setMoves, setScreenType, setScreenSpot } from './state.js?v=202610081612';
import { SHAPES, TOTEM_POOL, TOTEM_BASE, FREE_SLOTS, freeKnobSpots } from './parts.js?v=202610081612';
import { frontPoint, shapeSpots, stretchPoint, snapRay } from './body/sdf.js?v=202610081612';
import { view } from './view.js?v=202610081612';
import { createBlockPrompt } from './ui/blocks.js?v=202610081612';

/**
 * Guided prompts: a few canned "prompts" that reshape the object, standing in
 * for the real natural-language step so the interaction can be tested.
 *
 * Each preset is a short choreography of steps. A step tweens part of the
 * pose (wheels / screen) or of the body-shape intent, starting `at` ms after
 * it starts, over `dur` ms. Extra actions (spawning add-ons) can be scheduled
 * the same way. Edit freely — this is the place to sketch new ones.
 *
 * Presets with a `ref` don't reshape the object straight away: they open the
 * references node and offer an image; the shape changes only once that image
 * is dropped into a reference slot.
 */

const DEFAULT_SHAPE = {
  neckR: CONFIG.body.neckR,
  eyes: 0,
  padding: 6,
  blend: 14,
};
const DEFAULT_POSE = {
  wheelHalfTrack: CONFIG.initial.wheelHalfTrack,
  wheelY: CONFIG.initial.wheelY,
  screenX: CONFIG.initial.screenX,
  screenY: CONFIG.initial.screenY,
};

// case 2: the speaker box starts as a soft block with the speaker under the matrix
const BOX_SHAPE = { neckR: CONFIG.body.neckR, eyes: 0, padding: 7, blend: 16 };

const ROBOT = [
  {
    id: 'frog',
    prompt: 'i want it to look like a tiny frog',
    block: 'looks like a tiny frog', hue: 'teal', glyph: 'triangle',
    ref: 'frog',
    // low and squat: a soft, round skin around the parts, the screen sinks onto
    // it and two eyes pop up on top
    steps: [
      { at: 0, dur: 900, pose: { wheelHalfTrack: 66, wheelY: -20 } },
      { at: 150, dur: 1000, shape: { padding: 11, blend: 22 } }, // a soft, round skin
      { at: 350, dur: 1000, pose: { screenX: 0, screenY: 50 } },
      { at: 1000, dur: 700, shape: { eyes: 1 } },
    ],
  },
  {
    id: 'walle',
    prompt: 'i want it to look like wall-e',
    block: 'looks like wall-e', hue: 'magenta', glyph: 'diamond',
    ref: 'walle',
    // wide stance, slim waist, head lifted on a long thin neck
    steps: [
      { at: 0, dur: 1000, pose: { wheelHalfTrack: 92, wheelY: -12 } },
      { at: 100, dur: 900, shape: { eyes: 0, padding: 4, blend: 10 } }, // a tight, mechanical skin
      { at: 400, dur: 1200, pose: { screenX: 0, screenY: 98 } },
      { at: 400, dur: 1000, shape: { neckR: 12 } },
    ],
  },
  {
    id: 'face',
    prompt: 'i want it to have a face',
    block: 'has a face', glyph: 'dot', blockOnly: true,
    steps: [
      { at: 0, face: true },
    ],
  },
  {
    id: 'speak',
    prompt: 'i want this thing to speak',
    block: 'can speak', hue: 'red', glyph: 'ring',
    steps: [
      { at: 0, add: 'speaker' },
    ],
  },
  {
    id: 'reset',
    prompt: 'start over',
    ghost: true,
    reset: true,
    steps: [
      { at: 0, clear: true },
      { at: 0, face: false, blocksOnly: true },   // (the block prompt: the face is a piece of its own)
      { at: 0, face: true, chipsOnly: true },
      { at: 0, dur: 1000, shape: DEFAULT_SHAPE },
      { at: 150, dur: 1100, pose: DEFAULT_POSE },
    ],
  },
];

const SPEAKER_BOX = [
  {
    id: 'face',
    prompt: 'i want it to have a face',
    block: 'has a face', hue: 'teal', glyph: 'dot',
    // a screen goes on the front, above the speaker (a level of its own in a totem)
    steps: [
      { at: 0, face: true },
    ],
  },
  {
    id: 'two',
    prompt: 'i want to control bass and volume',
    chipOnly: true,   // (the main page's chip; the block prompt has one piece per knob)
    steps: [
      { at: 0, add: 'knob', always: true },
    ],
  },
  {
    id: 'bass',
    prompt: 'i want to control the bass',
    block: 'lets me control bass', glyph: 'square', blockOnly: true,
    steps: [
      { at: 0, add: 'knob', always: true, role: 'bass' },   // one knob each: bass and volume together make two
    ],
  },
  {
    id: 'volume',
    prompt: 'i want to control the volume',
    block: 'lets me control volume', glyph: 'triangle', blockOnly: true,
    steps: [
      { at: 0, add: 'knob', always: true, role: 'volume' },
    ],
  },
  {
    id: 'reset',
    prompt: 'start over',
    ghost: true,
    reset: true,
    steps: [
      { at: 0, clear: true },
      { at: 0, face: false },
      { at: 0, moves: false },
      { at: 0, form: 'free' },
      { at: 0, dur: 1000, shape: BOX_SHAPE },
      { at: 700, add: 'speaker' },
      { at: 1500, add: 'knob', base: true },   // (not with the block prompt: there every knob comes from a prompt)
    ],
  },
];


/** Prompts per case: 1 robot, 2 speaker box. */
export const PRESETS = { robot: ROBOT, speaker: SPEAKER_BOX };
const CASES = [['robot', 'case 1 · robot'], ['speaker', 'case 2 · speaker']];

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Builds the prompt UI (typed line + chips) and runs the choreography.
 * @param {{ extras, body, nodes }} deps
 */
export function createPrompts({ extras, body, nodes }) {
  // the prompt being "typed", large, at the top
  const root = document.createElement('div');
  root.id = 'prompt';
  root.innerHTML = '<span class="caret">›</span><span class="typed"></span><span class="cursor"></span>';
  document.body.appendChild(root);
  const typed = root.querySelector('.typed');

  // the guided choices, small, at the bottom
  const chips = document.createElement('div');
  chips.id = 'chips';
  document.body.appendChild(chips);

  function buildChips() {
    chips.innerHTML = '';
    for (const p of PRESETS[state.kind].filter((q) => !q.blockOnly)) {
      const b = document.createElement('button');
      b.textContent = p.prompt;
      if (p.ghost) b.classList.add('ghost');
      b.addEventListener('click', () => run(p));
      chips.appendChild(b);
    }
  }
  buildChips();

  // case 1 / case 2 switch, top left
  const cases = document.createElement('div');
  cases.id = 'casetoggle';
  cases.innerHTML = CASES.map(([k, label]) => `<button data-case="${k}">${label}</button>`).join('');
  document.body.appendChild(cases);
  const markCase = () => cases.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.case === state.kind));
  markCase();
  cases.addEventListener('click', (e) => {
    const k = e.target.closest('[data-case]')?.dataset.case;
    if (k && k !== state.kind && !busy) setCase(k);
  });

  // case 2: the skin's shape is picked in the "shape" tool node (ui/nodes.js), which calls setForm
  const markForm = () => document.body.classList.toggle('kind-speaker', state.kind === 'speaker');
  markForm();
  nodes.onShape = (k) => { if (!busy) setForm(k); };

  /** Change the case-2 shape: the speaker and the knobs move to its spots. The totem re-rolls on every click. */
  function setForm(k) {
    if (k === state.shape && k !== 'totem') return;
    const pick = () => TOTEM_POOL[Math.floor(Math.random() * TOTEM_POOL.length)];
    const base = TOTEM_BASE[Math.floor(Math.random() * TOTEM_BASE.length)];
    setShape2(k, k === 'totem' ? [base, ...Array.from({ length: 7 }, pick)] : null);
    markForm();
    body.scan(1.0);
    pulseAtObject();
    schedule(40, placeAll);
  }

  /** Every add-on to its spot: chosen by the primitive itself, or the free skin's front spots. */
  function placeAll() {
    const knobs = state.extras.filter((e) => e.type === 'knob');
    const nk = knobs.length;
    // the main knob (its prompt beside the root) first: it takes the front
    const main = knobs.find((e) => e.role && e.role === state.mainKnob);
    state.knobFront = !!main;
    const order = main ? [main, ...knobs.filter((e) => e !== main)] : knobs;
    const spk = state.extras.find((e) => e.type === 'speaker');
    for (const e of knobs) if (e !== main || state.shape !== 'free') e.anchor = undefined;
    if (state.shape !== 'free') {
      const spots = shapeSpots(nk);
      if (!spots) return;
      if (spk && spots[0]) updateExtra(spk.id, { p: spots[0].p, n: spots[0].n });
      order.forEach((e, i) => { const sp = spots[1 + i]; if (sp) updateExtra(e.id, { p: sp.p, n: sp.n }); });
      return;
    }
    const at = (x, y) => frontPoint(...stretchPoint(x, y));
    if (spk) { const hit = at(...FREE_SLOTS.speaker); if (hit) updateExtra(spk.id, { p: hit.p, n: hit.n }); }
    if (main) {
      // the free skin: on the front, beside the speaker (where a knob has always been); the others on
      // the sides (left first: the main one is on the right), mid-depth. (Primitives: under the speaker, parts.js)
      const hit = at(...FREE_SLOTS.knobs[0][0]);
      if (hit) updateExtra(main.id, { p: hit.p, n: hit.n });
      const right = true;   // (the main knob's side: the others start on the other one)
      order.slice(1).forEach((e, i) => {
        const sx = (i % 2 ? -1 : 1) * (right ? -1 : 1);
        const r = snapRay([sx * 400, -6, -24], [-sx, 0, 0], 0);
        if (r.attached) updateExtra(e.id, { p: r.p, n: r.n });
      });
      return;
    }
    const ks = freeKnobSpots(nk);
    order.forEach((e, i) => {
      const spot = ks[i];
      const hit = spot && at(spot[0], spot[1]);
      if (hit) updateExtra(e.id, { p: hit.p, n: hit.n });
    });
  }

  /** Swap the whole object: clear the add-ons, switch the parts, settle into the case's defaults. */
  function setCase(kind) {
    tweens = [];
    timers = [];
    extras.clear();
    nodes.reset();
    typed.textContent = '';
    state.wheels.linked = true;
    state.withScreen = false;   // a fresh speaker box starts without a screen
    state.moves = false;
    state.wheelSpread = 0;
    state.screenSpot = 'top';
    state.mainKnob = null;
    state.knobFront = false;
    setKind(kind);
    markCase();
    markForm();
    buildChips();
    blocks?.rebuild();
    body.scan(1.3);
    pulseAtObject();
    if (kind === 'robot') {
      state.withScreen = true;   // the robot has its face (on the cross page it is the 'has a face' piece, attached)
      setShape(DEFAULT_SHAPE);
      setPose(DEFAULT_POSE);
      if (blocks) schedule(300, () => blocks.attachById('face'));
    } else {
      setShape(BOX_SHAPE);
      // the speaker comes in once the old add-ons are gone
      schedule(650, () => { if (extras.count('speaker') === 0) extras.spawn('speaker'); });
      schedule(1400, placeAll);
      if (!blocks) schedule(1500, () => { if (extras.count('knob') === 0) extras.spawn('knob'); });
    }
  }

  /** Put the speaker at (x, y) on the front of the skin. */
  function placeSpeaker([x, y]) {
    const e = state.extras.find((x) => x.type === 'speaker');
    const hit = e && frontPoint(x, y);
    if (hit) updateExtra(e.id, { p: hit.p, n: hit.n });
  }

  let tweens = [];   // active tweens: { t, dur, from, to, kind }
  let timers = [];   // pending one-shot actions: { t, fn }
  let busy = false;

  /** Type the prompt, then play its steps. */
  function run(preset) {
    if (busy) return;
    busy = true;
    chips.classList.add('busy');
    cases.classList.add('busy');
    typed.textContent = '';
    root.classList.remove('done');

    const text = preset.prompt;
    const perChar = 26; // ms
    [...text].forEach((ch, i) => schedule(i * perChar, () => (typed.textContent += ch)));
    const start = text.length * perChar + 260; // short "thinking" pause

    let end;
    if (preset.ref) {
      // open the references node and offer the image; the shape waits for the drop
      schedule(start, () => {
        nodes.showReferences();
        nodes.offerImage(preset.ref);
      });
      end = start + 400;
    } else {
      if (preset.reset) schedule(start, () => {
        nodes.reset();
        // pixel 3d: a fresh palette, never the same one twice in a row
        const n = CONFIG.pixel3d.palettes.length;
        params.palette3d = (params.palette3d + 1 + Math.floor(Math.random() * (n - 1))) % n;
        // density: a new colour for the shape too (never the same one twice in a row)
        const D = CONFIG.density, dn = D.palettes.length;
        D.palette = (D.palette + 1 + Math.floor(Math.random() * (dn - 1))) % dn;
      });
      end = play(preset.steps, start);
    }
    schedule(end, () => {
      busy = false;
      chips.classList.remove('busy');
      cases.classList.remove('busy');
      root.classList.add('done');
      pulseAtObject();
    });
  }

  /** Schedule a preset's steps from `start` ms; returns when they end. */
  function play(steps, start = 0) {
    schedule(start, () => {
      body.scan(1.3);
      pulseAtObject();
    });
    let end = start;
    for (const s of steps) {
      const at = start + s.at;
      if (s.pose || s.shape) {
        schedule(at, () => tweens.push({ t: 0, dur: s.dur, kind: s.pose ? 'pose' : 'shape', to: s.pose ?? s.shape, from: null }));
        end = Math.max(end, at + s.dur);
      }
      if (s.move) {
        schedule(at, () => tweens.push({ t: 0, dur: s.dur, kind: 'move', type: s.move, to: s.to, from: null }));
        end = Math.max(end, at + s.dur);
      }
      if ((s.blocksOnly && !blocks) || (s.chipsOnly && blocks)) continue;
      if (s.add && !(s.base && blocks)) {
        schedule(at, () => {
          if (!(s.always || extras.count(s.add) === 0)) return;
          extras.spawn(s.add);
          if (s.role) { const e = state.extras.at(-1); if (e?.type === s.add) e.role = s.role; }   // (which prompt it answers)
        });
        if (state.kind === 'speaker') schedule(at + 120, placeAll);
        end = Math.max(end, at + 900);
      }
      if (s.clear) schedule(at, () => extras.clear());
      if (s.form) schedule(at, () => setForm(s.form));
      if (s.moves !== undefined) {
        schedule(at, () => { setMoves(s.moves); schedule(60, placeAll); });
        end = Math.max(end, at + 700);
      }
      if (s.face !== undefined) {
        schedule(at, () => { setWithScreen(s.face); schedule(60, placeAll); });
        end = Math.max(end, at + 700);
      }
    }
    return end;
  }

  /** A reference reached the object: take its shape. */
  function applyReference(id) {
    const preset = PRESETS.robot.find((p) => p.ref === id);
    if (preset) play(preset.steps);
  }

  function schedule(ms, fn) {
    timers.push({ t: ms, fn });
  }

  function pulseAtObject() {
    const [x, y] = view.project(0, CONFIG.viewCenterY, 0);
    body.ripple(x, y);
  }

  function update(dt) {
    blocks?.update(dt);
    const ms = dt * 1000;

    // one-shot actions
    const due = [];
    timers = timers.filter((tm) => {
      tm.t -= ms;
      if (tm.t <= 0) { due.push(tm); return false; }
      return true;
    });
    due.forEach((tm) => tm.fn());

    // tweens
    if (!tweens.length) return;
    const pose = {}, shape = {};
    let move = null;
    tweens = tweens.filter((tw) => {
      if (tw.kind === 'move') {
        // an add-on slides over the front of the skin
        const e = state.extras.find((x) => x.type === tw.type);
        if (!e) return false;
        tw.from ??= [e.p[0], e.p[1]];
        tw.t += ms;
        const k = easeInOut(Math.min(1, tw.t / tw.dur));
        move = [lerp(tw.from[0], tw.to[0], k), lerp(tw.from[1], tw.to[1], k)];
        return tw.t < tw.dur;
      }
      if (!tw.from) {
        const cur = tw.kind === 'pose' ? getPose() : state.body;
        tw.from = Object.fromEntries(Object.keys(tw.to).map((k) => [k, cur[k]]));
      }
      tw.t += ms;
      const k = easeInOut(Math.min(1, tw.t / tw.dur));
      const out = tw.kind === 'pose' ? pose : shape;
      for (const key in tw.to) out[key] = lerp(tw.from[key], tw.to[key], k);
      return tw.t < tw.dur;
    });
    if (Object.keys(pose).length) {
      state.wheels.linked = true;
      setPose(pose);
    }
    if (Object.keys(shape).length) setShape(shape);
    if (move) placeSpeaker(move);
  }

  /* ---------- cross page: the prompt is built from blocks ("a thing that …") ---------- */

  const begin = () => { busy = true; chips.classList.add('busy'); cases.classList.add('busy'); blocks?.setBusy(true); };
  const finish = (at) => schedule(at, () => {
    busy = false; chips.classList.remove('busy'); cases.classList.remove('busy'); blocks?.setBusy(false);
    pulseAtObject();
  });
  /** A piece clicked into the sentence: its prompt plays (a reference is offered, as before). */
  function attachBlock(p) {
    begin();
    let end = 400;
    if (p.ref) { nodes.showReferences(); nodes.offerImage(p.ref); }
    else end = play(p.steps, 0);
    finish(end);
  }
  /** A piece left the sentence: back to the case's start (keeping the chosen shape), then every piece still in it. */
  function recompose(list) {
    begin();
    nodes.reset();
    const base = PRESETS[state.kind].find((q) => q.reset).steps.filter((s) => !s.form);
    let at = play(base, 0) + 120;
    for (const q of list) at = play(q.steps, at) + 120;
    finish(at);
  }
  /**
   * Prompt hierarchy: the prompt in line with the root is the main feature, and it shapes the object.
   * The face is always on the front: as the main feature the big matrix, otherwise a small OLED.
   * A knob as the main feature ('lets me control bass / volume'): that knob on the front too, centred
   * under the speaker; the other knob on a side.
   * No knob in line: the knobs as always (symmetric).
   */
  function applyMain(p) {
    const faceMain = !p || p.id === 'face';
    const knobMain = p && (p.id === 'bass' || p.id === 'volume') ? p.id : null;
    const type = faceMain ? 'matrix' : 'oled';
    const spot = 'top';   // the face is always on the front (main: the big matrix; otherwise the small OLED)
    if (type === state.screenType && spot === state.screenSpot && knobMain === state.mainKnob && !state.screenMount) return;
    state.mainKnob = knobMain;
    state.screenMount = null;   // the hierarchy changed: the prompts place it again
    setScreenType(type);
    setScreenSpot(spot);
    if (state.kind === 'speaker') { schedule(60, placeAll); schedule(400, placeAll); }   // (again once the shape has settled)
    body.scan(0.8);
  }
  const blocks = document.body.dataset.page === 'cross'
    ? createBlockPrompt({
      presets: () => PRESETS[state.kind].filter((q) => !q.reset && !q.chipOnly),
      onAttach: attachBlock,
      onChange: recompose,
      onFocus: applyMain,
      onReset: () => run(PRESETS[state.kind].find((q) => q.reset)),
      grid: () => body.dotGrid(),
      head: () => (state.kind === 'robot' ? 'a moving thing that' : 'a speaking thing that'),
    })
    : null;

  // the page opens on case 2 · speaker (the cross page: "a thing that lets me control volume")
  setCase('speaker');
  // the cross page opens on the hexagon and the whole sentence: 'has a face' in line (the main feature),
  // 'lets me control bass' above, 'lets me control volume' below (each joins once the last has played)
  if (blocks) {
    setForm('hexagon');
    const queue = ['face', 'volume', 'bass'];   // (the first is the main one; the others alternate below / above)
    const next = () => {
      if (!queue.length) return;
      if (busy) { schedule(150, next); return; }
      blocks.attachById(queue.shift());
      schedule(150, next);
    };
    schedule(1500, next);
  }

  return { update, run, applyReference, setCase, placeAll };
}
