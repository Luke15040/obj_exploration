/**
 * The real components inside the object: what they are, how big they are,
 * where their connectors sit, how they are laid out without touching, and the
 * cables between them.
 *
 * Every part has a detailed model in body/glsl-parts.js; `size` here is its
 * bounding box (mm, local frame), from the makers' specs. The provisional body
 * (the dot cloud) is an envelope grown around these boxes.
 *
 * `inLibrary: false` marks the few parts added because the library alone can't
 * work (a battery, and a 5 V regulator for the brain).
 */

export const LIBRARY = {
  servo: {
    name: 'FEETECH STS3215 servo',
    type: 0,
    // Feetech drawing: 45.23 × 24.73; 36.5 along the shaft axis (spline + rear hub included).
    // Local x = output shaft (toward the wheel), y = width, z = length
    size: [36.5, 24.73, 45.23],
    shaftZ: 12.5, // output shaft offset from the body centre, along the length
    connectors: { bus: { p: [-18.2, 4.6, -0.5], d: [-1, 0, 0] } }, // 5264 3-pin, underside
  },
  feather: {
    name: 'Adafruit ESP32-S3 Feather (4MB flash / 2MB PSRAM)',
    url: 'https://www.adafruit.com/product/5477',
    type: 1,
    size: [52.3, 7.2, 22.7], // lying flat: length, height, width
    connectors: {
      usb: { p: [-28.0, -0.4, 0], d: [-1, 0, 0] },
      qt: { p: [-9.5, -0.5, 11.6], d: [0, 0, 1] },
      uart: { p: [8.0, -2.0, -10.1], d: [0, 1, 0] },   // TX/RX header pads
      vbus: { p: [-20.0, -2.0, 10.1], d: [0, 1, 0] },  // 5 V in
    },
  },
  piZero: {
    name: 'Raspberry Pi Zero 2 W (pre-soldered headers)',
    url: 'https://www.adafruit.com/product/6008',
    type: 2,
    size: [65, 10, 30], // 65 × 30 board; height includes the header pins
    connectors: {
      pwr: { p: [21.5, -2.3, -16.5], d: [0, 0, -1] },  // micro USB PWR IN
      usb: { p: [8.9, -2.3, -16.5], d: [0, 0, -1] },   // micro USB data (OTG)
    },
  },
  respeaker: {
    name: 'ReSpeaker 2-Mics Pi HAT',
    url: 'https://www.seeedstudio.com/ReSpeaker-2-Mics-Pi-HAT.html',
    type: 3,
    size: [65, 15, 30], // 65 × 30 × 15, including the female header it sits on
    connectors: {
      spk: { p: [13.5, 4.4, 11.4], d: [0, 0, 1] },     // JST speaker out
      grove: { p: [-20.0, 5.1, 9.7], d: [0, 0, 1] },   // Grove I2C
    },
  },
  speaker: {
    name: 'Seeed mono enclosed speaker 4Ω 5W',
    url: 'https://www.seeedstudio.com/Mono-Enclosed-Speaker-4R-5W-p-5931.html',
    type: 4,
    size: [50, 45, 22], // local z = facing out through the hole pattern
    connectors: { lead: { p: [0, -16, -12.6], d: [0, 0, -1] } },
  },
  encoder: {
    name: 'Adafruit I2C STEMMA QT rotary encoder with NeoPixel',
    url: 'https://www.adafruit.com/product/5880',
    type: 5,
    size: [25.4, 25.4, 15.1], // board 1.6 + PEC11R body 6.5 + M7 bushing 7; the Ø6 shaft runs 13 more to the knob
    // two STEMMA QT ports on opposite edges: in from the bus, out to the next knob
    connectors: { qtIn: { p: [-12.9, 0, -4.45], d: [-1, 0, 0] }, qtOut: { p: [12.9, 0, -4.45], d: [1, 0, 0] } },
  },
  matrix: {
    name: 'Adafruit IS31FL3741 13×9 RGB LED matrix (STEMMA QT)',
    url: 'https://www.adafruit.com/product/5201',
    type: 6,
    size: [51.3, 39.0, 4.6], // local z = LEDs facing out
    connectors: {
      qtIn: { p: [-19, -14, -2.5], d: [0, 0, -1] },
      qtOut: { p: [19, -14, -2.5], d: [0, 0, -1] },
    },
  },
  servoAdapter: {
    name: 'Waveshare Bus Servo Adapter (A)',
    url: 'https://www.waveshare.com/bus-servo-adapter-a.htm',
    type: 7,
    size: [42, 12, 33], // 42 × 33 board; ≈ 12 tall with the DC jack
    connectors: {
      servoA: { p: [4, -1.4, 10.5], d: [0, 1, 0] },
      servoB: { p: [4, -1.4, -10.5], d: [0, 1, 0] },
      power: { p: [-17, 0.6, 7], d: [0, 1, 0] },       // screw terminal, 9–12.6 V
      uart: { p: [12, 3.6, 0], d: [0, 1, 0] },
      usb: { p: [23.4, -2.8, 0], d: [1, 0, 0] },
    },
  },
  pdTrigger: {
    name: 'USB-C PD trigger module (5/9/12/15/20 V DIP switch)',
    url: 'https://www.amazon.com/dp/B0FNVBNNP1',
    type: 8,
    size: [28, 4.5, 11], // not used while a battery powers the object
    connectors: {},
  },
  battery: {
    name: 'Tattu 850 mAh 3S 11.1 V LiPo (XT30)',
    url: 'https://genstattu.com/tattu-850mah-11-1v-75c-3s1p-lipo-battery-pack-with-xt30-plug.html',
    type: 9,
    inLibrary: false,
    why: 'the servos need 9–12.6 V on the move; 3S fits the bus adapter exactly',
    size: [60, 23, 30], // L × H × W
    connectors: {
      xt30: { p: [-31, 5, -7], d: [-1, 0, 0] },
      balance: { p: [-31, 5, 7], d: [-1, 0, 0] }, // for charging only
    },
  },
  buck: {
    name: 'Pololu 5 V 3.2 A step-down regulator D36V28F5',
    url: 'https://www.pololu.com/product/3782',
    type: 10,
    inLibrary: false,
    why: 'the brain needs 5 V from the 3S battery',
    size: [17.8, 8.8, 20.3],
    connectors: {
      vin: { p: [-6.35, -2.0, -10.4], d: [0, 0, -1] },
      vout: { p: [6.35, -2.0, -10.4], d: [0, 0, -1] },
    },
  },
};

