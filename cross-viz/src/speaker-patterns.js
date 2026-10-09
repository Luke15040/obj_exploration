/**
 * Speaker hole patterns, as hole centres in units of the pattern radius
 * (CONFIG.extras.speaker.r). Shared by the shader (uploaded as an array), the
 * wireframe in extras.js and the preview in the speaker node. Max 32 holes.
 */
export const SPEAKER_PATTERNS = ['rings', 'grid', 'cross'];

export function holePattern(name) {
  if (name === 'grid') {
    // 4 × 4 square grid, corners still inside the radius
    const s = [-0.69, -0.23, 0.23, 0.69];
    return s.flatMap((y) => s.map((x) => [x, y]));
  }
  if (name === 'cross') {
    // a sparse cross: the centre and two holes per arm
    const pts = [[0, 0]];
    for (const d of [0.55, 1]) pts.push([d, 0], [-d, 0], [0, d], [0, -d]);
    return pts;
  }
  // rings: 1 centre + 6 at R/2 + 12 at R
  return [[0, 1], [0.5, 6], [1, 12]].flatMap(([rr, n]) =>
    Array.from({ length: n }, (_, k) => [rr * Math.cos((k / n) * Math.PI * 2), rr * Math.sin((k / n) * Math.PI * 2)]));
}
