// Общая трасса онлайн-гонки: трафик, воздушные препятствия и батарейки из одного seed.
// Ничего не зависит от частоты кадров: положение любой машины трафика — функция от времени гонки.
// Модуль «чистый» (без three.js), поэтому одинаково работает у всех игроков.
import { makeRng, mixSeed } from './prng.js';

// Должны совпадать с world.js / air.js
export const LANE_W = 3.6;
export const EDGE = LANE_W * 2 + 1.3;
export const FLY_Y = 7;

const KMH = 1 / 3.6;
export const laneX = (i) => (i - 1.5) * LANE_W;
// Скорость полос: левая — самая быстрая. Внутри полосы все едут одинаково — поэтому никогда не догоняют друг друга.
export const LANE_SPEED = [100, 88, 76, 64].map((v) => v * KMH);
export const LC_DUR = 1.6;   // длительность перестроения, с
export const BLINK = 1.2;    // поворотник включается заранее, с

// Размеры машин трафика (совпадают с моделями в models.js)
export const TRAFFIC_DIMS = {
  sedan: { length: 4.5, width: 1.85, height: 1.38 },
  hatch: { length: 3.9, width: 1.78, height: 1.48 },
  muscle: { length: 4.8, width: 1.96, height: 1.35 },
  sport: { length: 4.4, width: 1.96, height: 1.13 },
  pickup: { length: 5.3, width: 1.98, height: 1.83 },
  van: { length: 5.0, width: 2.02, height: 2.47 },
  boxtruck: { length: 8.6, width: 2.42, height: 3.9 },
  bus: { length: 11.5, width: 2.52, height: 3.3 },
};

const LANE_TYPES = [
  [['sedan', 5], ['hatch', 3], ['sport', 2], ['muscle', 2], ['pickup', 1]],
  [['sedan', 6], ['hatch', 4], ['pickup', 2], ['van', 1], ['muscle', 1]],
  [['sedan', 5], ['hatch', 3], ['van', 3], ['pickup', 2], ['boxtruck', 1]],
  [['sedan', 3], ['van', 3], ['boxtruck', 3], ['bus', 2], ['pickup', 2]],
];
export const TRAFFIC_COLORS = [0xd8dadf, 0x22252c, 0xb02a2a, 0x2a56b0, 0x7d8590, 0xe6e1d3, 0x2f6b46, 0xe0a326, 0x6b2a8a, 0x2aa3b0, 0xc65a1c, 0x404855];
// У этих моделей цвет «запечён» в геометрию — для них цвет фиксированный
export const FIXED_COLOR = { van: 0xe6e1d3, boxtruck: 0x2a56b0, bus: 0xe0a326 };

// Верхняя оценка длительности гонки (с) — чтобы трафика хватило даже медленным
export const maxRaceTime = (lengthM) => 45 + lengthM / 26;

// ---------- Положение машины трафика в момент t ----------
export function carState(c, t, out) {
  const lc = c.lc;
  if (!lc || t <= lc.t) {
    out.x = laneX(c.lane);
    out.z = c.z0 - c.v * t;
    out.speed = c.v;
    out.blink = lc && t > lc.t - BLINK ? Math.sign(lc.to - c.lane) : 0;
    out.yaw = 0;
    return out;
  }
  const zc = c.z0 - c.v * lc.t;
  const tau = t - lc.t;
  const side = Math.sign(lc.to - c.lane);
  if (tau < LC_DUR) {
    const k = tau / LC_DUR;
    const e = k * k * (3 - 2 * k);
    out.x = laneX(c.lane) + (laneX(lc.to) - laneX(c.lane)) * e;
    out.z = zc - (c.v * tau + (lc.v2 - c.v) * tau * tau / (2 * LC_DUR));
    out.speed = c.v + (lc.v2 - c.v) * k;
    out.blink = side;
    out.yaw = side * Math.sin(k * Math.PI) * 0.07;
  } else {
    out.x = laneX(lc.to);
    out.z = zc - (c.v * LC_DUR + (lc.v2 - c.v) * LC_DUR / 2) - lc.v2 * (tau - LC_DUR);
    out.speed = lc.v2;
    out.blink = 0;
    out.yaw = 0;
  }
  return out;
}

const _a = {}, _b = {};
function overlapsSomewhere(c, o, t0, t1) {
  const margin = (c.len + o.len) / 2 + 7;
  for (let t = t0; t <= t1; t += 0.25) {
    carState(c, t, _a); carState(o, t, _b);
    if (Math.abs(_a.x - _b.x) < 2.8 && Math.abs(_a.z - _b.z) < margin) return true;
  }
  return false;
}