/** Cables the parts need. */
export const CABLES = {
  servoBus: { code: 0, name: 'servo bus cable, 5264 3-pin (comes with the servo)', r: 1.1, albedo: 0.22 },
  qt: { code: 1, name: 'STEMMA QT cable, JST SH 4-pin', r: 1.0, albedo: 0.55 },
  power: { code: 2, name: '3S power leads, AWG16 (XT30)', r: 1.3, albedo: 0.3 },
  power5: { code: 3, name: '5 V leads', r: 0.9, albedo: 0.3 },
  uart: { code: 4, name: 'UART jumper wires', r: 0.8, albedo: 0.45 },
  usb: { code: 5, name: 'USB-C ↔ micro USB cable', r: 1.6, albedo: 0.25 },
  speaker: { code: 6, name: 'speaker lead, JST PH 2.0', r: 0.9, albedo: 0.25 },
  groveQt: {
    code: 7,
    name: 'Grove → STEMMA QT cable (Adafruit 4528)',
    url: 'https://www.adafruit.com/product/4528',
    inLibrary: false,
    why: 'the ReSpeaker HAT covers the Pi header, so the matrix plugs into its Grove I2C port',
    r: 1.0,
    albedo: 0.55,
  },
};

export const MAX_PARTS = 12;
export const MAX_CABLES = 12;
export const CABLE_POINTS = 8;
const CLEARANCE = 3; // mm kept free between parts

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MIRROR_X = [-1, 0, 0, 0, 1, 0, 0, 0, 1]; // left-hand copy of a part
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rot = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

/** Rotation whose local z is n (columns: u, v, n), same basis convention as the shaders. */
function frameFromNormal(n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, a));
  const v = cross(n, u);
  return [...u, ...v, ...n];
}

/** World-space half extents of an oriented box. */
function extents(part) {
  const { R, h } = part;
  return [0, 1, 2].map((k) => Math.abs(R[k]) * h[0] + Math.abs(R[3 + k]) * h[1] + Math.abs(R[6 + k]) * h[2]);
}

/** World position and direction of a part's connector. */
export function connectorOf(part, name) {
  const c = LIBRARY[part.lib].connectors[name];
  const p = rot(part.R, c.p.map((v) => v * part.scale));
  return { p: p.map((v, k) => v + part.c[k]), d: rot(part.R, c.d) };
}

/** A cable as a smooth curve leaving each connector along its direction (optionally through a via point). */
function route(a, b, via = null) {
  const bez = (p0, c1, c2, p1, t) => { const u = 1 - t; return [0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k]); };
  const len3 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  if (!via) {
    const L = Math.min(28, Math.max(6, len3(a.p, b.p) * 0.4));
    const c1 = a.p.map((v, k) => v + a.d[k] * L), c2 = b.p.map((v, k) => v + b.d[k] * L);
    return Array.from({ length: CABLE_POINTS }, (_, i) => bez(a.p, c1, c2, b.p, i / (CABLE_POINTS - 1)));
  }
  // two halves meeting smoothly at the via point (4 + 4 points)
  const dv = b.p.map((v, k) => v - a.p[k]), dl = Math.hypot(...dv) || 1, vd = dv.map((v) => v / dl);
  const La = Math.min(28, Math.max(6, len3(a.p, via) * 0.45)), Lb = Math.min(28, Math.max(6, len3(via, b.p) * 0.45));
  const h1 = [a.p, a.p.map((v, k) => v + a.d[k] * La), via.map((v, k) => v - vd[k] * La), via];
  const h2 = [via, via.map((v, k) => v + vd[k] * Lb), b.p.map((v, k) => v + b.d[k] * Lb), b.p];
  return [0, 1 / 3, 2 / 3].map((t) => bez(...h1, t)).concat([via], [1 / 3, 2 / 3, 1].map((t) => bez(...h2, t))).concat([b.p]).slice(0, CABLE_POINTS);
}

