import { view } from './view.js?v=202610081626';
import { state, setWheelSpread } from './state.js?v=202610081626';
import { createOrbit } from './orbit.js?v=202610081626';
import { createBody } from './body/body.js?v=202610081626';
import { createComponents } from './components/components.js?v=202610081626';
import { attachDrag } from './components/drag.js?v=202610081626';
import { createExtras } from './components/extras.js?v=202610081626';
import { createDebugPanel } from './debug/panel.js?v=202610081626';
import { createPrompts } from './prompts.js?v=202610081626';
import { createNodes } from './ui/nodes.js?v=202610081626';
import { createBom } from './ui/bom.js?v=202610081626';
import { createPartLabels } from './ui/labels.js?v=202610081626';
import { createDiagram } from './ui/diagram.js?v=202610081626';
import { createViewToggle } from './debug/viewtoggle.js?v=202610081626';
import { createViewPad } from './ui/viewpad.js?v=202610081626';
import { createFrame } from './ui/frame.js?v=202610081626';
import { createGridPanel } from './ui/gridpanel.js?v=202610081626';
import { createStretchPad } from './ui/stretchpad.js?v=202610081626';
// (the angle snap is a modifier on the cross page: viewtoggle.js)
// import { createSnapPad } from './ui/snappad.js?v=202610081626';
import { createWheelPad } from './ui/wheelpad.js?v=202610081626';
import { createDims } from './ui/dims.js?v=202610081626';

const canvas = document.getElementById('body-layer');
// if the GPU resets (driver timeout), come back with a fresh page once it is available again
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());
const svg = document.getElementById('components-layer');

view.update();

const orbit = createOrbit(svg);
const body = createBody(canvas);
const components = createComponents(svg);
const extras = createExtras(svg, { onPulse: (x, y) => body.ripple(x, y), offsets: () => body.layout()?.offsets ?? [], dotGrid: () => body.dotGrid() });
createDebugPanel({ orbit });
const nodes = createNodes({ body });
const bom = createBom({ body });
const labels = createPartLabels(svg, { body });
const diagram = createDiagram(svg, { body });
const prompts = createPrompts({ extras, body, nodes });
nodes.onApply = (id) => prompts.applyReference(id);
createViewToggle({ orbit });
createFrame({ body });
createGridPanel();
if (document.body.dataset.page !== 'cross') nodes.addTool('views', createViewPad({ orbit }), {
  name: 'views',
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3.5 19.5 7.8v8.4L12 20.5 4.5 16.2V7.8Z M4.5 7.8 12 12.1 19.5 7.8 M12 12.1v8.4"/></svg>',
});

// the cross page: a stretch node (the skin wider / taller); the add-ons follow to their spots
if (document.body.dataset.page === 'cross') {
  let pending = 0;
  if (false) nodes.addTool('stretch', createStretchPad({   // (the cross page: no stretch node)
    onChange: () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => prompts.placeAll()); },
  }), {
    name: 'stretch',
    icon: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1"/><path d="M3 12h3M18 12h3M12 3v3M12 18v3"/></svg>',
  });
  nodes.addTool('wheels', createWheelPad({ onChange: () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => prompts.placeAll()); }, layout: () => body.layout() }), {
    name: 'wheels',
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/></svg>',
    when: () => state.kind === 'robot' || (state.kind === 'speaker' && state.moves),   // whatever moves
  });
}

const dims = document.body.dataset.page === 'cross' ? createDims({ body }) : null;

// the cross page: the tool nodes are modifiers too, in the left column under view and angle snap
if (document.body.dataset.page === 'cross') {
  const lm = document.getElementById('leftmods');
  for (const sel of ['.node.shp', '.node.spk', '.node.scr', '.node.eng', '.node.whl']) {
    const n = document.querySelector(sel);
    if (lm && n) lm.appendChild(n);
  }
}

