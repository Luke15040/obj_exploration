import { CONFIG, CROSS_PALETTE } from '../config.js?v=202610091041';
import { CELLS as VIEW_CELLS, ICONS as VIEW_ICONS } from '../ui/viewpad.js?v=202610091041';
import { params } from '../state.js?v=202610091041';

// three pages: the main one, lab.html with every particle / dither experiment, cross.html with only the cross view
const LAB = document.body.dataset.page === 'lab';
const CROSS = document.body.dataset.page === 'cross';
const MAIN_MODES = ['pixel3d', 'sketch', 'flathd', 'cross', 'marker', 'density', 'flat2', 'flathd2', 'glass', 'empty'];
const LAB_MODES = ['dots', 'dotsgrid', 'pixel', 'pixel2', 'live', 'particles', 'orbital'];
const MODES = LAB ? LAB_MODES : CROSS ? ['cross', 'flathd2', 'density'] : MAIN_MODES;
// the cross page's density starts as the soft ball: the outside on top, no outlines
// (the defaults below are the look settled on: a pink soft ball, lit, the inside frosted behind it)
if (CROSS) Object.assign(params, { unfinished: true, unfinishedSpeed: 0.2, flatAlive: 0.24, unfHand: 0.38, unfTwice: 0.49, unfGaps: 0.78, flatFrost: 0.07, flatInside: 0.22, flatOutside: 0.93, crossBright: 0.78, flatTone: 'taupe', flatLineW: 1.4, flatSkinFill: 0.08, flatLines: 'colour', flatParts: 'fill',
  flatLineCol: 'grey', flatOutCol: 'olive', flatShade: false, flatPartsBroken: true,   // (napkin: the user's screenshot, 2026-10-08)
  densGrain: 0.38, densEdge: 0.48, densStyle: 'grainy', densOutside: 0.78, densInside: 1, densFrost: 0.19, densMotion: 0.95, densDiverge: 0.07, densSoft: 0.18, densPalette: 3, densGlow: 0.58, densPartStyle: 'outline', densShapeA: 0.76, densTrans: 'free', densLines: { object: false, parts: false },
  densOutCol: 'grey', densPartLineW: 1.15, densPartLineA: 0.89, densPartLineCol: 'white' });   // (density: the user's screenshot, 2026-10-08)
