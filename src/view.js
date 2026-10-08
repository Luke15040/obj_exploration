import { CONFIG } from './config.js?v=202610081603';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Shared view: viewport size, fit scale, and a perspective orbit camera.
 * The SVG wireframes and the shader use exactly the same projection, so the
 * crisp outlines and the dot field line up.
 *
 * World space = object space: mm, x right, y up, z toward the viewer.
 * `scale` is CSS px per mm at the camera target's depth.
 */
export const view = {
  vw: 0,
  vh: 0,
  dpr: 1,
  scale: CONFIG.pxPerMm,
  cx: 0, // CSS px of the camera target (viewport centre)
  cy: 0,

  cam: {
    yaw: 0,
    pitch: 0,
    target: [0, CONFIG.viewCenterY, 0],
    pos: [0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    fwd: [0, 0, -1],
  },

  zoom: 1, // mouse-wheel zoom on top of the fit scale

  /** Change the zoom (orbit.js eases it). */
  setZoom(z) {
    this.zoom = z;
    this.update();
  },

  update() {
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.dpr = window.devicePixelRatio || 1;

    // Rough object extents at the widest/tallest clamps, used to fit the window.
    const { limits, wheel, screen } = CONFIG;
    const widthMm = 2 * limits.wheelHalfTrack[1] + wheel.w + 40;
    const heightMm = limits.screenY[1] + screen.h / 2 - (limits.wheelY[0] - wheel.h / 2) + 30;
    const { top, bottom } = CONFIG.viewInsets;
    const availH = Math.max(200, this.vh - top - bottom);
    const fit = Math.min(
      (this.vw * 0.86) / (widthMm * CONFIG.pxPerMm),
      (availH * 0.9) / (heightMm * CONFIG.pxPerMm),
    );
    const [lo, hi] = CONFIG.fitRange;
    this.scale = CONFIG.pxPerMm * Math.min(hi, Math.max(lo, fit)) * this.zoom;

    this.cx = this.vw / 2;
    this.cy = top + availH / 2 + (document.body.dataset.page === 'cross' ? Math.round(this.vh * 0.015) : 0);   // (cross page: a touch lower, clear of the prompt)
  },

  /** Orbit the camera (radians) around the target. */
  setCamera(yaw, pitch) {
    const c = this.cam;
    const D = CONFIG.camera.distance;
    c.yaw = yaw;
    c.pitch = pitch;
    c.pos = [
      c.target[0] + D * Math.sin(yaw) * Math.cos(pitch),
      c.target[1] + D * Math.sin(pitch),
      c.target[2] + D * Math.cos(yaw) * Math.cos(pitch),
    ];
    c.fwd = norm(sub(c.target, c.pos));
    c.right = norm(cross(c.fwd, [0, 1, 0]));
    c.up = cross(c.right, c.fwd);
  },

  /** Focal length in CSS px: 1 mm at the target depth = `scale` px. */
  focal() {
    return this.scale * CONFIG.camera.distance;
  },

  /** world mm → CSS px (y down). Returns [px, py, depth]. */
  project(x, y, z) {
    const c = this.cam;
    const rel = sub([x, y, z], c.pos);
    const zc = Math.max(1, dot(rel, c.fwd));
    const f = this.focal();
    return [this.cx + (f * dot(rel, c.right)) / zc, this.cy - (f * dot(rel, c.up)) / zc, zc];
  },

  /** object mm on the z = 0 plane → CSS px */
  toPx(x, y, z = 0) {
    return this.project(x, y, z);
  },

  /** Camera ray through a CSS px point: { o, d } with d normalised. */
  ray(px, py) {
    const c = this.cam;
    const f = this.focal();
    const ox = (px - this.cx) / f;
    const oy = -(py - this.cy) / f;
    const d = norm([
      c.fwd[0] + c.right[0] * ox + c.up[0] * oy,
      c.fwd[1] + c.right[1] * ox + c.up[1] * oy,
      c.fwd[2] + c.right[2] * ox + c.up[2] * oy,
    ]);
    return { o: c.pos.slice(), d };
  },

  /** CSS px → point on the plane z = planeZ (where the parts slide), in mm. */
  toMm(px, py, planeZ = 0) {
    const c = this.cam;
    const f = this.focal();
    const ox = (px - this.cx) / f;
    const oy = -(py - this.cy) / f;
    const dir = [
      c.fwd[0] + c.right[0] * ox + c.up[0] * oy,
      c.fwd[1] + c.right[1] * ox + c.up[1] * oy,
      c.fwd[2] + c.right[2] * ox + c.up[2] * oy,
    ];
    // guard against grazing angles: never let the hit run off to infinity
    const dz = Math.abs(dir[2]) < 0.15 ? Math.sign(dir[2] || -1) * 0.15 : dir[2];
    const t = (planeZ - c.pos[2]) / dz;
    return [c.pos[0] + dir[0] * t, c.pos[1] + dir[1] * t];
  },
};