/**
 * Place the parts for a given pose, push the free ones apart until nothing is
 * closer than CLEARANCE mm to anything else, then run the cables.
 * @param {object} s
 *   wl, wr: [x, y] wheel centres · scr: [x, y] screen centre · pad: envelope thickness (mm)
 *   extras: [{ type, p, n, scale }] mounted add-ons
 *   wheelHalfW, screenHalfH: from CONFIG
 *   kind: 'robot' (case 1, default) | 'speaker' (case 2: a speaker box, no wheels)
 *   shape (case 2): one of SHAPES · knobCount: knobs to make room for (primitives)
 * @returns {{ parts, chassis, neck, cables, offsets }}
 *   offsets[i] = how far add-on i had to slide out along its normal to clear the parts
 *   part = { key, lib, type, c, h, R, env, scale, fixed, group }
 *   cable = { kind, from, to, points }
 */
/**
 * Case 2 shapes: "free" is the organic skin grown around the parts; the others
 * are primitive profiles extruded front-to-back (flat front at z = 0). On a
 * primitive the add-ons place themselves: the speaker on the front, each knob on
 * its own face (top first, then the sides), and the shape grows until every
 * module fits without touching anything.
 */
export const SHAPES = ['free', 'box', 'cylinder', 'prism', 'hexagon', 'pentagon', 'octagon', 'dome'];
// shapes a random totem is built from
// (every level rests on a flat face, so no round profiles: the cylinder stays out)
export const TOTEM_POOL = ['box', 'hexagon', 'octagon', 'prism', 'pentagon', 'dome'];
// flat on top and bottom: the only shapes something else can stand on
const FLAT_BOTH = ['box', 'hexagon', 'octagon'];
// the bottom level holds all the electronics: only shapes that stay compact around a wide block
export const TOTEM_BASE = FLAT_BOTH;
// regular polygons: [sides, angle of the first side's normal]
const POLY = { prism: [3, -Math.PI / 2], hexagon: [6, Math.PI / 6], pentagon: [5, -Math.PI / 2], octagon: [8, 0] };
// free skin only: spots on the front; knobs[n - 1] = the spots when there are n knobs
export const FREE_SLOTS = { speaker: [0, 0], knobs: [[[42, -6]], [[42, -6], [-42, -6]]] };
export const freeKnobSpots = (n) => (n > 0 ? FREE_SLOTS.knobs[Math.min(n, 2) - 1] : []);

const ENC = LIBRARY.encoder.size;
const TOTEM_MID = 30;   // height the totem is centred on (the camera looks around here)
const TOTEM_DEPTH = 62; // minimum depth of every totem level, mm

/** The primitive skin around the given xy rectangles: smallest of its kind (+ wall). */
function fitPrimitive(shape, rects, zBack, wall) {
  const pts = rects.flatMap((r) => [[r.lo[0], r.lo[1]], [r.hi[0], r.lo[1]], [r.lo[0], r.hi[1]], [r.hi[0], r.hi[1]]]);
  const lo = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
  const hi = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
  const z = [0, zBack];
  if (shape === 'box') return { kind: 1, c, h: [(hi[0] - lo[0]) / 2 + wall, (hi[1] - lo[1]) / 2 + wall], a: 0, n: 0, rot: 0, z, round: 6 };
  if (shape === 'dome') {
    // half a disc on a flat base: the centre sits on the content's bottom
    const a = Math.max(...pts.map(([x, y]) => Math.hypot(x - c[0], y - lo[1])));
    return { kind: 4, c: [c[0], lo[1]], h: [0, wall], a: a + wall, n: 0, rot: 0, z, round: 3 };
  }
  // circle / regular polygon: inradius needed around the points, best centre height found by search
  const [n, rot] = POLY[shape] ?? [0, 0];
  const need = (cy) => Math.max(...pts.map(([x, y]) => {
    const q = [x - c[0], y - cy];
    if (!n) return Math.hypot(q[0], q[1]);
    let m = -Infinity;
    for (let k = 0; k < n; k++) { const an = rot + (2 * Math.PI * k) / n; m = Math.max(m, q[0] * Math.cos(an) + q[1] * Math.sin(an)); }
    return m;
  }));
  let best = c[1], bestA = need(c[1]);
  for (let dy = -40; dy <= 40; dy += 1) { const a = need(c[1] + dy); if (a < bestA) { bestA = a; best = c[1] + dy; } }
  return { kind: n ? 3 : 2, c: [c[0], best], h: [0, 0], a: bestA + wall, n, rot, z, round: 3 };
}

