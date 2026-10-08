/**
 * All physical dimensions, in millimetres.
 * Swap these for real part specs later — nothing else in the code hardcodes sizes.
 *
 * Coordinate system ("object space"): origin at the midpoint between the two
 * wheel axles in the default pose, x → right, y → up, units = mm.
 *
 * Current values are derived from the reference screenshot, using the wheel
 * height (90 mm, from the "90mm" wheels card) as the yardstick.
 */
export const CONFIG = {
  /** CSS pixels per mm at a 1:1 fit. The view scales this to fit the window (see view.js). */
  pxPerMm: 2.4,
  /** Allowed range for that fit factor: shrink on phones, grow on big screens. */
  fitRange: [0.35, 1.7],

  wheel: {
    // NOT in the component library: a provisional shape (drawn as points)
    w: 30,        // tread width (cylinder length along x)
    h: 90,        // diameter
    r: 4,         // edge rounding
    capH: 9,      // (front-view tread band, kept for reference)
  },

  /** The screen is the Adafruit IS31FL3741 13×9 LED matrix (51.3 × 39.0 × 4.6). */
  // the current screen (case 1); its numbers are swapped in from SCREENS when the screen node changes it
  screen: {
    w: 51.3,
    h: 39.0,
    d: 4.6,
    r: 1.5,
    display: {
      w: 39,        // the 13 × 9 LED field at 3 mm pitch
      h: 27,
      r: 0.5,
      offsetY: 0,
    },
  },

  /** Default pose (component centres). */
  initial: {
    wheelHalfTrack: 66, // |x| of each wheel centre
    wheelY: 0,
    screenX: 0,
    screenY: 62.5,
  },

  /** Clamps that keep the object sensible. */
  limits: {
    wheelHalfTrack: [52, 100],  // |x| of a wheel centre (also never less than the servos need: parts.js)
    wheelY: [-35, 30],
    screenY: [42, 120],         // screen centre
    screenXFromMid: 24,         // max |screen.x - midpoint between wheels|
  },

  /** Body (enclosure) proportions that are not exposed in the debug panel. */
  body: {
    neckR: 9,       // radius of the neck towards the screen
    // (the rest of the body is grown around the real parts: see parts.js)
  },

  /** live view: point cloud crowding on the outlines */
  live: { cellPx: 4.5, dotPx: 0.85, skin: '#d9d6cf', line: '#f4f2ec' },   // 2D, on black: one point per cell (CSS px)
  /** cross view: rounded cell islands on a grid of crosses (the crosses double as snap points) */
  // (the shape clearly darker than the page, the faces well apart; the page dots recede)
  cross: { movingRes: 1, redraw: 0.9, out: 0.45, cellMm: 6, light: '#c9c9d0', top: '#dcdce2', side: '#adadb6', wheel: '#9c9ca5', dot: '#7c7c86', pageDot: '#c2c2c7', partCell: '#55555d',
    // look a: the same warm greys as the grey pixel 3d of look a; parts get its mauve tint
    lookA: { light: '#cbc9c4', top: '#dad8d3', side: '#b1aea8', wheel: '#a29f99', dot: '#817e78', pageDot: '#c9c7c2', partCell: '#57544f', tint: [1, 0.965, 0.98] } },   // page marks as strong as before; partCell = parts as tiles

  /** picasso view: ink on paper (ref: the bull lithographs) */
  picasso: { ink: '#141312' },

  /** particles view: a 3D point cloud on the surfaces, like a scan */
  particles: { cellPx: 9, fill: 0.5, partFill: 0.7, rings: 0.16, dotR: 0.28, ink: '#f4f2ec', line: '#e9e7e2', partLine: '#8d8b86' },

  /** density view: the parts as a kernel-density contour plot (8 colours: page tint, then bands outside → in) */
  density: {
    spreadMm: 16,        // halo spread of each part
    line: '#ffffff',     // the parts: white outlines
    palette: 0,
    palettes: [
      ['#f7eef0', '#f0d9dd', '#e6bfca', '#d4a0b8', '#b77fa5', '#8f6093', '#634478', '#36294f'],   // pink → plum
      ['#eef5ee', '#d6e8d4', '#b6d3b2', '#8fb98d', '#6a9a6c', '#4d7a54', '#36593d', '#233a28'],   // sage → forest
      ['#eef0f9', '#d8dcf0', '#bcc3e3', '#9aa5d0', '#7a87ba', '#5d6aa0', '#434f80', '#2b3459'],   // lavender → ink blue
      ['#f8f1e8', '#f0dcc2', '#e6c095', '#d79f6b', '#bd7c4b', '#985c36', '#6e4129', '#47291b'],   // sand → umber
      ['#edf6f5', '#d0ebe7', '#a9d8d1', '#7fbfb6', '#579f98', '#3c7f7a', '#2a605d', '#1a3f3e'],   // mint → deep teal
      ['#fbefe9', '#f6d3c6', '#efb09b', '#e48a72', '#cf6551', '#ab4a3d', '#80342d', '#55211e'],   // peach → brick
      ['#f3f2f0', '#e2e0dc', '#cbc8c3', '#aeaaa4', '#8e8a84', '#6e6a65', '#4f4c48', '#33312e'],   // grey: paper → graphite
    ],
  },

  /** gradient view (cross page): grainy colour patches on a soft blob, on a flat page; [page, 5 patch colours] */
  gradient: {
    palettes: [
      ['#fbd9ef', '#a99af0', '#ff5f4f', '#ffbf47', '#ffffff', '#f6a6c8'],   // candy: pink page, lilac · red · amber · white · rose
      ['#5b82ff', '#ffd1ee', '#ff9a3d', '#8f8cf2', '#ff6f8e', '#fff2fb'],   // sky: blue page, pink · orange · lilac · coral · white
      ['#d7f2e6', '#7fd8c2', '#ffd66b', '#ff8a7a', '#6c8cff', '#ffffff'],   // mint: mint page, teal · yellow · salmon · blue · white
      ['#1a1a1f', '#ff7ac6', '#7b6cff', '#ffc94d', '#45e0c8', '#ffffff'],   // night: dark page, magenta · violet · gold · aqua · white
    ],
  },

  /** marker view: felt-pen fills per face on a pale blue page (ref "Balance") */
  marker: {
    cellPx: 1.6, redraw: 1.0, front: '#2547a8', side: '#ee3340', top: '#f4a089', back: '#2d4fb0', page: '#cdd7e6',
    // the parts in the same pens: deep navy, yellow, orange, ivory, plum…
    parts: {
      servo: '#1b2a6b', feather: '#f2b632', piZero: '#1e2f78', respeaker: '#7a2f6a', speaker: '#222433', speakerSmall: '#222433',
      encoder: '#f2c230', matrix: '#f1ece1', oled: '#f1ece1', servoAdapter: '#2b3a8f', pdTrigger: '#f08a2c',
      battery: '#f08a2c', buck: '#f6d36b', qtHub: '#1b2a6b',
    },
  },

  /** milk view: milky silicone body, parts inside each in its own clear colour (octobot-like) */
  milk: {
    skin: '#fbfbfa',
    shade: '#d9dde3',
    veil: 0.03,           // per mm: how quickly the silicone hides what is deeper inside
    parts: {
      servo: '#e8452c', feather: '#f28a1d', piZero: '#2f6fe0', respeaker: '#e5304f', speaker: '#1d9bd8',
      encoder: '#f5a524', matrix: '#7b4fd6', oled: '#5b5bd6', servoAdapter: '#d6336c', pdTrigger: '#21a89f',
      battery: '#2bb673', buck: '#f2c230', qtHub: '#7d8fd6',
    },
  },

  /** flat hd: length of the hand-drawn redraw after a view change (s) */
  flatHd: { redraw: 1.6 },

  /** sketch view: cell size of the stepped pencil line (mm) */
  sketch: { cellMm: 5 },

  /** Orbit camera around (0, viewCenterY, 0). Angles in degrees. */
  camera: {
    distance: 4000,       // mm; perspective strength (larger = flatter) — far: near-parallel, like real orthographic / axonometric views
    yaw: -45,             // default 3/4 view (axonometric)
    pitch: 35,
    yawRange: null,       // free: all the way round
    pitchRange: [-35, 85],
    parallax: [0, 0],     // degrees of yaw / pitch that follow the cursor (off: views stay on the snap grid)
    // no free orbit: only the essential drawn views. Turning goes front → axonometric → side → …
    // (orthographic elevations at every 90°, axonometric from above in between); up = plan (top)
    snap: {
      freeYaw: 0.35, freePitch: 0.3, freeMin: -10,   // cross: free turn, degrees per px · lowest pitch
      turnOut: 0.22,      // cross: s for the tiles to shrink away when a free turn starts
      turnOutFlat: 0.6,   // flat hd 2: s for the contour to un-draw itself (along the pen's path) when a free turn starts
      yaw: 45,            // step between elevation and axonometric
      axo: 35,            // pitch of the axonometric views
      top: 89.5,          // pitch of the plan view
      dragPx: 70,         // drag distance per step
    },
    redraw: 0.85,         // s: how long the drawing takes to grow back after a view change
    zoom: 1.25,           // fixed framing: a little closer than the fit (no mouse-wheel zoom)
    glide: 0.7,           // s: cross / flat hd 2 — the parts glide to the new view before the shape is built
    buildAt: 0.65,        // the shape starts building at this point of the glide (1 = only once the parts have arrived)
  },

  /** Key light direction in world space (x right, y up, z toward the viewer). */
  light: [-0.55, 0.65, 0.55],
  /** Light for the solid view's tone bands: top brightest, front mid, sides darker. */
  solidLight: [-0.35, 0.85, 0.4],

  /**
   * Add-on components that mount on a surface of the object.
   * speaker: a circular pattern of holes (1 + 6 + 12) cut into the surface.
   * knob: r = radius, h = height off the surface, boss = mounting-pad radius.
   * snap = magnetic reach in mm.
   */
  extras: {
    max: 6,
    speaker: { r: 12, hole: 1.6, depth: 4, snap: 8, small: { r: 8, hole: 1.3 } }, // r = radius of the hole pattern (small = the 2 W speaker)
    knob: { r: 7.25, h: 11.5, boss: 12, snap: 34, angleRange: [-135, 135] }, // ≈ slim rubber knob Ø14.5 × 11.5
  },

  /** Screen space reserved for the UI, in CSS px (prompt on top, toolbar below). */
  viewInsets: { top: 140, bottom: 70 },

  /** Pixel view: size of a mosaic cell, in mm at the object's depth. */
  pixelCellMm: 6,
  // "glass": frosted body, parts inside
  glass: { frost: 0.16 },
  // "pixel 3d": the shape as flat pixels, the parts 3D in playful colours
  pixel3d: {
    cellMm: 5,
    // a new one is picked at every "start over": [skin (robot), skin (speaker), wheels, parts by kind]
    palettes: [
      { skin: '#1fa34a', skinSpeaker: '#13a092', wheel: '#0d7f73',
        parts: { servo: '#ff4fa3', feather: '#ffd21f', piZero: '#ff8a1f', respeaker: '#b46bff', speaker: '#3fb8ff', encoder: '#ff5a3c', matrix: '#f5f5f5', oled: '#e8f4ff', servoAdapter: '#7a5cff', pdTrigger: '#c0c0c0', battery: '#ff3b3b', buck: '#ffe14d', qtHub: '#2b2b2e' } },
      { skin: '#7cc243', skinSpeaker: '#5bb53a', wheel: '#3e8a2c',   // daisy
        parts: { servo: '#ffffff', feather: '#ffcf1f', piZero: '#ffb21f', respeaker: '#ff8fc8', speaker: '#fff3a8', encoder: '#ffd84a', matrix: '#ffffff', oled: '#fff6c8', servoAdapter: '#ff9ad1', pdTrigger: '#dddddd', battery: '#ff7ab8', buck: '#ffe680', qtHub: '#2b2b2e' } },
      { skin: '#0f9a86', skinSpeaker: '#13887a', wheel: '#0a6b5e',   // orchid
        parts: { servo: '#c13bd6', feather: '#ffe11a', piZero: '#e05be8', respeaker: '#8f2fd1', speaker: '#f07ce8', encoder: '#ffe11a', matrix: '#f6e6ff', oled: '#fff9a8', servoAdapter: '#a24bff', pdTrigger: '#cccccc', battery: '#ff4fd8', buck: '#fff06a', qtHub: '#2b2b2e' } },
      { skin: '#18a24b', skinSpeaker: '#1b9a5a', wheel: '#0e6e35',   // tulip
        parts: { servo: '#e8262b', feather: '#ff8a1a', piZero: '#ff5a1f', respeaker: '#d91c3c', speaker: '#ff3d2e', encoder: '#ff9a1a', matrix: '#fff1e8', oled: '#ffe0c0', servoAdapter: '#c0182b', pdTrigger: '#cccccc', battery: '#ff6a3d', buck: '#ffb02e', qtHub: '#2b2b2e' } },
      { skin: '#3a5cf0', skinSpeaker: '#2f6cf2', wheel: '#2238a8',   // night garden
        parts: { servo: '#ffd21f', feather: '#ff6fb5', piZero: '#ff9a2e', respeaker: '#ffe14d', speaker: '#ff7ac0', encoder: '#5ef0c8', matrix: '#ffffff', oled: '#c8fff0', servoAdapter: '#ffb84d', pdTrigger: '#cccccc', battery: '#ff4f6d', buck: '#a8f05e', qtHub: '#2b2b2e' } },
    ],
  },
  // "orbital" view: the shape as a soft density cloud
  orbital: { density: 0.06, soft: 5, cloud: '#3a3a3e', line: '#1e1e20' },
  emptyCellMm: 6,   // graph-paper square of the "empty" view

  /** Vertical centre of the framed view, in mm (the object is taller above the axles). */
  viewCenterY: 28,

  /** On light grey: ink dots and hairlines. */
  palette: {
    dot: '#211f22',       // dots and rings; outlines of fixed parts in the lines view
    line: '#262426',      // component outlines
    lineSoft: '#9f9a93',  // secondary lines (wheel caps, display)
    label: '#8d8983',     // coordinate labels, ticks, crosshair
    guide: '#cdc8bf',     // drag guide lines
    blockLine: '#a7a29a', // provisional block outlines (lines view)
    // solid view: flat tone bands, darkest → lightest
    solid: {
      fixedLo: '#1f1e1c', fixedHi: '#8d8a83', // real parts: ink
      bodyLo: '#bdb7aa', bodyHi: '#ece7dc',   // provisional: paper
      dark: '#0e0e0d',                        // display, speaker holes
    },
    // pixel view: halftone mosaic for the skin, circles + lines for parts and cables
    // "empty": blue ink outlines on graph paper
    empty: { ink: '#2f2fa8', hi: '#f0382c', paper: '#c9ccd6' },
    // "empty" in look a (prototype): warm charcoal ink on a sand grid
    emptyA: { ink: '#3a3732', hi: '#c4492e', paper: '#dcd8cf' },
    // "sketch": pencil shape on graph paper, real-colour parts
    sketch: { ink: '#2f2fa8', soft: '#9da0d8', hi: '#f0382c', paper: '#c9ccd6' },   // blue, like empty
    // "flat hd": pale tint of the shape's faces (white = lighter than the page)
    flatHdFill: '#ffffff',
    flatHdLine: '#2f2fa8',   // flat hd: the whole shape in one blue (like empty / sketch)
    // "blob": metaballs, a few warm and cool families (order = part type index)
    blob: {
      parts: {
        servo: '#1fb5c4', feather: '#ff6a1a', piZero: '#ff8a2a', respeaker: '#ff5a36',
        speaker: '#36d6c3', encoder: '#9fe8d8', matrix: '#5fe6dc', oled: '#9ff0ea', servoAdapter: '#ffa040',
        pdTrigger: '#c0c0c0', battery: '#ff3d1f', buck: '#ffb347', qtHub: '#d0d0d0',
      },
      wheel: '#ff7424',
      knob: '#c8fff4',
    },
    pixel: {
      red: '#f0382c',
      pink: '#f6c9c3',
      blue: '#3f6fd8',     // wheels
      light: '#f4efe8',
      circle: '#ff2d8f',
      ring: '#f0382c',
      line: '#cfe81a',
      knot: '#1f4d36',
    },
    // flat view: ink shapes and coloured contours
    flat: {
      ink: '#151514',
      red: '#e2472f',
      blue: '#3f7fdc',
      green: '#2e8b3e',
      orange: '#f06a2c',
      // one colour per kind of part
      parts: {
        servo: '#6c5ce7',
        feather: '#f06a2c',
        piZero: '#f2a541',
        respeaker: '#e84a8a',
        speaker: '#2d3a8c',
        encoder: '#00a3a3',
        matrix: '#29a8e0', oled: '#7fc8f0',
        servoAdapter: '#1e9e6a',
        pdTrigger: '#9e9e9e',
        battery: '#8bbf3c',
        buck: '#c9a227',
        qtHub: '#4a4a4f',
      },
    },
  },
};

