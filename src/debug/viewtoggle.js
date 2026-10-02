import { params } from '../state.js';

const MODES = ['dots', 'flat2', 'flat', 'pixel', 'pixel2', 'pixel3d', 'glass', 'empty'];
const LABELS = { dots: 'dots', blocks: 'lines', flat: 'flat 2', flat2: 'flat 1', pixel: 'dither 1', pixel2: 'dither 2', pixel3d: 'pixel 3d', glass: 'glass', empty: 'empty', orbital: 'orbital', blob: 'blob' };

/**
 * "dots | lines | solid" switch (the `b` key cycles). The body layer
 * cross-fades the renderings itself; this only sets the mode and a body class
 * that the SVG styling keys off.
 */
export function createViewToggle({ orbit } = {}) {
  const root = document.createElement('div');
  root.id = 'viewtoggle';
  root.innerHTML = MODES.map((m) => `<button data-view="${m}">${LABELS[m]}</button>`).join('');
  document.body.appendChild(root);

  function set(mode) {
    if (mode === 'pixel3d' && params.view !== 'pixel3d') orbit?.setView('front');   // pixel 3d reads best straight on
    params.view = mode;
    document.body.classList.toggle('mode-blocks', mode !== 'dots'); // SVG contours hide in the other views
    document.body.classList.toggle('mode-flat', mode === 'flat' || mode === 'flat2');
    document.body.classList.toggle('mode-pixel', mode === 'pixel' || mode === 'pixel2');
    document.body.classList.toggle('mode-empty', mode === 'empty');
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

  set(params.view);
  return { set };
}
