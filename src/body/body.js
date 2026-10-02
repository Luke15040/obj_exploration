import { CONFIG } from '../config.js';
import { state, params } from '../state.js';
import { view } from '../view.js';
import { Spring } from './springs.js';
import { vertexShader, levelShader, easeShader, dotShader, cloudShader, flatShader, pixelShader, pixelDrawShader, pixel2Shader, orbitalShader, orbitalEdgeShader, pixel3dShader, glassShader, flat2GbufferShader, flat2EdgeShader, emptyCellShader, emptyEdgeShader, blobShader } from './shaders.js';
import { gbufferShader, edgeShader } from './blockshaders.js';
import { createProgram, createFullscreenQuad, createR8Texture, createTarget, hexToRgb } from './gl.js';
import { generateBlueNoise } from './bluenoise.js';
import { layoutParts, MAX_PARTS, MAX_CABLES, CABLE_POINTS, CABLES, LIBRARY } from '../parts.js';
import { holePattern } from '../speaker-patterns.js';

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
  const pxr = () => Math.min(view.dpr, MAX_PIXEL_RATIO) * quality;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL2 is not available');

  /** A shader program compiled on first use (each view only pays for its own). */
  const lazy = (fs) => {
    let p = null;
    const get = () => {
      if (!p) {
        const pr = createProgram(gl, vertexShader, fs);
        p = { ...pr, quad: createFullscreenQuad(gl, pr.prog) };
      }
      return p;
    };
    return { get prog() { return get().prog; }, get uniforms() { return get().uniforms; }, get quad() { return get().quad; } };
  };
  const level = lazy(levelShader);
  const ease = lazy(easeShader);
  const dots = lazy(dotShader);
  const cloud = lazy(cloudShader);
  const flat = lazy(flatShader);
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
  const gbuf = lazy(gbufferShader);
  const edge = lazy(edgeShader);
  const blueTex = createR8Texture(gl, 64, generateBlueNoise(64));
  const target = createTarget(gl);
  let cur = createTarget(gl);
  let prev = createTarget(gl);
  const gtarget = createTarget(gl); // full-res g-buffer for the blocks view
  // cross-fade weight of each view (1 = fully shown)
  const VIEWS = ['dots', 'blocks', 'flat', 'flat2', 'pixel', 'pixel2', 'empty', 'blob', 'orbital', 'pixel3d', 'glass'];
  const weight = Object.fromEntries(VIEWS.map((v) => [v, params.view === v ? 1 : 0]));

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
    }
    if (gw !== size.gw || gh !== size.gh) {
      target.resize(gw, gh);
      cur.resize(gw, gh);
      prev.resize(gw, gh);
    }
    size = { w, h, cell, gw, gh, ox, oy };
  }

  function update(dt) {
    frameTime += (dt - frameTime) * 0.1;
    qualityClock += dt;
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
    easeK = 1 - Math.exp(-params.dotSpeed * dt);
    // cross-fade between views (~0.45 s)
    const approach = (v, goal) => v + Math.sign(goal - v) * Math.min(Math.abs(goal - v), dt / 0.45);
    for (const v of VIEWS) weight[v] = approach(weight[v], params.view === v ? 1 : 0);
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
    gl.uniform3fv(u.uLight, CONFIG.light);

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
      power: state.power,
      shape: state.shape,
      totem: state.totem,
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
      grow([geo.wlx.value, geo.wly.value, 0], [16, 46, 46]);
      grow([geo.wrx.value, geo.wry.value, 0], [16, 46, 46]);
    }
    grow(L.neck.a, [L.neck.r, L.neck.r, L.neck.r]);
    for (const Pm of Ps) {
      // box half size, or the profile's circumradius
      const r = Pm.kind === 2 || Pm.kind === 4 ? Pm.a : Pm.a / Math.cos(Math.PI / Math.max(Pm.n, 3));
      const e = Pm.kind === 1 ? Pm.h : [r, r];
      grow([Pm.c[0], Pm.c[1], (Pm.z[0] + Pm.z[1]) / 2], [e[0], e[1], (Pm.z[0] - Pm.z[1]) / 2]);
    }
    grow(L.chassis.a, [L.chassis.r, L.chassis.r, L.chassis.r]);
    grow(L.chassis.b, [L.chassis.r, L.chassis.r, L.chassis.r]);
    if (mx0 && state.kind === 'robot') grow([geo.sx.value, geo.sy.value, 0], [S.w / 2, S.h / 2 + 18, 20]); // matrix + frog eyes
    for (const e of extras) grow(e.p, [16, 16, 16]);                       // knob caps
    for (const cb of L.cables) if (cb.kind === 'wall') for (const pt of cb.points) grow(pt, [3, 3, 3]); // the cable to the wall
    const margin = look.pad.value + params.breathe + params.reach + 4;
    const bc = lo.map((v, k) => (v + hi[k]) / 2);
    gl.uniform3fv(u.uBoundC, bc);
    gl.uniform1f(u.uBoundR, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + margin);
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
    gl.uniform3f(u.uSpk, X.speaker.r, X.speaker.hole, X.speaker.depth);
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
  const typeColors = new Float32Array(12 * 3);
  const pixel3dColors = new Float32Array(12 * 3);
  let pixel3dPal = -1;
  function pixel3dPalette() {
    const pals = CONFIG.pixel3d.palettes, i = ((params.palette3d % pals.length) + pals.length) % pals.length;
    if (i !== pixel3dPal) {
      pixel3dPal = i;
      for (const k in LIBRARY) if (pals[i].parts[k]) pixel3dColors.set(hexToRgb(pals[i].parts[k]), LIBRARY[k].type * 3);
    }
    return pals[i];
  }
  const blobColors = new Float32Array(12 * 3);
  for (const k in LIBRARY) if (CONFIG.palette.blob.parts[k]) blobColors.set(hexToRgb(CONFIG.palette.blob.parts[k]), LIBRARY[k].type * 3);
  Object.values(LIBRARY).forEach((lib) => {
    const c = CONFIG.palette.flat.parts[Object.keys(LIBRARY).find((k) => LIBRARY[k] === lib)];
    if (c) typeColors.set(hexToRgb(c), lib.type * 3);
  });

  /** Flat view: coloured shapes for the parts, coloured contours, pencil cables. */
  function renderFlat(alpha, sketch) {
    const u = flat.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size.w, size.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(flat.prog);
    gl.uniform1f(u.uTime, clock);
    sceneUniforms(u);
    const [mx, my] = view.toMm(mouse.x, mouse.y);
    gl.uniform2f(u.uMouse, mx, my);
    gl.uniform1f(u.uMouseAmt, Math.max(0, mouse.amt.value));
    gl.uniform1f(u.uReach, params.reach);
    gl.uniform1f(u.uBreathe, params.breathe);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uSketch, sketch);
    const F = CONFIG.palette.flat;
    gl.uniform3fv(u.uFInk, hexToRgb(F.ink));
    gl.uniform3fv(u.uFRed, hexToRgb(F.red));
    gl.uniform3fv(u.uFBlue, hexToRgb(F.blue));
    gl.uniform3fv(u.uFGreen, hexToRgb(F.green));
    gl.uniform3fv(u.uFOrange, hexToRgb(F.orange));
    if (u['uTypeColor[0]']) gl.uniform3fv(u['uTypeColor[0]'], typeColors);
    gl.bindVertexArray(flat.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Flat 2: what is seen (ids + depths) into the g-buffer, then fills and clean lines. */
  function flat2Gbuffer() {
    const u = flat2g.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gtarget.fbo);
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
    gl.uniform1f(u.uBreathe, params.breathe);
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
    const E = CONFIG.palette.empty;
    gl.uniform3fv(u.uInk, hexToRgb(E.ink));
    gl.uniform3fv(u.uHiInk, hexToRgb(E.hi));
    gl.uniform3fv(u.uPaper, hexToRgb(E.paper));
    gl.bindVertexArray(emptyE.quad);
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
    gl.uniform3fv(u.uSkinCol, hexToRgb(params.pixel3dGrey ? '#b4b4b8' : state.kind === 'speaker' ? C3.skinSpeaker : C3.skin));
    gl.uniform3fv(u.uWheelCol, hexToRgb(params.pixel3dGrey ? '#8c8c91' : C3.wheel));
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
    if (weight.blob > 0.01) renderBlob(weight.blob);
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
