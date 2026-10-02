/**
 * Blue-noise threshold map via Ulichney's void-and-cluster algorithm.
 * Generated once at startup (~tens of ms for 64×64), so there is no asset to ship.
 *
 * Returns a Uint8Array of size² ranks scaled to 0..255, usable as a dither threshold.
 */
export function generateBlueNoise(size = 64, sigma = 1.5, seed = 7) {
  const N = size * size;
  const mask = size - 1; // size must be a power of two

  // tiny deterministic PRNG so the pattern is the same every load
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  // toroidal gaussian kernel, indexed by wrapped (dx, dy)
  const kernel = new Float32Array(N);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x);
      const dy = Math.min(y, size - y);
      kernel[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }

  const bits = new Uint8Array(N);    // current binary pattern
  const energy = new Float32Array(N); // density of 1s around each pixel

  const toggle = (i, on) => {
    bits[i] = on ? 1 : 0;
    const px = i & mask, py = i >> Math.log2(size);
    const sign = on ? 1 : -1;
    for (let y = 0; y < size; y++) {
      const ky = ((y - py) & mask) * size;
      const row = y * size;
      for (let x = 0; x < size; x++) energy[row + x] += sign * kernel[ky + ((x - px) & mask)];
    }
  };

  const tightestCluster = () => { // the 1 with the highest energy
    let best = -1, bestE = -Infinity;
    for (let i = 0; i < N; i++) if (bits[i] && energy[i] > bestE) { bestE = energy[i]; best = i; }
    return best;
  };
  const largestVoid = () => { // the 0 with the lowest energy
    let best = -1, bestE = Infinity;
    for (let i = 0; i < N; i++) if (!bits[i] && energy[i] < bestE) { bestE = energy[i]; best = i; }
    return best;
  };

  // 1) random initial pattern (~10% ones), then relax until stable
  const initialCount = Math.floor(N * 0.1);
  let placed = 0;
  while (placed < initialCount) {
    const i = Math.floor(rand() * N);
    if (!bits[i]) { toggle(i, true); placed++; }
  }
  for (let iter = 0; iter < N; iter++) {
    const c = tightestCluster();
    toggle(c, false);
    const v = largestVoid();
    if (v === c) { toggle(c, true); break; }
    toggle(v, true);
  }
  const initialBits = bits.slice();
  const initialEnergy = energy.slice();

  const rank = new Uint32Array(N);

  // 2) phase 1: strip ones from the initial pattern, highest ranks first
  for (let r = initialCount - 1; r >= 0; r--) {
    const c = tightestCluster();
    toggle(c, false);
    rank[c] = r;
  }

  // restore initial pattern
  bits.set(initialBits);
  energy.set(initialEnergy);

  // 3) phases 2+3: fill voids until the map is full
  // (filling the largest void of 1s is equivalent to the tightest cluster of 0s)
  for (let r = initialCount; r < N; r++) {
    const v = largestVoid();
    toggle(v, true);
    rank[v] = r;
  }

  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.floor(((rank[i] + 0.5) / N) * 256);
  return out;
}
