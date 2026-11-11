// Сохранение прогресса в localStorage: монеты, машины, цвета, настройки, язык, рекорды.

const KEY = 'highwayRush.save.v1';

function defaults() {
  return {
    coins: 0,
    owned: ['sedan'],
    selected: 'sedan',
    colors: {},            // id машины -> цвет кузова (число 0xRRGGBB)
    settings: { music: 50, sfx: 80, quality: 'high', tilt: false, lang: null },
    records: {},           // режим -> [{ score, date, car, loc }]
    rotateDismissed: false,
  };
}

let data = defaults();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const d = defaults();
      data = { ...d, ...parsed, settings: { ...d.settings, ...(parsed.settings || {}) } };
      if (!Array.isArray(data.owned) || !data.owned.includes('sedan')) data.owned = ['sedan', ...(data.owned || [])];
    }
  } catch (e) {
    data = defaults();
  }
  return data;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* приватный режим — просто не сохраняем */ }
}

export function get() { return data; }

export function resetAll() {
  const lang = data.settings.lang;
  data = defaults();
  data.settings.lang = lang;
  save();
}

export function addCoins(n) { data.coins += Math.max(0, Math.floor(n)); save(); }

export function spendCoins(n) {
  if (data.coins < n) return false;
  data.coins -= n; save(); return true;
}

export function getRecords(mode) { return data.records[mode] || []; }

export function bestScore(mode) {
  const r = getRecords(mode);
  return r.length ? r[0].score : 0;
}

// Добавляет результат в топ-10. Возвращает true, если это новый лучший результат режима.
export function addRecord(mode, entry) {
  const list = getRecords(mode).slice();
  const prevBest = list.length ? list[0].score : 0;
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  data.records[mode] = list.slice(0, 10);
  save();
  return entry.score > prevBest && entry.score > 0;
}