// Можно ли машине c перестроиться (lc уже записан в c.lc) — не врежется ли она в кого-нибудь
function laneChangeOk(c, cars) {
  const lc = c.lc;
  const zc = carState(c, lc.t, _a).z;
  for (const o of cars) {
    if (o === c) continue;
    if (Math.abs(carState(o, lc.t, _b).z - zc) < 260 && overlapsSomewhere(c, o, lc.t - BLINK, lc.t + LC_DUR + 8)) return false;
    if (o.lc) {
      const zo = carState(o, o.lc.t, _b).z;
      if (Math.abs(carState(c, o.lc.t, _a).z - zo) < 260 && overlapsSomewhere(c, o, o.lc.t - BLINK, o.lc.t + LC_DUR + 8)) return false;
    }
  }
  return true;
}

// ---------- Генерация трассы ----------
// lengthKm: 3 | 5 | 10
export function generateTrack(seed, lengthKm) {
  const L = lengthKm * 1000;
  const tMax = maxRaceTime(L);

  // Трафик: по каждой полосе машины на случайном расстоянии друг от друга.
  // Машины есть и позади старта: они медленнее игроков, но к отстающим доедут.
  const R = makeRng(mixSeed(seed, 1));
  const cars = [];
  for (let lane = 0; lane < 4; lane++) {
    const v = LANE_SPEED[lane];
    let z = v * tMax + 150;
    const zFar = -(L + 900);
    while (z > zFar) {
      const type = R.weighted(LANE_TYPES[lane]);
      const d = TRAFFIC_DIMS[type];
      const colorRoll = R.int(TRAFFIC_COLORS.length);
      const gap = R.range(26, 105) * (lane === 3 ? 1.25 : 1);
      z -= d.length / 2;
      // Возле старта (с запасом) машин нет — чтобы не мешать отсчёту
      if (z > 260 || z < -210) {
        cars.push({
          id: cars.length, type, lane, v, z0: z, len: d.length, wid: d.width, h: d.height,
          color: FIXED_COLOR[type] ?? TRAFFIC_COLORS[colorRoll], lc: null,
        });
      }
      z -= d.length / 2 + gap;
    }
  }
  // Перестроения: часть машин один раз меняет полосу (с поворотником), только если там свободно
  const R2 = makeRng(mixSeed(seed, 2));
  for (const c of cars) {
    const roll = R2.next(), tc = R2.range(3, tMax), side = R2.next() < 0.5 ? -1 : 1;
    if (roll > 0.3) continue;
    let to = c.lane + side;
    if (to < 0 || to > 3) to = c.lane - side;
    c.lc = { t: tc, to, v2: LANE_SPEED[to] };
    if (!laneChangeOk(c, cars)) c.lc = null;
  }

  // Воздушные препятствия — на фиксированных местах трассы
  const H = makeRng(mixSeed(seed, 3));
  const hazards = [];
  let z = -300;
  while (z > -(L - 60)) {
    const r = H.next(), a = H.next(), b = H.next(), c = H.next(), ph = H.range(0, 10);
    const type = r < 0.28 ? 'heli' : r < 0.55 ? 'drone' : r < 0.8 ? 'birds' : 'bridge';
    const h = { id: hazards.length, type, z, ph, x: 0, y: 0 };
    if (type === 'heli') { h.x = laneX(Math.floor(a * 4)); h.y = FLY_Y + 1.1; h.rot = (b - 0.5) * 1.2; }
    else if (type === 'drone') { h.x = laneX(Math.floor(a * 4)) + (b - 0.5) * 1.6; h.y = FLY_Y + 0.2 + c * 1.2; }
    else if (type === 'birds') {
      h.dir = a < 0.5 ? -1 : 1; h.vx = h.dir * (5 + b * 2.5); h.y = FLY_Y + 0.3 + c * 0.9;
      h.period = 2 * (EDGE + 40) / Math.abs(h.vx);
    } else { h.lanes = b < 0.5 ? 1 : 2; h.lane0 = Math.floor(c * (5 - h.lanes)); }
    hazards.push(h);
    z -= H.range(95, 175);
  }

  // Батарейки: на дороге и в воздухе
  const B = makeRng(mixSeed(seed, 4));
  const batteries = [];
  z = -170;
  while (z > -(L - 30)) {
    const air = B.chance(0.45);
    batteries.push({ id: batteries.length, x: laneX(B.int(4)), z, y: air ? FLY_Y + 0.8 : 1.1, ph: B.range(0, 6) });
    z -= B.range(110, 220);
  }

  return { seed, length: L, tMax, cars, hazards, batteries };
}

// Положение стаи птиц по времени гонки (летает туда-обратно поперёк дороги по кругу)
export function birdsX(h, t) {
  const tt = ((t + h.ph * 3) % h.period + h.period) % h.period;
  return -h.dir * (EDGE + 40) + h.vx * tt;
}
