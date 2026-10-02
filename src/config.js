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

  /** Orbit camera around (0, viewCenterY, 0). Angles in degrees. */
  camera: {
    distance: 700,        // mm; perspective strength (larger = flatter)
    yaw: -28,             // default 3/4 view
    pitch: 14,
    yawRange: null,       // free: all the way round
    pitchRange: [-35, 85],
    parallax: [4, 2.5],   // degrees of yaw / pitch that follow the cursor
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
