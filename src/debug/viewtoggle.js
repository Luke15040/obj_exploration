import { CONFIG } from '../config.js?v=202610080154';
import { params } from '../state.js?v=202610080154';

// three pages: the main one, lab.html with every particle / dither experiment, cross.html with only the cross view
const LAB = document.body.dataset.page === 'lab';
const CROSS = document.body.dataset.page === 'cross';
const MAIN_MODES = ['pixel3d', 'sketch', 'flathd', 'cross', 'marker', 'density', 'flat2', 'flathd2', 'glass', 'empty'];
const LAB_MODES = ['dots', 'dotsgrid', 'pixel', 'pixel2', 'live', 'particles', 'orbital'];
const MODES = LAB ? LAB_MODES : CROSS ? ['cross', 'flathd2', 'density', 'gradient'] : MAIN_MODES;
// the cross page's density starts as the soft ball: the outside on top, no outlines
// (the defaults below are the look settled on: a pink soft ball, lit, the inside frosted behind it)
if (CROSS) Object.assign(params, { unfinished: true, unfinishedSpeed: 0.08, flatAlive: 0.15, densGrain: 0.25, densEdge: 0.15, densStyle: 'soft', densOutside: 1, densInside: 0.62, densFrost: 0.2, densMotion: 0.65, densDiverge: 0.07, densSoft: 0.07, densPalette: 0, densGlow: 0.7, densLines: { object: false, parts: false } });
const LABELS = { dots: 'dots', blocks: 'lines', flat: 'flat 2', flat2: 'flat 1', pixel: 'dither 1', pixel2: 'dither 2', pixel3d: 'pixel 3d', glass: 'glass', empty: 'empty', sketch: 'sketch', flathd: 'flat hd', flathd2: 'flat hd 2', milk: 'milk', live: 'live', cross: 'cross', cross2: 'cross 2', marker: 'marker', density: 'density', gradient: 'gradient', particles: 'particles', picasso: 'picasso', dotsgrid: 'dots grid', orbital: 'orbital', blob: 'blob' };

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
  // the way to the other pages
  const links = document.createElement('div');
  links.id = 'pagelink';
  const PAGES = CROSS ? []   // the cross page stands on its own
    : LAB
    ? [['index.html', '← main', 'back to the main views']]
    : [['lab.html', 'lab →', 'particle and dither experiments'], ['cross.html', 'cross →', 'the cross view on its own']];
  links.innerHTML = PAGES.map(([href, t, title]) => `<a href="${href}" title="${title}">${t}</a>`).join('');
  document.body.appendChild(links);
  if (LAB && !LAB_MODES.includes(params.view)) params.view = LAB_MODES[0];
  if (CROSS && !MODES.includes(params.view)) params.view = 'cross';

  let current = null;
  function set(mode) {
    if (mode === 'pixel3d' && current !== 'pixel3d') orbit?.setView('front');   // pixel 3d reads best straight on
    if ((mode === 'flathd' || mode === 'flathd2' || mode === 'cross' || mode === 'marker' || mode === 'picasso') && current !== mode) params.redraw++;   // these views draw / build themselves in
    current = mode;
    // the cross page: flat hd 2 is shown in look b, cross in look a
    if (CROSS && typeof markLook === 'function') { params.look = mode === 'flathd2' ? 2 : 1; markLook(); }
    // 'dots grid' = the dots view with the first, screen-space dithering
    params.dotStyle = mode === 'dotsgrid' ? 'grid' : 'cloud';
    params.view = mode === 'dotsgrid' ? 'dots' : mode;
    document.body.classList.toggle('mode-dotsgrid', mode === 'dotsgrid');
    document.body.classList.toggle('mode-blocks', mode !== 'dots'); // SVG contours hide in the other views
    document.body.classList.toggle('mode-flat', mode === 'flat' || mode === 'flat2' || mode === 'flathd2');
    document.body.classList.toggle('mode-flathd2', mode === 'flathd2');
    document.querySelectorAll('.opslider').forEach((el) => { el.querySelector('input').value = params[mode === 'flathd2' ? el.dataset.flatKey : mode === 'density' ? el.dataset.densKey : mode === 'gradient' ? el.dataset.gradKey : el.dataset.key] ?? 1; });
    const ffOn = document.querySelector('#frostfollow [data-ff="1"]');
    if (ffOn) ffOn.textContent = mode === 'flathd2' ? 'follows the line' : 'follows the tiles';   // (what the frost goes with)
    const frIn = document.querySelector('#frost input');
    if (frIn) frIn.value = mode === 'density' ? params.densFrost : params.frost;
    const frl = document.querySelectorAll('#frost .lbl');
    if (frl.length === 2) { frl[0].textContent = mode === 'flathd2' ? 'sharp' : 'clear'; frl[1].textContent = mode === 'flathd2' ? 'blurred' : 'frosted'; }
    const ffl = document.querySelector('#frostfollow .lbl');
    if (ffl) ffl.textContent = mode === 'flathd2' ? 'blur' : 'frost';
    document.body.classList.toggle('mode-pixel', mode === 'pixel' || mode === 'pixel2');
    document.body.classList.toggle('mode-empty', mode === 'empty');
    document.body.classList.toggle('mode-pixel3d', mode === 'pixel3d');
    document.body.classList.toggle('mode-sketch', mode === 'sketch');
    document.body.classList.toggle('mode-flathd', mode === 'flathd');
    document.body.classList.toggle('mode-cross', mode === 'cross');
    document.body.classList.toggle('mode-gradient', mode === 'gradient');
    document.body.classList.toggle('mode-marker', mode === 'marker');
    document.body.classList.toggle('mode-density', mode === 'density');
    document.body.classList.toggle('mode-particles', mode === 'particles');
    document.body.classList.toggle('mode-live', mode === 'live');
    document.body.classList.toggle('mode-orbital', mode === 'orbital');
    root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
  }

  // cross page: a view's first showing compiles its shaders, which freezes the page for a while
  // (ANGLE / D3D compiles at the first draw) — so the loading veil goes up first, then the switch
  const seen = new Set([params.view]);
  const switchTo = (mode) => {
    if (!CROSS || seen.has(mode)) { set(mode); return; }
    seen.add(mode);
    const veil = document.createElement('div');
    veil.id = 'loading';
    veil.innerHTML = '<div class="cells"><i></i><i></i><i></i></div><span>loading</span>';
    document.body.appendChild(veil);
    // two frames: the veil is on screen before the compile blocks
    requestAnimationFrame(() => requestAnimationFrame(() => {
      set(mode);
      let n = 0;
      const wait = () => { if (++n > 8) { veil.classList.add('done'); setTimeout(() => veil.remove(), 600); } else requestAnimationFrame(wait); };
      requestAnimationFrame(wait);
    }));
  };
  root.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-view]')?.dataset.view;
    if (mode) switchTo(mode);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key.toLowerCase() === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      set(MODES[(MODES.indexOf(params.view) + 1) % MODES.length]);
    }
  });

  // snap markers (bottom right, above the looks): how the snap points show while dragging
  const SNAP = {
    cross: '<path d="M4 8h8M8 4v8"/>',
    dot: '<circle cx="8" cy="8" r="2.2" fill="currentColor"/>',
    ring: '<circle cx="8" cy="8" r="4"/>',
  };
  const snaps = document.createElement('div');
  snaps.id = 'snapstyle';
  snaps.innerHTML = '<span class="lbl">snap</span>' + Object.entries(SNAP).map(([k, svg]) => `<button data-snap="${k}" title="snap marker: ${k}"><svg viewBox="0 0 16 16">${svg}</svg></button>`).join('');
  const markSnap = () => snaps.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.snap === params.snapStyle));
  markSnap();
  snaps.addEventListener('click', (e) => {
    const b = e.target.closest('[data-snap]');
    if (b) { params.snapStyle = b.dataset.snap; markSnap(); }
  });
  document.body.appendChild(snaps);

  // cross only: how the shape leaves and comes back at a view change (to compare)
  const anims = document.createElement('div');
  anims.id = 'crossanim';
  // (scatter variants; 'wipe' / 'ripple' / 'cut' still exist in the shader)
  const ANIMS = { scatter: 'shrink', pop: 'pop' };
  anims.innerHTML = '<span class="lbl">anim</span>' + Object.entries(ANIMS).map(([k, label]) => `<button data-anim="${k}">${label}</button>`).join('');
  const markAnim = () => anims.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.anim === params.crossAnim));
  markAnim();
  anims.addEventListener('click', (e) => {
    const b = e.target.closest('[data-anim]');
    if (b) { params.crossAnim = b.dataset.anim; markAnim(); }
  });
  document.body.appendChild(anims);

  // cross only: how the parts are drawn (to compare)
  const pstyle = document.createElement('div');
  pstyle.id = 'partstyle';
  // from the most real to the most abstract
  // (line, flat 1, boxes, grid line, dots and crosses are still in the shaders, just not offered)
  const PSTYLES = { colour: 'real', grey: 'grey', flat: 'flat', vector: 'colour', outline: 'outline', flathd2: 'tiles' };   // (labels only: the ids stay)
  if (!PSTYLES[params.partStyle]) params.partStyle = 'colour';
  pstyle.innerHTML = '<span class="lbl">parts</span>' + Object.entries(PSTYLES).map(([k, t]) => `<button data-pstyle="${k}">${t}</button>`).join('');
  const markP = () => {
    pstyle.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.pstyle === params.partStyle));
  };
  markP();
  pstyle.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pstyle]');
    if (b) { params.partStyle = b.dataset.pstyle; markP(); }
  });
  document.body.appendChild(pstyle);

  // density only: snap marks always there, or only while a part is dragged
  const dsn = document.createElement('div');
  dsn.id = 'densnap';
  dsn.innerHTML = '<span class="lbl">snaps</span><button data-ds="always">always</button><button data-ds="drag">drag</button>';
  const markDs = () => dsn.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ds === params.densSnaps));
  markDs();
  dsn.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ds]');
    if (b) { params.densSnaps = b.dataset.ds; markDs(); }
  });
  document.body.appendChild(dsn);

  // density only: how much the shape keeps moving
  const dmo = document.createElement('div');
  dmo.id = 'densmotion';
  dmo.innerHTML = '<span class="lbl">motion</span><input type="range" min="0" max="1" step="0.01" aria-label="motion">';
  const dmr = dmo.querySelector('input');
  dmr.value = params.densMotion;
  dmr.addEventListener('input', () => { params.densMotion = Number(dmr.value); });
  document.body.appendChild(dmo);

  // density: bands (a contour map) or a soft ball
  const dst = document.createElement('div');
  dst.id = 'densstyle';
  dst.innerHTML = '<span class="lbl">density</span><button data-dst="soft">soft ball</button><button data-dst="bands">bands</button>';
  const markDst = () => dst.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.dst === params.densStyle));
  markDst();
  dst.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dst]');
    if (b) { params.densStyle = b.dataset.dst; markDst(); document.body.classList.toggle('dens-soft', params.densStyle === 'soft'); }
  });
  document.body.classList.toggle('dens-soft', params.densStyle === 'soft');
  document.body.appendChild(dst);

  // density, soft ball: how soft and round it is
  const dso = document.createElement('div');
  dso.id = 'denssoft';
  dso.innerHTML = '<span class="lbl">tight</span><input type="range" min="0" max="1" step="0.01" aria-label="softness"><span class="lbl">soft</span>';
  const dsoR = dso.querySelector('input');
  dsoR.value = params.densSoft;
  dsoR.addEventListener('input', () => { params.densSoft = Number(dsoR.value); });
  document.body.appendChild(dso);

  // density: how far the moving shape strays from the real one (0 = it stays on the shape)
  const ddv = document.createElement('div');
  ddv.id = 'densdiverge';
  ddv.innerHTML = '<span class="lbl">faithful</span><input type="range" min="0" max="1" step="0.01" aria-label="how far the shape strays"><span class="lbl">free</span>';
  const ddvR = ddv.querySelector('input');
  ddvR.value = params.densDiverge;
  ddvR.addEventListener('input', () => { params.densDiverge = Number(ddvR.value); });
  document.body.appendChild(ddv);

  // density, soft ball: its light (flat ↔ lit from above, like coloured glass)
  const dgl = document.createElement('div');
  dgl.id = 'densglow';
  dgl.innerHTML = '<span class="lbl">flat</span><input type="range" min="0" max="1" step="0.01" aria-label="light"><span class="lbl">lit</span>';
  const dglR = dgl.querySelector('input');
  dglR.value = params.densGlow;
  dglR.addEventListener('input', () => { params.densGlow = Number(dglR.value); });
  document.body.appendChild(dgl);

  // gradient: its sliders (grain · flow · wobble · round) and palettes (each with its page)
  const gradSlider = (id, key, lo, hi) => {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'gradctl';
    el.innerHTML = `<span class="lbl">${lo}</span><input type="range" min="0" max="1" step="0.01" aria-label="${id}"><span class="lbl">${hi}</span>`;
    const r = el.querySelector('input');
    r.value = params[key];
    r.addEventListener('input', () => { params[key] = Number(r.value); });
    document.body.appendChild(el);
  };
  gradSlider('gradround', 'gradRound', 'close', 'round');
  gradSlider('gradwobble', 'gradWobble', 'faithful', 'free');
  gradSlider('gradflow', 'gradFlow', 'still', 'flowing');
  gradSlider('gradgrain', 'gradGrain', 'smooth', 'grainy');
  const gpl = document.createElement('div');
  gpl.id = 'gradpal';
  gpl.className = 'gradctl';
  gpl.innerHTML = '<span class="lbl">colour</span>' + CONFIG.gradient.palettes.map((r, i) =>
    `<button data-gp="${i}" title="palette ${i + 1}" style="--sw:${r[0]};--sw2:${r[1]}"></button>`).join('') + '<button data-gpage="1" class="page">page</button>';
  const markGp = () => {
    gpl.querySelectorAll('[data-gp]').forEach((b) => b.classList.toggle('on', Number(b.dataset.gp) === params.gradPalette));
    gpl.querySelector('[data-gpage]').classList.toggle('on', params.gradPage !== false);
  };
  markGp();
  gpl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gp]');
    if (b) { params.gradPalette = Number(b.dataset.gp); markGp(); }
    if (e.target.closest('[data-gpage]')) { params.gradPage = params.gradPage === false; markGp(); }
  });
  document.body.appendChild(gpl);

  // density, soft ball: grain (smooth ↔ grainy) and its edge (crisp ↔ hazy)
  for (const [id, key, lo, hi] of [['densgrain', 'densGrain', 'smooth', 'grainy'], ['densedge', 'densEdge', 'crisp', 'hazy']]) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'densctl';
    el.innerHTML = `<span class="lbl">${lo}</span><input type="range" min="0" max="1" step="0.01" aria-label="${id}"><span class="lbl">${hi}</span>`;
    const r = el.querySelector('input');
    r.value = params[key];
    r.addEventListener('input', () => { params[key] = Number(r.value); });
    document.body.appendChild(el);
  }

  // density (cross page): the transition while it turns
  const dtr = document.createElement('div');
  dtr.id = 'denstrans';
  dtr.innerHTML = '<span class="lbl">transition</span><button data-dtr="condense">condense</button><button data-dtr="evaporate">evaporate</button><button data-dtr="liquid">liquid</button>';
  const markDtr = () => dtr.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.dtr === params.densTrans));
  markDtr();
  dtr.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dtr]');
    if (b) { params.densTrans = b.dataset.dtr; markDtr(); }
  });
  document.body.appendChild(dtr);

  // density: its colours (one ramp each)
  const dpl = document.createElement('div');
  dpl.id = 'denspal';
  dpl.innerHTML = '<span class="lbl">colour</span>' + CONFIG.density.palettes.map((r, i) =>
    `<button data-dp="${i}" title="palette ${i + 1}" style="--sw:${r[3]}"></button>`).join('');
  const markDp = () => dpl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.dp) === params.densPalette));
  markDp();
  dpl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dp]');
    if (b) { params.densPalette = Number(b.dataset.dp); markDp(); }
  });
  document.body.appendChild(dpl);

  // density only: the white outlines, object and parts, each on / off
  const dln = document.createElement('div');
  dln.id = 'denslines';
  dln.innerHTML = '<span class="lbl">outlines</span><button data-dl="object">object</button><button data-dl="parts">parts</button>';
  const markDl = () => dln.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !!params.densLines[b.dataset.dl]));
  markDl();
  dln.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dl]');
    if (b) { params.densLines[b.dataset.dl] = !params.densLines[b.dataset.dl]; markDl(); }
  });
  document.body.appendChild(dln);

  // lab · dots grid only: object outline, part outlines, hi-fi parts — each on / off
  const gso = document.createElement('div');
  gso.id = 'gridshow';
  gso.innerHTML = '<span class="lbl">show</span><button data-gs="outline">outline</button><button data-gs="lines">lines</button><button data-gs="hifi">hi-fi</button>';
  const markGs = () => gso.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !!params.gridShow[b.dataset.gs]));
  markGs();
  gso.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gs]');
    if (b) { params.gridShow[b.dataset.gs] = !params.gridShow[b.dataset.gs]; markGs(); }
  });
  document.body.appendChild(gso);

  // cross only: how much the shape blinks at rest (its surface breathes, the cells flip)
  const shim = document.createElement('div');
  shim.id = 'shimmer';
  shim.innerHTML = '<span class="lbl">shimmer</span><input type="range" min="0" max="3" step="0.05" aria-label="shimmer">';
  const range = shim.querySelector('input');
  range.value = params.shimmer;
  range.addEventListener('input', () => { params.shimmer = Number(range.value); });
  document.body.appendChild(shim);

  // cross only: the level of abstraction — big cells (abstract) ↔ small cells (defined)
  const det = document.createElement('div');
  det.id = 'crossdetail';
  det.innerHTML = '<span class="lbl">abstract</span><input type="range" min="0" max="1" step="0.01" aria-label="detail"><span class="lbl">detail</span>';
  const detR = det.querySelector('input');
  const MM = [14, 2.5];                                    // cell mm at the two ends (log scale)
  const toMm = (t) => MM[0] * Math.pow(MM[1] / MM[0], t);
  detR.value = Math.log(params.crossCellMm / MM[0]) / Math.log(MM[1] / MM[0]);
  detR.addEventListener('input', () => { params.crossCellMm = toMm(Number(detR.value)); });
  document.body.appendChild(det);

  // cross only: two opacities, each on its own — the inside (the parts) and the outside (caps, holes, the screen's face)
  // (flat hd 2 has the same two, with values of its own)
  for (const [id, key, label, flatKey, densKey, gradKey] of [['insideop', 'insideOpacity', 'inside', 'flatInside', 'densInside', ''], ['outsideop', 'outsideOpacity', 'outside', 'flatOutside', 'densOutside', 'gradOutside']]) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'opslider';
    el.dataset.key = key;
    el.dataset.flatKey = flatKey;
    el.dataset.densKey = densKey;
    el.dataset.gradKey = gradKey;
    el.innerHTML = `<span class="lbl">${label}</span><input type="range" min="0" max="1" step="0.01" aria-label="${label} opacity">`;
    const r = el.querySelector('input');
    r.value = params[key];
    r.addEventListener('input', () => { params[params.view === 'flathd2' ? flatKey : params.view === 'density' ? densKey : params.view === 'gradient' ? gradKey : key] = Number(r.value); });
    document.body.appendChild(el);
  }

  // cross only: how frosted the parts look inside the shape
  const fro = document.createElement('div');
  fro.id = 'frost';
  fro.innerHTML = '<span class="lbl">clear</span><input type="range" min="0" max="1" step="0.01" aria-label="frost"><span class="lbl">frosted</span>';
  const froR = fro.querySelector('input');
  froR.value = params.frost;
  froR.addEventListener('input', () => { params[params.view === 'density' ? 'densFrost' : 'frost'] = Number(froR.value); });   // (density: its own)
  document.body.appendChild(fro);

  // cross only: does the frost go with the tiles (pixel by pixel) or stay on the shape's place?
  const ff = document.createElement('div');
  ff.id = 'frostfollow';
  ff.innerHTML = '<span class="lbl">frost</span><button data-ff="1">follows the tiles</button><button data-ff="0">stays</button>';
  const markFf = () => ff.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.ff === '1') === !!params.frostFollow));
  markFf();
  ff.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ff]');
    if (b) { params.frostFollow = b.dataset.ff === '1'; markFf(); }
  });
  document.body.appendChild(ff);

  // flat hd 2: the drawing finished, or left unfinished (gaps in the lines)
  const unf = document.createElement('div');
  unf.id = 'unfinished';
  unf.innerHTML = '<span class="lbl">drawing</span><button data-unf="0">finished</button><button data-unf="1">unfinished</button>';
  const markUnf = () => unf.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.unf === '1') === !!params.unfinished));
  markUnf();
  document.body.classList.toggle('unfinished-on', !!params.unfinished);
  unf.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unf]');
    if (b) { params.unfinished = b.dataset.unf === '1'; markUnf(); document.body.classList.toggle('unfinished-on', params.unfinished); }
  });
  document.body.appendChild(unf);

  // flat hd 2, unfinished: how unfinished — gaps, strokes gone over twice, the hand's tremor
  for (const [id, key, lo, hi] of [['unfgaps', 'unfGaps', 'whole', 'gaps'], ['unftwice', 'unfTwice', 'once', 'retraced'], ['unfhand', 'unfHand', 'steady', 'hand']]) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'unfctl';
    el.innerHTML = `<span class="lbl">${lo}</span><input type="range" min="0" max="1" step="0.01" aria-label="${id}"><span class="lbl">${hi}</span>`;
    const r = el.querySelector('input');
    r.value = params[key];
    r.addEventListener('input', () => { params[key] = Number(r.value); });
    document.body.appendChild(el);
  }

  // flat hd 2: lines in colour or grey · parts filled or as outlines (one pill)
  const fls = document.createElement('div');
  fls.id = 'flatlines';
  fls.innerHTML = '<span class="lbl">lines</span><button data-fl="colour">colour</button><button data-fl="grey">grey</button>'
    + '<span class="lbl sep">parts</span><button data-fp="fill">fill</button><button data-fp="outline">outline</button>';
  const markFls = () => {
    fls.querySelectorAll('[data-fl]').forEach((b) => b.classList.toggle('on', b.dataset.fl === params.flatLines));
    fls.querySelectorAll('[data-fp]').forEach((b) => b.classList.toggle('on', b.dataset.fp === params.flatParts));
  };
  markFls();
  fls.addEventListener('click', (e) => {
    const a = e.target.closest('[data-fl]'), b = e.target.closest('[data-fp]');
    if (a) params.flatLines = a.dataset.fl;
    if (b) params.flatParts = b.dataset.fp;
    markFls();
  });
  document.body.appendChild(fls);

  // flat hd 2: how alive the drawing is at rest (the shape breathes, the line trembles)
  const fal = document.createElement('div');
  fal.id = 'flatalive';
  fal.innerHTML = '<span class="lbl">still</span><input type="range" min="0" max="1" step="0.01" aria-label="alive"><span class="lbl">alive</span>';
  const falR = fal.querySelector('input');
  falR.value = params.flatAlive;
  falR.addEventListener('input', () => { params.flatAlive = Number(falR.value); });
  document.body.appendChild(fal);

  // flat hd 2, unfinished: how lively the gaps are (0 = still, they stay put)
  const us = document.createElement('div');
  us.id = 'unfspeed';
  us.innerHTML = '<span class="lbl">still</span><input type="range" min="0" max="1" step="0.01" aria-label="how fast the unfinished drawing changes"><span class="lbl">restless</span>';
  const usR = us.querySelector('input');
  usR.value = params.unfinishedSpeed;
  usR.addEventListener('input', () => { params.unfinishedSpeed = Number(usR.value); });
  document.body.appendChild(us);

  // cross only: how many of the shape's cells stay on screen as voxels while the view changes
  const vx = document.createElement('div');
  vx.id = 'voxels';
  vx.innerHTML = '<span class="lbl">voxels</span><input type="range" min="0" max="0.8" step="0.01" aria-label="voxels"><span class="lbl">many</span>';
  const vxR = vx.querySelector('input');
  vxR.value = params.voxels;
  vxR.addEventListener('input', () => { params.voxels = Number(vxR.value); });
  document.body.appendChild(vx);

  // cross only: how much the voxels pulse while the object is being turned
  const vs = document.createElement('div');
  vs.id = 'voxshimmer';
  vs.innerHTML = '<span class="lbl">voxels shimmer</span><input type="range" min="0" max="1" step="0.01" aria-label="voxel shimmer">';
  const vsR = vs.querySelector('input');
  vsR.value = params.voxShimmer;
  vsR.addEventListener('input', () => { params.voxShimmer = Number(vsR.value); });
  document.body.appendChild(vs);

  // cross page: hide / show every view control on the right at once
  if (CROSS) {
    const vt = document.createElement('button');
    vt.id = 'viewctl-toggle';
    // › tucks the column away to the right · ‹ brings it back
    const markVt = () => {
      const hid = document.body.classList.contains('hide-viewctl');
      vt.textContent = hid ? '‹' : '›';
      vt.title = hid ? 'show the view controls' : 'hide the view controls';
    };
    markVt();
    vt.addEventListener('click', () => { document.body.classList.toggle('hide-viewctl'); markVt(); });
    document.body.appendChild(vt);
  }

  // the look (bottom right): look a = prototype (reference cards, warm, grey pixel 3d) ·
  // look b = experiment (plain nodes, cool greys, grey pixel shape with colour parts)
  const looks = document.createElement('div');
  looks.id = 'looks';
  looks.innerHTML = '<button data-look="1" title="prototype look">look a</button><button data-look="2" title="experiment look">look b</button>';
  var markLook = () => {
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
