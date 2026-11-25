// Детерминированный генератор случайных чисел (seeded PRNG).
// Один и тот же seed у всех игроков → одинаковый трафик, препятствия и батарейки.

// mulberry32 — маленький быстрый PRNG с хорошим распределением
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Отдельный «поток» чисел для каждой подсистемы: seed + соль
export function mixSeed(seed, salt) {
  let h = (seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    weighted(list) { // [[значение, вес], ...]
      let total = 0;
      for (const [, w] of list) total += w;
      let r = next() * total;
      for (const [v, w] of list) if ((r -= w) < 0) return v;
      return list[0][0];
    },
  };
}
