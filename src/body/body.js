import { CONFIG, NODE_PALETTE } from '../config.js?v=202610080154';
import { state, params } from '../state.js?v=202610080154';
import { view } from '../view.js?v=202610080154';
import { Spring } from './springs.js?v=202610080154';
import { vertexShader, levelShader, easeShader, dotShader, cloudShader, flatShader, pixelShader, pixelDrawShader, pixel2Shader, orbitalShader, orbitalEdgeShader, pixel3dShader, glassShader, flat2GbufferShader, flat2EdgeShader, emptyCellShader, emptyEdgeShader, blobShader, sketchShader, flatHdShader, milkShader, liveEdgeShader, liveDrawShader, crossShader, crossHifiVariant, crossMaskShader, flatBlurShader, gradientShader, markerShader, densityShader, particlesShader, picassoShader, overlayShader } from './shaders.js?v=202610080154';
import { gbufferShader, edgeShader } from './blockshaders.js?v=202610080154';
import { startProgram, finishProgram, createFullscreenQuad, createR8Texture, createTarget, hexToRgb } from './gl.js?v=202610080154';
import { traceStrokes } from './strokes.js?v=202610080154';
import { generateBlueNoise } from './bluenoise.js?v=202610080154';
import { layoutParts, MAX_PARTS, MAX_CABLES, CABLE_POINTS, CABLES, LIBRARY } from '../parts.js?v=202610080154';
import { holePattern } from '../speaker-patterns.js?v=202610080154';

const METHODS = { bayer: 0, blue: 1, split: 2 };

/**
 * The body layer: a 3D render of the object, in one of two views.
 * Reads component positions from `state`, eases its SDF parameters toward them
 * with springs (so the body lags and wobbles slightly behind a dragged part).
 *
 * dots view (cloud style, default):
 *   one pass — points on a jittered 3D lattice stuck to the body surface;
 *   fixed parts drawn solid.
 * dots view (grid style, the original dithering):
 *   pass 1 — dithered target state per cell (solid / ring / empty),
 *   pass 2 — eases each cell's current state toward its target (ping-pong),
 *   pass 3 — draws dots and rings at full device resolution.
 * lines view:
 *   pass 1 — g-buffer of the scene as hard blocks (id, depth, normal),
 *   pass 2 — visible outlines from that buffer.
 * solid view:
 *   one pass — the same blocks, flat-shaded in a few tone bands.
 * Switching views cross-fades them inside the same canvas.
 */
