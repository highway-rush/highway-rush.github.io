// Задания: 3 ежедневных (меняются в полночь) и постоянные достижения.
// Всё засчитывается за один заезд в одиночной игре. Награда — монеты, начисляется сразу.
import * as storage from './storage.js';
import { t } from './i18n.js';
import { MODE_ICONS } from './modes.js';
import { LOCATIONS } from './locations.js';

// stat — показатель заезда (см. Game.questStats), n — цель, reward — монеты.
// mode / loc — задание засчитывается только в этом режиме / локации.
const DAILY_POOL = [
  { id: 'd_dist2', stat: 'dist', n: 2000, reward: 150 },
  { id: 'd_dist4', stat: 'dist', n: 4000, reward: 300 },
  { id: 'd_speed180', stat: 'speed', n: 180, reward: 150 },
  { id: 'd_speed210', stat: 'speed', n: 210, reward: 250 },
  { id: 'd_near10', stat: 'near', n: 10, reward: 200 },
  { id: 'd_near20', stat: 'near', n: 20, reward: 350 },
  { id: 'd_jumps5', stat: 'jumps', n: 5, reward: 150 },
  { id: 'd_over3', stat: 'over', n: 3, reward: 250 },
  { id: 'd_fly15', stat: 'fly', n: 15, reward: 250 },
  { id: 'd_batt3', stat: 'batt', n: 3, reward: 200 },
  { id: 'd_score8k', stat: 'score', n: 8000, reward: 250 },
  { id: 'd_combo4', stat: 'combo', n: 4, reward: 250 },
  { id: 'd_cp3', stat: 'cp', n: 3, reward: 250, mode: 'time' },
  { id: 'd_caught1', stat: 'caught', n: 1, reward: 300, mode: 'police' },
  { id: 'd_onc20', stat: 'oncoming', n: 20, reward: 250, mode: 'twoway' },
  { id: 'd_snow2', stat: 'dist', n: 2000, reward: 250, loc: 'snow' },
  { id: 'd_city8', stat: 'near', n: 8, reward: 250, loc: 'city' },
  { id: 'd_rain10', stat: 'fly', n: 10, reward: 250, loc: 'rain' },
  { id: 'd_steppe2', stat: 'over', n: 2, reward: 250, loc: 'steppe' },
  { id: 'd_hw200', stat: 'speed', n: 200, reward: 200, loc: 'highway' },
];

const ACHIEVEMENTS = [
  { id: 'a_dist5', stat: 'dist', n: 5000, reward: 300 },
  { id: 'a_dist15', stat: 'dist', n: 15000, reward: 1000 },
  { id: 'a_dist30', stat: 'dist', n: 30000, reward: 2500 },
  { id: 'a_speed250', stat: 'speed', n: 250, reward: 500 },
  { id: 'a_speed300', stat: 'speed', n: 300, reward: 1500 },
  { id: 'a_near25', stat: 'near', n: 25, reward: 500 },
  { id: 'a_near60', stat: 'near', n: 60, reward: 1500 },
  { id: 'a_over5', stat: 'over', n: 5, reward: 500 },
  { id: 'a_over15', stat: 'over', n: 15, reward: 1500 },
  { id: 'a_fly30', stat: 'fly', n: 30, reward: 500 },
  { id: 'a_fly60', stat: 'fly', n: 60, reward: 1500 },
  { id: 'a_batt10', stat: 'batt', n: 10, reward: 800 },
  { id: 'a_combo9', stat: 'combo', n: 9, reward: 1000 },
  { id: 'a_score25k', stat: 'score', n: 25000, reward: 800 },
  { id: 'a_score60k', stat: 'score', n: 60000, reward: 2000 },
  { id: 'a_cp10', stat: 'cp', n: 10, reward: 1000, mode: 'time' },
  { id: 'a_caught5', stat: 'caught', n: 5, reward: 1500, mode: 'police' },
  { id: 'a_onc60', stat: 'oncoming', n: 60, reward: 1000, mode: 'twoway' },
];

const DAILY_COUNT = 3;
const ALL = new Map([...DAILY_POOL, ...ACHIEVEMENTS].map((d) => [d.id, d]));

function dayKey(d = new Date()) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let x = seed;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Состояние заданий; в новый день выбираем новые ежедневные (одинаковые у всех в этот день)
function state() {
  const q = storage.get().quests;
  const day = dayKey();
  if (q.day !== day) {
    const r = rng(hash(day));
    const pool = DAILY_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // Разные показатели и не больше одного задания с привязкой к режиму или локации
    const picked = [], stats = new Set();
    let special = 0;
    for (const d of pool) {
      if (picked.length >= DAILY_COUNT) break;
      const isSpecial = !!(d.mode || d.loc);
      if (stats.has(d.stat) || (isSpecial && special >= 1)) continue;
      stats.add(d.stat);
      if (isSpecial) special++;
      picked.push(d.id);
    }
    q.day = day;
    q.daily = picked;
    for (const k of Object.keys(q.done)) if (k.startsWith('d_')) delete q.done[k];
    for (const k of Object.keys(q.best)) if (k.startsWith('d_')) delete q.best[k];
    storage.save();
  }
  return q;
}

export function daily() { return state().daily.map((id) => ALL.get(id)).filter(Boolean); }
export function achievements() { return ACHIEVEMENTS; }
export function isDone(d) { return !!state().done[d.id]; }
export function best(d) { return state().best[d.id] || 0; }

export function msToReset() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

function applies(d, s) { return (!d.mode || d.mode === s.mode) && (!d.loc || d.loc === s.loc); }

// Проверка во время заезда. Возвращает только что выполненные задания (монеты уже начислены).
export function check(s) {
  const q = state();
  const out = [];
  for (const d of [...daily(), ...ACHIEVEMENTS]) {
    if (q.done[d.id] || !applies(d, s)) continue;
    if ((s[d.stat] || 0) >= d.n) {
      q.done[d.id] = true;
      q.best[d.id] = d.n;
      storage.addCoins(d.reward); // заодно сохраняет
      out.push(d);
    }
  }
  return out;
}

// В конце заезда запоминаем лучший результат для полосок прогресса
export function saveBest(s) {
  const q = state();
  let changed = false;
  for (const d of [...daily(), ...ACHIEVEMENTS]) {
    if (q.done[d.id] || !applies(d, s)) continue;
    const v = Math.min(d.n, s[d.stat] || 0);
    if (v > (q.best[d.id] || 0)) { q.best[d.id] = v; changed = true; }
  }
  if (changed) storage.save();
}

// Значение в единицах, которые видит игрок
function shown(stat, v) {
  if (stat === 'dist') return +(v / 1000).toFixed(1);
  if (stat === 'combo') return 1 + v * 0.5;
  return Math.floor(v);
}

export function title(d) { return t('q_' + d.stat, { n: shown(d.stat, d.n) }); }
export function progressText(d) { return `${shown(d.stat, best(d))} / ${shown(d.stat, d.n)}`; }

export function chips(d) {
  const out = [];
  if (d.mode) out.push(`${MODE_ICONS[d.mode]} ${t('mode_' + d.mode)}`);
  if (d.loc) out.push(`${LOCATIONS[d.loc].icon} ${t('loc_' + d.loc)}`);
  return out;
}
