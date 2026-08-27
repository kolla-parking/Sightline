// Deterministic PRNG utilities — the simulation must replay identically
// across reloads so the twin, history, and analytics stay coherent.

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...keys) {
  return mulberry32(hashStr(keys.join("|")));
}

// Stable per-key uniform in [0,1) — no sequence state.
export function unit(...keys) {
  return rngFor(...keys)();
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// Smooth 1D value noise in [0,1] keyed by `key`, continuous over t.
export function smoothNoise(key, t) {
  const i = Math.floor(t);
  const f = t - i;
  const a = unit(key, i);
  const b = unit(key, i + 1);
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
export function fakePlate(rand) {
  let p = "";
  for (let i = 0; i < 3; i++) p += LETTERS[Math.floor(rand() * LETTERS.length)];
  p += "-";
  for (let i = 0; i < 4; i++) p += Math.floor(rand() * 10);
  return p;
}
