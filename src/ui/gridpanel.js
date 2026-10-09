import { params } from '../state.js?v=202610091549';

/**
 * Lab · dots grid: a small panel (left, only in that view) to tune the dithered dots —
 * where they gather (light ↔ outline), their spacing and size, how much the size
 * follows the light, the rings on the edges, the exposure — and the extra layers:
 * object outline, part outlines (with their width) and hi-fi parts.
 * Reads / writes params (pitch, dotSize, sizeByLight, ringAmount, exposure,
 * edgeFocus, gridShow).
 */
const SLIDERS = [
  ['lightAz', 'light dir', -180, 180, 1],
  ['lightEl', 'light height', 2, 90, 1],
  ['edgeFocus', 'edge focus', 0, 1, 0.01],
  ['pitch', 'spacing', 1.2, 6, 0.1, 'mm'],
  ['dotSize', 'dot size', 0.3, 1, 0.01],
  ['sizeByLight', 'by light', 0, 1, 0.01],
  ['ringAmount', 'rings', 0, 1, 0.01],
  ['exposure', 'exposure', 0.4, 1.8, 0.01],
];
const TOGGLES = [['outline', 'outline'], ['lines', 'lines'], ['hifi', 'hi-fi']];

export function createGridPanel() {
  const root = document.createElement('div');
  root.id = 'gridpanel';
  root.innerHTML = '<div class="ttl">dots grid</div>' +
    `<div class="row"><span>show</span><div class="seg">${TOGGLES.map(([k, t]) => `<button data-gs="${k}">${t}</button>`).join('')}</div></div>` +
    `<div class="row"><span>line width</span><input type="range" data-line min="0.5" max="4" step="0.1"><span class="val" data-val="lineW"></span></div>` +
    '<div class="sep"></div>' +
    SLIDERS.map(([k, label, min, max, step]) => `<div class="row"><span>${label}</span><input type="range" data-key="${k}" min="${min}" max="${max}" step="${step}"><span class="val" data-val="${k}"></span></div>`).join('');
  document.body.appendChild(root);

  const G = params.gridShow;
  const sync = () => {
    root.querySelectorAll('input[data-key]').forEach((i) => {
      i.value = params[i.dataset.key];
      root.querySelector(`[data-val="${i.dataset.key}"]`).textContent = Number(params[i.dataset.key]).toFixed(Number(i.step) >= 1 ? 0 : 2) + (Number(i.step) >= 1 ? '°' : '');
    });
    const lw = root.querySelector('input[data-line]');
    lw.value = G.lineW;
    root.querySelector('[data-val="lineW"]').textContent = Number(G.lineW).toFixed(1);
    root.querySelectorAll('[data-gs]').forEach((b) => b.classList.toggle('on', !!G[b.dataset.gs]));
  };
  sync();
  root.addEventListener('input', (e) => {
    const i = e.target.closest('input');
    if (!i) return;
    if (i.dataset.key) params[i.dataset.key] = Number(i.value);
    else G.lineW = Number(i.value);
    sync();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gs]');
    if (b) { G[b.dataset.gs] = !G[b.dataset.gs]; sync(); }
  });
  root.addEventListener('keydown', (e) => e.stopPropagation());   // typing here never turns the view
}
