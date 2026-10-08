import { params } from '../state.js?v=202610081559';

// the options, as in the sketch: a vertical axis with the step fanned out at its foot
const SNAPS = [
  ['free', 'free: the shape appears where you stop',
    '<path d="M12 20V5M9.5 7.5 12 5l2.5 2.5"/><path d="M5 17.5a8 8 0 0 0 7 2.5" stroke-dasharray="1.6 1.8"/>'],
  ['10', 'every 10°',
    '<path d="M14 20V5M11.5 7.5 14 5l2.5 2.5"/><path d="M14 20 4 18.2M14 20l-9.4 3M14 20l-7.8 5.3"/>'],
  ['20', 'every 20°',
    '<path d="M14 20V5M11.5 7.5 14 5l2.5 2.5"/><path d="M14 20 4 18.4M14 20l-8.2 5.4"/>'],
  ['views', 'front and axonometric views only (90°)',
    '<path d="M15 4v15.5M15 19.5c-4 0-7-.6-9-1.6M15 19.5l-1.8 4"/>'],
];

/**
 * The angle-snap node (cross view): how a free turn of the object comes to rest —
 * free (anywhere), every 10° or 20° (the turn clicks from step to step while dragging),
 * or 90° = only the essential views (front, sides, axonometric, plan), glided to on release.
 */
export function createSnapPad() {
  const node = document.createElement('div');
  node.className = 'node snp tool hidden';
  node.innerHTML = `<div class="tab">angle snap</div>
    <div class="card">
      <div class="snaps">${SNAPS.map(([k, title, icon]) => `<button data-snap="${k}" title="${title}" aria-label="${title}"><svg viewBox="0 0 24 26">${icon}</svg><span>${k === 'views' ? '90°' : k === 'free' ? 'free' : k + '°'}</span></button>`).join('')}</div>
      <div class="value"><span class="v"></span></div>
    </div>`;
  document.body.appendChild(node);
  const SAYS = { free: 'stops where you let go', 10: 'clicks every 10°', 20: 'clicks every 20°', views: 'front, sides, axonometric, plan' };
  const mark = () => {
    node.querySelectorAll('[data-snap]').forEach((b) => b.classList.toggle('on', b.dataset.snap === params.angleSnap));
    node.querySelector('.value .v').textContent = SAYS[params.angleSnap] ?? '';
  };
  mark();
  node.querySelector('.snaps').addEventListener('click', (e) => {
    const k = e.target.closest('[data-snap]')?.dataset.snap;
    if (k) { params.angleSnap = k; mark(); }
  });
  return node;
}
