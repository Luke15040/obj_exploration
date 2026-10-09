import { LIBRARY, CABLES } from '../parts.js?v=202610091312';
import { params, state } from '../state.js?v=202610091312';

/**
 * Components list at the side, text only: the real parts in use (from the
 * library, plus the few added ones, marked +), the cables between them, and
 * what is still provisional. Full names and sizes in the tooltip.
 * Hovering a part highlights it in the 3D view.
 */
export function createBom({ body }) {
  const root = document.createElement('div');
  root.className = 'node bom';
  root.innerHTML = '<div class="rows"></div>';
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
      const tip = `${L.name} · ${size(g.lib)} mm${added ? ' · added: ' + L.why : ''}`;
      return `<div class="row part" data-key="${g.keys[0]}" title="${tip}"><span class="num">${g.nums.join(' ')}</span>${L.short ?? L.name}${g.n > 1 ? ` <span class="soft">×${g.n}</span>` : ''}${added ? ' <span class="soft">+</span>' : ''}</div>`;
    };
    const cable = ([kind, n]) => {
      const C = CABLES[kind];
      return `<span title="${C.name}">${C.short ?? C.name}${n > 1 ? ` ×${n}` : ''}${C.inLibrary === false ? ' +' : ''}</span>`;
    };
    const provisional = ['skin', ...(state.kind === 'speaker' ? (state.shape === 'free' ? ['front baffle'] : state.shape === 'totem' ? [`totem: ${state.totem.slice(0, 2 + state.extras.filter((e) => e.type === 'knob').length).join(' · ')}`] : [state.shape]) : ['wheels', 'frame bar']), ...(state.extras.some((e) => e.type === 'knob') ? ['knob caps'] : [])];

    rows.innerHTML = `
      <div class="sec">components</div>${[...counts.values()].map(part).join('')}
      <div class="sec">cables</div><div class="line">${[...cableCounts.entries()].map(cable).join(' · ')}</div>
      <div class="sec">provisional</div><div class="line">${provisional.join(' · ')}</div>
      <div class="legend">+ added so it can work</div>`;

    rows.querySelectorAll('.row.part').forEach((r) => {
      r.addEventListener('pointerenter', () => (params.highlight = r.dataset.key));
      r.addEventListener('pointerleave', () => { if (params.highlight === r.dataset.key) params.highlight = null; });
    });
  }

  function update() {
    const layout = body.layout();
    if (!layout) return;
    const sig = layout.parts.map((p) => p.lib).join(',') + '|' + layout.cables.map((c) => c.kind).join(',') + '|' + state.extras.map((e) => e.type).join(',') + '|' + state.kind + state.shape + state.totem.join('') + state.power;
    if (sig === signature) return;
    signature = sig;
    render(layout);
  }

  return { update };
}
