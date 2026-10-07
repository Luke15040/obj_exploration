import { CONFIG } from '../config.js?v=202610071420';
import { params } from '../state.js?v=202610071420';

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
export function createBlockPrompt({ presets, onAttach, onChange, onReset, grid }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'promptcells';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
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
    piece.w = g + Math.max(2, Math.ceil((measure(piece.text) + 2 * pad) / G.cell));
    piece.h = Math.max(1, Math.ceil(24 / G.cell));
  }

  /** Where everything sits on the grid (stack at the top, tray at the bottom). */
  function layout() {
    const indent = Math.max(1, Math.round(14 / G.cell));
    // the stack: 'a thing that' on top, then each prompt one indent further in, right below the previous one
    sizeOf(head);
    let ext = head.w;
    stack.forEach((pc, i) => { ext = Math.max(ext, (i + 1) * indent + pc.w); });
    const slotW = drag ? drag.piece.w : 6;   // (the free place doesn't move the stack: it only reaches to the right)
    const col0 = Math.round((window.innerWidth / 2 - G.ox) / G.cell - ext / 2);
    let row = Math.round((70 - G.oyTop) / G.cell);
    place(head, col0, row, 'head');
    row += head.h;
    stack.forEach((pc, i) => place(pc, col0 + (i + 1) * indent, row, 'stack') && (row += pc.h));
    slot.col = col0 + (stack.length + 1) * indent;
    slot.row = row;
    slot.w = slotW;
    slot.h = drag ? drag.piece.h : Math.max(1, Math.ceil(24 / G.cell));
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
    again.style.left = `${Math.round(cellX(col) + 4)}px`;
    again.style.top = `${Math.round(cellY(trow) + G.cell / 2 - 11)}px`;
  }
  const slot = { col: 0, row: 0, w: 6, h: 1 };
  function place(pc, col, row, where) {
    const key = `${col},${row},${pc.w},${pc.h},${where}`;
    if (key !== pc.key) { pc.key = key; pc.t0 = clock; }   // moved: build up again where it lands
    pc.col = col; pc.row = row; pc.place = where;
    return true;
  }

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

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const X = params.look === 1 ? { ...CONFIG.cross, ...CONFIG.cross.lookA } : CONFIG.cross;
    // nested like code blocks: the root dark, each prompt below it one step lighter
    const ROOT = '#5b5853', ROOT_MARK = '#d9d6d0', ROOT_INK = '#f3f1ec';
    const TONES = [X.side, X.light, X.top];
    const alpha = busy ? 0.55 : 1;
    const glyphCells = (pc, col, row) => (pc.p?.glyph ? Array.from({ length: pc.h }, (_, j) => `${col},${row + j}`) : []);

    // the next free place in the stack: hatched cells (the stripes run while a prompt is near)
    const slotCells = [];
    for (let j = 0; j < slot.h; j++) for (let i = 0; i < slot.w; i++) slotCells.push({ c: slot.col + i, r: slot.row + j, g: 1 });
    hatch.setTransform(new DOMMatrix().translate(drag?.near ? (clock * 16) % 8 : 0, 0));
    drawBlob(slotCells, () => hatch, dpr, drag?.near ? 0.9 : drag ? 0.6 : 0.4);

    // the stack, 'a thing that' included: one blob
    const sc = [];
    const toneOf = new Map(), skip = new Set();
    [head, ...stack].forEach((pc, i) => {
      cellsOf(pc, pc.col, pc.row).forEach((q) => { sc.push(q); toneOf.set(`${q.c},${q.r}`, i === 0 ? ROOT : TONES[Math.min(i - 1, 2)]); });
      glyphCells(pc, pc.col, pc.row).forEach((k) => skip.add(k));
    });
    drawBlob(sc, (q) => toneOf.get(`${q.c},${q.r}`), dpr, alpha);
    drawMarks(sc, (q) => (toneOf.get(`${q.c},${q.r}`) === ROOT ? ROOT_MARK : X.dot), dpr, skip);
    drawText(head, head.col, head.row, false, ROOT_INK);
    stack.forEach((pc) => drawText(pc, pc.col, pc.row));

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
    if (e.button !== 0 || busy) return;
    const pc = hit(e.clientX, e.clientY);
    if (!pc) return;
    e.preventDefault();
    e.stopPropagation();            // not an orbit, not a part drag
    const [c, r] = cellAt(e.clientX, e.clientY);
    const wasIn = stack.includes(pc);
    if (wasIn) stack.splice(stack.indexOf(pc), 1);
    drag = { piece: pc, gc: c - pc.col, gr: r - pc.row, col: pc.col, row: pc.row, near: false, wasIn };
    document.documentElement.classList.add('block-dragging');
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag) {
      document.documentElement.classList.toggle('block-hover', !busy && !!hit(e.clientX, e.clientY));
      return;
    }
    const [c, r] = cellAt(e.clientX, e.clientY);
    let col = c - drag.gc, row = r - drag.gr;
    // magnetic: within a few cells of the free place it jumps in and holds
    const M = Math.max(2, Math.round(70 / G.cell));
    drag.near = Math.abs(col - slot.col) <= M && Math.abs(row - slot.row) <= M;
    if (drag.near) { col = slot.col; row = slot.row; }
    drag.col = col; drag.row = row;
  }, true);
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const { piece: pc, near, wasIn } = drag;
    drag = null;
    document.documentElement.classList.remove('block-dragging');
    if (near) {
      stack.push(pc);
      pc.place = 'stack';
      if (!wasIn) onAttach(pc.p);          // a new prompt: it plays
    } else {
      pc.place = 'tray';
      if (wasIn) onChange(stack.map((q) => q.p));   // one left the stack: recompose
    }
  }, true);
  again.addEventListener('click', () => { if (!busy) { rebuild(); onReset(); } });

  /** Fresh tray for the current case (every prompt back out of the stack). */
  function rebuild() {
    stack.length = 0;
    drag = null;
    pieces = presets().map((p) => ({ p, text: p.block ?? p.prompt, place: 'tray', key: '', t0: clock }));
  }
  rebuild();

  // debug: where the prompts and the free place are, in CSS px (the canvas has no DOM to find)
  const rect = (col, row, w, h) => ({ x: cellX(col), y: cellY(row), w: w * G.cell, h: h * G.cell });
  window.__blocks = () => ({ pieces: pieces.map((pc) => ({ text: pc.text, place: pc.place, ...rect(pc.col, pc.row, pc.w, pc.h) })), slot: rect(slot.col, slot.row, slot.w, slot.h), cell: G.cell });

  return {
    rebuild,
    /** Put a prompt into the sentence as if dropped there (it plays). */
    attachById(id) {
      const pc = pieces.find((q) => q.p.id === id && q.place === 'tray');
      if (!pc || busy) return;
      stack.push(pc);
      pc.place = 'stack';
      onAttach(pc.p);
    },
    setBusy(b) { busy = b; again.classList.toggle('busy', b); },
    /** Every frame (from the prompts' update): follow the grid, lay out, draw. */
    update(dt) {
      clock += dt;
      const g = grid();
      if (g && (g.cell !== G.cell)) textW.clear();
      if (g) G = g;
      for (const pc of pieces) sizeOf(pc);
      layout();
      draw();
    },
  };
}