/** Lowest and highest y of a primitive's profile. */
function profileY(P) {
  if (P.kind === 1) return [P.c[1] - P.h[1], P.c[1] + P.h[1]];
  if (P.kind === 2) return [P.c[1] - P.a, P.c[1] + P.a];
  if (P.kind === 4) return [P.c[1] - P.h[1], P.c[1] + P.a];
  const R = P.a / Math.cos(Math.PI / P.n);
  const ys = Array.from({ length: P.n }, (_, k) => P.c[1] + R * Math.sin(P.rot + Math.PI / P.n + (2 * Math.PI * k) / P.n));
  return [Math.min(...ys), Math.max(...ys)];
}

/**
 * A random totem: a stack of primitives, each with one job — the electronics at the
 * bottom, then the speaker, then one per knob — every add-on on its shape's front.
 */
function totemLayout(shapes, content, knobCount, pad) {
  const wall = pad, overlap = 2;
  const levels = 2 + knobCount;
  // only the top level may have a point or a dome; every other one is flat on both sides
  const shapeAt = (i) => {
    const k = shapes[i % shapes.length];
    return i === levels - 1 || FLAT_BOTH.includes(k) ? k : FLAT_BOTH[(i + k.length) % FLAT_BOTH.length];
  };
  // all levels share one generous depth: a solid stack, not cut-outs
  const zBack = Math.min(Math.min(...content.map((b) => b.lo[2])) - pad, -(LIBRARY.speaker.size[2] + 2 * pad), -TOTEM_DEPTH);
  const prims = [], spots = [];
  const flat = (b) => ({ lo: [b.lo[0], b.lo[1]], hi: [b.hi[0], b.hi[1]] });
  const base = fitPrimitive(shapeAt(0), content.map(flat), zBack, wall);
  prims.push(base);
  let top = profileY(base)[1];
  const stack = (shape, w, h, type) => {
    const P = fitPrimitive(shape, [{ lo: [-w / 2, -h / 2], hi: [w / 2, h / 2] }], zBack, wall);
    const dy = top - overlap - profileY(P)[0];          // stands flush on the flat top below
    P.c = [P.c[0], P.c[1] + dy];
    prims.push(P);
    spots.push({ type, p: [0, dy, 0], n: [0, 0, 1] });
    top = profileY(P)[1];
  };
  const sp = LIBRARY.speaker.size;
  stack(shapeAt(1), sp[0], sp[1], 'speaker');
  for (let i = 0; i < knobCount; i++) stack(shapeAt(2 + i), ENC[0] + 4, ENC[1] + 4, 'knob');
  // centre the whole stack in height (dy: how much everything moved)
  const dy = TOTEM_MID - (profileY(base)[0] + top) / 2;
  for (const P of prims) P.c = [P.c[0], P.c[1] + dy];
  for (const s of spots) s.p = [s.p[0], s.p[1] + dy, s.p[2]];
  return { prims, spots, dy };
}

/** The faces a knob can go on, best first (up-facing first, never the bottom or the front). */
function primFaces(P) {
  const at = (an, r) => ({ n: [Math.cos(an), Math.sin(an)], p: [P.c[0] + Math.cos(an) * r, P.c[1] + Math.sin(an) * r] });
  if (P.kind === 1) return [
    { n: [0, 1], p: [P.c[0], P.c[1] + P.h[1]] },
    { n: [1, 0], p: [P.c[0] + P.h[0], P.c[1]] },
    { n: [-1, 0], p: [P.c[0] - P.h[0], P.c[1]] },
  ];
  if (P.kind === 2 || P.kind === 4) return [Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4, 0, Math.PI].map((an) => at(an, P.a));
  const faces = [];
  for (let k = 0; k < P.n; k++) faces.push(at(P.rot + (2 * Math.PI * k) / P.n, P.a));
  return faces.filter((f) => f.n[1] > -0.2);
}

/**
 * Which faces the knobs take, keeping the object symmetric: an odd count puts one
 * on top, the rest go in mirrored pairs (highest pair first); one knob and no top → right side.
 */
function chooseFaces(faces, count) {
  const r = (v) => Math.round(v * 100) / 100;
  const top = faces.find((f) => Math.abs(f.n[0]) < 0.01 && f.n[1] > 0.9);
  const pairs = [];
  for (const f of faces) {
    if (f.n[0] <= 0.01) continue;
    const m = faces.find((g) => r(g.n[0]) === r(-f.n[0]) && r(g.n[1]) === r(f.n[1]));
    if (m) pairs.push([f, m]);
  }
  pairs.sort((a, b) => b[0].n[1] - a[0].n[1]);
  const out = [];
  if (count % 2 === 1 && top) out.push(top);
  for (const [a, b] of pairs) { if (out.length < count) out.push(a); if (out.length < count) out.push(b); }
  while (out.length < count) out.push(out[out.length % Math.max(1, out.length)] ?? faces[0]);
  return out;
}

