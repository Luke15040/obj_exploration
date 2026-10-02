/**
 * Damped spring: moves `value` toward `target`.
 * `frequency` (Hz) sets how quickly it responds; `damping` is the damping
 * ratio — 1 settles without overshoot, below 1 adds a small jelly wobble.
 */
export class Spring {
  constructor(value, frequency = 2.2, damping = 1) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.frequency = frequency;
    this.damping = damping;
  }

  step(dt) {
    const w = 2 * Math.PI * this.frequency;
    // sub-step for stability on long frames
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (this.target - this.value) - 2 * this.damping * w * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}
