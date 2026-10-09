/**
 * A tiny synth voice for the speaker node (Web Audio, no assets).
 * voice: 'beep' | 'chirp' | 'hum'; volume 0..1; pitch 0..1 (≈220 → 880 Hz).
 */
let ctx = null;

const VOICES = {
  // [start s, frequency multiplier, duration s]
  beep: { wave: 'sine', notes: [[0, 1, 0.2]] },
  chirp: { wave: 'sine', notes: [[0, 1, 0.09], [0.12, 1.5, 0.09], [0.24, 2, 0.14]], glide: 1.3 },
  hum: { wave: 'triangle', notes: [[0, 0.75, 0.7]], vibrato: 7 },
};

export function playVoice({ voice = 'chirp', volume = 0.6, pitch = 0.5 }, onNote) {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();

  const v = VOICES[voice] ?? VOICES.chirp;
  const base = 220 * Math.pow(2, pitch * 2);
  const now = ctx.currentTime + 0.02;

  for (const [t, mul, dur] of v.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = v.wave;
    osc.frequency.setValueAtTime(base * mul, now + t);
    if (v.glide) osc.frequency.exponentialRampToValueAtTime(base * mul * v.glide, now + t + dur);
    if (v.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = v.vibrato;
      depth.gain.value = base * 0.03;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(now + t);
      lfo.stop(now + t + dur + 0.05);
    }
    gain.gain.setValueAtTime(0, now + t);
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, volume * 0.3), now + t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + t);
    osc.stop(now + t + dur + 0.05);
    setTimeout(() => onNote?.(), (t + 0.02) * 1000);
  }
}