/**
 * Fit a primitive around the content and give every add-on a spot on it.
 * content: 3D boxes of the electronics · spk: 3D box of the speaker module (front, centre)
 * Returns { prim, spots: [{ type, p, n }] } — p on the surface, n its outward normal.
 */
function primLayout(shape, content, spk, knobCount, pad) {
  const wall = pad + 2;
  const zBack = Math.min(...content.map((b) => b.lo[2])) - pad;
  const zk = -(pad + ENC[0] / 2 + 3);                 // knobs on side faces sit near the front edge
  const clear3 = (a, b) => [0, 1, 2].some((k) => a.lo[k] - b.hi[k] >= CLEARANCE || b.lo[k] - a.hi[k] >= CLEARANCE);
  const flat = (b) => ({ lo: [b.lo[0], b.lo[1]], hi: [b.hi[0], b.hi[1]] });
  let need = [];     // xy points the profile must reach (outer corners of the knob modules)
  let prim, spots;
  for (let it = 0; it < 10; it++) {
    prim = fitPrimitive(shape, [...content.map(flat), flat(spk), ...need], zBack, wall);
    const faces = chooseFaces(primFaces(prim), knobCount);
    spots = [{ type: 'speaker', p: [0, 0, 0], n: [0, 0, 1] }];
    const mods = [];
    const next = [];
    for (let i = 0; i < knobCount; i++) {
      const f = faces[i];
      const n = [f.n[0], f.n[1], 0], t = [-f.n[1], f.n[0], 0];
      // a second knob on an already used face sits beside the first
      const side = faces.indexOf(f) < i ? (ENC[0] + 6) : 0;
      let surf = [f.p[0] + t[0] * side, f.p[1] + t[1] * side, zk];
      const d = ENC[2] / 2 + pad;
      const ext = [Math.abs(n[0]) * ENC[2] / 2 + Math.abs(t[0]) * ENC[0] / 2, Math.abs(n[1]) * ENC[2] / 2 + Math.abs(t[1]) * ENC[0] / 2, ENC[1] / 2];
      let box;
      for (let push = 0; push < 120; push += 1) {
        const c = surf.map((v, k) => v - n[k] * d);
        box = { lo: c.map((v, k) => v - ext[k]), hi: c.map((v, k) => v + ext[k]) };
        if ([...content, spk, ...mods].every((o) => clear3(box, o))) break;
        surf = surf.map((v, k) => v + n[k]);           // not enough room: further out
      }
      mods.push(box);
      spots.push({ type: 'knob', p: surf, n });
      // the profile must reach the surface point (minus the wall it adds)
      const q = [surf[0] - n[0] * wall, surf[1] - n[1] * wall];
      next.push({ lo: q, hi: q });
    }
    const moved = JSON.stringify(next.map((r) => r.lo.map((v) => Math.round(v * 10)))) !== JSON.stringify(need.map((r) => r.lo.map((v) => Math.round(v * 10))));
    need = next;
    if (!moved) break;
  }
  return { prim, spots };
}

