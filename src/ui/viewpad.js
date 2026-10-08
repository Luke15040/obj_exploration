import { view } from '../view.js?v=202610081559';

/**
 * The views node — two ways to pick one of the essential drawn views:
 *
 *  compass  edges = orthographic elevations (front · right · back · left), corners =
 *           axonometric views from above, centre = plan. Every icon marks where the
 *           object's FRONT is: filled face on the axonometric cubes and on the front
 *           elevation, a thick edge on the side elevations and the plan.
 *  cube     a view cube like in 3D modelling tools: it turns with the camera; click a
 *           face for the orthographic view (TOP = plan), a top corner for the
 *           axonometric view from that corner.
 *
 * A click cuts (or glides) to that view, exactly like dragging or the arrow keys.
 * Orbit step k: yaw = k · 45°, the camera on that side (0 front, 2 right, 4 back, 6 left).
 */
export const CELLS = [
  { k: 5, name: 'axonometric · back left' }, { k: 4, name: 'back' }, { k: 3, name: 'axonometric · back right' },
  { k: 6, name: 'left' }, { top: true, name: 'plan (top)' }, { k: 2, name: 'right' },
  { k: 7, name: 'axonometric · front left' }, { k: 0, name: 'front' }, { k: 1, name: 'axonometric · front right' },
];

// a small iso cube: top, left face, right face (as seen from a top corner)
const CUBE_TOP = 'M8 2.8 13 5.6 8 8.4 3 5.6Z';
const CUBE_L = 'M3 5.6 8 8.4V14L3 11.2Z';
const CUBE_R = 'M8 8.4 13 5.6v5.6L8 14Z';
const cubeIcon = (frontSide) => `<svg viewBox="0 0 16 16">
  <path d="${CUBE_TOP}"/><path d="${CUBE_L}" class="${frontSide === 'L' ? 'front' : ''}"/><path d="${CUBE_R}" class="${frontSide === 'R' ? 'front' : ''}"/></svg>`;
export const ICONS = {
  // axonometric: front-right camera sees the front on the left of the image, front-left on the right
  1: cubeIcon('L'), 7: cubeIcon('R'), 3: cubeIcon(null), 5: cubeIcon(null),
  0: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" class="front"/></svg>',
  4: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8"/></svg>',
  2: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8"/><path d="M4 4v8" class="edge"/></svg>',   // right: front on the left
  6: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8"/><path d="M12 4v8" class="edge"/></svg>',  // left: front on the right
  top: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8"/><path d="M4 12h8" class="edge"/></svg>', // plan: front at the bottom
};

// the view cube: faces (normal, view, label) and the four top corners (axonometric views)
const FACES = [
  { n: [0, 0, 1], k: 0, label: 'FRONT' }, { n: [1, 0, 0], k: 2, label: 'RIGHT' },
  { n: [0, 0, -1], k: 4, label: 'BACK' }, { n: [-1, 0, 0], k: 6, label: 'LEFT' },
  { n: [0, 1, 0], top: true, label: 'TOP' }, { n: [0, -1, 0], none: true, label: '' },
];
const CORNERS = [
  { p: [1, 1, 1], k: 1 }, { p: [1, 1, -1], k: 3 }, { p: [-1, 1, -1], k: 5 }, { p: [-1, 1, 1], k: 7 },
];