const LABELS0 = { dots: 'dots', blocks: 'lines', flat: 'flat 2', flat2: 'flat 1', pixel: 'dither 1', pixel2: 'dither 2', pixel3d: 'pixel 3d', glass: 'glass', empty: 'empty', sketch: 'sketch', flathd: 'flat hd', flathd2: 'flat hd 2', milk: 'milk', live: 'live', cross: 'cross', cross2: 'cross 2', marker: 'marker', density: 'density', gradient: 'gradient', particles: 'particles', picasso: 'picasso', dotsgrid: 'dots grid', orbital: 'orbital', blob: 'blob' };
// the cross page names its three views: pegboard · napkin · density
const LABELS = { ...LABELS0, ...(CROSS ? { cross: 'pegboard', flathd2: 'napkin', density: 'density' } : {}) };

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
    if (CROSS && typeof markLook === 'function') { params.look = 1; markLook(); }   // (flat hd 2 too: look a)
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
    if (frIn) frIn.value = mode === 'density' ? params.densFrost : mode === 'flathd2' ? params.flatFrost : params.frost;
    const frl = document.querySelectorAll('#frost .lbl');
    if (frl.length === 2) { frl[0].textContent = mode === 'flathd2' ? 'parts blur' : 'clear'; frl[1].textContent = mode === 'flathd2' ? 'blurred' : 'frosted'; }
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
  dst.innerHTML = '<span class="lbl">density</span>' + (CROSS ? '<button data-dst="grainy">grainy</button>' : '') + '<button data-dst="soft">soft ball</button><button data-dst="bands">bands</button>';
  const markDst = () => dst.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.dst === params.densStyle));
  markDst();
  dst.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dst]');
    if (b) { params.densStyle = b.dataset.dst; markDst(); document.body.classList.toggle('dens-soft', params.densStyle !== 'bands'); }
  });
  document.body.classList.toggle('dens-soft', params.densStyle !== 'bands');   // (grainy: the soft ball's sliders too)
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

  // density: the outside solid or as outlines, and those outlines' own frost
  if (CROSS) {
    const dol = document.createElement('div');
    dol.id = 'densoutlook';
    dol.className = 'flatpill dpill';
    dol.innerHTML = '<span class="lbl">outside</span><button data-dol="solid">solid</button><button data-dol="outline">outline</button>';
    const dfo = document.createElement('div');
    dfo.id = 'densfrostout';
    dfo.className = 'dslider';
    dfo.innerHTML = '<span class="lbl">outside clear</span><input type="range" min="0" max="1" step="0.01" aria-label="outside frost"><span class="lbl">frosted</span>';
    const dfoR = dfo.querySelector('input');
    dfoR.value = params.densFrostOut ?? 0;
    dfoR.addEventListener('input', () => { params.densFrostOut = Number(dfoR.value); });
    const markDol = () => {
      dol.querySelectorAll('[data-dol]').forEach((b) => b.classList.toggle('on', b.dataset.dol === (params.densOutLook ?? 'solid')));
      document.body.classList.toggle('dens-outoutl', params.densOutLook === 'outline');
    };
    markDol();
    dol.addEventListener('click', (e) => { const b = e.target.closest('[data-dol]'); if (b) { params.densOutLook = b.dataset.dol; markDol(); } });
    document.body.append(dol, dfo);
  }

  // pegboard (cross): how bright the body is — darker ↔ lighter (0.5 = as designed)
  if (CROSS) {
    const cb = document.createElement('div');
    cb.id = 'crossbright';
    cb.innerHTML = '<span class="lbl">darker</span><input type="range" min="0" max="1" step="0.01" aria-label="body brightness"><span class="lbl">lighter</span>';
    const cbR = cb.querySelector('input');
    cbR.value = params.crossBright ?? 0.5;
    cbR.addEventListener('input', () => { params.crossBright = Number(cbR.value); });
    document.body.appendChild(cb);
  }

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
  dtr.innerHTML = '<span class="lbl">transition</span>' + (CROSS ? '<button data-dtr="free">free</button>' : '') + '<button data-dtr="condense">condense</button><button data-dtr="evaporate">evaporate</button><button data-dtr="liquid">liquid</button>';
  const markDtr = () => dtr.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.dtr === params.densTrans));
  markDtr();
  dtr.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dtr]');
    if (b) { params.densTrans = b.dataset.dtr; markDtr(); }
  });
  document.body.appendChild(dtr);

  // density: the parts inside, drawn as in cross (same looks) · how solid the shape is
  const dps = document.createElement('div');
  dps.id = 'densparts';
  const DLOOKS = { colour: 'real', grey: 'grey', flat: 'flat', vector: 'colour', outline: 'outline', flathd2: 'tiles' };
  dps.innerHTML = '<span class="lbl">parts</span>' + Object.entries(DLOOKS).map(([k, t]) => `<button data-dps="${k}">${t}</button>`).join('');
  const markDps = () => dps.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.dps === params.densPartStyle));
  markDps();
  dps.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dps]');
    if (b) { params.densPartStyle = b.dataset.dps; markDps(); markOutl?.(); }
  });
  document.body.appendChild(dps);
  // density, parts as outline: the line's thickness and colour (shown with the outline look)
  const dpw = document.createElement('div');
  dpw.id = 'denspartlw';
  dpw.className = 'densoutl';
  dpw.innerHTML = '<span class="lbl">line thin</span><input type="range" min="0.6" max="4" step="0.05" aria-label="outline thickness"><span class="lbl">thick</span>';
  const dpwR = dpw.querySelector('input');
  dpwR.value = params.densPartLineW;
  dpwR.addEventListener('input', () => { params.densPartLineW = Number(dpwR.value); });
  document.body.appendChild(dpw);
  const dpc = document.createElement('div');
  dpc.id = 'denspartcol';
  dpc.className = 'densoutl';
  dpc.innerHTML = '<span class="lbl">line</span><button data-dpc="parts" class="word">parts</button>' + Object.entries(CONFIG.flatLineCols).map(([k, c]) => `<button data-dpc="${k}" class="sw" title="${k === 'grey' ? 'warm grey' : k}" style="--sw:${c}"></button>`).join('');
  const markDpc = () => dpc.querySelectorAll('[data-dpc]').forEach((b) => b.classList.toggle('on', b.dataset.dpc === params.densPartLineCol));
  markDpc();
  dpc.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dpc]');
    if (b) { params.densPartLineCol = b.dataset.dpc; markDpc(); }
  });
  document.body.appendChild(dpc);
  const dsa = document.createElement('div');
  dsa.id = 'densalpha';
  dsa.innerHTML = '<span class="lbl">clear</span><input type="range" min="0" max="1" step="0.01" aria-label="shape opacity"><span class="lbl">solid</span>';
  const dsaR = dsa.querySelector('input');
  dsaR.value = params.densShapeA;
  dsaR.addEventListener('input', () => { params.densShapeA = Number(dsaR.value); });
  document.body.appendChild(dsa);

  // density: the outside's colour (knob caps, speaker holes, the screen): as it is, or one of the swatches
  const doc = document.createElement('div');
  doc.id = 'densoutcol';
  doc.innerHTML = '<span class="lbl">outside</span><button data-doc="real" class="word">real</button>' + Object.entries(CONFIG.flatLineCols).map(([k, c]) => `<button data-doc="${k}" class="sw" title="${k === 'grey' ? 'warm grey' : k}" style="--sw:${c}"></button>`).join('');
  const markDoc = () => doc.querySelectorAll('[data-doc]').forEach((b) => b.classList.toggle('on', b.dataset.doc === (params.densOutCol ?? 'real')));
  markDoc();
  doc.addEventListener('click', (e) => {
    const b = e.target.closest('[data-doc]');
    if (b) { params.densOutCol = b.dataset.doc; markDoc(); }
  });
  document.body.appendChild(doc);

  // density: its colours (one ramp each)
  const dpl = document.createElement('div');
  dpl.id = 'denspal';
  dpl.innerHTML = '<span class="lbl">colour</span>' + (CROSS ? CROSS_PALETTE.density : CONFIG.density.palettes).map((r, i) =>
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
    if (b) { params.densLines[b.dataset.dl] = !params.densLines[b.dataset.dl]; markDl(); markOutl(); }
  });
  document.body.appendChild(dln);
  // the line controls (thickness · colour · opacity) show with any outline: the parts' look, or the outlines on
  function markOutl() {
    document.body.classList.toggle('dens-outline', params.densPartStyle === 'outline' || !!params.densLines.object || !!params.densLines.parts);
  }
  markOutl();
  const dpo = document.createElement('div');
  dpo.id = 'denspartop';
  dpo.className = 'densoutl';
  dpo.innerHTML = '<span class="lbl">line faint</span><input type="range" min="0.1" max="1" step="0.01" aria-label="outline opacity"><span class="lbl">solid</span>';
  const dpoR = dpo.querySelector('input');
  dpoR.value = params.densPartLineA;
  dpoR.addEventListener('input', () => { params.densPartLineA = Number(dpoR.value); });
  document.body.appendChild(dpo);

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
  froR.addEventListener('input', () => { params[params.view === 'density' ? 'densFrost' : params.view === 'flathd2' ? 'flatFrost' : 'frost'] = Number(froR.value); });   // (density, flat hd 2: their own)
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
  fls.innerHTML = '<span class="lbl">lines</span>' + Object.entries(CONFIG.flatLineCols).map(([k, c]) => `<button data-flc="${k}" class="sw" title="${k === 'grey' ? 'warm grey' : k}" style="--sw:${c}"></button>`).join('')
    + (CROSS ? '' : '<span class="lbl sep">parts</span><button data-fp="fill">fill</button><button data-fp="outline">outline</button>');
  // (the cross page: the parts' fill / outline in a pill of its own, beside the parts' other controls)
  const fpm = document.createElement('div');
  fpm.id = 'flatpartsmode';
  fpm.className = 'flatpill';
  fpm.innerHTML = '<span class="lbl">parts</span><button data-fp="fill">fill</button><button data-fp="outline">outline</button>';
  const markFls = () => {
    fls.querySelectorAll('[data-flc]').forEach((b) => b.classList.toggle('on', b.dataset.flc === params.flatLineCol));
    [...fls.querySelectorAll('[data-fp]'), ...fpm.querySelectorAll('[data-fp]')].forEach((b) => b.classList.toggle('on', b.dataset.fp === params.flatParts));
  };
  markFls();
  fls.addEventListener('click', (e) => {
    const a = e.target.closest('[data-flc]'), b = e.target.closest('[data-fp]');
    if (a) params.flatLineCol = a.dataset.flc;
    if (b) params.flatParts = b.dataset.fp;
    markFls();
  });
  document.body.appendChild(fls);
  if (CROSS) {
    fpm.addEventListener('click', (e) => { const b = e.target.closest('[data-fp]'); if (b) { params.flatParts = b.dataset.fp; markFls(); } });
    document.body.appendChild(fpm);
  }

  // flat hd 2 (cross page): the parts in grey or in one colour's scale (they light up on the nodes' hover) · the line's weight
  if (CROSS) {
    const ft = document.createElement('div');
    ft.id = 'flattone';
    const tones = [['grey', '#9a9a96'], ['orange', CROSS_PALETTE.density[0][4]], ['aqua', CROSS_PALETTE.density[1][4]], ['olive', CROSS_PALETTE.density[2][4]], ['taupe', CROSS_PALETTE.density[3][4]]];
    ft.innerHTML = '<span class="lbl">parts</span>' + tones.map(([k, c]) => `<button data-ft="${k}" title="${k}" style="--sw:${c}"></button>`).join('')
      + '<button data-ft="colour" class="word">colour</button>';
    const markFt = () => ft.querySelectorAll('[data-ft]').forEach((b) => b.classList.toggle('on', b.dataset.ft === params.flatTone));
    markFt();
    ft.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ft]');
      if (b) { params.flatTone = b.dataset.ft; markFt(); }
    });
    document.body.appendChild(ft);
    const fw = document.createElement('div');
    fw.id = 'flatthin';
    fw.innerHTML = '<span class="lbl">thin</span><input type="range" min="0.3" max="2.5" step="0.01" aria-label="line weight"><span class="lbl">thick</span>';
    const fwR = fw.querySelector('input');
    fwR.value = params.flatLineW;
    fwR.addEventListener('input', () => { params.flatLineW = Number(fwR.value); });
    document.body.appendChild(fw);
    // …the outside (screen, knobs, speaker holes): the lines' colour, or one of its own
    const foc = document.createElement('div');
    foc.id = 'flatoutcol';
    foc.innerHTML = '<span class="lbl">outside</span><button data-foc="same" class="word">same</button>' + Object.entries(CONFIG.flatLineCols).map(([k, c]) => `<button data-foc="${k}" class="sw" title="${k === 'grey' ? 'warm grey' : k}" style="--sw:${c}"></button>`).join('');
    const markFoc = () => foc.querySelectorAll('[data-foc]').forEach((b) => b.classList.toggle('on', b.dataset.foc === params.flatOutCol));
    markFoc();
    foc.addEventListener('click', (e) => {
      const b = e.target.closest('[data-foc]');
      if (b) { params.flatOutCol = b.dataset.foc; markFoc(); }
    });
    document.body.appendChild(foc);
    // …the shade (faces seen edge-on) on / off · the parts' outlines broken or whole
    const fsh = document.createElement('div');
    fsh.id = 'flatshade';
    fsh.innerHTML = '<span class="lbl">shade</span><button data-fsh="1">on</button><button data-fsh="0">off</button>';
    const fpl = document.createElement('div');
    fpl.id = 'flatpartlines';
    fpl.className = 'flatpill';
    fpl.innerHTML = '<span class="lbl">part lines</span><button data-fpb="1">broken</button><button data-fpb="0">whole</button>';
    const markFsh = () => {
      fsh.querySelectorAll('[data-fsh]').forEach((b) => b.classList.toggle('on', (b.dataset.fsh === '1') === (params.flatShade !== false)));
      fpl.querySelectorAll('[data-fpb]').forEach((b) => b.classList.toggle('on', (b.dataset.fpb === '1') === (params.flatPartsBroken !== false)));
    };
    fpl.addEventListener('click', (e) => { const b = e.target.closest('[data-fpb]'); if (b) { params.flatPartsBroken = b.dataset.fpb === '1'; markFsh(); } });
    document.body.appendChild(fpl);
    markFsh();
    fsh.addEventListener('click', (e) => {
      const a = e.target.closest('[data-fsh]'), b = e.target.closest('[data-fpb]');
      if (a) params.flatShade = a.dataset.fsh === '1';
      if (b) params.flatPartsBroken = b.dataset.fpb === '1';
      markFsh();
    });
    document.body.appendChild(fsh);
    // …and a fill on the shape's surfaces, in the outline's colour: how see-through
    const ff = document.createElement('div');
    ff.id = 'flatfill';
    ff.innerHTML = '<span class="lbl">no fill</span><input type="range" min="0" max="1" step="0.01" aria-label="surface fill"><span class="lbl">fill</span>';
    const ffR = ff.querySelector('input');
    ffR.value = params.flatSkinFill;
    ffR.addEventListener('input', () => { params.flatSkinFill = Number(ffR.value); });
    document.body.appendChild(ff);
  }

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
    // (the arrow is gone from the page: in its place, a small hint — every view turns by dragging)
    const hint = document.createElement('div');
    hint.id = 'draghint';
    hint.textContent = 'drag to rotate';
    document.body.appendChild(hint);
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

  if (CROSS) {
    // left: the view and the angle snap, as modifiers (where the components list was)
    const left = document.createElement('div');
    left.id = 'leftmods';
    const vw = document.createElement('div');
    vw.className = 'lmod lviews';
    // a map seen from above: the object in the middle (its front edge drawn thicker, at the bottom), and around
    // it the eight places the camera can stand, each an arrow looking at the object; the middle = from above
    const VNAME = ['back left', 'back', 'back right', 'left', 'from above', 'right', 'front left', 'front', 'front right'];
    const camIcon = (i) => {
      if (i === 4) return '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1"/><path d="M4 12h8" class="edge"/></svg>';
      const dx = (i % 3) - 1, dy = Math.floor(i / 3) - 1;
      const rot = Math.atan2(-dy, -dx) * 180 / Math.PI - 90;   // (the arrow points down, turned toward the middle)
      return `<svg viewBox="0 0 16 16"><path d="M8 3.5v8M5.2 8.7 8 11.5l2.8-2.8" transform="rotate(${rot} 8 8)"/></svg>`;
    };
    vw.innerHTML = '<span class="lbl">view</span><div class="vwrap"><div class="vgrid">' + VIEW_CELLS.map((c, i) => `<button data-i="${i}" aria-label="${VNAME[i]}">${camIcon(i)}</button>`).join('') + '</div><div class="vname"></div></div>';
    const vname = vw.querySelector('.vname');
    const markVw = () => {
      const cur = orbit?.current();
      if (!cur) return;
      const k8 = ((cur.k % 8) + 8) % 8;
      let name = 'free';
      vw.querySelectorAll('[data-i]').forEach((b) => {
        const i = Number(b.dataset.i), c = VIEW_CELLS[i], on = c.top ? !!cur.top : !cur.top && !cur.free && c.k === k8;
        b.classList.toggle('on', on);
        if (on) name = VNAME[i];
      });
      vname.textContent = name;
    };
    vw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || !orbit) return;
      const c = VIEW_CELLS[Number(b.dataset.i)];
      if (c.top) orbit.goTo(null, true); else orbit.goTo(c.k, false);
    });
    orbit?.onChange(markVw);
    markVw();
    const sn = document.createElement('div');
    sn.className = 'lmod lsnap';
    const SN = [['free', 'free'], ['10', '10°'], ['20', '20°'], ['views', '90°']];
    sn.innerHTML = '<span class="lbl">angle snap</span>' + SN.map(([k, t]) => `<button data-snap="${k}">${t}</button>`).join('');
    const markSn = () => sn.querySelectorAll('[data-snap]').forEach((b) => b.classList.toggle('on', b.dataset.snap === params.angleSnap));
    markSn();
    sn.addEventListener('click', (e) => {
      const b = e.target.closest('[data-snap]');
      if (b) { params.angleSnap = b.dataset.snap; markSn(); }
    });
    left.append(vw, sn);
    document.body.appendChild(left);

    // right: every view's modifiers in one tidy column — the ones shown now, stacked from the bottom
    // in their own order, one width, one gap (they are placed one by one in CSS: this packs them)
    const SKIP = new Set(['viewtoggle', 'pagelink', 'viewctl-toggle', 'leftmods']);
    let pending = 0;
    const packRight = () => {
      pending = 0;
      const els = [...document.body.children].filter((el) => {
        if (SKIP.has(el.id) || el.classList.contains('node')) return false;
        const cs = getComputedStyle(el);
        return cs.position === 'fixed' && cs.display !== 'none' && cs.right === '20px' && cs.left !== '0px' && cs.top !== '20px';
      });
      // their order: as the stylesheet stacks them (the lower, the earlier) — density: its own, top to bottom,
      // the parts and everything about their outline together
      const ORDER = params.view === 'density' ? ['densedge', 'densgrain', 'densstyle', 'denspal', 'densglow', 'densmotion', 'densdiverge', 'denssoft',
        'denstrans', 'frost', 'densalpha', 'insideop', 'outsideop', 'densoutlook', 'densoutcol', 'densfrostout', 'densparts', 'denslines', 'denspartlw', 'denspartop', 'denspartcol', 'snapstyle']
        : params.view === 'flathd2' ? ['flatlines', 'flatthin', 'flatfill', 'flatshade',
          'unfinished', 'unfgaps', 'unftwice', 'unfhand', 'unfspeed', 'flatalive',
          'flatpartsmode', 'flatpartlines', 'flattone', 'frost', 'insideop',
          'outsideop', 'flatoutcol', 'snapstyle'] : null;
      els.forEach((el) => { el.style.bottom = ''; el.style.minWidth = ''; });
      const rank = (el) => (ORDER && ORDER.includes(el.id) ? -ORDER.indexOf(el.id) : null);
      els.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== null && rb !== null) return ra - rb;
        return parseFloat(getComputedStyle(a).bottom) - parseFloat(getComputedStyle(b).bottom);
      });
      els.forEach((el) => el.classList.add('rmod'));
      const wMax = Math.max(268, ...els.map((el) => el.offsetWidth));   // (one width: the widest)
      let y = 20;
      for (const el of els) {
        el.style.minWidth = `${wMax}px`;
        el.style.bottom = `${y}px`;
        y += el.offsetHeight + 6;
      }
    };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(packRight); };
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    setTimeout(packRight, 0);
    window.__packRight = packRight;   // debug: pack now (rAF is paused in a hidden tab)

    // hover a modifier: a small box top right says in one sentence what it does
    const TIPS = {
      // left
      lviews: 'Turns the object to a fixed angle: front, sides, back or from above.',
      lsnap: 'How the object settles when you let go of a drag: free, or snapping to 10°, 20° or 90° steps.',
      shp: 'The primitive shape the body is built on.',
      spk: 'The speaker inside: its size and power.',
      scr: 'The screen on the face: which display it is.',
      eng: 'The energy source that powers the object.',
      whl: 'The knobs on the object.',
      // pegboard
      crossbright: 'Makes the body lighter or darker.',
      voxshimmer: 'How much the loose voxels shimmer while the object turns.',
      voxels: 'How many loose voxels fly around while the object turns.',
      frostfollow: 'Whether the frost follows the tiles as they build up, or stays all the time.',
      crossdetail: 'From an abstract read of the object to one with more detail.',
      partstyle: 'How the parts inside are drawn.',
      crossanim: 'How the tiles appear when the view changes.',
      shimmer: 'How much the tiles shimmer at rest.',
      snapstyle: 'The marker shown where a knob or part can snap.',
      // napkin
      flatlines: 'The colour of the drawing.',
      flatthin: 'How thick the drawn lines are.',
      flatfill: 'A see-through fill on the body’s surfaces, in the line colour.',
      flatshade: 'The shading on faces seen almost edge-on.',
      unfinished: 'Leaves the drawing finished, or unfinished with missing strokes.',
      unfgaps: 'How many strokes are missing from the drawing.',
      unftwice: 'How many strokes are gone over a second time.',
      unfhand: 'How much the hand trembles as it draws.',
      unfspeed: 'How fast the gaps in the drawing move around.',
      flatalive: 'How much the line and the shape breathe at rest.',
      flatpartsmode: 'Parts inside drawn as filled shapes or as outlines.',
      flatpartlines: 'The parts’ outlines broken like the drawing, or whole.',
      flattone: 'The colour scale of the parts inside.',
      flatoutcol: 'The colour of what sits outside: screen, knobs, speaker holes.',
      // density
      densedge: 'How crisp or hazy the edge of the shape is.',
      densgrain: 'How smooth or grainy the shape is.',
      densstyle: 'The rendering style of the shape.',
      denspal: 'The colour of the shape.',
      densglow: 'Flat colour, or lit from above like coloured glass.',
      densmotion: 'How much the shape moves and flows.',
      densdiverge: 'How faithfully the shape follows the object, or strays freely from it.',
      denssoft: 'How tight or soft the shape is around the object.',
      densalpha: 'How see-through the shape is.',
      densoutcol: 'The colour of what sits outside: screen, knobs, speaker holes.',
      densoutlook: 'What sits outside drawn solid, or as outlines.',
      densfrostout: 'How frosted the outside outlines are, on their own.',
      densparts: 'How the parts inside are drawn.',
      denslines: 'Adds outlines to the object and / or its parts.',
      denspartlw: 'How thick the outlines are.',
      denspartop: 'How solid the outlines are.',
      denspartcol: 'The colour of the outlines.',
    };
    const tipFor = (el, target) => {
      const v = params.view;
      const cell = target?.closest?.('.lviews [data-i]');
      if (cell) return `Look at the object from ${['the back left', 'the back', 'the back right', 'the left', 'above', 'the right', 'the front left', 'the front', 'the front right'][Number(cell.dataset.i)]}.`;
      if (el.id === 'frost') return v === 'flathd2' ? 'How blurred the parts inside are.' : 'How frosted the parts inside look, as through frosted glass.';
      if (el.id === 'insideop') return 'How visible the parts inside are.';
      if (el.id === 'outsideop') return 'How visible what sits outside is: screen, knobs, speaker holes.';
      if (TIPS[el.id]) return TIPS[el.id];
      for (const c of el.classList) if (TIPS[c]) return TIPS[c];
      return null;
    };
    const tip = document.createElement('div');
    tip.id = 'modtip';
    document.body.appendChild(tip);
    let tipEl = null;
    window.addEventListener('pointermove', (e) => {
      const el = e.target.closest?.('.rmod, #leftmods .lmod, #leftmods .node');
      const t = el ? tipFor(el, e.target) : null;
      if (!t) { if (tipEl) { tip.classList.remove('on'); tipEl = null; } return; }
      if (tip.textContent !== t || !tipEl) { tip.textContent = t; tipEl = el; tip.classList.add('on'); }   // (shown top right: style.css)
    }, { passive: true });
    window.addEventListener('pointerdown', () => { tip.classList.remove('on'); tipEl = null; }, { passive: true });
  }

  set(params.view);
  return { set };
}
