import { CONFIG, SCREENS } from './config.js?v=202610021616';
import { layoutParts, LIBRARY, CABLES, minHalfTrack } from './parts.js?v=202610021616';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Single source of truth for the object's layout.
 * Positions are component CENTRES in object space (mm, y up).
 * The FluentCAD step should read this (or `snapshot()`), never the DOM.
 */
export const state = {
  kind: 'robot', // case 1 'robot' (wheels + screen) · case 2 'speaker' (a speaker box)
  shape: 'free', // case 2: 'free' (organic skin), a primitive (see SHAPES in parts.js) or 'totem'
  totem: [],     // case 2 totem: the shape of each level, bottom up (electronics, speaker, knobs)
  speakerPattern: 'rings', // hole pattern of the speaker grille (see speaker-patterns.js)
  speakerLib: 'speaker',   // which speaker: 'speaker' (Seeed 4Ω 5W) | 'speakerSmall' (Seeed 6Ω 2W)
  screenType: 'matrix',    // case 1 display: 'matrix' | 'oled' (CONFIG SCREENS)
  power: 'battery',        // energy source: 'battery' | 'wall'
  withScreen: false,       // case 2: a screen was added ('+ screen')
  // LED matrix 13 × 9: which LEDs are on, row by row from the top (starts as a quiet face)
  leds: Array.from({ length: 117 }, (_, i) => {
    const x = i % 13, y = Math.floor(i / 13);
    return ((y === 2 || y === 3) && (x === 3 || x === 9)) || (y === 6 && (x === 4 || x === 8)) || (y === 7 && x >= 5 && x <= 7);
  }),
  wheels: {
    linked: true, // symmetric by default
    left:  { x: -CONFIG.initial.wheelHalfTrack, y: CONFIG.initial.wheelY },
    right: { x:  CONFIG.initial.wheelHalfTrack, y: CONFIG.initial.wheelY },
  },
  screen: { x: CONFIG.initial.screenX, y: CONFIG.initial.screenY },
  /** Surface-mounted add-ons: { id, type, p:[x,y,z] contact point, n:[x,y,z] surface normal, angle } */
  extras: [],
  body: {
    padding: 6,  // mm of envelope around the real parts inside
    blend: 14,   // smooth-min radius in mm
    // shape intent (morphed by the guided prompts)
    neckR: CONFIG.body.neckR,         // neck radius toward the screen
    eyes: 0,                          // 0..1: two bumps on top of the screen
  },
};

/** Rendering-only tuning (not geometry). Edited by the debug panel. */
export const params = {
  highlight: null,  // key of the part hovered in the components list
  palette3d: 0,     // pixel 3d: which palette (changes at every "start over")
  look: 1,          // 1 = reference look (warm, card nodes, grey pixel 3d) · 2 = simple look (cool greys, plain nodes, colour pixel 3d)
  pixel3dGrey: true,  // pixel 3d: the pixelated shape in greys instead of colour (follows the look)
  view: 'pixel3d', // first view on opening;     // 'dots' | 'blocks' (visible outlines) | 'flat' / 'flat2' (coloured shapes, sketchy / clean) | 'pixel' (halftone mosaic)
  dotStyle: 'cloud', // 'cloud' (points on the surface, solid parts) | 'grid' (screen-space dithering)
  pitch: 2.4,       // dot spacing in mm, so it scales with the object
  dotSize: 0.72,    // max dot diameter as a fraction of the cell
  sizeByLight: 0.6, // 0 = all dots equal, 1 = dot size fully follows the lighting
  method: 'blue',   // 'bayer' | 'blue' | 'split'
  exposure: 1.0,    // overall brightness of the shading → dot density
  softness: 6,      // width of the near-silhouette halo in mm
  drift: 0.6,       // speed of the points' wandering
  cluster: 0.18,    // how strongly dots on the body gather into drifting clusters
  breathe: 0.5,     // surface breathing amplitude in mm
  rings: true,      // hollow rings on the body's undecided edge (the third level)
  ringAmount: 0.6,
  response: 3.2,    // body spring frequency, Hz (higher = snappier)
  wobble: 0.9,      // body spring damping ratio (1 = no overshoot)
  dotSpeed: 14,     // how fast dots grow / shrink in, 1/s
  reach: 9,         // mm the body swells toward a nearby cursor
};