/**
 * The nodes' palette (yellow · orange · cyan · olive): the colour a node and its part light up in,
 * and the cross view's 'colour' style — every part in the same family, the node parts in exactly theirs.
 */
export const NODE_PALETTE = {
  nodes: { screen: '#ff8c55', speaker: '#e7e96c', energy: '#a0e0e0', wheels: '#8b8f63' },
  parts: {
    matrix: '#ff8c55', oled: '#ff8c55',                    // screen · orange
    speaker: '#e7e96c', speakerSmall: '#e7e96c',           // speaker · yellow
    battery: '#a0e0e0', pdTrigger: '#a0e0e0',              // energy · cyan
    servo: '#8b8f63',                                      // wheels · olive
    piZero: '#a6aa7c', feather: '#a6aa7c', respeaker: '#6f7350', qtHub: '#5c6045', servoAdapter: '#7c8058',   // the rest: olives
    encoder: '#c6a3e0', buck: '#7cc6c6',                   // knobs: lilac (their own, not the speaker's yellow) · a deeper cyan
  },
};

/** Displays from the library the screen node can pick from (sizes in mm, display = lit area). */
export const SCREENS = {
  matrix: {
    lib: 'matrix', label: 'Adafruit IS31FL3741', tags: ['rgb led', '13×9', '$14.95'],
    w: 51.3, h: 39.0, d: 4.6, r: 1.5, display: { w: 39, h: 27, r: 0.5, offsetY: 0 },
  },
  oled: {
    lib: 'oled', label: 'Adafruit Monochrome 1.3"', tags: ['oled', '128×64', '$19.95'],
    w: 35.6, h: 33.0, d: 6.2, r: 1.5, display: { w: 29.42, h: 14.7, r: 0.3, offsetY: -3.0 },
  },
};
