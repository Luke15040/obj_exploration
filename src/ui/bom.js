import { LIBRARY, CABLES } from '../parts.js';
import { params, state } from '../state.js';

/**
 * Components list at the side, in the terminal style of the other nodes:
 * the real parts in use (from the library, plus the few added ones), the
 * cables between them, and what is still provisional (drawn as points).
 * Hovering a part highlights it in the 3D view.
 */
export function createBom({ body }) {
  const root = document.createElement('div');
  root.className = 'node bom';
  root.innerHTML = '<div class="tab">components</div><div class="card"><div class="rows"></div></div>';
  document.body.appendChild(root);
  const rows = root.querySelector('.rows');

  let signature = '';

  const size = (lib) => LIBRARY[lib].size.map((v) => +v.toFixed(1)).join('×');

  function render(layout) {
    // group identical parts (e.g. the two servos)
    const counts = new Map();
    layout.parts.forEach((p, i) => {
      const g = counts.get(p.lib) ?? { lib: p.lib, keys: [], nums: [], n: 0 };
      g.n++;
      g.keys.push(p.key);
      g.nums.push(i + 1);
      counts.set(p.lib, g);
    });
    const cableCounts = new Map();
    for (const c of layout.cables) cableCounts.set(c.kind, (cableCounts.get(c.kind) ?? 0) + 1);

    const part = (g) => {
      const L = LIBRARY[g.lib];
      const added = L.inLibrary === false;
      return `<div class="row part${added ? ' added' : ''}" data-key="${g.keys[0]}" title="${added ? 'added — ' + L.why : 'from the library'}">
        <span class="n">${g.n}×</span><span class="name">${L.name}<span class="num">#${g.nums.join(' #')}</span></span><span class="dim">${size(g.lib)}</span>${added ? '<span class="flag">+</span>' : ''}</div>`;
    };
    const cable = ([kind, n]) => {
      const C = CABLES[kind];
      const added = C.inLibrary === false;
      return `<div class="row cable${added ? ' added' : ''}" title="${added ? 'added — ' + C.why : ''}">
        <span class="n">${n}×</span><span class="name">${C.name}</span>${added ? '<span class="flag">+</span>' : ''}</div>`;
    };
    const provisional = ['skin / enclosure', ...(state.kind === 'speaker' ? (state.shape === 'free' ? ['front baffle'] : state.shape === 'totem' ? [`totem: ${state.totem.slice(0, 2 + state.extras.filter((e) => e.type === 'knob').length).join(' · ')}`] : [`shape: ${state.shape}`]) : ['wheels Ø90×30', 'frame bar']), ...(state.extras.some((e) => e.type === 'knob') ? ['knob caps'] : [])];

    rows.innerHTML = `
      <div class="sec">parts</div>${[...counts.values()].map(part).join('')}
      <div class="sec">cables</div>${[...cableCounts.entries()].map(cable).join('')}
      <div class="sec">provisional · points</div><div class="row prov">${provisional.join(' · ')}</div>
      <div class="legend"><span class="flag">+</span> not in the library, added so it can work</div>`;

    rows.querySelectorAll('.row.part').forEach((r) => {
      r.addEventListener('pointerenter', () => (params.highlight = r.dataset.key));
      r.addEventListener('pointerleave', () => { if (params.highlight === r.dataset.key) params.highlight = null; });
    });
  }

  function update() {
    const layout = body.layout();
    if (!layout) return;
    const sig = layout.parts.map((p) => p.lib).join(',') + '|' + layout.cables.map((c) => c.kind).join(',') + '|' + state.extras.map((e) => e.type).join(',');
    if (sig === signature) return;
    signature = sig;
    render(layout);
  }

  return { update };
}