const listeners = new Set();
/** Subscribe to geometry changes. Returns an unsubscribe fn. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(state)); }

/** Screen x must stay near the midpoint between the wheels. */
function clampScreen() {
  const L = CONFIG.limits;
  if (state.kind === 'speaker') {
    state.screen.x = clamp(state.screen.x, -45, 45);
    state.screen.y = clamp(state.screen.y, 20, 90);
    return;
  }
  const mid = (state.wheels.left.x + state.wheels.right.x) / 2;
  state.screen.x = clamp(state.screen.x, mid - L.screenXFromMid, mid + L.screenXFromMid);
  state.screen.y = clamp(state.screen.y, L.screenY[0], L.screenY[1]);
}

/**
 * Move one wheel. When linked, the other wheel mirrors it around x = 0.
 * @param {'left'|'right'} side
 */
export function moveWheel(side, x, y) {
  const L = CONFIG.limits;
  const sign = side === 'left' ? -1 : 1;
  // distance from the centre line; never closer than the two servos need
  const minHalf = Math.max(L.wheelHalfTrack[0], minHalfTrack(CONFIG.wheel.w / 2, state.body.padding));
  const half = clamp(sign * x, minHalf, L.wheelHalfTrack[1]);
  const w = state.wheels[side];
  w.x = sign * half;
  w.y = clamp(y, L.wheelY[0], L.wheelY[1]);

  if (state.wheels.linked) {
    const other = state.wheels[side === 'left' ? 'right' : 'left'];
    other.x = -w.x;
    other.y = w.y;
  }
  clampScreen();
  emit();
}

export function moveScreen(x, y) {
  state.screen.x = x;
  state.screen.y = y;
  clampScreen();
  emit();
}

/** Toggling the link re-symmetrises the wheels around the left one. */
export function setLinked(linked) {
  state.wheels.linked = linked;
  if (linked) moveWheel('left', state.wheels.left.x, state.wheels.left.y);
  else emit();
}

/** Speaker grille pattern and LED matrix drawing (no layout change, so no emit needed). */
export function setSpeakerPattern(name) { state.speakerPattern = name; }
export function setSpeakerLib(lib) { state.speakerLib = lib; emit(); }
export function setLed(i, on) { state.leds[i] = on; }

/** Case 2: add / remove a screen. */
export function setWithScreen(on) { state.withScreen = on; emit(); }

/** Energy source: battery or wall power. */
export function setPower(p) { state.power = p; emit(); }

/** Case 1: swap the display (its size flows everywhere through CONFIG.screen). */
export function setScreenType(type) {
  const sc = SCREENS[type];
  if (!sc) return;
  state.screenType = type;
  Object.assign(CONFIG.screen, { w: sc.w, h: sc.h, d: sc.d, r: sc.r, display: { ...sc.display } });
  clampScreen();
  emit();
}

/** Case 2: pick the skin's shape. */
export function setShape2(shape, totem) {
  state.shape = shape;
  if (totem) state.totem = totem;
  emit();
}

/** Switch between case 1 (robot) and case 2 (speaker box). */
export function setKind(kind) {
  state.kind = kind;
  clampScreen();
  emit();
}

export function setBody(key, value) {
  state.body[key] = value;
  emit();
}

let nextExtraId = 1;

/** Add a surface-mounted component at contact point p with surface normal n. */
/** On the speaker box's flat front, add-ons face straight ahead (like their modules: parts.js). */
export function mountNormal(n) {
  return state.kind === 'speaker' && n[2] > 0.6 ? [0, 0, 1] : n;
}

export function addExtra(type, p, n) {
  const e = { id: nextExtraId++, type, p: [...p], n: [...mountNormal(n)], angle: 0 };
  state.extras.push(e);
  emit();
  return e;
}

export function updateExtra(id, patch) {
  const e = state.extras.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  if (patch.n) e.n = mountNormal(patch.n);
  emit();
}

export function removeExtra(id) {
  const i = state.extras.findIndex((x) => x.id === id);
  if (i >= 0) state.extras.splice(i, 1);
  emit();
}

/** Set the symmetric pose at once (used by the guided prompts' tweens). */
export function setPose({ wheelHalfTrack, wheelY, screenX, screenY }) {
  const L = CONFIG.limits;
  const W = state.wheels;
  if (wheelHalfTrack != null) {
    const minHalf = Math.max(L.wheelHalfTrack[0], minHalfTrack(CONFIG.wheel.w / 2, state.body.padding));
    const h = clamp(wheelHalfTrack, minHalf, L.wheelHalfTrack[1]);
    W.left.x = -h;
    W.right.x = h;
  }
  if (wheelY != null) W.left.y = W.right.y = clamp(wheelY, L.wheelY[0], L.wheelY[1]);
  if (screenX != null) state.screen.x = screenX;
  if (screenY != null) state.screen.y = screenY;
  clampScreen();
  emit();
}

