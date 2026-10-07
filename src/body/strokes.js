/**
 * Pen strokes for the flat hd redraw.
 *
 * Right after a view change the camera is still, so the flat hd g-buffer is read
 * back once and its lines are traced into ordered strokes, like a hand would
 * draw them: the silhouette first (top-left onwards, each loop in a few strokes,
 * the pen easing in and out), then the creases. Every traced line cell gets the
 * time (0..1 of the redraw) at which the pen passes it; the shader draws a line
 * pixel once the redraw clock has reached that time.
 *
 * In: RGBA8 g-buffer (R = skin id + 10 × face, B = part id), w × h, bottom row first.
 * Out: { data: Float32Array tw × th, tw, th } — one cell per S × S device px.
 */
const SIL = 1, CREASE = 2;

export function traceStrokes(px, w, h, S, windows) {
  const tw = Math.ceil(w / S), th = Math.ceil(h / S);
  const raw = new Uint8Array(tw * th), pid = new Uint8Array(tw * th), dep = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    const row = Math.min(h - 1, y * S) * w;
    for (let x = 0; x < tw; x++) {
      const i = (row + Math.min(w - 1, x * S)) * 4;
      raw[y * tw + x] = px[i];
      dep[y * tw + x] = px[i + 1];
      pid[y * tw + x] = px[i + 2];
    }
  }

  // line cells: silhouette where the skin id changes, creases where only the face does
  const kind = new Uint8Array(tw * th);
  for (let y = 0; y < th - 1; y++) for (let x = 0; x < tw - 1; x++) {
    const i = y * tw + x;
    const a = raw[i], s = a % 10;
    for (let q = 0; q < 2; q++) {
      const j = q ? i + tw : i + 1;
      const b = raw[j], sb = b % 10;
      // (a jump in depth on the same skin is a contour too: the shader draws it)
      if (s !== sb || (s > 0 && Math.abs(dep[i] - dep[j]) > 3)) kind[i] = SIL;
      else if (windows.crease && s > 0 && a !== b && !pid[i] && !pid[j] && kind[i] !== SIL) kind[i] = CREASE;
    }
  }

  // chains: walk from the top-left-most free cell, always to the free neighbour that
  // turns least; a jump or a long run starts a new stroke
  const used = new Uint8Array(tw * th);
  const RING = [];
  for (let r = 1; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r) RING.push([dx, dy, r]);
  const MAXRUN = Math.max(60, Math.round(500 / S));

  function chains(k) {
    const seeds = [];
    for (let i = 0; i < kind.length; i++) if (kind[i] === k) seeds.push(i);
    // top-left first (rows are bottom-up)
    seeds.sort((a, b) => ((a % tw) - Math.floor(a / tw)) - ((b % tw) - Math.floor(b / tw)));
    const out = [];
    for (const s0 of seeds) {
      if (used[s0]) continue;
      let cur = s0, dir = null, run = [];
      while (cur >= 0) {
        used[cur] = 1;
        run.push(cur);
        const cx = cur % tw, cy = Math.floor(cur / tw);
        // thin the line: the cells right beside this one belong to it
        for (const [dx, dy, r] of RING) if (r === 1) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < tw && ny < th && kind[ny * tw + nx] === k && !used[ny * tw + nx] && dir && (dx * dir[0] + dy * dir[1]) < 0) used[ny * tw + nx] = 1;
        }
        let best = -1, bestScore = Infinity, bd = null;
        for (const [dx, dy, r] of RING) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
          const j = ny * tw + nx;
          if (kind[j] !== k || used[j]) continue;
          const turn = dir ? 1 - (dx * dir[0] + dy * dir[1]) / Math.hypot(dx, dy) : 0;
          const score = r * 2 + turn;
          if (score < bestScore) { bestScore = score; best = j; bd = [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)]; }
        }
        if (best >= 0) dir = dir ? [dir[0] * 0.6 + bd[0] * 0.4, dir[1] * 0.6 + bd[1] * 0.4] : bd;
        cur = best;
        if (run.length >= MAXRUN) { out.push(run); run = []; }
      }
      if (run.length) out.push(run);
    }
    return out.filter((c) => c.length >= 3);
  }

  // (compare against the value as stored: in a Float32Array 0.9 becomes 0.8999999762 < 0.9)
  const REST = Math.fround(windows.rest);
  const data = new Float32Array(tw * th).fill(REST);
  const ease = (u) => 0.5 * u + 0.5 * u * u * (3 - 2 * u);   // the pen eases in and out a little
  function schedule(list, [t0, t1]) {
    const total = list.reduce((a, c) => a + c.length, 0);
    if (!total) return;
    const span = t1 - t0, overlap = 0.12;
    let cursor = t0;
    for (const c of list) {
      const dur = (c.length / total) * span / (1 - overlap * (1 - 1 / list.length));
      c.forEach((cell, j) => { data[cell] = Math.min(data[cell], cursor + dur * ease(j / Math.max(1, c.length - 1))); });
      cursor += dur * (1 - overlap);
    }
  }
  schedule(chains(SIL), windows.sil);
  if (windows.crease) schedule(chains(CREASE), windows.crease);

  // line cells the walk skipped (tiny bits, thinned cells) inherit the time of the line they touch,
  // spreading along it like the pen carrying on — nothing is left to pop in at the end
  const queue = [];
  for (let i = 0; i < data.length; i++) if (data[i] < REST) queue.push(i);
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], x = i % tw, y = (i - x) / tw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
      const j = ny * tw + nx;
      if (kind[j] && data[j] >= REST) { data[j] = Math.min(REST - 0.001, data[i] + 0.002); queue.push(j); }
    }
  }
  // isolated specks no stroke reached: drawn with the last strokes, not after them
  for (let i = 0; i < data.length; i++) if (kind[i] && data[i] >= REST) data[i] = windows.sil[1];

  // every other cell takes the time of the nearest timed line cell (a wave over the whole grid),
  // so a line pixel the trace did not see is still drawn by the stroke beside it — never popped in late
  const out = data;
  const wave = new Int32Array(tw * th);
  let head = 0, tail = 0;
  for (let i = 0; i < out.length; i++) if (out[i] < REST) wave[tail++] = i;
  const filled = new Uint8Array(tw * th);
  for (let i = 0; i < tail; i++) filled[wave[i]] = 1;
  while (head < tail) {
    const i = wave[head++], x = i % tw;
    const v = out[i];
    if (x > 0 && !filled[i - 1]) { filled[i - 1] = 1; out[i - 1] = v; wave[tail++] = i - 1; }
    if (x < tw - 1 && !filled[i + 1]) { filled[i + 1] = 1; out[i + 1] = v; wave[tail++] = i + 1; }
    if (i >= tw && !filled[i - tw]) { filled[i - tw] = 1; out[i - tw] = v; wave[tail++] = i - tw; }
    if (i < out.length - tw && !filled[i + tw]) { filled[i + tw] = 1; out[i + tw] = v; wave[tail++] = i + tw; }
  }
  return { data: out, tw, th };
}
