import { view } from './view.js';
import { createOrbit } from './orbit.js';
import { createBody } from './body/body.js';
import { createComponents } from './components/components.js';
import { attachDrag } from './components/drag.js';
import { createExtras } from './components/extras.js';
import { createDebugPanel } from './debug/panel.js';
import { createPrompts } from './prompts.js';
import { createNodes } from './ui/nodes.js';
import { createBom } from './ui/bom.js';
import { createPartLabels } from './ui/labels.js';
import { createDiagram } from './ui/diagram.js';
import { createViewToggle } from './debug/viewtoggle.js';

const canvas = document.getElementById('body-layer');
// if the GPU resets (driver timeout), come back with a fresh page once it is available again
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());
const svg = document.getElementById('components-layer');

view.update();

const orbit = createOrbit(svg);
const body = createBody(canvas);
const components = createComponents(svg);
const extras = createExtras(svg, { onPulse: (x, y) => body.ripple(x, y), offsets: () => body.layout()?.offsets ?? [] });
createDebugPanel({ orbit });
const nodes = createNodes({ body });
const bom = createBom({ body });
const labels = createPartLabels(svg, { body });
const diagram = createDiagram(svg, { body });
const prompts = createPrompts({ extras, body, nodes });
nodes.onApply = (id) => prompts.applyReference(id);
createViewToggle();

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
