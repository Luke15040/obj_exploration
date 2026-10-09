import { CONFIG } from '../config.js?v=202610091622';
import { params } from '../state.js?v=202610091622';

/**
 * The block prompt (cross page), drawn in the language of the pixel shape: every prompt is
 * a little island of cells ON THE PAGE'S GRID (same cells, greys, fillets and marks as the
 * shape). Drag one from the tray at the bottom — it moves cell by cell, on the pattern — up
 * to the sentence at the top: near the next free place it clicks in magnetically. The
 * prompts stack in steps (each one a cell further in, like nested code blocks) and their
 * cells merge into one blob: fillets only where the blob has an outer corner. A prompt
 * that lands builds itself up cell by cell. Drag one out of the stack and it goes back to
 * the tray; the object is then recomposed from the prompts still stacked.
 *
 * @param {{ presets: () => object[], onAttach: (p) => void, onChange: (list) => void,
 *           onReset: () => void, grid: () => { cell: number, ox: number, oyTop: number } }} hooks
 */
export function createBlockPrompt({ presets, onAttach, onChange, onReset, grid, onFocus = () => {}, head: headText = () => 'a thing that' }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'promptcells';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  // the cross page: the sentence as a plain line of text at the bottom (the blocks are not shown, not editable)
  const LOCKED = document.body.dataset.page === 'cross';
  const line0 = document.createElement('div');
  line0.id = 'promptline';
  if (LOCKED) document.body.appendChild(line0);
  const again = document.createElement('button');
  again.id = 'blockagain';
  again.textContent = 'start over';
  document.body.appendChild(again);

  const FONT = '13px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
  const BUILD = 0.32;         // s: a prompt's cells build up over this long (each cell its own moment)
  let busy = false, clock = 0;
  let pieces = [];            // { p, text, w, h, place: 'tray' | 'stack', col, row, t0, key }
  const stack = [];           // pieces in the sentence, in order
  let drag = null;            // { piece, gc, gr, col, row, near }
  let focus = null;           // the important prompt: in line with 'a thing that' (the last attached, or the last clicked)
  let line = null;            // the piece drawn in line right now (the focus, unless one is being dropped there)
  let pending = null;         // pointer down on a piece, not moved yet (a click, or the start of a drag)
  let hovered = null;         // the prompt in the sentence under the pointer (its × shows clearly)
  const head = { text: 'a thing that', place: 'head', key: '', t0: 0 };   // the root: never moves, never leaves
  let G = { cell: 20, ox: 0, oyTop: 0 };

  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const textW = new Map();
  const measure = (t) => {
    if (!textW.has(t)) { ctx.font = FONT; textW.set(t, ctx.measureText(t).width); }
    return textW.get(t);
  };
  const cellAt = (x, y) => [Math.floor((x - G.ox) / G.cell), Math.floor((y - G.oyTop) / G.cell)];
  const cellX = (c) => G.ox + c * G.cell, cellY = (r) => G.oyTop + r * G.cell;

  /** Size in cells: the text plus half a cell of margin each side (at least 8 px), one or more rows. */
  function sizeOf(piece) {
    const pad = Math.max(8, G.cell * 0.5);
    const g = piece.p?.glyph ? 1 : 0;      // the glyph takes the first cell
    piece.w = g + Math.max(2, Math.ceil((measure(piece.text) + 2 * pad) / G.cell)) + (piece.place === 'stack' ? 1 : 0);   // (+ the ×: it can be taken out)
    piece.h = Math.max(1, Math.ceil(24 / G.cell));
  }

  /** Where everything sits on the grid (stack at the top, tray at the bottom). */
  function layout() {
    const indent = Math.max(1, Math.round(14 / G.cell));
    // the sentence: 'a thing that' and the important prompt side by side on one row,
    // the other prompts stacked above and below it (alternating), a step further in
    if (head.text !== headText()) { head.text = headText(); textW.delete(head.text); }
    sizeOf(head);
    // while a prompt hovers over the main place, the current main one steps down into the rest
    const toMain = drag?.near && drag.target === 'main';
    const cur = stack.includes(focus) ? focus : null;
    const f = toMain ? null : cur;
    line = f;
    const others = toMain && cur ? [cur, ...stack.filter((pc) => pc !== cur)] : stack.filter((pc) => pc !== f);
    const above = others.filter((_, i) => i % 2 === 1), below = others.filter((_, i) => i % 2 === 0);
    const unit = Math.max(1, Math.ceil(24 / G.cell));
    const slotW = drag ? drag.piece.w : 6, slotH = drag ? drag.piece.h : unit;
    const rowW = head.w + (f ? f.w : slotW);
    const col0 = Math.round((window.innerWidth / 2 - G.ox) / G.cell - rowW / 2);
    const row0 = Math.round((70 - G.oyTop) / G.cell) + above.reduce((s, pc) => s + pc.h, 0);
    place(head, col0, row0, 'head');
    if (f) place(f, col0 + head.w, row0, 'stack');
    let r = row0;
    for (const pc of above) { r -= pc.h; place(pc, col0 + 2 * indent, r, 'stack'); }
    r = row0 + head.h;
    for (const pc of below) { place(pc, col0 + indent, r, 'stack'); r += pc.h; }
    // two places to drop: beside the root (the main feature) and under the rest (a feature among others)
    slots.length = 0;
    slots.push({ kind: 'main', col: col0 + head.w, row: row0, w: f ? f.w : slotW, h: slotH, free: !f });
    if (stack.length) slots.push({ kind: 'rest', col: col0 + indent, row: r, w: slotW, h: slotH, free: true });
    // the tray: one row, a cell apart, centred near the bottom
    const tray = pieces.filter((pc) => pc.place === 'tray' && pc !== drag?.piece);
    const all = pieces.filter((pc) => pc.place === 'tray');
    const tw = all.reduce((s, pc) => s + pc.w, 0) + Math.max(0, all.length - 1);
    let col = Math.round((window.innerWidth / 2 - G.ox) / G.cell - tw / 2);
    const trow = Math.round((window.innerHeight - 50 - G.oyTop) / G.cell);
    for (const pc of all) {
      if (tray.includes(pc)) place(pc, col, trow - pc.h + 1, 'tray');
      col += pc.w + 1;
    }
    const al = `${Math.round(cellX(col) + 4)}px`, at = `${Math.round(cellY(trow) + G.cell / 2 - 11)}px`;
    if (again.style.left !== al) again.style.left = al;   // (only when it moved: a write makes the page lay out again)
    if (again.style.top !== at) again.style.top = at;
  }
  const slots = [];            // { kind: 'main' | 'rest', col, row, w, h, free }
  function place(pc, col, row, where) {
    const key = `${col},${row},${pc.w},${pc.h},${where}`;
    if (key !== pc.key) {
      // inside the sentence (or just dropped into it) a prompt slides to its new place;
      // anything else builds up again where it lands
      const slide = (where === 'stack' || where === 'head') && pc.px !== undefined && (pc.dropped || pc.was === where);
      if (!slide) { pc.t0 = clock; pc.px = col; pc.py = row; }
      pc.dropped = false;
      pc.key = key;
    }
    pc.was = where;
    pc.col = col; pc.row = row; pc.place = where;
    return true;
  }
  /** Every frame: the slide of the prompts that moved (eased, a few frames). */
  function glide(dt) {
    const k = 1 - Math.exp(-dt * 14);
    for (const pc of [head, ...pieces]) {
      if (pc.px === undefined) continue;
      pc.px += (pc.col - pc.px) * k; pc.py += (pc.row - pc.py) * k;
      if (Math.abs(pc.col - pc.px) < 0.02 && Math.abs(pc.row - pc.py) < 0.02) { pc.px = pc.col; pc.py = pc.row; }
    }
  }
  const settled = (pc) => pc.px === pc.col && pc.py === pc.row;

  /** Cells of a piece at (col, row), with how far each one has grown (0..1). */
  function cellsOf(pc, col, row, built) {
    const out = [];
    for (let j = 0; j < pc.h; j++) for (let i = 0; i < pc.w; i++) {
      const c = col + i, r = row + j;
      const g = built ? 1 : Math.min(1, Math.max(0, (clock - pc.t0 - hash(c, r) * BUILD * 0.7) / (BUILD * 0.3)));
      out.push({ c, r, g: 1 - (1 - g) * (1 - g) });
    }
    return out;
  }

  /** Draw one blob of cells: rounded squares, a corner rounded when both its side neighbours are missing. */
  function drawBlob(cells, tones, dpr, alpha) {
    const at = new Map(cells.map((q) => [`${q.c},${q.r}`, q]));
    const full = (c, r) => (at.get(`${c},${r}`)?.g ?? 0) >= 1;
    const c = G.cell;
    ctx.globalAlpha = alpha;
    for (const q of cells) {
      if (q.g <= 0.01) continue;
      const half = 0.5 * c * q.g + (q.g >= 1 ? 0.6 / dpr : 0);   // full cells overlap a hair: no seams between them
      const cx = cellX(q.c) + c / 2, cy = cellY(q.r) + c / 2;
      const L = !full(q.c - 1, q.r), R = !full(q.c + 1, q.r), T = !full(q.c, q.r - 1), B = !full(q.c, q.r + 1);
      const rad = [T && L, T && R, B && R, B && L].map((o) => (o ? half : 0));
      ctx.fillStyle = tones(q);
      ctx.beginPath();
      ctx.roundRect(Math.round((cx - half) * dpr) / dpr, Math.round((cy - half) * dpr) / dpr, Math.round(2 * half * dpr) / dpr, Math.round(2 * half * dpr) / dpr, rad);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** The page's mark on every cell centre (as the shape: cross / dot / ring), crisp, one device px. */
  function drawMarks(cells, col, dpr, skip = null) {
    const c = G.cell, k = Math.max(2, Math.min(3, Math.floor(c * dpr * 0.12)));
    const mark = params.snapStyle || 'dot';
    ctx.lineWidth = 1 / dpr;
    for (const q of cells) {
      if (q.g < 1 || skip?.has(`${q.c},${q.r}`)) continue;
      ctx.fillStyle = ctx.strokeStyle = typeof col === 'function' ? col(q) : col;
      ctx.globalAlpha = 0.7;
      const x = (Math.floor((cellX(q.c) + c / 2) * dpr) + 0.5) / dpr, y = (Math.floor((cellY(q.r) + c / 2) * dpr) + 0.5) / dpr;
      ctx.beginPath();
      if (mark === 'cross') { ctx.moveTo(x - k / dpr, y); ctx.lineTo(x + k / dpr, y); ctx.moveTo(x, y - k / dpr); ctx.lineTo(x, y + k / dpr); ctx.stroke(); }
      else if (mark === 'ring') { ctx.arc(x, y, k / dpr, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.arc(x, y, Math.max(0.8, c * 0.07), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  const INK = '#2b2925';
  /** The words, after the glyph. */
  function drawText(pc, col, row, built, ink = INK) {
    const k = built ? 1 : Math.min(1, Math.max(0, (clock - pc.t0 - BUILD * 0.6) / 0.2));
    if (k <= 0) return;
    const pad = Math.max(8, G.cell * 0.5);
    const g = pc.p?.glyph ? 1 : 0;
    const x0 = cellX(col + g) + (g ? 2 : pad), y = cellY(row) + (pc.h * G.cell) / 2 + 0.5;
    ctx.globalAlpha = k * (busy ? 0.5 : 1);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(pc.text, x0, y);
    if (g) drawGlyph(pc.p.glyph, cellX(col) + G.cell / 2, cellY(row) + (pc.h * G.cell) / 2);
    ctx.globalAlpha = 1;
  }

  /** The × at the end of a prompt in the sentence: it can be taken out (back to the tray). */
  function drawCross(pc, col, row) {
    const c = G.cell, x = cellX(col + pc.w - 1) + c / 2, y = cellY(row) + (pc.h * c) / 2, r = Math.max(2.5, c * 0.16);
    ctx.globalAlpha = (pc === hovered ? 0.85 : 0.3) * (busy ? 0.5 : 1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** One small black sign per prompt, in its first cell: a single simple geometric shape. */
  function drawGlyph(kind, x, y) {
    const c = G.cell, r = c * 0.24;
    ctx.fillStyle = ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, c * 0.09);
    ctx.beginPath();
    if (kind === 'square') ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
    else if (kind === 'triangle') { ctx.moveTo(x, y - r * 1.05); ctx.lineTo(x + r * 1.05, y + r * 0.8); ctx.lineTo(x - r * 1.05, y + r * 0.8); ctx.closePath(); }
    else if (kind === 'semi') { ctx.arc(x, y + r * 0.45, r * 1.1, Math.PI, 0); ctx.closePath(); }   // a half disc: rolls
    else if (kind === 'diamond') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
    else ctx.arc(x, y, kind === 'ring' ? r * 0.85 : r, 0, Math.PI * 2);
    if (kind === 'ring') ctx.stroke(); else ctx.fill();
  }

  // the free place: hatched cells (a slot waiting to be filled); the stripes run while a prompt is near
  const hatch = (() => {
    const t = document.createElement('canvas');
    t.width = t.height = 8;
    const g = t.getContext('2d');
    g.strokeStyle = '#8c8983';
    g.lineWidth = 1.2;
    g.beginPath();
    for (const o of [-8, 0, 8]) { g.moveTo(o, 8); g.lineTo(o + 8, 0); }
    g.stroke();
    return ctx.createPattern(t, 'repeat');
  })();

  // the last picture drawn: while nothing moves, builds or changes, the canvas is left as it is
  let drawnSig = null;
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    const animating = !!drag || [head, ...pieces].some((pc) => !settled(pc) || clock - pc.t0 < BUILD + 1);
    const sig = [W, H, G.cell, G.ox, G.oyTop, params.look, params.snapStyle, busy, line?.key ?? '', head.key, head.text, hovered?.key ?? '',
      ...pieces.map((pc) => pc.key + pc.place + pc.text + (stack.includes(pc) ? '*' : '')),
      ...slots.map((sl) => `${sl.kind}${sl.col},${sl.row},${sl.w},${sl.h}${sl.free}`)].join('|');
    if (!animating && sig === drawnSig) return;
    drawnSig = animating ? null : sig;   // (after an animation: one more, still frame)
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const X = params.look === 1 ? { ...CONFIG.cross, ...CONFIG.cross.lookA } : CONFIG.cross;
    // nested like code blocks: the root dark, each prompt below it one step lighter
    const ROOT = '#5b5853', ROOT_MARK = '#d9d6d0', ROOT_INK = '#f3f1ec';
    const alpha = busy ? 0.55 : 1;
    const glyphCells = (pc, col, row) => (pc.p?.glyph ? Array.from({ length: pc.h }, (_, j) => `${col},${row + j}`) : []);

    // the next free place in the stack: hatched cells (the stripes run while a prompt is near)
    hatch.setTransform(new DOMMatrix().translate(drag?.near ? (clock * 16) % 8 : 0, 0));
    for (const sl of slots) {
      if (!sl.free) continue;
      const cells = [];
      for (let j = 0; j < sl.h; j++) for (let i = 0; i < sl.w; i++) cells.push({ c: sl.col + i, r: sl.row + j, g: 1 });
      const on = drag?.near && drag.target === sl.kind;
      drawBlob(cells, () => hatch, dpr, on ? 0.9 : drag ? 0.6 : 0.4);
    }

    // the stack, 'a thing that' included: one blob
    const sc = [];
    const toneOf = new Map(), skip = new Set();
    const toneFor = (pc) => (pc === head ? ROOT : pc === line ? X.light : pc.row < head.row ? X.top : X.side);
    const moving = [head, ...stack].filter((pc) => !settled(pc));
    [head, ...stack].filter(settled).forEach((pc) => {
      const tone = toneFor(pc);
      cellsOf(pc, pc.col, pc.row).forEach((q) => { sc.push(q); toneOf.set(`${q.c},${q.r}`, tone); });
      glyphCells(pc, pc.col, pc.row).forEach((k) => skip.add(k));
    });
    drawBlob(sc, (q) => toneOf.get(`${q.c},${q.r}`), dpr, alpha);
    drawMarks(sc, (q) => (toneOf.get(`${q.c},${q.r}`) === ROOT ? ROOT_MARK : X.dot), dpr, skip);
    if (settled(head)) drawText(head, head.col, head.row, false, ROOT_INK);
    stack.filter(settled).forEach((pc) => { drawText(pc, pc.col, pc.row); drawCross(pc, pc.col, pc.row); });
    for (const pc of moving) {
      ctx.save();
      ctx.translate((pc.px - pc.col) * G.cell, (pc.py - pc.row) * G.cell);
      const tone = toneFor(pc), cs = cellsOf(pc, pc.col, pc.row);
      drawBlob(cs, () => tone, dpr, alpha);
      drawMarks(cs, tone === ROOT ? ROOT_MARK : X.dot, dpr, new Set(glyphCells(pc, pc.col, pc.row)));
      drawText(pc, pc.col, pc.row, false, pc === head ? ROOT_INK : INK);
      ctx.restore();
    }

    // the tray: an island each
    for (const pc of pieces) {
      if (pc.place !== 'tray' || pc === drag?.piece) continue;
      const cs = cellsOf(pc, pc.col, pc.row);
      drawBlob(cs, () => X.top, dpr, alpha);
      drawMarks(cs, X.dot, dpr, new Set(glyphCells(pc, pc.col, pc.row)));
      drawText(pc, pc.col, pc.row);
    }

    // the one being dragged, on the grid, lifted off the page (its shadow a few px below)
    if (drag) {
      const pc = drag.piece;
      const cs = cellsOf(pc, drag.col, drag.row, true);
      ctx.save();
      ctx.translate(2, 3);
      drawBlob(cs, () => 'rgba(60, 54, 44, 0.16)', dpr, 1);
      ctx.restore();
      drawBlob(cs, () => (drag.near ? X.light : X.top), dpr, 1);
      drawMarks(cs, X.dot, dpr, new Set(glyphCells(pc, drag.col, drag.row)));
      drawText(pc, drag.col, drag.row, true);
    }
  }

  /* ---------- pointer ---------- */

  const hit = (x, y) => {
    const [c, r] = cellAt(x, y);
    return [...pieces].reverse().find((pc) => c >= pc.col && c < pc.col + pc.w && r >= pc.row && r < pc.row + pc.h);
  };
  window.addEventListener('pointerdown', (e) => {
    if (LOCKED || e.button !== 0 || busy) return;
    const pc = hit(e.clientX, e.clientY);
    if (!pc) return;
    e.preventDefault();
    e.stopPropagation();            // not an orbit, not a part drag
    const [c, r] = cellAt(e.clientX, e.clientY);
    // on its ×: out of the sentence, back to the tray (as when dragged out)
    if (stack.includes(pc) && c === pc.col + pc.w - 1) {
      const was = focus;
      stack.splice(stack.indexOf(pc), 1);
      pc.place = 'tray';
      if (focus === pc) focus = stack[0] ?? null;
      hovered = null;
      onChange(stack.map((q) => q.p));
      if (focus !== was) onFocus(focus?.p ?? null);
      return;
    }
    pending = { piece: pc, x: e.clientX, y: e.clientY, gc: c - pc.col, gr: r - pc.row };
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 4) {
      const { piece: pc, gc, gr } = pending;
      pending = null;
      const wasIn = stack.includes(pc);
      if (wasIn) stack.splice(stack.indexOf(pc), 1);
      drag = { piece: pc, gc, gr, col: pc.col, row: pc.row, near: false, wasIn };
      document.documentElement.classList.add('block-dragging');
    }
    if (!drag) {
      const h = hit(e.clientX, e.clientY);
      document.documentElement.classList.toggle('block-hover', !busy && !!h);
      hovered = h && stack.includes(h) ? h : null;
      return;
    }
    const [c, r] = cellAt(e.clientX, e.clientY);
    let col = c - drag.gc, row = r - drag.gr;
    // magnetic: within a few cells of the free place it jumps in and holds
    const M = Math.max(2, Math.round(70 / G.cell));
    let best = null, bd = Infinity;
    for (const sl of slots) {
      const dc = Math.abs(col - sl.col), dr = Math.abs(row - sl.row);
      if (dc > M || dr > M) continue;
      const d = dc + 2 * dr + (sl.kind === drag.target ? -1 : 0);   // (a little stickiness: no flicker between the two)
      if (d < bd) { bd = d; best = sl; }
    }
    drag.near = !!best;
    drag.target = best?.kind ?? null;
    if (best) { col = best.col; row = best.row; }
    drag.col = col; drag.row = row;
  }, true);
  window.addEventListener('pointerup', () => {
    if (pending) {                  // a click: a stacked prompt comes in line, a tray one joins
      const pc = pending.piece;
      pending = null;
      if (stack.includes(pc)) { if (focus !== pc) { focus = pc; onFocus(pc.p); } }
      else if (pc.place === 'tray' && !busy) {
        stack.push(pc); pc.place = 'stack';
        const was = focus;
        if (!stack.includes(focus)) focus = pc;   // the first one is the main one; later ones join the rest
        onAttach(pc.p);
        if (focus !== was) onFocus(focus.p);
      }
      return;
    }
    if (!drag) return;
    const { piece: pc, near, wasIn, target, col: dc, row: dr } = drag;
    drag = null;
    document.documentElement.classList.remove('block-dragging');
    const was = focus;
    if (near) {
      stack.push(pc);
      pc.place = 'stack';
      pc.px = dc; pc.py = dr; pc.dropped = true; pc.t0 = -1e3;   // (built already: it slides in)
      if (target === 'main' || !stack.includes(focus)) focus = pc;   // dropped beside the root: the main feature
      else if (focus === pc) focus = stack.find((q) => q !== pc) ?? pc;   // the main one moved down to the rest: the next one steps up
      if (!wasIn) onAttach(pc.p);          // a new prompt: it plays
    } else {
      pc.place = 'tray';
      if (focus === pc) focus = stack[0] ?? null;
      if (wasIn) onChange(stack.map((q) => q.p));   // one left the stack: recompose
    }
    if (focus !== was || (wasIn && !near)) onFocus(focus?.p ?? null);
  }, true);
  again.addEventListener('click', () => { if (!busy) { rebuild(); onReset(); } });

  /** Fresh tray for the current case (every prompt back out of the stack). */
  function rebuild() {
    stack.length = 0;
    drag = pending = focus = null;
    pieces = presets().map((p) => ({ p, text: p.block ?? p.prompt, place: 'tray', key: '', t0: clock }));
  }
  rebuild();

  // debug: where the prompts and the free place are, in CSS px (the canvas has no DOM to find)
  const rect = (col, row, w, h) => ({ x: cellX(col), y: cellY(row), w: w * G.cell, h: h * G.cell });
  window.__blocks = () => ({ pieces: pieces.map((pc) => ({ text: pc.text, place: pc.place, ...rect(pc.col, pc.row, pc.w, pc.h) })), slots: slots.map((sl) => ({ kind: sl.kind, free: sl.free, ...rect(sl.col, sl.row, sl.w, sl.h) })), cell: G.cell });

  return {
    rebuild,
    /** Put a prompt into the sentence as if dropped there (it plays). */
    attachById(id) {
      const pc = pieces.find((q) => q.p.id === id && q.place === 'tray');
      if (!pc || busy) return;
      stack.push(pc);
      pc.place = 'stack';
      const first = !stack.includes(focus);
      if (first) focus = pc;
      onAttach(pc.p);
      if (first) onFocus(pc.p);
    },
    /** The main feature (the prompt in line with the root), or null. */
    main: () => (stack.includes(focus) ? focus.p : null),
    setBusy(b) { busy = b; again.classList.toggle('busy', b); },
    /** Every frame (from the prompts' update): follow the grid, lay out, draw. */
    update(dt) {
      clock += dt;
      const g = grid();
      if (g && (g.cell !== G.cell)) textW.clear();
      if (g) G = g;
      for (const pc of pieces) sizeOf(pc);
      layout();
      glide(dt);
      if (LOCKED) {
        // the sentence, each block in its own colour: the root, the others, and the main feature last
        // ('a speaking thing that lets me control volume, lets me control bass and has a face')
        const main = stack.includes(focus) ? focus : null;
        const rest = stack.filter((pc) => pc !== main).map((pc) => pc.text);
        const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
        const parts = rest.map((t) => `<span class="pl-rest">${esc(t)}</span>`);
        const tail = main ? `<span class="pl-main">${esc(main.text)}</span>` : '';
        const body2 = parts.length && tail ? parts.join('<i>, </i>') + '<i> and </i>' + tail : parts.length ? parts.join('<i>, </i>') : tail || '<i>…</i>';
        const html = `<span class="pl-root">${esc(head.text)}</span> ` + body2;
        if (line0.dataset.html !== html) { line0.dataset.html = html; line0.innerHTML = html; }
        return;
      }
      draw();
    },
  };
}