/** Current symmetric pose (averaged if the wheels are unlinked). */
export function getPose() {
  const W = state.wheels;
  return {
    wheelHalfTrack: (W.right.x - W.left.x) / 2,
    wheelY: (W.left.y + W.right.y) / 2,
    screenX: state.screen.x,
    screenY: state.screen.y,
  };
}

/** Merge body-shape values (padding, blend, neckR, eyes). */
export function setShape(patch) {
  Object.assign(state.body, patch);
  emit();
}

export function reset() {
  const I = CONFIG.initial;
  state.wheels.left.x = -I.wheelHalfTrack;
  state.wheels.right.x = I.wheelHalfTrack;
  state.wheels.left.y = state.wheels.right.y = I.wheelY;
  state.screen.x = I.screenX;
  state.screen.y = I.screenY;
  emit();
}

/**
 * Plain, serialisable description for downstream steps (FluentCAD):
 * positions + dimensions of every fixed component, plus body intent.
 */
export function snapshot() {
  const { wheel, screen } = CONFIG;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    units: 'mm',
    kind: state.kind,
    ...(state.kind === 'speaker' ? { shape: state.shape, ...(state.shape === 'totem' ? { totem: state.totem } : {}) } : {}),
    origin: 'midpoint between default axle positions, y up',
    wheels: {
      linked: state.wheels.linked,
      size: { w: wheel.w, h: wheel.h },
      left:  { x: r(state.wheels.left.x),  y: r(state.wheels.left.y) },
      right: { x: r(state.wheels.right.x), y: r(state.wheels.right.y) },
    },
    screen: {
      size: { w: screen.w, h: screen.h },
      display: { ...screen.display },
      x: r(state.screen.x),
      y: r(state.screen.y),
    },
    extras: state.extras.map((e) => ({
      id: e.id,
      type: e.type,
      spec: { ...CONFIG.extras[e.type] },
      contact: e.p.map(r),
      normal: e.n.map((v) => Math.round(v * 1000) / 1000),
      angle: Math.round(e.angle),
      ...(e.sound ? { sound: { ...e.sound } } : {}),
      ...(e.type === 'speaker' ? { pattern: state.speakerPattern } : {}),
    })),
    ...(() => {
      const L = layoutParts({
        kind: state.kind,
        screen: state.screenType,
        withScreen: state.withScreen,
        speakerLib: state.speakerLib,
        power: state.power,
        shape: state.shape,
        totem: state.totem,
        knobCount: state.extras.filter((e) => e.type === 'knob').length,
        wl: [state.wheels.left.x, state.wheels.left.y],
        wr: [state.wheels.right.x, state.wheels.right.y],
        scr: [state.screen.x, state.screen.y],
        pad: state.body.padding,
        neckR: state.body.neckR,
        extras: state.extras.map((e) => ({ type: e.type, p: e.p, n: e.n, scale: 1 })),
        wheelHalfW: CONFIG.wheel.w / 2,
        screenHalfH: CONFIG.screen.h / 2,
      });
      return {
        // library parts only; everything else in the object is provisional
        components: L.parts.map((p) => ({
          key: p.key,
          part: LIBRARY[p.lib].name,
          ...(LIBRARY[p.lib].url ? { url: LIBRARY[p.lib].url } : {}),
          center: p.c.map(r),
          size: LIBRARY[p.lib].size,
          axes: p.R.map((v) => Math.round(v * 1000) / 1000),
          ...(LIBRARY[p.lib].inLibrary === false ? { inLibrary: false, why: LIBRARY[p.lib].why } : {}),
        })),
        cables: L.cables.map((c) => ({ cable: CABLES[c.kind].name, from: c.from, to: c.to, ...(CABLES[c.kind].inLibrary === false ? { inLibrary: false } : {}) })),
        provisional: ['skin / enclosure', ...(state.kind === 'speaker' ? [] : ['wheels Ø90×30']), ...(state.extras.some((e) => e.type === 'knob') ? ['knob caps'] : [])],
      };
    })(),
    power: state.power,
    ...(state.kind === 'robot' || state.withScreen ? { screenType: state.screenType } : {}),
    ...(state.kind === 'robot' && state.screenType === 'matrix' ? { screenPixels: Array.from({ length: 9 }, (_, y) => state.leds.slice(y * 13, y * 13 + 13).map((v) => (v ? '#' : '.')).join('')) } : {}),
    body: { ...CONFIG.body, ...state.body },
  };
}

// handy for inspection from the console
if (typeof window !== 'undefined') window.objectState = { state, snapshot };