export function layoutParts(s) {
  const parts = [];
  const add = (key, lib, c, opts = {}) => {
    const scale = opts.scale ?? 1;
    const part = {
      key, lib, type: LIBRARY[lib].type, c: c.slice(),
      h: LIBRARY[lib].size.map((v) => (v * scale) / 2),
      R: opts.R ?? IDENTITY, env: opts.env ?? 0, scale,
      fixed: !!opts.fixed, group: opts.group ?? key, rank: opts.rank ?? 0,
    };
    parts.push(part);
    return part;
  };
  // case 2: a speaker box — no wheels, no drive; the speaker and the knobs face front
  const box2 = s.kind === 'speaker';
  const shape = box2 ? (s.shape ?? 'free') : 'free';
  const prim = box2 && shape !== 'free';

  const yc = 0.5 * (s.wl[1] + s.wr[1]);
  const mid = 0.5 * (s.wl[0] + s.wr[0]);
  const servo = LIBRARY.servo.size;
  const speakers = s.extras.filter((e) => e.type === 'speaker' && e.scale > 0.02);
  const knobs = s.extras.filter((e) => e.type === 'knob' && e.scale > 0.02);

  let sL = null, sR = null, adapter = null, buck, brain, hat = null, battery, back;
  if (!box2) {
    // servos sit just inside each wheel, clear of it by the envelope thickness + 2 mm,
    // with the output shaft on the wheel axle (so the body reaches back behind it)
    const gap = s.wheelHalfW + s.pad + 2 + servo[0] / 2;
    back = -LIBRARY.servo.shaftZ;
    sL = add('servo-left', 'servo', [s.wl[0] + gap, s.wl[1], back], { R: MIRROR_X, fixed: true });
    sR = add('servo-right', 'servo', [s.wr[0] - gap, s.wr[1], back], { fixed: true });

    // electronics deck over the servos: bus adapter and 5 V regulator, the brain on top.
    // A speaker needs the ReSpeaker HAT, which needs a Pi header: the brain becomes a Pi Zero 2 W.
    const deckY = yc + servo[1] / 2 + CLEARANCE;
    adapter = add('servo-adapter', 'servoAdapter', [mid, deckY + LIBRARY.servoAdapter.size[1] / 2, back], { rank: 1 });
    // the regulator sits on the deck behind the adapter
    buck = add('regulator', 'buck', [mid, deckY + LIBRARY.buck.size[1] / 2,
      back - LIBRARY.servoAdapter.size[2] / 2 - CLEARANCE - LIBRARY.buck.size[2] / 2], { rank: 2 });
    const brainY = deckY + LIBRARY.servoAdapter.size[1] + CLEARANCE;
    if (speakers.length) {
      const pi = LIBRARY.piZero.size, hs = LIBRARY.respeaker.size;
      brain = add('brain', 'piZero', [mid, brainY + pi[1] / 2, back], { group: 'brain', rank: 3 });
      // the HAT's female header slides over the Pi's pins, so it starts on the Pi board
      hat = add('hat', 'respeaker', [mid, brainY + 1.4 + hs[1] / 2, back], { group: 'brain', rank: 3 });
    } else {
      brain = add('brain', 'feather', [mid, brainY + LIBRARY.feather.size[1] / 2, back], { group: 'brain', rank: 3 });
    }
    // battery lies flat behind the drive, low
    battery = add('battery', 'battery', [mid, yc - 2, back - servo[2] / 2 - CLEARANCE - LIBRARY.battery.size[2] / 2], { rank: 2 });
  } else if (shape === 'totem') {
    // totem: the electronics fill the bottom shape on their own, close behind its front
    back = -(s.pad + LIBRARY.battery.size[2] / 2);
    const bs = LIBRARY.battery.size, pi = LIBRARY.piZero.size, hs = LIBRARY.respeaker.size;
    battery = add('battery', 'battery', [0, bs[1] / 2, back], { rank: 1 });
    buck = add('regulator', 'buck', [bs[0] / 2 + CLEARANCE + LIBRARY.buck.size[0] / 2, LIBRARY.buck.size[1] / 2, back], { rank: 2 });
    const brainY = bs[1] + CLEARANCE;
    brain = add('brain', 'piZero', [0, brainY + pi[1] / 2, back], { group: 'brain', rank: 3 });
    hat = add('hat', 'respeaker', [0, brainY + 1.4 + hs[1] / 2, back], { group: 'brain', rank: 3 });
  } else {
    // a speaker box always plays sound: Pi Zero 2 W + ReSpeaker HAT (its amplifier drives the speaker).
    // Everything electronic sits in a layer behind the speaker module, battery at the bottom.
    back = -(s.pad + LIBRARY.speaker.size[2] + CLEARANCE + LIBRARY.battery.size[2] / 2);
    const base = -LIBRARY.speaker.size[1] / 2;
    battery = add('battery', 'battery', [0, base + LIBRARY.battery.size[1] / 2, back], { rank: 1 });
    // free skin: the regulator beside the battery; primitive shapes: behind it (keeps the profile compact)
    buck = prim
      ? add('regulator', 'buck', [0, base + LIBRARY.buck.size[1] / 2, back - LIBRARY.battery.size[2] / 2 - CLEARANCE - LIBRARY.buck.size[2] / 2], { rank: 2 })
      : add('regulator', 'buck', [LIBRARY.battery.size[0] / 2 + CLEARANCE + LIBRARY.buck.size[0] / 2 + 2, base + LIBRARY.buck.size[1] / 2, back], { rank: 2 });
    const pi = LIBRARY.piZero.size, hs = LIBRARY.respeaker.size;
    const brainY = base + LIBRARY.battery.size[1] + CLEARANCE;
    brain = add('brain', 'piZero', [0, brainY + pi[1] / 2, back], { group: 'brain', rank: 3 });
    hat = add('hat', 'respeaker', [0, brainY + 1.4 + hs[1] / 2, back], { group: 'brain', rank: 3 });
  }
  // case 2 primitive: shape and add-on spots from the electronics as placed (before any relaxing),
  // so the CPU surface and the shader always agree
  let shaped = null;
  if (prim) {
    const content = [battery, buck, brain, hat].map((p) => ({ lo: p.c.map((v, k) => v - p.h[k]), hi: p.c.map((v, k) => v + p.h[k]) }));
    const sd = LIBRARY.speaker.size, zc = -(sd[2] / 2 + s.pad);
    const spk = { lo: [-sd[0] / 2, -sd[1] / 2, zc - sd[2] / 2], hi: [sd[0] / 2, sd[1] / 2, zc + sd[2] / 2] };
    if (shape === 'totem') {
      const pool = s.totem?.length ? s.totem : ['box', 'cylinder', 'prism', 'hexagon', 'dome', 'octagon'];
      const shapes = Array.from({ length: 2 + MAX_PARTS }, (_, i) => pool[i % pool.length]);
      shaped = totemLayout(shapes, content, s.knobCount ?? knobs.length, s.pad);
      for (const p of [battery, buck, brain, hat]) p.c[1] += shaped.dy;   // the electronics move with their level
    } else {
      const one = primLayout(shape, content, spk, s.knobCount ?? knobs.length, s.pad);
      shaped = { prims: [one.prim], spots: one.spots };
    }
  }

  // the screen is the LED matrix; the skin wraps its back and sides, its face stays flush.
  // The speaker box has no screen.
  const matrix = box2 ? null : add('matrix', 'matrix', [s.scr[0], s.scr[1], 0], { env: s.pad, fixed: true });

  // modules behind surface-mounted add-ons, facing out along the surface normal; their
  // front sits one envelope thickness behind the mount point
  // a speaker box has a flat front: modules mounted on it face straight ahead
  const faceOf = (n) => (box2 && n[2] > 0.6 ? [0, 0, 1] : n);
  const spkParts = speakers.map((e, i) => {
    const d = LIBRARY.speaker.size[2] * e.scale, n = faceOf(e.n);
    return add(`speaker-${i}`, 'speaker', e.p.map((v, k) => v - n[k] * (d / 2 + s.pad)), { R: frameFromNormal(n), scale: e.scale, fixed: true });
  });
  const encParts = knobs.map((e, i) => {
    const d = LIBRARY.encoder.size[2] * e.scale, n = faceOf(e.n);
    return add(`encoder-${i}`, 'encoder', e.p.map((v, k) => v - n[k] * (d / 2 + s.pad)), { R: frameFromNormal(n), scale: e.scale, fixed: true });
  });

  // ---- add-on modules: if they hit the drive, the matrix or each other, they slide outward
  // along their surface normal (the skin, the holes and the knob follow them) ----
  const box = (p) => { const e = extents(p); return { lo: p.c.map((v, k) => v - e[k]), hi: p.c.map((v, k) => v + e[k]) }; };
  const clearOf = (a, b) => [0, 1, 2].some((k) => a.lo[k] - b.hi[k] >= CLEARANCE || b.lo[k] - a.hi[k] >= CLEARANCE);
  const wheelsAsParts = box2 ? [] : [s.wl, s.wr].map((w) => ({ c: [w[0], w[1], 0], h: [s.wheelHalfW + 2, 47, 47], R: IDENTITY }));
  const offsets = s.extras.map(() => 0);
  const modules = [...spkParts, ...encParts];
  const mountOf = [...speakers, ...knobs];
  const obstacles = [...[sL, sR, matrix].filter(Boolean), ...wheelsAsParts];
  modules.forEach((m, i) => {
    const n = faceOf(mountOf[i].n);
    let out = 0;
    for (; out < 60; out += 1) {
      const b = box(m);
      if (obstacles.every((o) => clearOf(b, box(o)))) break;
      m.c = m.c.map((v, k) => v + n[k]);
    }
    offsets[s.extras.indexOf(mountOf[i])] = out;
    obstacles.push(m);
  });

  // ---- push the free parts apart: no part may come within CLEARANCE of another.
  // In a collision the higher-ranked part moves (the brain climbs off the adapter,
  // never the other way round); fixed parts never move ----
  const groups = {};
  for (const p of parts) (groups[p.group] ??= []).push(p);
  // the wheels are obstacles too (not parts: they are provisional), plus room to spin
  if (!box2) {
    groups['wheel-left'] = [{ ...wheelsAsParts[0], fixed: true }];
    groups['wheel-right'] = [{ ...wheelsAsParts[1], fixed: true }];
  }
  const groupBox = (g) => {
    const bs = groups[g].map(box);
    return { lo: [0, 1, 2].map((k) => Math.min(...bs.map((b) => b.lo[k]))), hi: [0, 1, 2].map((k) => Math.max(...bs.map((b) => b.hi[k]))) };
  };
  const names = Object.keys(groups);
  const rankOf = (g) => (g.some((p) => p.fixed) ? -1 : Math.max(...g.map((p) => p.rank ?? 0)));
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const gi = groups[names[i]], gj = groups[names[j]];
        const ri = rankOf(gi), rj = rankOf(gj);
        if (ri < 0 && rj < 0) continue;
        const A = groupBox(names[i]), B = groupBox(names[j]);
        const pen = [0, 1, 2].map((k) => Math.min(A.hi[k] - B.lo[k], B.hi[k] - A.lo[k]) + CLEARANCE);
        if (pen.some((v) => v <= 0.01)) continue;
        const share = ri === rj ? 0.5 : ri > rj ? 1 : 0;             // the higher rank yields
        // separate along the axis of least overlap — but never push a part downward
        // (parts rest on what is below them: they slide sideways, back, or climb)
        const order = [0, 1, 2].sort((a, b) => pen[a] - pen[b]);
        let k = order[0], dir = 0;
        for (const a of order) {
          const d = (A.lo[a] + A.hi[a]) < (B.lo[a] + B.hi[a]) ? -1 : 1;   // the way group i moves
          const iDown = a === 1 && d < 0 && share > 0;
          const jDown = a === 1 && d > 0 && share < 1;
          if (!iDown && !jDown) { k = a; dir = d; break; }
        }
        if (dir === 0) dir = (A.lo[k] + A.hi[k]) < (B.lo[k] + B.hi[k]) ? -1 : 1;
        for (const p of gi) p.c[k] += dir * pen[k] * share;
        for (const p of gj) p.c[k] -= dir * pen[k] * (1 - share);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // ---- cables between real connectors ----
  const cables = [];
  const wire = (kind, a, an, b, bn, via = null) => cables.push({ kind, from: `${a.key}.${an}`, to: `${b.key}.${bn}`, points: route(connectorOf(a, an), connectorOf(b, bn), via) });
  // speaker box: a cable between two knobs goes round behind the speaker, never across its front
  const behind = (a, b) => {
    if (!box2 || !spkParts.length) return null;
    const pa = a.c, pb = b.c, back = Math.min(...spkParts.map((p) => box(p).lo[2])) - 5;
    return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, Math.min(back, pa[2], pb[2])];
  };
  if (box2) {
    wire('power', battery, 'xt30', buck, 'vin');
    wire('power5', buck, 'vout', brain, 'pwr');
    for (const sp of spkParts) wire('speaker', sp, 'lead', hat, 'spk');
  } else {
    wire('servoBus', sL, 'bus', adapter, 'servoA');
    wire('servoBus', sR, 'bus', adapter, 'servoB');
    wire('power', battery, 'xt30', adapter, 'power');
    wire('power', adapter, 'power', buck, 'vin'); // shares the adapter's screw terminal
    if (hat) {
      wire('power5', buck, 'vout', brain, 'pwr');
      wire('usb', adapter, 'usb', brain, 'usb');
      wire('groveQt', hat, 'grove', matrix, 'qtIn');
      for (const sp of spkParts) wire('speaker', sp, 'lead', hat, 'spk');
    } else {
      wire('power5', buck, 'vout', brain, 'vbus');
      wire('uart', adapter, 'uart', brain, 'uart');
      wire('qt', brain, 'qt', matrix, 'qtIn');
    }
  }
  // I2C daisy chain: matrix → encoder → next encoder (speaker box: from the HAT's grove port)
  let prev = matrix ?? hat, prevPort = matrix ? 'qtOut' : 'grove';
  for (const enc of encParts) { wire(prev === hat ? 'groveQt' : 'qt', prev, prevPort, enc, 'qtIn', prev.lib === 'encoder' ? behind(prev, enc) : null); prev = enc; prevPort = 'qtOut'; }

  if (box2) {
    // provisional structure: a front baffle where the speaker and the knob mount (so the
    // skin has a front even before they are in); no neck
    const chassis = { a: [-34, 0, -16], b: [40, 0, -16], r: 12 };
    const neck = { a: brain.c.slice(), b: brain.c.slice(), r: 0 };
    return { parts: parts.slice(0, MAX_PARTS), chassis, neck, cables: cables.slice(0, MAX_CABLES), offsets, prims: shaped?.prims ?? [], spots: shaped?.spots ?? null };
  }

  // provisional structure: a frame bar between the servos, and a neck up to the matrix
  const top = Math.max(...[adapter, buck, brain, hat].filter(Boolean).map((p) => box(p).hi[1]));
  const chassis = { a: [sL.c[0], sL.c[1], back], b: [sR.c[0], sR.c[1], back], r: 7 };
  const base = s.scr[1] - s.screenHalfH;
  const gapUp = base - (top + s.pad);
  const t = Math.min(1, Math.max(0, (gapUp - 2) / 14));
  const neck = {
    a: [Math.min(Math.max(s.scr[0], chassis.a[0]), chassis.b[0]), top - 4, brain.c[2] * 0.5],
    b: [s.scr[0], base + 6, 0],
    r: s.neckR * t * t * (3 - 2 * t),
  };

  return { parts: parts.slice(0, MAX_PARTS), chassis, neck, cables: cables.slice(0, MAX_CABLES), offsets, prims: [] };
}

/** Smallest wheel half-track at which the two servos still fit side by side. */
export function minHalfTrack(wheelHalfW, pad) {
  return wheelHalfW + pad + 2 + LIBRARY.servo.size[0] + CLEARANCE / 2;
}
