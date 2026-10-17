// RBJ Audio EQ Cookbook biquads for offline rendering and tests. Pure: no globals.

/** Numerator (b0, b1, b2 before a0 normalisation) per type; bandpass is the constant 0 dB peak-gain variant. */
const NUMERATORS = {
  lowpass: (cosW) => [(1 - cosW) / 2, 1 - cosW, (1 - cosW) / 2],
  highpass: (cosW) => [(1 + cosW) / 2, -(1 + cosW), (1 + cosW) / 2],
  bandpass: (cosW, alpha) => [alpha, 0, -alpha],
};

/** Cookbook coefficients normalised by a0, so y = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2. */
function coefficients({ type, fc, Q, sampleRate }) {
  const numerator = NUMERATORS[type];
  if (!numerator) throw new RangeError(`makeBiquad: unknown type "${type}"`);
  if (!(fc > 0 && fc < sampleRate / 2 && Q > 0)) {
    throw new RangeError(`makeBiquad: need 0 < fc < sampleRate/2 and Q > 0 (fc=${fc}, Q=${Q}, sampleRate=${sampleRate})`);
  }
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  const [b0, b1, b2] = numerator(cosW, alpha);
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cosW) / a0, a2: (1 - alpha) / a0 };
}

/**
 * Direct form I biquad from the RBJ cookbook; filter state persists across process() calls until reset().
 * @param {{type: 'lowpass'|'bandpass'|'highpass', fc: number, Q: number, sampleRate: number}} spec
 * @returns {{process(x: Float32Array): Float32Array, reset(): void}}
 */
export function makeBiquad(spec) {
  const { b0, b1, b2, a1, a2 } = coefficients(spec);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return {
    process(x) {
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const x0 = x[i];
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
        y[i] = y0;
      }
      return y;
    },
    reset() {
      x1 = x2 = y1 = y2 = 0;
    },
  };
}