// the cross page opens on the front view, the nodes where they belong, and a loading veil until it has all played
if (document.body.dataset.page === 'cross') {
  orbit.setView('front');
  nodes.setHomes({ stretch: [0.091, 0.11], speaker: [0.6625, 0.125], shape: [0.1875, 0.69] });   // (views and angle snap are modifiers here, not nodes)
  const veil = document.getElementById('loading');
  let firstAt = 0, frames = 0;
  const watch = (now) => {
    if (!veil) return;
    frames++;
    firstAt ||= now;
    // a few real frames (the shaders are compiled by then) and the opening played: the prompt, the knob, the build
    if (frames > 20 && now - firstAt > 3000) { veil.classList.add('done'); setTimeout(() => veil.remove(), 600); return; }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

// case 2 · moves: drag a wheel sideways to open or close the track (as the robot's wheels)
{
  const wheelAt = (x, y) => {
    const W = state.kind === 'speaker' && state.moves ? body.layout()?.wheels : null;
    if (!W) return null;
    for (const [side, w] of [[-1, W.l], [1, W.r]]) {
      const [px, py] = view.project(w[0], w[1], W.z);
      const r = W.R * view.scale * 1.05;
      if (Math.abs(x - px) < Math.max(18, W.hw * view.scale * 1.6 + r * 0.25) && Math.abs(y - py) < r) return side;
    }
    return null;
  };
  let wd = null;
  // debug: the wheels' centres on screen (CSS px)
  window.__wheels = () => { const W = body.layout()?.wheels; return W ? [W.l, W.r].map((w) => view.project(w[0], w[1], W.z).slice(0, 2)) : null; };
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.node, button, input, #toolbox')) return;
    const side = wheelAt(e.clientX, e.clientY);
    if (!side) return;
    e.preventDefault();
    e.stopPropagation();   // not an orbit
    // mm per px along the wheels' axis, as seen now
    const W = body.layout().wheels;
    const a = view.project(W.r[0], W.r[1], W.z), b = view.project(W.r[0] + 10, W.r[1], W.z);
    const pxPerMm = Math.max(0.05, Math.hypot(b[0] - a[0], b[1] - a[1]) / 10);
    const dir = [(b[0] - a[0]) / (10 * pxPerMm), (b[1] - a[1]) / (10 * pxPerMm)];
    wd = { side, x: e.clientX, y: e.clientY, start: state.wheelSpread, pxPerMm, dir };
    document.documentElement.classList.add('wheel-dragging');
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!wd) {
      document.documentElement.classList.toggle('wheel-hover', !!wheelAt(e.clientX, e.clientY));
      return;
    }
    // moving a wheel outward (along +x for the right one, −x for the left) widens the track; both move together
    const along = ((e.clientX - wd.x) * wd.dir[0] + (e.clientY - wd.y) * wd.dir[1]) / wd.pxPerMm;
    setWheelSpread(wd.start + along * wd.side);
  }, true);
  window.addEventListener('pointerup', () => {
    if (!wd) return;
    wd = null;
    document.documentElement.classList.remove('wheel-dragging');
  }, true);
}

attachDrag(svg, {
  onStart: (part) => components.setActive(part),
  onEnd: (part, e) => {
    components.setActive(null);
    body.ripple(e.clientX, e.clientY); // a wave through the dots on release
  },
});

// the body leans toward the cursor and dots swell under it
window.addEventListener('pointermove', (e) => body.setPointer(e.clientX, e.clientY, true));
window.addEventListener('pointerdown', (e) => body.setPointer(e.clientX, e.clientY, true));
document.documentElement.addEventListener('pointerleave', (e) => body.setPointer(e.clientX, e.clientY, false));
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') body.setPointer(e.clientX, e.clientY, false); // no hover on touch
});

window.addEventListener('resize', () => view.update());

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp after tab switches
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}

function tick(dt, draw = true) {
  prompts.update(dt);    // guided-prompt choreography tweens the state
  // the camera looks at the middle of the object, whatever its shape (eased, so shape changes glide)
  const oc = body.center();
  if (oc) { const k = Math.min(1, dt * 8); for (let i = 0; i < 3; i++) view.cam.target[i] += (oc[i] - view.cam.target[i]) * k; }
  orbit.update(dt);      // camera eases first, so both layers use the same pose
  components.render();   // wireframes snap to state instantly
  extras.update(dt);     // add-ons animate (fly in, snap, follow the surface)
  extras.render();
  body.setExtras(extras.renderList());
  body.update(dt);       // the body eases after them
  if (draw) body.render(); // the active view (cross-faded inside the canvas)
  nodes.update(dt);      // node cards + connectors follow the object
  bom.update();          // components list
  labels.update();       // part numbers (flat views)
  diagram.update();      // circles and lines (pixel view)
  dims?.update();        // cross page: the overall size, under the object
}
requestAnimationFrame(frame);

// debug: advance the animation by hand (e.g. in a background tab where rAF is paused)
window.objectViz = {
  step(ms = 1000, fps = 60) {
    // advance everything, but draw only the last frame (bursts of heavy frames can trip the GPU watchdog)
    const n = Math.max(1, Math.round((ms * fps) / 1000));
    for (let i = 0; i < n; i++) tick(1 / fps, i === n - 1);
  },
};