/** Builds the views node (a tool node like the others; nodes.js places, drags and closes it). */
export function createViewPad({ orbit }) {
  const root = document.createElement('div');
  root.className = 'node vws tool hidden';
  root.innerHTML = `<div class="tab">views</div><div class="card">
    <div class="grid">${CELLS.map((c, i) => `<button data-i="${i}" title="${c.name}">${ICONS[c.top ? 'top' : c.k]}</button>`).join('')}</div>
    <svg class="vcube" viewBox="-50 -50 100 100" role="img" aria-label="view cube"></svg>
    <div class="mode"><button data-mode="grid" title="compass">compass</button><button data-mode="cube" title="view cube">cube</button></div>
    <div class="value"><span class="k">view</span><span class="v"></span></div>
  </div>`;
  document.body.appendChild(root);
  const cube = root.querySelector('.vcube');
  let mode = document.body.dataset.page === 'cross' ? 'grid' : 'cube';   // cross page: the compass first

  const setMode = (m) => {
    mode = m;
    root.classList.toggle('as-cube', m === 'cube');
    root.querySelectorAll('.mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  };
  setMode(mode);

  const mark = () => {
    const cur = orbit.current();
    const k8 = ((cur.k % 8) + 8) % 8;
    // the view in words (a free resting angle from the angle snap has no name)
    const cell = CELLS.find((c) => (cur.top ? c.top : !c.top && c.k === k8));
    root.querySelector('.value .v').textContent = cur.free ? `${Math.round(((cur.free.yaw % 360) + 360) % 360)}° · ${Math.round(cur.free.pitch)}°` : cell ? cell.name.replace(' (top)', '') : '';
    root.querySelectorAll('.grid button').forEach((b) => {
      const c = CELLS[Number(b.dataset.i)];
      b.classList.toggle('on', c.top ? cur.top : !cur.top && c.k === k8);
    });
  };

  /* ---------- the cube, drawn with the camera's own axes (it turns as the view turns) ---------- */
  const S = 21;   // half size, px in the 100-unit box
  const P = (p) => {
    const c = view.cam;
    const d = (a) => p[0] * a[0] + p[1] * a[1] + p[2] * a[2];
    return [S * d(c.right), -S * d(c.up)];
  };
  // the 4 corners of a face with normal n
  const faceCorners = (n) => {
    const a = n[0] ? [0, 1, 2] : n[1] ? [1, 0, 2] : [2, 0, 1];
    const [i, u, v] = a, out = [];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0];
      p[i] = n[i]; p[u] = su; p[v] = sv;
      out.push(p);
    }
    return out;
  };
  let lastKey = '';
  function drawCube() {
    if (mode !== 'cube' || root.classList.contains('hidden')) return;
    const c = view.cam;
    const key = c.right.map((v) => v.toFixed(3)).join() + c.up.map((v) => v.toFixed(3)).join() + JSON.stringify(orbit.current());
    if (key === lastKey) return;
    lastKey = key;
    const cur = orbit.current();
    const k8 = ((cur.k % 8) + 8) % 8;
    const toCam = c.fwd.map((v) => -v);
    let html = '';
    // faces, back to front (only the ones turned toward the camera)
    const faces = FACES.map((f) => ({ ...f, facing: f.n[0] * toCam[0] + f.n[1] * toCam[1] + f.n[2] * toCam[2] }))
      .filter((f) => f.facing > 0.02).sort((a, b) => a.facing - b.facing);
    for (const f of faces) {
      const pts = faceCorners(f.n).map(P);
      const on = !f.none && (f.top ? cur.top : !cur.top && f.k === k8);
      const cls = ['face', f.k === 0 ? 'front' : '', on ? 'on' : '', f.none ? 'none' : ''].join(' ');
      const id = f.none ? '' : f.top ? 'data-top="1"' : `data-k="${f.k}"`;
      html += `<path class="${cls}" ${id} d="M${pts.map((q) => q.map((v) => v.toFixed(1)).join(' ')).join('L')}Z"><title>${f.label.toLowerCase()}</title></path>`;
      if (f.label && f.facing > 0.3) {
        const [x, y] = P(f.n);
        // the label squashed with the face, so it reads as printed on it
        html += `<text class="${on ? 'on' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" style="transform-box: fill-box; transform-origin: center; transform: scale(${Math.max(0.35, f.facing).toFixed(2)}, 1)">${f.label}</text>`;
      }
    }
    // the top corners: axonometric views
    for (const cn of CORNERS) {
      const facing = (cn.p[0] * toCam[0] + cn.p[1] * toCam[1] + cn.p[2] * toCam[2]) / Math.sqrt(3);
      if (facing < -0.2) continue;
      const [x, y] = P(cn.p);
      const on = !cur.top && cn.k === k8;
      html += `<circle class="corner${on ? ' on' : ''}" data-k="${cn.k}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.8"><title>axonometric</title></circle>`;
    }
    cube.innerHTML = html;
  }
  // follows the camera every frame (also while the parts glide between views)
  const loop = () => { drawCube(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__drawViewCube = () => { lastKey = ''; drawCube(); };   // debug: draw now (rAF is paused in a hidden tab)

  root.addEventListener('click', (e) => {
    const m = e.target.closest('.mode button');
    if (m) { setMode(m.dataset.mode); lastKey = ''; return; }
    const b = e.target.closest('.grid button');
    if (b) {
      const c = CELLS[Number(b.dataset.i)];
      if (c.top) orbit.goTo(null, true);
      else orbit.goTo(c.k, false);
      return;
    }
    const t = e.target.closest('.vcube [data-k], .vcube [data-top]');
    if (t) {
      if (t.dataset.top) orbit.goTo(null, true);
      else orbit.goTo(Number(t.dataset.k), false);
    }
  });
  orbit.onChange(() => { mark(); lastKey = ''; });
  mark();
  return root;
}
