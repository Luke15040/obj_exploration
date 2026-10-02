import { params } from '../state.js?v=202610021927';

const MODES = ['pixel3d', 'dots', 'flat2', 'flat', 'pixel', 'pixel2', 'glass', 'empty'];
const LABELS = { dots: 'dots', blocks: 'lines', flat: 'flat 2', flat2: 'flat 1', pixel: 'dither 1', pixel2: 'dither 2', pixel3d: 'pixel 3d', glass: 'glass', empty: 'empty', orbital: 'orbital', blob: 'blob' };

/**
 * "dots | lines | solid" switch (the `b` key cycles). The body layer
 * cross-fades the renderings itself; this only sets the mode and a body class
 * that the SVG styling keys off.
 */
export function createViewToggle({ orbit } = {}) {
  const root = document.createElement('div');
  root.id = 'viewtoggle';
  // one pill, pixel 3d first
  const btns = (list) => list.map((m) => `<button data-view="${m}">${LABELS[m]}</button>`).join('');
  root.innerHTML = `<div class="grp">${btns(MODES)}</div>`;
  document.body.appendChild(root);

  let current = null;
  function set(mode) {
    if (mode === 'pixel3d' && current !== 'pixel3d') orbit?.setView('front');   // pixel 3d reads best straight on
    current = mode;
    params.view = mode;
    document.body.classList.toggle('mode-blocks', mode !== 'dots'); // SVG contours hide in the other views
    document.body.classList.toggle('mode-flat', mode === 'flat' || mode === 'flat2');
    document.body.classList.toggle('mode-pixel', mode === 'pixel' || mode === 'pixel2');
    document.body.classList.toggle('mode-empty', mode === 'empty');
    document.body.classList.toggle('mode-pixel3d', mode === 'pixel3d');
    document.body.classList.toggle('mode-orbital', mode === 'orbital');
    root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  }

  root.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-view]')?.dataset.view;
    if (mode) set(mode);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key.toLowerCase() === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      set(MODES[(MODES.indexOf(params.view) + 1) % MODES.length]);
    }
  });

  // the look (bottom right): look a = prototype (reference cards, warm, grey pixel 3d) ·
  // look b = experiment (plain nodes, cool greys, grey pixel shape with colour parts)
  const looks = document.createElement('div');
  looks.id = 'looks';
  looks.innerHTML = '<button data-look="1" title="prototype look">look a</button><button data-look="2" title="experiment look">look b</button>';
  const markLook = () => {
    params.pixel3dGrey = true;   // the pixel shape is grey in both looks; look b keeps the parts in colour
    document.body.classList.toggle('look-1', params.look === 1);
    document.body.classList.toggle('look-2', params.look === 2);
    looks.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.look) === params.look));
  };
  markLook();
  looks.addEventListener('click', (e) => {
    const b = e.target.closest('[data-look]');
    if (b) { params.look = Number(b.dataset.look); markLook(); }
  });
  document.body.appendChild(looks);

  set(params.view);
  return { set };
}