export function createBody(canvas) {
  // canvas pixel ratio, capped: on retina screens the raymarching would cost 4× for little gain
  const MAX_PIXEL_RATIO = 1.5;
  // dynamic resolution: drops a little when frames run slow, climbs back when there is headroom
  let quality = 1;
  let frameTime = 1 / 60, qualityClock = 0;
  // (cross / cross 2 render at the screen's own pixel ratio, so their one-pixel marks stay crisp)
  // crisp views keep full resolution; flat hd 2 too at rest (its drawing is fine lines: halving it smudged them),
  // it may only drop while it turns
  const crispView = () => params.view === 'cross' || params.view === 'cross2' || (params.view === 'dots' && params.dotStyle === 'grid')
    || (params.view === 'flathd2' && !params.moving && !((params.outT || 0) > 0));
  const pxr = () => Math.min(view.dpr, crispView() ? 3 : MAX_PIXEL_RATIO) * quality;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL2 is not available');

  gl.getExtension('KHR_parallel_shader_compile');   // shaders compile on driver threads, off the page
  /**
   * A shader program built on first use; warm() starts its compile early in the background,
   * so switching to a view later finds it ready instead of stalling.
   */
  const lazy = (fs) => {
    let p = null, started = null;
    const warm = () => { if (!p && !started) started = startProgram(gl, vertexShader, fs); };
    const get = () => {
      if (!p) {
        warm();
        const pr = finishProgram(gl, started);
        p = { ...pr, quad: createFullscreenQuad(gl, pr.prog) };
      }
      return p;
    };
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    const ready = () => !!p || (!!started && (!ext || gl.getProgramParameter(started.prog, ext.COMPLETION_STATUS_KHR)));
    return { warm, ready, get started() { return !!(p || started); }, get prog() { return get().prog; }, get uniforms() { return get().uniforms; }, get quad() { return get().quad; } };
  };
  const level = lazy(levelShader);
  const ease = lazy(easeShader);
  const dots = lazy(dotShader);
  const cloud = lazy(cloudShader);
  const flat = lazy(flatShader);
  const flatBlur = lazy(flatBlurShader);
  const gradV = lazy(gradientShader);
  let gradT = 0;   // the gradient view's own clock
  // flat hd 2 with blur: the sharp layer and the inside layer (MRT), and one for the first blur pass
  const flatSplit = (() => {
    const mk = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    const over = mk(), inner = mk(), tmp = mk(), fbo = gl.createFramebuffer(), fboTmp = gl.createFramebuffer();
    let w = 0, h = 0;
    return {
      over, inner, tmp, fbo, fboTmp,
      resize(W, H) {
        if (W === w && H === h) return;
        w = W; h = H;
        for (const t of [over, inner, tmp]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, over, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, inner, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboTmp);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tmp, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
    };
  })();
  const pixel = lazy(pixelShader);
  const pixelD = lazy(pixelDrawShader);
  const pixel2 = lazy(pixel2Shader);
  const orbital = lazy(orbitalShader);
  const orbitalE = lazy(orbitalEdgeShader);
  const pixel3d = lazy(pixel3dShader);
  const glass = lazy(glassShader);
  const flat2g = lazy(flat2GbufferShader);
  const flat2e = lazy(flat2EdgeShader);
  const emptyC = lazy(emptyCellShader);
  const emptyE = lazy(emptyEdgeShader);
  const blob = lazy(blobShader);
  const sketch = lazy(sketchShader);
  const flathd = lazy(flatHdShader);
  const milk = lazy(milkShader);
  const liveE = lazy(liveEdgeShader);
  const liveD = lazy(liveDrawShader);
  const liveTarget = createTarget(gl);   // per-cell edge proximity for the live view
  let liveSize = '';
  const crossV = lazy(crossShader);
  // the hifi pass: one program per need (parts / boxes × with or without the outside)
  const crossHv = { parts: lazy(crossHifiVariant([])), boxes: lazy(crossHifiVariant(['BOXES'])), outer: lazy(crossHifiVariant(['OUTER'])) };
  const crossM = lazy(crossMaskShader);
  let crossGhost = 0;   // cross: 0..1, the loose voxels while the object turns
  // cross: the hifi layer (parts + outside) in two full-res textures, re-rendered only when its key changes
  const crossHifi = (() => {
    const mk = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    const parts = mk(), outer = mk(), meta = mk(), fbo = gl.createFramebuffer();
    const depth = gl.createRenderbuffer();   // the mask: where the heavy pass may run
    let w = 0, h = 0;
    return {
      parts, outer, meta, fbo, key: '',
      resize(W, H) {
        if (W === w && H === h) return;
        w = W; h = H;
        for (const t of [parts, outer, meta]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, parts, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, outer, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, meta, 0);
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.key = '';
      },
    };
  })();
  const markerV = lazy(markerShader);
  const densV = lazy(densityShader);
  const partV = lazy(particlesShader);
  const picV = lazy(picassoShader);
  const overV = lazy(overlayShader);
  const gbuf = lazy(gbufferShader);
  const edge = lazy(edgeShader);
  const blueTex = createR8Texture(gl, 64, generateBlueNoise(64));
  const target = createTarget(gl);
  let cur = createTarget(gl);
  let prev = createTarget(gl);
  // background warm-up of every view's shaders, in the order of the view switch
  // (pixel 3d · dots · flat 1 · flat 2 · dither 1 · dither 2 · glass · empty), one every 350 ms
  // (the cross page has one view: warming the others there only keeps the driver busy for ~20 s)
  const WARM = document.body.dataset.page === 'cross'
    ? { emptyC, crossV, crossM, crossH: crossHv.parts }
    : { emptyC, pixel3d, cloud, flat2g, flat2e, flat, pixel, pixelD, pixel2, glass, emptyE, sketch, flathd, crossV, crossH: crossHv.parts, markerV, densV, partV, picV };
  const t0 = performance.now(), readyAt = {};
  if (document.body.dataset.page === 'cross') {
    for (const q of Object.values(WARM)) q.warm();   // at once: they are needed now
    setTimeout(() => crossHv.outer.warm(), 4000);   // then the outside, quietly, before anyone asks for it
    setTimeout(() => { flat.warm(); flat2g.warm(); }, 6000);   // and flat hd 2, the page's other view
  }
  setTimeout(() => {
    // hand them all to the driver at once (it compiles on its own threads), then just watch
    for (const q of Object.values(WARM)) q.warm();
    const watch = setInterval(() => {
      for (const [k, q] of Object.entries(WARM)) if (!readyAt[k] && q.ready()) readyAt[k] = Math.round(performance.now() - t0);
      if (Object.keys(readyAt).length === Object.keys(WARM).length) clearInterval(watch);
    }, 200);
  }, 1500);
  window.__shaderStatus = () => ({ ...readyAt });   // debug: ms after load when each program was ready
  const gtarget = createTarget(gl); // full-res g-buffer for the blocks view
  const g2target = createTarget(gl); // a second full-res g-buffer (density: part outlines)
  let densA = createTarget(gl), densB = createTarget(gl), densFresh = true;   // density field, ping-pong (fluid memory)
  // cross-fade weight of each view (1 = fully shown)
  const VIEWS = ['dots', 'blocks', 'flat', 'flat2', 'pixel', 'pixel2', 'empty', 'blob', 'orbital', 'pixel3d', 'glass', 'sketch', 'flathd', 'flathd2', 'milk', 'live', 'cross', 'cross2', 'marker', 'density', 'particles', 'picasso', 'gradient'];
  const weight = Object.fromEntries(VIEWS.map((v) => [v, params.view === v ? 1 : 0]));
  // view changes are redrawn, not orbited: the line views grow their drawing back around the parts,
  // the others fade back in
  const LINE_VIEWS = ['sketch', 'flathd', 'flathd2', 'cross', 'marker', 'density', 'particles', 'picasso'];
  let bound = { c: [0, 0, 0], r: 100 };
  let objCenter = null;   // centre of the object's box (parts + shape), mm
  let densSmoke = 0;
  let densTr = 0;         // density (cross page): its transition, 0 at rest … 1 while turning      // density: 1 while the view changes (smoke spreads), back to 0 as it condenses
  let lastDt = 1 / 60;
  let ptScatter = 0;      // particles: thrown about while the view changes, back in place after
  const densJelly = [];   // density: each part's halo follows its projected box on a soft spring (a jelly blob)
  let redrawSeen = params.redraw, redrawT = 1;
  let unfT = 0;   // flat hd 2: the unfinished drawing's clock
  // flat hd: the pen strokes, traced from the g-buffer once per redraw
  const STROKE_S = 2;   // device px per stroke cell
  const strokeTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, strokeTex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
  let strokeW = 1, lastTraceW = 1, needTrace = false;
  function redrawUniforms(u) {
    const k = Math.min(1, redrawT / CONFIG.camera.redraw);
    gl.uniform1f(u.uRedraw, redrawT >= CONFIG.camera.redraw ? 1 : 1 - Math.pow(1 - k, 2.2));
    const [px, py] = view.project(bound.c[0], bound.c[1], bound.c[2]);
    gl.uniform2f(u.uRedrawC, px * pxr(), size.h - py * pxr());
    gl.uniform1f(u.uRedrawR, bound.r * 1.5 * view.scale * pxr());
    if (u.uDrawT) gl.uniform1f(u.uDrawT, params.moving ? 0 : Math.min(1, redrawT / CONFIG.flatHd.redraw));
  }

  // --- animated SDF parameters (mm) ---
  const geo = {
    wlx: new Spring(state.wheels.left.x),
    wly: new Spring(state.wheels.left.y),
    wrx: new Spring(state.wheels.right.x),
    wry: new Spring(state.wheels.right.y),
    sx: new Spring(state.screen.x),
    sy: new Spring(state.screen.y),
  };
  // tuning values ease without wobble
  const look = {
    pad: new Spring(state.body.padding, 2.5),
    blend: new Spring(state.body.blend, 2.5),
    soft: new Spring(params.softness, 2.5),
    exposure: new Spring(params.exposure, 2.5),
    neckR: new Spring(state.body.neckR, 2.2, 0.7),
    eyes: new Spring(state.body.eyes, 2.0, 0.55),
  };

  // --- cursor + ripple ---
  const mouse = { x: 0, y: 0, inside: false, amt: new Spring(0, 2.5) };
  const ripple = { x: 0, y: 0, t: 99 };
  const scan = { t: 9, dur: 1.2 }; // seconds since a scan started

  let extras = [];  // visible add-on poses, set each frame by extras.js
  const MAX_EXTRAS = 6;
  const extraP = new Float32Array(MAX_EXTRAS * 3);
  const extraN = new Float32Array(MAX_EXTRAS * 3);
  const extraInfo = new Float32Array(MAX_EXTRAS * 4);
  const partC = new Float32Array(MAX_PARTS * 3);
  const partH = new Float32Array(MAX_PARTS * 3);
  const partR = new Float32Array(MAX_PARTS * 9);
  const partType = new Int32Array(MAX_PARTS);
  const partEnv = new Float32Array(MAX_PARTS);
  // cables in a float texture: 16 texels per cable (bbox lo + r, bbox hi + albedo, 8 points)
  const cableData = new Float32Array(MAX_CABLES * 16 * 4);
  const cableTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, cableTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_CABLES * 16, 1, 0, gl.RGBA, gl.FLOAT, cableData);
  let layout = null; // last part layout, for the components list
  let easeK = 0.2; // per-frame dot easing fraction
  let clock = 0; // drift time, integrated so changing speed never jumps
  let size = { w: 0, h: 0, cell: 0, gw: 0, gh: 0, ox: 0, oy: 0 };

  /** Canvas = exact device pixels; grid = one texel per cell, lattice centred on the view. */
  function resize() {
    const w = Math.round(view.vw * pxr());
    const h = Math.round(view.vh * pxr());
    const cell = Math.max(3, params.pitch * view.scale * pxr()); // device px per cell (float is fine)
    const mod = (a, b) => ((a % b) + b) % b;
    // place a cell centre exactly at the view centre
    const ox = mod(view.cx * pxr() - 0.5 * cell, cell);
    const oy = mod(h - view.cy * pxr() - 0.5 * cell, cell);
    const gw = Math.ceil((w - ox) / cell) + 1;
    const gh = Math.ceil((h - oy) / cell) + 1;

    if (w !== size.w || h !== size.h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = view.vw + 'px';
      canvas.style.height = view.vh + 'px';
      gtarget.resize(w, h);
      g2target.resize(w, h);
      densA.resize(w, h); densB.resize(w, h); densFresh = true;
    }
    if (gw !== size.gw || gh !== size.gh) {
      target.resize(gw, gh);
      cur.resize(gw, gh);
      prev.resize(gw, gh);
    }
    size = { w, h, cell, gw, gh, ox, oy };
  }

  function update(dt) {
    // the dynamic resolution holds still while a view is being redrawn: a resize mid-drawing
    // reads as a jump (and the one heavy frame that traces the strokes must not count)
    const redrawing = redrawT < CONFIG.flatHd.redraw + 0.4;
    if (!redrawing) frameTime += (Math.min(dt, 0.05) - frameTime) * 0.1;
    qualityClock = redrawing ? 0 : qualityClock + dt;
    // cross / cross 2 / dots grid keep full resolution: their crisp marks blur into blobs when upscaled
    if (crispView()) { quality = 1; qualityClock = 0; }
    if (qualityClock > 0.5) {
      qualityClock = 0;
      if (frameTime > 0.022 && quality > 0.5) quality = Math.max(0.5, +(quality - 0.1).toFixed(2));
      else if (frameTime < 0.0145 && quality < 1) quality = Math.min(1, +(quality + 0.05).toFixed(2));
    }
    geo.wlx.target = state.wheels.left.x;
    geo.wly.target = state.wheels.left.y;
    geo.wrx.target = state.wheels.right.x;
    geo.wry.target = state.wheels.right.y;
    geo.sx.target = state.screen.x;
    geo.sy.target = state.screen.y;
    for (const k in geo) {
      geo[k].frequency = params.response;
      geo[k].damping = params.wobble;
      geo[k].step(dt);
    }
    look.pad.target = state.body.padding;
    look.blend.target = state.body.blend;
    look.soft.target = params.softness;
    look.exposure.target = params.exposure;
    look.neckR.target = state.body.neckR;
    look.eyes.target = state.body.eyes;
    for (const k in look) look[k].step(dt);

    mouse.amt.target = mouse.inside ? 1 : 0;
    mouse.amt.step(dt);
    ripple.t += dt;
    scan.t += dt;
    clock += dt * params.drift;
    gradT += dt * (0.15 + 1.6 * (params.gradFlow ?? 0.4));   // gradient: the colours' flow
    unfT += dt * 1.6 * (params.unfinishedSpeed ?? 0.4);   // flat hd 2, unfinished: how fast the gaps move
    easeK = 1 - Math.exp(-params.dotSpeed * dt);
    // cross-fade between views (~0.45 s)
    const approach = (v, goal) => v + Math.sign(goal - v) * Math.min(Math.abs(goal - v), dt / 0.45);
    for (const v of VIEWS) weight[v] = approach(weight[v], params.view === v ? 1 : 0);
    if (params.redraw !== redrawSeen) { redrawSeen = params.redraw; redrawT = 0; needTrace = true; }
    else redrawT += dt;
    densSmoke = params.moving ? Math.min(1, densSmoke + dt / 0.3) : Math.max(0, densSmoke - dt / 0.35);
    // cross page, density: the transition's amount — up as the turn starts (with the shape leaving),
    // full while it turns, back down over a little under a second once the view has settled
    const turningD = params.view === 'density' && (params.moving || (params.outT || 0) > 0);
    densTr = turningD ? Math.max(densTr, params.moving ? 1 : params.outT) : Math.max(0, densTr - dt / 0.9);
    ptScatter = params.moving ? Math.min(1, ptScatter + dt / 0.25) : Math.max(0, ptScatter - dt / 0.6);
    lastDt = dt;
    if (redrawT > 1e4) redrawT = 1e4;
    const fade = LINE_VIEWS.includes(params.view) ? 1 : Math.min(1, 0.15 + redrawT / (0.6 * CONFIG.camera.redraw));
    canvas.style.opacity = fade.toFixed(3);
  }

  const color = hexToRgb(CONFIG.palette.dot);

  function bindTex(unit, tex, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  /** Camera, body shape and add-on uniforms shared by the dots and blocks passes. */
  function sceneUniforms(u) {
    // camera (same projection as the SVG wireframes)
    const c = view.cam;
    gl.uniform3fv(u.uCamPos, c.pos);
    gl.uniform3fv(u.uCamRight, c.right);
    gl.uniform3fv(u.uCamUp, c.up);
    gl.uniform3fv(u.uCamFwd, c.fwd);
    gl.uniform1f(u.uFocal, view.focal() * pxr());
    gl.uniform2f(u.uCenterDev, view.cx * pxr(), size.h - view.cy * pxr());
    // lab · dots grid: the light can be moved (direction around the object, height), so the
    // dots — which follow the light — show the surfaces differently
    if (params.view === 'dots' && params.dotStyle === 'grid') {
      const az = params.lightAz * Math.PI / 180, el = params.lightEl * Math.PI / 180;
      gl.uniform3f(u.uLight, Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    } else gl.uniform3fv(u.uLight, CONFIG.light);

    const W = CONFIG.wheel, S = CONFIG.screen;
    // case 2 has no wheels: they are parked far away, outside the bounds (never hit)
    const noWheels = state.kind === 'speaker';
    gl.uniform2f(u.uWL, noWheels ? -1e4 : geo.wlx.value, noWheels ? -1e4 : geo.wly.value);
    gl.uniform2f(u.uWR, noWheels ? 1e4 : geo.wrx.value, noWheels ? -1e4 : geo.wry.value);
    gl.uniform1f(u.uWheelR, W.h / 2);
    gl.uniform1f(u.uWheelHalfW, W.w / 2);
    gl.uniform2f(u.uScr, geo.sx.value, geo.sy.value);
    gl.uniform3f(u.uScrHalf, S.w / 2, S.h / 2, S.d / 2);
    gl.uniform2f(u.uDispHalf, S.display.w / 2, S.display.h / 2);
    gl.uniform1f(u.uDispOffY, S.display.offsetY);

    // real parts inside + the provisional structure tying them together
    const L = layoutParts({
      kind: state.kind,
      screen: state.screenType,
      withScreen: state.withScreen,
      screenSpot: state.screenSpot, knobFront: state.knobFront, screenMount: state.screenMount,
      speakerLib: state.speakerLib,
      power: state.power,
      shape: state.shape,
      totem: state.totem,
      stretch: state.stretch, moves: state.moves, wheelD: state.wheelD, wheelSpread: state.wheelSpread,
      knobCount: state.extras.filter((e) => e.type === 'knob').length,
      wl: [geo.wlx.value, geo.wly.value],
      wr: [geo.wrx.value, geo.wry.value],
      scr: [geo.sx.value, geo.sy.value],
      pad: look.pad.value,
      neckR: look.neckR.value,
      extras,
      wheelHalfW: W.w / 2,
      screenHalfH: S.h / 2,
    });
    const n = L.parts.length;
    for (let i = 0; i < n; i++) {
      partC.set(L.parts[i].c, i * 3);
      partH.set(L.parts[i].h, i * 3);
      partR.set(L.parts[i].R, i * 9);
      partType[i] = L.parts[i].type;
      partEnv[i] = L.parts[i].env;
    }
    gl.uniform1i(u.uPartCount, n);
    // case 2 wheels (it moves): from the layout — position, axle depth, size
    const WH = state.kind === 'speaker' ? L.wheels : null;
    if (state.kind === 'speaker') {
      gl.uniform2f(u.uWL, WH ? WH.l[0] : -1e4, WH ? WH.l[1] : -1e4);
      gl.uniform2f(u.uWR, WH ? WH.r[0] : 1e4, WH ? WH.r[1] : -1e4);
    }
    gl.uniform1f(u.uWheelZ, WH ? WH.z : 0);
    gl.uniform1f(u.uWheelScale, WH ? WH.scale : state.kind === 'robot' ? state.wheelD / 90 : 1);   // (the robot: the wheels node's size)
    gl.uniform1f(u.uAxleIn, WH ? WH.axleIn : 0);
    if (u['uPartC[0]']) {
      gl.uniform3fv(u['uPartC[0]'], partC);
      gl.uniform3fv(u['uPartH[0]'], partH);
      gl.uniformMatrix3fv(u['uPartR[0]'], false, partR);
      gl.uniform1fv(u['uPartEnv[0]'], partEnv);
    }
    if (u['uPartType[0]']) gl.uniform1iv(u['uPartType[0]'], partType);
    gl.uniform3fv(u.uChassisA, L.chassis.a);
    gl.uniform3fv(u.uChassisB, L.chassis.b);
    gl.uniform1f(u.uChassisR, L.chassis.r);
    gl.uniform3fv(u.uNeckA, L.neck.a);
    gl.uniform3fv(u.uNeckB, L.neck.b);
    gl.uniform1f(u.uNeckR, L.neck.r);
    const Ps = L.prims ?? [];
    gl.uniform1i(u.uPrimCount, Ps.length);
    if (Ps.length && u['uPrimKind[0]']) {
      const kind = new Int32Array(6), n = new Int32Array(6), c = new Float32Array(12), h = new Float32Array(12);
      const A = new Float32Array(6), rot = new Float32Array(6), z = new Float32Array(12), rnd = new Float32Array(6);
      Ps.slice(0, 6).forEach((P, i) => {
        kind[i] = P.kind; n[i] = P.n; c.set(P.c, i * 2); h.set(P.h, i * 2);
        A[i] = P.a; rot[i] = P.rot; z.set(P.z, i * 2); rnd[i] = P.round;
      });
      gl.uniform1iv(u['uPrimKind[0]'], kind);
      gl.uniform1iv(u['uPrimN[0]'], n);
      gl.uniform2fv(u['uPrimC[0]'], c);
      gl.uniform2fv(u['uPrimH[0]'], h);
      gl.uniform1fv(u['uPrimA[0]'], A);
      gl.uniform1fv(u['uPrimRot[0]'], rot);
      gl.uniform2fv(u['uPrimZ[0]'], z);
      gl.uniform1fv(u['uPrimRound[0]'], rnd);
    }
    layout = L;
    const ST = L.stretch ?? { c: [0, 0], s: [1, 1] };
    gl.uniform4f(u.uStretch, ST.c[0], ST.c[1], ST.s[0], ST.s[1]);

    // cables
    L.cables.forEach((cb, ci) => {
      const kind = CABLES[cb.kind];
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      cb.points.forEach((pt, k) => {
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pt[a] - kind.r); hi[a] = Math.max(hi[a], pt[a] + kind.r); }
        cableData.set([pt[0], pt[1], pt[2], 0], (ci * 16 + 2 + k) * 4);
      });
      cableData.set([lo[0], lo[1], lo[2], kind.r], ci * 16 * 4);
      cableData.set([hi[0], hi[1], hi[2], kind.code], (ci * 16 + 1) * 4);
    });
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, cableTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_CABLES * 16, 1, gl.RGBA, gl.FLOAT, cableData);
    gl.uniform1i(u.uCables, 3);
    gl.uniform1i(u.uCableN, L.cables.length);
    const all = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    L.cables.forEach((cb, ci) => {
      for (let a = 0; a < 3; a++) {
        all[0][a] = Math.min(all[0][a], cableData[ci * 64 + a]);
        all[1][a] = Math.max(all[1][a], cableData[ci * 64 + 4 + a]);
      }
    });
    if (L.cables.length) {
      gl.uniform3fv(u.uCableLo, all[0]);
      gl.uniform3fv(u.uCableHi, all[1]);
    }
    const hiIdx = params.highlight ? L.parts.findIndex((p) => p.key === params.highlight) : -1;
    gl.uniform1i(u.uHi, hiIdx);

    // tight bounding sphere around everything, so rays start right at the object
    const mx0 = L.parts.some((p) => p.key === 'matrix');
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const grow = (c, e) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k] - e[k]); hi[k] = Math.max(hi[k], c[k] + e[k]); } };
    for (const part of L.parts) {
      const R = part.R, h = part.h;
      grow(part.c, [0, 1, 2].map((k) => Math.abs(R[k]) * h[0] + Math.abs(R[3 + k]) * h[1] + Math.abs(R[6 + k]) * (h[2] + 7)));
    }
    if (!noWheels) {
      const ws = state.wheelD / 90;
      grow([geo.wlx.value, geo.wly.value, 0], [16 * ws, 46 * ws, 46 * ws]);
      grow([geo.wrx.value, geo.wry.value, 0], [16 * ws, 46 * ws, 46 * ws]);
    }
    if (WH) for (const w of [WH.l, WH.r]) grow([w[0], w[1], WH.z], [WH.hw + 1, WH.R + 1, WH.R + 1]);
    grow(L.neck.a, [L.neck.r, L.neck.r, L.neck.r]);
    for (const Pm of Ps) {
      // box half size, or the profile's circumradius
      const r = Pm.kind === 2 || Pm.kind === 4 ? Pm.a : Pm.a / Math.cos(Math.PI / Math.max(Pm.n, 3));
      const e = Pm.kind === 1 ? Pm.h : [r, r];
      grow([Pm.c[0], Pm.c[1], (Pm.z[0] + Pm.z[1]) / 2], [e[0], e[1], (Pm.z[0] - Pm.z[1]) / 2]);
    }
    grow(L.chassis.a, [L.chassis.r, L.chassis.r, L.chassis.r]);
    grow(L.chassis.b, [L.chassis.r, L.chassis.r, L.chassis.r]);
    // the stretched skin reaches further out, in x and y from the stretch centre
    for (let k = 0; k < 2; k++) { lo[k] = ST.c[k] + (lo[k] - ST.c[k]) * ST.s[k]; hi[k] = ST.c[k] + (hi[k] - ST.c[k]) * ST.s[k]; }
    if (mx0 && state.kind === 'robot') grow([geo.sx.value, geo.sy.value, 0], [S.w / 2, S.h / 2 + 18, 20]); // matrix + frog eyes
    for (const e of extras) grow(e.p, [16, 16, 16]);                       // knob caps
    objCenter = lo.map((v, k) => (v + hi[k]) / 2);   // the object itself (not the cable to the wall): the camera looks here
    for (const cb of L.cables) if (cb.kind === 'wall') for (const pt of cb.points) grow(pt, [3, 3, 3]); // the cable to the wall
    const margin = look.pad.value + params.breathe + params.reach + 4;
    const bc = lo.map((v, k) => (v + hi[k]) / 2);
    const br = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + margin;
    gl.uniform3fv(u.uBoundC, bc);
    gl.uniform1f(u.uBoundR, br);
    bound = { c: bc, r: br };
    // window in the skin over the LED matrix's LEDs
    const mx = L.parts.find((p) => p.key === 'matrix');
    if (mx) {
      gl.uniform3f(u.uWinC, mx.c[0], mx.c[1] + S.display.offsetY, mx.c[2]);
      gl.uniform3f(u.uWinH, S.display.w / 2 + 1.5, S.display.h / 2 + 1.5, mx.h[2]);
    } else {
      gl.uniform3f(u.uWinH, 0, 0, 0);
    }
    gl.uniform1f(u.uEyes, Math.max(0, look.eyes.value));
    gl.uniform1f(u.uPad, look.pad.value);
    gl.uniform1f(u.uBlend, look.blend.value);

    // surface-mounted add-ons (slid outward if their module needed room: see parts.js)
    const count = Math.min(MAX_EXTRAS, extras.length);
    for (let i = 0; i < count; i++) {
      const e = extras[i];
      const off = layout?.offsets?.[i] ?? 0;
      extraP.set(e.p.map((v, k) => v + e.n[k] * off), i * 3);
      extraN.set(e.n, i * 3);
      extraInfo.set([e.type === 'knob' ? 1 : 0, e.scale, (e.angle * Math.PI) / 180, 0], i * 4);
    }
    const X = CONFIG.extras;
    gl.uniform1i(u.uExtraCount, count);
    if (u['uExtraP[0]']) {
      gl.uniform3fv(u['uExtraP[0]'], extraP);
      gl.uniform3fv(u['uExtraN[0]'], extraN);
      gl.uniform4fv(u['uExtraInfo[0]'], extraInfo);
    }
    const SG = state.speakerLib === 'speakerSmall' ? X.speaker.small : X.speaker;
    gl.uniform3f(u.uSpk, SG.r, SG.hole, X.speaker.depth);
    // speaker grille pattern and LED drawing
    if (holeKey !== state.speakerPattern) {
      holeKey = state.speakerPattern;
      const hp = holePattern(holeKey).slice(0, 32);
      holeData.fill(0);
      hp.forEach((h, i) => holeData.set(h, i * 2));
      holeN = hp.length;
    }
    if (u['uSpkHoles[0]']) gl.uniform2fv(u['uSpkHoles[0]'], holeData);
    gl.uniform1i(u.uSpkHoleN, holeN);
    ledBits.fill(0);
    state.leds.forEach((on, i) => { if (on) ledBits[i >> 5] |= 1 << (i & 31); });
    if (u['uLed[0]']) gl.uniform1uiv(u['uLed[0]'], ledBits);
    gl.uniform3f(u.uKnob, X.knob.r, X.knob.h, X.knob.boss);
  }

  function renderLevels() {
    const u = level.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, size.gw, size.gh);
    gl.useProgram(level.prog);
    gl.disable(gl.BLEND);

    gl.uniform1f(u.uCell, size.cell);
    gl.uniform2f(u.uOffset, size.ox, size.oy);
    gl.uniform1f(u.uSplitX, (view.vw / 2) * pxr());
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);

    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);

    gl.uniform1f(u.uSoft, Math.max(0.01, look.soft.value));
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uExposure, look.exposure.value);
    gl.uniform1f(u.uDriftAmt, params.cluster);
    gl.uniform1i(u.uMethod, METHODS[params.method] ?? 0);
    gl.uniform1i(u.uRings, params.rings ? 1 : 0);
    gl.uniform1f(u.uRingAmt, params.ringAmount);
    gl.uniform1f(u.uEdgeFocus, params.edgeFocus);
    bindTex(0, blueTex, u.uBlue);

    gl.bindVertexArray(level.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderEase() {
    gl.disable(gl.BLEND);
    // swap: last frame's result becomes `prev`, we write into `cur`
    [cur, prev] = [prev, cur];
    const u = ease.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo);
    gl.viewport(0, 0, size.gw, size.gh);
    gl.useProgram(ease.prog);
    bindTex(0, target.tex, u.uTarget);
    bindTex(1, prev.tex, u.uPrev);
    gl.uniform1f(u.uK, easeK);
    gl.bindVertexArray(ease.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderDots(alpha) {
    const u = dots.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(dots.prog);
    gl.uniform1f(u.uAlpha, alpha);

    bindTex(0, cur.tex, u.uState);
    gl.uniform1f(u.uCell, size.cell);
    gl.uniform2f(u.uOffset, size.ox, size.oy);
    gl.uniform1f(u.uDot, params.dotSize);
    gl.uniform1f(u.uSizeByLight, params.sizeByLight);
    gl.uniform1f(u.uLine, Math.max(1, Math.min(1.2 * pxr(), size.cell * 0.14)));
    gl.uniform3fv(u.uColor, color);

    gl.uniform2f(u.uMouseDev, mouse.x * pxr(), size.h - mouse.y * pxr());
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uLensR, 70 * pxr());
    gl.uniform2f(u.uRippleDev, ripple.x * pxr(), size.h - ripple.y * pxr());
    gl.uniform1f(u.uRippleT, ripple.t);
    gl.uniform1f(u.uScanT, scan.t / scan.dur);
    gl.uniform1f(u.uHeight, size.h);

    gl.bindVertexArray(dots.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  const fixedRgb = hexToRgb(CONFIG.palette.dot);
  const blockRgb = hexToRgb(CONFIG.palette.blockLine);
  const S = CONFIG.palette.solid;
  const solidRgb = {
    fixedLo: hexToRgb(S.fixedLo), fixedHi: hexToRgb(S.fixedHi),
    bodyLo: hexToRgb(S.bodyLo), bodyHi: hexToRgb(S.bodyHi),
    dark: hexToRgb(S.dark),
  };

  /** Fixed parts follow the raw state in the block views, so they track the hand exactly. */
  function blockUniforms(u) {
    sceneUniforms(u);
    const noWheels = state.kind === 'speaker';
    gl.uniform2f(u.uCWL, noWheels ? -1e4 : state.wheels.left.x, noWheels ? -1e4 : state.wheels.left.y);
    gl.uniform2f(u.uCWR, noWheels ? 1e4 : state.wheels.right.x, noWheels ? -1e4 : state.wheels.right.y);
    gl.uniform2f(u.uCScr, state.screen.x, state.screen.y);
  }

  /** Lines view: g-buffer of hard blocks, then the visible outlines. */
  function renderLines(alpha) {
    let u = gbuf.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(gbuf.prog);
    blockUniforms(u);
    gl.uniform1f(u.uSmooth, 0); // lines view: hard blocks
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.bindVertexArray(gbuf.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    u = edge.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(edge.prog);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform3fv(u.uFixed, fixedRgb);
    gl.uniform3fv(u.uBody, blockRgb);
    gl.bindVertexArray(edge.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }



  /** Dots view: a point cloud on the provisional body; fixed parts solid. */
  function renderCloud(alpha) {
    const u = cloud.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(cloud.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);

    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uSpacing, params.pitch);
    gl.uniform1f(u.uDotR, params.pitch * params.dotSize * 0.3);
    gl.uniform3fv(u.uDotColor, color);
    gl.uniform3fv(u.uFixedLo, solidRgb.fixedLo);
    gl.uniform3fv(u.uFixedHi, solidRgb.fixedHi);
    gl.uniform3fv(u.uDark, solidRgb.dark);
    gl.uniform3fv(u.uSolidLight, CONFIG.solidLight);

    gl.uniform2f(u.uMouseDev, mouse.x * pxr(), size.h - mouse.y * pxr());
    gl.uniform1f(u.uLensR, 70 * pxr());
    gl.uniform2f(u.uRippleDev, ripple.x * pxr(), size.h - ripple.y * pxr());
    gl.uniform1f(u.uRippleT, ripple.t);
    gl.uniform1f(u.uScanT, scan.t / scan.dur);
    gl.uniform1f(u.uHeight, size.h);
    gl.bindVertexArray(cloud.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // flat view: one colour per kind of part, indexed by LIBRARY[..].type
  const holeData = new Float32Array(64);
  let holeKey = null, holeN = 0;
  const ledBits = new Uint32Array(4);
  const typeColors = new Float32Array(13 * 3);
  // the cross 'colour' style: the nodes' palette (yellow · orange · cyan · olive), one colour per kind of part
  const nodeColors = new Float32Array(13 * 3);
  for (const k in LIBRARY) if (NODE_PALETTE.parts[k]) nodeColors.set(hexToRgb(NODE_PALETTE.parts[k]), LIBRARY[k].type * 3);
  const pixel3dColors = new Float32Array(13 * 3);
  let pixel3dPal = -1;
  function pixel3dPalette() {
    const pals = CONFIG.pixel3d.palettes, i = ((params.palette3d % pals.length) + pals.length) % pals.length;
    if (i !== pixel3dPal) {
      pixel3dPal = i;
      for (const k in LIBRARY) if (pals[i].parts[k]) pixel3dColors.set(hexToRgb(pals[i].parts[k]), LIBRARY[k].type * 3);
    }
    return pals[i];
  }
  const blobColors = new Float32Array(13 * 3);
  for (const k in LIBRARY) if (CONFIG.palette.blob.parts[k]) blobColors.set(hexToRgb(CONFIG.palette.blob.parts[k]), LIBRARY[k].type * 3);
  Object.values(LIBRARY).forEach((lib) => {
    const c = CONFIG.palette.flat.parts[Object.keys(LIBRARY).find((k) => LIBRARY[k] === lib)];
    if (c) typeColors.set(hexToRgb(c), lib.type * 3);
  });

  /** Flat view: coloured shapes for the parts, coloured contours, pencil cables. */
  function renderFlat(alpha, sketch, animate = false) {
    if (animate) {
      // flat hd 2: the flat g-buffer with face classes, for the corner lines (and the strokes)
      gl.useProgram(flat2g.prog);
      gl.uniform1f(flat2g.uniforms.uFaces, 1);
      flat2Gbuffer(gtarget, flatBreathe());
      gl.useProgram(flat2g.prog);
      gl.uniform1f(flat2g.uniforms.uFaces, 0);
      // (also when the canvas changed size since the last trace: else the pen's map no longer matches the line)
      if (needTrace || (lastTraceW !== size.w && !params.moving && !(params.outT > 0))) traceNow();
    }
    const u = flat.uniforms;
    // flat hd 2's blur slider; 'follows': the parts sharpen as the line leaves (turning), 'stays': always blurred
    const guide = params.moving ? 1 : params.outT || 0;
    const blurPx = animate ? (params.frost ?? 0) * (params.frostFollow ? 1 - guide : 1) * 14 * pxr() : 0;
    const split = blurPx > 0.5;
    if (split) {
      // the inside parts to a layer of their own, the rest (sharp) to another: blurred and laid together below
      flatSplit.resize(size.w, size.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, flatSplit.fbo);
      gl.viewport(0, 0, size.w, size.h);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, size.w, size.h);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.useProgram(flat.prog);
    gl.uniform1f(u.uSplit, split ? 1 : 0);
    gl.uniform1f(u.uUnfinished, animate && params.unfinished ? 1 : 0);
    gl.uniform1f(u.uUnfT, unfT);
    gl.uniform1f(u.uLineGrey, animate && params.flatLines === 'grey' ? 1 : 0);
    gl.uniform1f(u.uPartsLine, animate && params.flatParts === 'outline' ? 1 : 0);
    gl.uniform1f(u.uUnfGaps, params.unfGaps ?? 0.6);
    gl.uniform1f(u.uUnfTwice, params.unfTwice ?? 0.5);
    gl.uniform1f(u.uUnfHand, 1.2 * (params.unfHand ?? 0.38));
    gl.uniform1f(u.uAlive, animate ? params.flatAlive ?? 0.4 : 0);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, animate ? flatBreathe() : params.breathe);   // (flat hd 2: the 'alive' slider)
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uSketch, sketch);
    gl.uniform1f(u.uAnim, animate ? 1 : 0);
    gl.uniform1f(u.uOutT, animate ? params.outT || 0 : 0);   // flat hd 2: the drag began, the contour un-draws
    gl.uniform1f(u.uGuide, animate ? (params.moving ? 1 : params.outT || 0) : 0);   // …and turns into a grey pencil line
    gl.uniform1f(u.uGuideW, pxr());
    gl.uniform1f(u.uInsideA, animate ? params.flatInside ?? 1 : 1);
    gl.uniform1f(u.uOutsideA, animate ? params.flatOutside ?? 1 : 1);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uLineW, Math.max(1, 1.1 * pxr()));
    redrawUniforms(u);
    bindTex(4, strokeTex, u.uStroke);
    gl.uniform1f(u.uStrokeK, strokeW / Math.max(1, lastTraceW));
    const F = CONFIG.palette.flat;
    gl.uniform3fv(u.uFInk, hexToRgb(F.ink));
    gl.uniform3fv(u.uFRed, hexToRgb(F.red));
    gl.uniform3fv(u.uFBlue, hexToRgb(F.blue));
    gl.uniform3fv(u.uFGreen, hexToRgb(F.green));
    gl.uniform3fv(u.uFOrange, hexToRgb(F.orange));
    gl.uniform3fv(u.uHiCol, params.highlightColour ? hexToRgb(params.highlightColour) : [0, 0, 0]);
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);
    gl.bindVertexArray(flat.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (split) {
      const b = flatBlur.uniforms;
      gl.useProgram(flatBlur.prog);
      gl.uniform1f(b.uR, blurPx);
      // across, into the spare layer
      gl.bindFramebuffer(gl.FRAMEBUFFER, flatSplit.fboTmp);
      gl.clear(gl.COLOR_BUFFER_BIT);
      bindTex(0, flatSplit.inner, b.uTex);
      bindTex(1, flatSplit.over, b.uOver);
      gl.uniform2f(b.uDir, 1, 0);
      gl.uniform1f(b.uFinal, 0);
      gl.bindVertexArray(flatBlur.quad);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // down, onto the screen, with the sharp layer on top
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      bindTex(0, flatSplit.tmp, b.uTex);
      gl.uniform2f(b.uDir, 0, 1);
      gl.uniform1f(b.uFinal, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  /** Flat 2: what is seen (ids + depths) into the g-buffer, then fills and clean lines. */
  /** Flat hd 2: how much the shape breathes ('still ↔ alive': from barely to clearly). */
  const flatBreathe = () => params.breathe * (0.25 + 3.75 * (params.flatAlive ?? 0.4));
  function flat2Gbuffer(into = gtarget, breathe = params.breathe) {
    const u = flat2g.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(flat2g.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, breathe);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.bindVertexArray(flat2g.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderFlat2(alpha) {
    flat2Gbuffer();
    let u;
    u = flat2e.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(flat2e.prog);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uLineW, Math.max(1, 1.1 * pxr()));
    if (u['uPartType[0]']) gl.uniform1iv(u['uPartType[0]'], partType);
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);
    const L = layout;
    gl.uniform1i(u.uHi, params.highlight && L ? L.parts.findIndex((p) => p.key === params.highlight) : -1);
    const F = CONFIG.palette.flat;
    gl.uniform3fv(u.uFInk, hexToRgb(F.ink));
    gl.uniform3fv(u.uFRed, hexToRgb(F.red));
    gl.uniform3fv(u.uFBlue, hexToRgb(F.blue));
    gl.uniform3fv(u.uFGreen, hexToRgb(F.green));
    gl.uniform3fv(u.uFOrange, hexToRgb(F.orange));
    gl.bindVertexArray(flat2e.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Pixel view: the skin as a halftone mosaic (parts and cables are drawn in SVG). */
  function renderPixel(alpha) {
    const cell = Math.max(6, CONFIG.pixelCellMm * view.scale * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;

    // pass 1: one texel per cell
    let u = pixel.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(pixel.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.bindVertexArray(pixel.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // pass 2: the mosaic with its contours
    u = pixelD.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pixelD.prog);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uLineW, Math.max(1, 1.1 * pxr()));
    const L = layout;
    gl.uniform1i(u.uHi, params.highlight && L ? L.parts.findIndex((p) => p.key === params.highlight) : -1);
    if (u['uPartType[0]']) gl.uniform1iv(u['uPartType[0]'], partType);
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);
    const P = CONFIG.palette.pixel;
    gl.uniform3fv(u.uPRed, hexToRgb(P.red));
    gl.uniform3fv(u.uPPink, hexToRgb(P.pink));
    gl.uniform3fv(u.uPLight, hexToRgb(P.light));
    gl.uniform3fv(u.uPBlue, hexToRgb(P.blue));
    gl.uniform3fv(u.uPInk, hexToRgb(CONFIG.palette.flat.ink));
    gl.bindVertexArray(pixelD.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }


  /** Empty: graph paper; silhouette and parts as stepped outlines along the cell borders. */
  function renderEmpty(alpha) {
    const cell = Math.max(6, CONFIG.emptyCellMm * view.scale * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;

    // pass 1: one texel per cell
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // pass 2: paper and ink
    u = emptyE.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(emptyE.prog);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uLineW, Math.max(1, 1.25 * pxr()));
    const L = layout;
    gl.uniform1i(u.uHi, params.highlight && L ? L.parts.findIndex((p) => p.key === params.highlight) : -1);
    const E = params.look === 1 ? CONFIG.palette.emptyA : CONFIG.palette.empty;
    gl.uniform3fv(u.uInk, hexToRgb(E.ink));
    gl.uniform3fv(u.uHiInk, hexToRgb(E.hi));
    gl.uniform3fv(u.uPaper, hexToRgb(E.paper));
    gl.bindVertexArray(emptyE.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Sketch: the shape as a stepped pencil drawing (silhouette + face creases), the parts high fidelity. */
  function renderSketch(alpha) {
    const cell = Math.max(6, CONFIG.sketch.cellMm * view.scale * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;

    // pass 1: one texel per cell, with the face it sees
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.uniform1f(u.uFaces, 1);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(u.uFaces, 0);   // the empty and pixel 3d views share this program

    // pass 2: paper, pencil, and the real parts
    u = sketch.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(sketch.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uLineW, Math.max(1, 1.25 * pxr()));
    redrawUniforms(u);
    const S = CONFIG.palette.sketch;
    gl.uniform3fv(u.uInk, hexToRgb(S.ink));
    gl.uniform3fv(u.uSoftInk, hexToRgb(S.soft));
    gl.uniform3fv(u.uHiInk, hexToRgb(S.hi));
    gl.uniform3fv(u.uPaper, hexToRgb(S.paper));
    gl.bindVertexArray(sketch.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * The camera has just cut to a new view: read the flat g-buffer (already rendered into
   * gtarget) back and trace its lines into pen strokes (strokes.js).
   * flat hd: profile, then the corners · flat hd 2: the profile only.
   */
  function traceNow() {
    needTrace = false;
    const px = new Uint8Array(size.w * size.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.readPixels(0, 0, size.w, size.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const win = { sil: [0.16, 0.62], crease: [0.52, 0.86], rest: 0.9 };   // profile, then the corners (flat hd and flat hd 2)
    const st = traceStrokes(px, size.w, size.h, STROKE_S, win);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, strokeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, st.tw, st.th, 0, gl.RED, gl.FLOAT, st.data);
    strokeW = st.tw;
    lastTraceW = size.w;
  }

  /** Flat hd: flat 1's clean lines with face tints and creases, the parts high fidelity. */
  function renderFlatHd(alpha, creases = false) {
    flat2g.uniforms;   // make sure the program exists before setting uFaces
    gl.useProgram(flat2g.prog);
    gl.uniform1f(flat2g.uniforms.uFaces, 1);
    flat2Gbuffer();
    gl.useProgram(flat2g.prog);
    gl.uniform1f(flat2g.uniforms.uFaces, 0);   // flat 1 / orbital share this program
    if (needTrace) traceNow();
    const u = flathd.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(flathd.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uLineW, Math.max(1, 1.1 * pxr()));
    redrawUniforms(u);
    bindTex(4, strokeTex, u.uStroke);
    gl.uniform1f(u.uStrokeK, strokeW / Math.max(1, lastTraceW));
    const F = CONFIG.palette.flat;
    gl.uniform3fv(u.uFInk, hexToRgb(F.ink));
    gl.uniform3fv(u.uFRed, hexToRgb(F.red));
    gl.uniform3fv(u.uFBlue, hexToRgb(F.blue));
    gl.uniform3fv(u.uFGreen, hexToRgb(F.green));
    gl.uniform3fv(u.uFill, hexToRgb(CONFIG.palette.flatHdFill));
    gl.uniform3fv(u.uLine, hexToRgb(CONFIG.palette.flatHdLine));
    gl.uniform1f(u.uCreases, creases ? 1 : 0);
    gl.bindVertexArray(flathd.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Milk: a solid milky silicone body, the parts inside in their own clear colours. */
  const milkColors = new Float32Array(13 * 3);
  for (const k in LIBRARY) if (CONFIG.milk.parts[k]) milkColors.set(hexToRgb(CONFIG.milk.parts[k]), LIBRARY[k].type * 3);
  function renderMilk(alpha) {
    const u = milk.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(milk.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uAlpha, alpha);
    const M = CONFIG.milk;
    gl.uniform3fv(u.uMilk, hexToRgb(M.skin));
    gl.uniform3fv(u.uMilkShade, hexToRgb(M.shade));
    gl.uniform1f(u.uVeil, M.veil);
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], milkColors);
    gl.bindVertexArray(milk.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Live (2D): a point cloud that gathers on the outlines, on black. */
  function renderLive(alpha) {
    const cell = Math.max(3, CONFIG.live.cellPx * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;

    // pass 1: what covers each cell
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.uniform1f(u.uFaces, 1);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(u.uFaces, 0);

    // pass 2: closeness to the outlines, per cell (the g-buffer is read with the same +1 offset)
    const key = `${cols}x${rows}`;
    if (key !== liveSize) { liveTarget.resize(cols, rows); liveSize = key; }
    u = liveE.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, liveTarget.fbo);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(liveE.prog);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1i(u.uZero, 0);
    gl.bindVertexArray(liveE.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // pass 3: full-res g-buffer for the profile line and where the parts are
    flat2Gbuffer();

    // pass 4: the points, the parts, the profile
    u = liveD.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(liveD.prog);
    sceneUniforms(u);
    bindTex(0, liveTarget.tex, u.uE);
    bindTex(1, gtarget.tex, u.uG);
    gl.uniform1f(u.uLineW, Math.max(1, 1.2 * pxr()));
    gl.uniform3fv(u.uLineCol, hexToRgb(CONFIG.live.line));
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uTime, clock);
    gl.uniform1f(u.uDotPx, CONFIG.live.dotPx * pxr());
    gl.uniform3fv(u.uSkinCol, hexToRgb(CONFIG.live.skin));
    gl.bindVertexArray(liveD.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  const markerColors = new Float32Array(13 * 3);
  for (const k in LIBRARY) if (CONFIG.marker.parts[k]) markerColors.set(hexToRgb(CONFIG.marker.parts[k]), LIBRARY[k].type * 3);
  /** Marker: flat felt-pen fills per face, stepped wobbly edges, streaks; parts high fidelity. */
  function renderMarker(alpha) {
    const cell = Math.max(1.5, CONFIG.marker.cellPx * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.uniform1f(u.uFaces, 1);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(u.uFaces, 0);

    u = markerV.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(markerV.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    redrawUniforms(u);
    gl.uniform1f(u.uDrawT, params.moving ? 0 : Math.min(1, redrawT / CONFIG.marker.redraw));
    // the parts wobble: clearly while they move and while the shape forms, barely at rest
    const mt = Math.min(1, redrawT / CONFIG.marker.redraw);
    gl.uniform1f(u.uWobble, (params.moving ? 2.6 : 0.5 + 2.1 * (1 - mt)) * pxr());
    const M = CONFIG.marker;
    gl.uniform3fv(u.uFront, hexToRgb(M.front));
    gl.uniform3fv(u.uSide, hexToRgb(M.side));
    gl.uniform3fv(u.uTop, hexToRgb(M.top));
    gl.uniform3fv(u.uBack, hexToRgb(M.back));
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], markerColors);
    gl.bindVertexArray(markerV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Density: the parts' projected boxes as soft halos, summed and cut into flat bands. */
  const rectData = new Float32Array(12 * 4), rectW = new Float32Array(12);
  const jellyOff = [0, 0];
  function renderDensity(alpha) {
    const L = layout;
    let n = 0;
    jellyOff[0] = 0; jellyOff[1] = 0;
    if (L) for (const part of L.parts) {
      if (n >= 12) break;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const R = part.R, h = part.h;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = [0, 1, 2].map((k) => part.c[k] + sx * h[0] * R[k] + sy * h[1] * R[3 + k] + sz * h[2] * R[6 + k]);
        const [x, y] = view.project(p[0], p[1], p[2]);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const r = pxr();
      // the halo lags behind its part on an underdamped spring: the blob trails, overshoots, settles
      const goal = [(x0 + x1) / 2 * r, size.h - (y0 + y1) / 2 * r, (x1 - x0) / 2 * r * 0.6, (y1 - y0) / 2 * r * 0.6];
      const J = densJelly[n] ??= { v: goal.slice(), vel: [0, 0, 0, 0] };
      const w = 2 * Math.PI * (1.5 + 0.2 * (n % 4)), z = 0.55;        // each part its own, soft wobble
      const steps = Math.max(1, Math.ceil(lastDt / (1 / 120))), hdt = Math.min(lastDt, 0.1) / steps;
      for (let s = 0; s < steps; s++) for (let k = 0; k < 4; k++) {
        J.vel[k] += (w * w * (goal[k] - J.v[k]) - 2 * z * w * J.vel[k]) * hdt;
        J.v[k] += J.vel[k] * hdt;
      }
      if (Math.abs(goal[0] - J.v[0]) > size.w) J.v = goal.slice();   // (first frame / resize: no fly-in)
      rectData.set(J.v, n * 4);
      jellyOff[0] += J.v[0] - goal[0]; jellyOff[1] += J.v[1] - goal[1];
      rectW[n] = 0.6 + Math.min(1.2, (h[0] * h[1] * h[2]) / 8000);
      n++;
    }
    flat2Gbuffer(g2target);   // which part is seen where: for the white outlines
    // the shape, one texel per small cell (with faces), for the blurred silhouette
    const cell = Math.max(3, 3 * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    let ue = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, Math.ceil(size.w / cell) + 2, Math.ceil(size.h / cell) + 2);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(ue.uTime, clock);
    sceneUniforms(ue);
    gl.uniform1f(ue.uBreathe, params.breathe * Math.min(2, params.densMotion * 2.5));   // the surface breathes with the motion slider (still at 0)
    gl.uniform1f(ue.uCellPx, cell);
    gl.uniform2f(ue.uGridOff, off[0], off[1]);
    gl.uniform1f(ue.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(ue.uFar, CONFIG.camera.distance + 320);
    gl.uniform1f(ue.uFaces, 1);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(ue.uFaces, 0);

    const u = densV.uniforms;
    // pass 0: the field, flowing from last frame's (densA) into densB
    gl.bindFramebuffer(gl.FRAMEBUFFER, densB.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.useProgram(densV.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    gl.uniform1f(u.uAlpha, alpha);
    if (u['uRect[0]']) gl.uniform4fv(u['uRect[0]'], rectData);
    if (u['uRectW[0]']) gl.uniform1fv(u['uRectW[0]'], rectW);
    const D = CONFIG.density;
    gl.uniform1i(u.uRectN, n);
    gl.uniform2f(u.uJelly, n ? jellyOff[0] / n : 0, n ? jellyOff[1] / n : 0);   // the shape's blur follows the blob's mean lag
    bindTex(0, gtarget.tex, u.uG);
    bindTex(1, g2target.tex, u.uP);
    gl.uniform1f(u.uLineW, Math.max(1, 1.2 * pxr()));
    gl.uniform3fv(u.uLineCol, hexToRgb(D.line));
    gl.uniform1i(u.uShowSil, params.densLines.object ? 1 : 0);
    gl.uniform1i(u.uShowParts, params.densLines.parts ? 1 : 0);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    // the transition: the smoke spreads out (wider halo, fewer bands, more haze), then condenses back
    const crossPage = document.body.dataset.page === 'cross';
    const sm = crossPage ? 0 : densSmoke * densSmoke * (3 - 2 * densSmoke);   // (the cross page has its own transitions)
    const trMode = ['condense', 'evaporate', 'liquid'].indexOf(params.densTrans ?? 'condense');
    const tr = crossPage ? densTr : 0;
    const soft = (params.densStyle ?? 'bands') === 'soft';
    // the soft ball: the softness slider spreads it (a rounder, softer ball)
    gl.uniform1f(u.uSigma, D.spreadMm * (1 + 0.3 * sm) * (1 + (trMode === 1 ? 1.4 * tr : 0)) * (soft ? 0.8 + 1.8 * (params.densSoft ?? 0.5) : 1) * view.scale * pxr());
    gl.uniform1f(u.uTr, tr);
    gl.uniform1i(u.uTrMode, Math.max(0, trMode));
    gl.uniform1i(u.uStyle, soft ? 1 : 0);
    // (condense / evaporate: as the ball goes, the parts come forward)
    gl.uniform1f(u.uInsideA, (params.densInside ?? 0) + (trMode < 2 ? (1 - (params.densInside ?? 0)) * tr : 0));
    gl.uniform1f(u.uFrost, params.densFrost ?? 0);
    gl.uniform1f(u.uGlow, params.densGlow ?? 0);
    gl.uniform1f(u.uDGrain, params.densGrain ?? 1);
    gl.uniform1f(u.uDEdge, params.densEdge ?? 0.47);
    gl.uniform1f(u.uDiverge, document.body.dataset.page === 'cross' ? params.densDiverge ?? 0.3 : -1);   // (the main page: as before)
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);
    gl.uniform1f(u.uOutsideA, params.densOutside ?? 0);
    gl.uniform1f(u.uHaze, 0.3 + 0.35 * sm);
    gl.uniform1f(u.uMotion, params.densMotion);
    const ramp = D.palettes[(params.densPalette ?? D.palette) % D.palettes.length];
    if (u['uRamp[0]']) gl.uniform3fv(u['uRamp[0]'], new Float32Array(ramp.flatMap(hexToRgb)));
    gl.uniform1f(u.uLevels, (ramp.length - 1) * (1 - 0.2 * sm));
    gl.uniform1i(u.uPass, 0);
    bindTex(2, densA.tex, u.uPrev);
    // memory: settles fast at rest, flows slowly (liquid) while the view changes
    // flows while the view changes, settles quickly once it has arrived (liquid: lags behind, settles slowly)
    const rate = crossPage && trMode === 2 ? (params.moving ? 1.1 : densTr > 0 ? 3.5 : 16) : params.moving ? 3.2 : 16;
    gl.uniform1f(u.uK, densFresh ? 1 : 1 - Math.exp(-rate * lastDt));
    densFresh = false;
    gl.bindVertexArray(densV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    [densA, densB] = [densB, densA];
    // pass 1: bands, outlines
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(u.uPass, 1);
    bindTex(2, densA.tex, u.uPrev);
    gl.bindVertexArray(densV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Particles: a clean, still dot grid inside the shape, a 2D outline, parts as outlines. */
  function renderParticles(alpha) {
    const P = CONFIG.particles;
    flat2Gbuffer(g2target);
    const cell = Math.max(4, P.cellPx * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, Math.ceil(size.w / cell) + 2, Math.ceil(size.h / cell) + 2);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    gl.uniform1f(u.uBreathe, 0);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    u = partV.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(partV.prog);
    bindTex(0, gtarget.tex, u.uG);
    bindTex(1, g2target.tex, u.uP);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uFill, P.fill);
    gl.uniform1f(u.uPartFill, P.partFill);
    gl.uniform1f(u.uRingFrac, P.rings);
    gl.uniform1f(u.uDotR, P.dotR);
    gl.uniform1f(u.uLineW, Math.max(1, 1.0 * pxr()));
    gl.uniform3fv(u.uInk, hexToRgb(P.ink));
    gl.uniform3fv(u.uLineCol, hexToRgb(P.line));
    gl.uniform3fv(u.uPartLine, hexToRgb(P.partLine));
    gl.bindVertexArray(partV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Picasso: one brush contour, construction lines, lithographic black parts, a ground stroke. */
  function renderPicasso(alpha) {
    gl.useProgram(flat2g.prog);
    gl.uniform1f(flat2g.uniforms.uFaces, 1);
    flat2Gbuffer();
    gl.useProgram(flat2g.prog);
    gl.uniform1f(flat2g.uniforms.uFaces, 0);
    if (needTrace) traceNow();
    const u = picV.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(picV.prog);
    bindTex(0, gtarget.tex, u.uG);
    bindTex(4, strokeTex, u.uStroke);
    gl.uniform1f(u.uStrokeK, strokeW / Math.max(1, lastTraceW));
    gl.uniform1f(u.uDrawT, params.moving ? 0 : Math.min(1, redrawT / CONFIG.flatHd.redraw));
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uLineW, Math.max(1.2, 1.5 * pxr()));
    gl.uniform3fv(u.uInk, hexToRgb(CONFIG.picasso.ink));
    // the ground stroke: under the object's box, a little wider than it
    const oc = objCenter || bound.c, r = bound.r;
    const [gx, cyS] = view.project(oc[0], oc[1], oc[2]);
    const gy = cyS + r * 0.74 * view.scale;                  // just below the object as seen (any view)
    const half = r * 0.95 * view.scale;
    gl.uniform4f(u.uGround, (gx - half) * pxr(), (gx + half) * pxr(), size.h - gy * pxr(), 3.2 * pxr());
    gl.bindVertexArray(picV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Overlay layers (lab · dots grid): object outline, part outlines, hi-fi parts. */
  function renderOverlay(alpha, G) {
    flat2Gbuffer(g2target);
    const u = overV.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(overV.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    bindTex(1, g2target.tex, u.uP);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uLineW, Math.max(0.6, (G.lineW ?? 1) * pxr()));
    gl.uniform3fv(u.uLineCol, hexToRgb(CONFIG.palette.dot));
    gl.uniform1i(u.uShowSil, G.outline ? 1 : 0);
    gl.uniform1i(u.uShowPartLines, G.lines ? 1 : 0);
    gl.uniform1i(u.uShowParts, G.hifi ? 1 : 0);
    gl.bindVertexArray(overV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Cross: rounded cell islands, one tone per face, on a grid of crosses; parts high fidelity. */
  function renderCross(alpha, pattern = true) {
    // cross: whole cells · cross 2: smooth (one 'cell' per device px), no pattern
    const cell = pattern ? Math.max(4, (params.crossCellMm ?? CONFIG.cross.cellMm) * view.scale * pxr()) : 1;   // the detail slider
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.shimmer ?? params.breathe);   // the shimmer slider
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.uniform1f(u.uFaces, 1);
    // conservative: a cell counts as 'near a part' within ~one cell (mm) of it, cables included
    gl.uniform1f(u.uPartEps, Math.max(1.5, 0.75 * cell / (view.scale * pxr())));
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(u.uFaces, 0);
    gl.uniform1f(u.uPartEps, 0);   // (the program is shared with other views)

    // pass 2: the hifi layer — only when what it shows has changed (it is by far the heaviest pass)
    const X = params.look === 1 ? { ...CONFIG.cross, ...CONFIG.cross.lookA } : CONFIG.cross;   // look a: warm greys
    const pstyle = Math.max(0, ['colour', 'grey', 'flat', 'vector', 'line', 'boxes', 'flathd2', 'outline', 'gridline', 'dots', 'crosses', 'flat1'].indexOf(params.partStyle || 'colour'));
    const outerWanted = pattern && (params.outsideOpacity ?? 0) > 0.01 && !params.moving;   // the outside only at rest
    // the program for it — compiled in the background: until it is ready (this can take ~40 s on
    // ANGLE / D3D the first time), draw with one that is, instead of freezing the page
    const vName = pstyle === 5 && crossHv.boxes.ready() ? 'boxes' : 'parts';
    if (pstyle === 5) crossHv.boxes.warm();
    if (outerWanted) crossHv.outer.warm();
    const outerOn = outerWanted && crossHv.outer.ready();
    const hs = params.moving || params.outT > 0 ? CONFIG.cross.movingRes : 1;   // while the camera moves: the parts at low resolution (much cheaper)
    const hw = Math.ceil(size.w * hs), hh = Math.ceil(size.h * hs);
    // the loose voxels shown while the object turns (eased in / out)
    crossGhost += ((params.moving || params.outT > 0 ? 1 : 0) - crossGhost) * Math.min(1, lastDt * (params.moving ? 10 : 6));
    // rounded well below a pixel: the springs and the camera ease forever by ever smaller amounts
    const cam = view.cam, mm = (v) => Math.round(v * 20), dir = (v) => Math.round(v * 1e4);
    const J = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? mm(v) : v));
    const key = [size.w, size.h, Math.round(view.focal() * pxr() * 10), Math.round(view.cx * 10), Math.round(view.cy * 10), ...cam.pos.map(mm), ...cam.right.map(dir), ...cam.up.map(dir)].join(',')
      + '|' + J(extras) + '|' + J(layout?.parts?.map((q) => q.c)) + '|' + J(layout?.stretch) + '|' + J(layout?.prims) + '|' + J(layout?.cables?.map((q) => q.points))
      + '|' + vName + pstyle + outerOn + hs + params.look + params.highlight + params.highlightColour + state.speakerPattern + state.leds.join('');
    crossHifi.resize(size.w, size.h);
    if (key !== crossHifi.key) {
      crossHifi.key = key;
      gl.bindFramebuffer(gl.FRAMEBUFFER, crossHifi.fbo);
      gl.viewport(0, 0, hw, hh);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // only where the object can be: the projected box of its bounding sphere
      const pr = bound.c.map((v) => v);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const [px, py] = view.project(pr[0] + (i & 1 ? 1 : -1) * bound.r, pr[1] + (i & 2 ? 1 : -1) * bound.r, pr[2] + (i & 4 ? 1 : -1) * bound.r);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const sx0 = Math.max(0, Math.floor(x0 * pxr() * hs)), sx1 = Math.min(hw, Math.ceil(x1 * pxr() * hs));
      const sy0 = Math.max(0, Math.floor((size.h - y1 * pxr()) * hs)), sy1 = Math.min(hh, Math.ceil((size.h - y0 * pxr()) * hs));
      if (sx1 > sx0 && sy1 > sy0) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(sx0, sy0, sx1 - sx0, sy1 - sy0);
        // the mask (depth only): near a part, or on the skin when the outside is drawn
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.ALWAYS);
        gl.colorMask(false, false, false, false);
        let um = crossM.uniforms;
        gl.useProgram(crossM.prog);
        bindTex(4, gtarget.tex, um.uG);
        gl.uniform1f(um.uCellPx, cell * hs);
        gl.uniform2f(um.uGridOff, off[0] * hs, off[1] * hs);
        gl.uniform1f(um.uSkin, outerOn ? 1 : 0);
        gl.bindVertexArray(crossM.quad);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.depthFunc(gl.GREATER);   // the quad sits at depth 0.5: only where the mask wrote 0
        const drawHifi = (crossH) => {
          u = crossH.uniforms;
          gl.useProgram(crossH.prog);
          gl.uniform1f(u.uTime, clock);
          sceneUniforms(u);
          gl.uniform1f(u.uFocal, view.focal() * pxr() * hs);
          gl.uniform2f(u.uCenterDev, view.cx * pxr() * hs, (size.h - view.cy * pxr()) * hs);
          gl.uniform2f(u.uMouse, 0, 0);       // the outside is drawn at rest (no lean, no breathing)
          gl.uniform1f(u.uMouseAmt, 0);
          gl.uniform1f(u.uBreathe, 0);
          gl.uniform1i(u.uPartStyle, pstyle);
          gl.uniform3fv(u.uPartTint, X.tint ?? [1, 1, 1]);
          gl.uniform1f(u.uOuterOn, outerOn ? 1 : 0);
          gl.uniform1i(u.uSteps, 110);
          gl.uniform3fv(u.uHiCol, params.highlightColour ? hexToRgb(params.highlightColour) : [0, 0, 0]);
          bindTex(4, gtarget.tex, u.uG);
          gl.uniform1f(u.uCellPx, cell * hs);
          gl.uniform2f(u.uGridOff, off[0] * hs, off[1] * hs);
          gl.uniform2f(u.uCellRange, CONFIG.camera.distance - 320, CONFIG.camera.distance + 320);
          if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], nodeColors);   // ('colour' style: the node palette)
          const camD = Math.hypot(...[0, 1, 2].map((k) => cam.pos[k] - bound.c[k]));
          gl.uniform2f(u.uDepthRange, camD - bound.r, camD + bound.r);
          gl.bindVertexArray(crossH.quad);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        };
        drawHifi(crossHv[vName]);
        if (outerOn) {
          // the outside: its own small program, into the outer target only (over the screen's face)
          gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1, gl.NONE]);
          drawHifi(crossHv.outer);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
      }
    }

    // pass 3: cells + marks + the hifi layer (cheap, every frame)
    u = crossV.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(crossV.prog);
    bindTex(0, gtarget.tex, u.uG);
    bindTex(1, crossHifi.parts, u.uParts);
    bindTex(2, crossHifi.outer, u.uOuterTex);
    bindTex(3, crossHifi.meta, u.uMeta);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uOuter, outerOn ? params.outsideOpacity : 0);   // the outside slider
    gl.uniform1f(u.uInside, pattern ? params.insideOpacity ?? 1 : 1);   // the inside slider
    gl.uniform1f(u.uHifiScale, hs);
    gl.uniform1f(u.uGhost, pattern ? crossGhost : 0);
    gl.uniform1f(u.uFrost, params.frost ?? 0);
    gl.uniform1f(u.uFrostFollow, params.frostFollow ? 1 : 0);
    gl.uniform1f(u.uVoxAmt, params.voxels ?? 0.2);
    gl.uniform1f(u.uVoxShimmer, params.voxShimmer ?? 0.2);
    gl.uniform1f(u.uTime, clock);
    gl.uniform3fv(u.uLightFill, hexToRgb(X.light));
    gl.uniform3fv(u.uTopFill, hexToRgb(X.top));
    gl.uniform3fv(u.uSideFill, hexToRgb(X.side));
    gl.uniform3fv(u.uWheelFill, hexToRgb(X.wheel));
    gl.uniform3fv(u.uDotCol, hexToRgb(X.dot));
    gl.uniform3fv(u.uPageDot, hexToRgb(X.pageDot));
    gl.uniform1f(u.uPattern, pattern ? 1 : 0);
    gl.uniform1i(u.uPartStyle, pstyle);
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);   // the flat hd 2 colours
    if (u['uPartType[0]']) gl.uniform1iv(u['uPartType[0]'], partType);
    gl.uniform3fv(u.uPartCell, hexToRgb(X.partCell));
    gl.uniform1i(u.uMark, ['dot', 'cross', 'ring', 'bracket'].indexOf(params.snapStyle || 'dot'));
    redrawUniforms(u);
    gl.uniform1f(u.uDrawT, !pattern ? 1 : params.moving ? 0 : Math.min(1, redrawT / CONFIG.cross.redraw));   // cross builds up cell by cell
    gl.uniform1f(u.uOutT, pattern ? params.outT || 0 : 0);   // …and leaves cell by cell
    gl.uniform1i(u.uAnim, Math.max(0, ['scatter', 'wipe', 'ripple', 'cut', 'pop', 'flicker'].indexOf(params.crossAnim || 'scatter')));
    gl.bindVertexArray(crossV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Blob view: metaballs — the parts as soft coloured bodies melting into each other. */
  function renderBlob(alpha) {
    const u = blob.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(blob.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uMerge, 9 + look.blend.value * 0.6);
    gl.uniform1f(u.uSwell, 3 + look.pad.value * 0.5);
    const Bc = CONFIG.palette.blob;
    if (u['uBlobColor[0]']) gl.uniform3fv(u['uBlobColor[0]'], blobColors);
    gl.uniform3fv(u.uBlobWheel, hexToRgb(Bc.wheel));
    gl.uniform3fv(u.uBlobKnob, hexToRgb(Bc.knob));
    gl.bindVertexArray(blob.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Gradient: the object as a soft blob, grainy flowing colours, a flat coloured page. */
  function renderGradient(alpha) {
    const u = gradV.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(gradV.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    gl.uniform1f(u.uAlpha, alpha);
    const G = CONFIG.gradient.palettes[(params.gradPalette ?? 0) % CONFIG.gradient.palettes.length];
    gl.uniform3fv(u.uBg, hexToRgb(G[0]));
    if (u['uPal[0]']) gl.uniform3fv(u['uPal[0]'], new Float32Array(G.slice(1).flatMap(hexToRgb)));
    gl.uniform1f(u.uBgOn, params.gradPage === false ? 0 : 1);
    gl.uniform1f(u.uInflate, 4 + 10 * (params.gradRound ?? 0.5));
    gl.uniform1f(u.uRound, params.gradRound ?? 0.5);
    gl.uniform1f(u.uWobble, params.gradWobble ?? 0.35);
    gl.uniform1f(u.uGrain, params.gradGrain ?? 0.6);
    gl.uniform1f(u.uOutsideA, params.gradOutside ?? 1);
    gl.uniform1f(u.uFT, gradT);
    gl.bindVertexArray(gradV.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Pixel 2: one ray per cell — solid part cells, halftone skin, solid silhouette cells. */
  function renderPixel2(alpha) {
    const u = pixel2.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pixel2.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uAlpha, alpha);
    const cell = Math.max(6, CONFIG.pixelCellMm * view.scale * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell));
    const P = CONFIG.palette.pixel;
    gl.uniform3fv(u.uPRed, hexToRgb(P.red));
    gl.uniform3fv(u.uPPink, hexToRgb(P.pink));
    gl.uniform3fv(u.uPLight, hexToRgb(P.light));
    gl.uniform3fv(u.uPBlue, hexToRgb(P.blue));
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);
    gl.bindVertexArray(pixel2.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Orbital: the shape as a soft density cloud, the parts as ink outlines over it. */
  function renderOrbital(alpha) {
    let u = orbital.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(orbital.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uDensity, CONFIG.orbital.density);
    gl.uniform1f(u.uFade, CONFIG.orbital.soft);
    gl.uniform3fv(u.uInk, hexToRgb(CONFIG.orbital.cloud));
    gl.bindVertexArray(orbital.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    flat2Gbuffer();
    u = orbitalE.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(orbitalE.prog);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uLineW, Math.max(1, 1.0 * pxr()));
    const L = layout;
    gl.uniform1i(u.uHi, params.highlight && L ? L.parts.findIndex((p) => p.key === params.highlight) : -1);
    gl.uniform3fv(u.uInk, hexToRgb(CONFIG.orbital.line));
    gl.uniform3fv(u.uHiInk, hexToRgb(CONFIG.palette.pixel.red));
    gl.bindVertexArray(orbitalE.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Pixel 3d: the shape as solid flat pixels, the parts as lit 3D models in playful colours. */
  function renderPixel3d(alpha) {
    const cell = Math.max(5, CONFIG.pixel3d.cellMm * view.scale * pxr());
    const mod = (a, b) => ((a % b) + b) % b;
    const off = [mod(view.cx * pxr(), cell), mod(size.h - view.cy * pxr(), cell)];
    const cols = Math.ceil(size.w / cell) + 2;
    const rows = Math.ceil(size.h / cell) + 2;

    // pass 1: what covers each cell (same as the empty view)
    let u = emptyC.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(emptyC.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    gl.uniform1f(u.uNear, CONFIG.camera.distance - 320);
    gl.uniform1f(u.uFar, CONFIG.camera.distance + 320);
    gl.bindVertexArray(emptyC.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // pass 2: flat pixels + 3D parts
    u = pixel3d.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pixel3d.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    bindTex(0, gtarget.tex, u.uG);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uCellPx, cell);
    gl.uniform2f(u.uGridOff, off[0], off[1]);
    const C3 = pixel3dPalette();
    // grey version: the shape just a touch darker than the page, with a dot pattern
    // look a warm greys with dots; look b a plain, slightly darker cool grey (parts keep their colour)
    const G = params.look === 1 ? ['#e3e2df', '#d8d6d2', '#c9c7c2'] : ['#d4d4d7', '#c9c9cd', '#c4c4c9'];
    gl.uniform3fv(u.uSkinCol, hexToRgb(params.pixel3dGrey ? G[0] : state.kind === 'speaker' ? C3.skinSpeaker : C3.skin));
    gl.uniform3fv(u.uWheelCol, hexToRgb(params.pixel3dGrey ? G[1] : C3.wheel));
    gl.uniform1f(u.uMono, params.pixel3dGrey ? 1 : 0);
    gl.uniform1f(u.uMonoParts, params.pixel3dGrey && params.look === 1 ? 1 : 0);
    gl.uniform1f(u.uDots, params.look === 1 ? 1 : 0);   // look b: plain grey, no dots
    gl.uniform3fv(u.uDotCol, hexToRgb(G[2]));
    gl.uniform1f(u.uDotStep, Math.max(3, cell / 2));
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], pixel3dColors);
    gl.bindVertexArray(pixel3d.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Glass: a frosted glass body with the parts inside, bright and playful. */
  function renderGlass(alpha) {
    const u = glass.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(glass.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uFrost, CONFIG.glass.frost);
    pixel3dPalette();   // same playful palettes as pixel 3d (they change at "start over")
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], pixel3dColors);
    gl.bindVertexArray(glass.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render() {
    resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (weight.dots > 0.01) {
      if (params.dotStyle === 'cloud') {
        renderCloud(weight.dots);
      } else {
        renderLevels();
        renderEase();
        renderDots(weight.dots);
        const G = params.gridShow;   // lab · dots grid: optional object / part outlines, hi-fi parts
        if (G.outline || G.lines || G.hifi) renderOverlay(weight.dots, G);
      }
    }
    if (weight.blocks > 0.01) renderLines(weight.blocks);
    if (weight.flat > 0.01) renderFlat(weight.flat, 1);
    if (weight.flat2 > 0.01) renderFlat2(weight.flat2);
    if (weight.pixel > 0.01) renderPixel(weight.pixel);
    if (weight.pixel2 > 0.01) renderPixel2(weight.pixel2);
    if (weight.orbital > 0.01) renderOrbital(weight.orbital);
    if (weight.pixel3d > 0.01) renderPixel3d(weight.pixel3d);
    if (weight.glass > 0.01) renderGlass(weight.glass);
    if (weight.empty > 0.01) renderEmpty(weight.empty);
    if (weight.sketch > 0.01) renderSketch(weight.sketch);
    if (weight.flathd > 0.01) renderFlatHd(weight.flathd, true);              // with the corners
    if (weight.flathd2 > 0.01) renderFlat(weight.flathd2, 1, true);          // the old 'flat 2', drawing itself in
    if (weight.milk > 0.01) renderMilk(weight.milk);
    if (weight.live > 0.01) renderLive(weight.live);
    if (weight.cross > 0.01) renderCross(weight.cross);
    if (weight.cross2 > 0.01) renderCross(weight.cross2, false);   // only the snap points (SVG dots)
    if (weight.marker > 0.01) renderMarker(weight.marker);
    if (weight.density > 0.01) renderDensity(weight.density);
    if (weight.particles > 0.01) renderParticles(weight.particles);
    if (weight.picasso > 0.01) renderPicasso(weight.picasso);
    if (weight.blob > 0.01) renderBlob(weight.blob);
    if (weight.gradient > 0.01) renderGradient(weight.gradient);
  }

  return {
    update,
    render,
    /** Cursor position in CSS px (client coords); `inside` = pointer is over the page. */
    setPointer(x, y, inside = true) {
      mouse.x = x;
      mouse.y = y;
      mouse.inside = inside;
    },
    /** The cross view's dot grid in CSS px: centre of cell (i, j) = off + (i + 0.5, j + 0.5) · cell (y down). */
    dotGrid() {
      const r = pxr();
      const cell = Math.max(4, (params.crossCellMm ?? CONFIG.cross.cellMm) * view.scale * r);
      const mod = (a, b) => ((a % b) + b) % b;
      const ox = mod(view.cx * r, cell), oyGl = mod(size.h - view.cy * r, cell);
      // flip the GL rows to CSS: a centre at GL y = oyGl + (j + .5)·cell sits at CSS y = (h − that) / r
      return { cell: cell / r, ox: ox / r, oyTop: mod(size.h - oyGl, cell) / r };
    },
    /** Bounding sphere of the object (mm): { c, r }. */
    bounds: () => bound,
    /** Centre of the object's box in mm (null before the first frame). */
    center: () => objCenter,
    /** The part layout used for the last frame (parts, cables). */
    layout: () => layout,
    /** Add-on poses for this frame: [{ type, p, n, scale, angle }]. */
    setExtras(list) {
      extras = list;
    },
    /** Sweep a scan band up through the dots (a prompt is being "read"). */
    scan(duration = 1.2) {
      scan.t = 0;
      scan.dur = duration;
    },
    /** Start a ripple from a point in CSS px. */
    ripple(x, y) {
      ripple.x = x;
      ripple.y = y;
      ripple.t = 0;
    },
  };
}
