// Интерфейс: экраны меню, выбор режима/локации, гараж, рекорды, настройки, HUD, результаты.
import { t, setLang, getLang, LANGS } from './i18n.js';
import * as storage from './storage.js';
import { CARS, PAINTS, PAINT_PRICE, carById } from './cars.js';
import { LOCATIONS, LOCATION_IDS } from './locations.js';
import { MODE_IDS, MODE_ICONS, MODE_COLORS } from './modes.js';
import { JUMP_COOLDOWN, FLY_MIN_ENERGY } from './player.js';

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const SCREENS = {
  loading: '#screen-loading', menu: '#screen-menu', modes: '#screen-modes', locations: '#screen-locations',
  garage: '#screen-garage', records: '#screen-records', settings: '#screen-settings',
  hud: '#hud', pause: '#screen-pause', results: '#screen-results',
  online: '#screen-online', lobby: '#screen-lobby', 'online-results': '#screen-online-results',
};

export class UI {
  constructor(audio, input) {
    this.audio = audio;
    this.input = input;
    this.current = 'loading';
    this.stack = [];
    this.hudCache = {};
    this.garageIndex = 0;
    this.recordsMode = 'endless';
    this.lastLoc = 'highway';

    document.getElementById('ui').addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      this.audio.unlock();
      if (el.dataset.action !== 'pause') this.audio.click();
      this.action(el.dataset.action, el);
    });

    // Первое касание включает звук (требование iPhone)
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    if (storage.get().rotateDismissed) document.body.classList.add('rotate-dismissed');
    if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) {
      document.querySelectorAll('.fs-btn').forEach((b) => (b.style.display = 'none'));
    }
    this.bindSettings();
  }

  setGame(game) { this.game = game; }
  setOnline(online) { this.online = online; }

  // ---------- Навигация ----------
  show(name, push = false) {
    if (push && this.current && this.current !== name) this.stack.push(this.current);
    for (const k in SCREENS) $(SCREENS[k]).classList.toggle('active', k === name);
    this.current = name;
    if (name === 'menu') { this.stack = []; this.renderMenu(); }
    if (name === 'modes') this.renderModes();
    if (name === 'locations') this.renderLocations();
    if (name === 'garage') {
      if (push || !this.garageOpened) this.garageIndex = Math.max(0, CARS.findIndex((c) => c.id === storage.get().selected));
      this.garageOpened = true;
      this.previewColor = null;
      this.renderGarage();
    }
    if (name === 'records') this.renderRecords();
    if (name === 'settings') this.renderSettings();
  }

  back() {
    const prev = this.stack.pop() || 'menu';
    if (prev === 'menu' && this.game.state !== 'menu') this.game.startDemo(this.lastLoc);
    this.show(prev);
  }

  showHud() {
    this.hudCache = {};
    $('#popups').innerHTML = '';
    this.setOncoming('');
    $('#hud').classList.toggle('online', !!this.game.online);
    this.show('hud');
  }

  action(a, el) {
    const g = this.game;
    switch (a) {
      case 'play': return this.show('modes', true);
      case 'garage':
        if (this.current === 'results') { g.startDemo(this.lastLoc); this.stack = ['menu']; this.show('garage'); return; }
        return this.show('garage', true);
      case 'records': return this.show('records', true);
      case 'settings': return this.show('settings', true);
      case 'back': return this.back();
      case 'mode': this.chosenMode = el.dataset.id; return this.show('locations', true);
      case 'location':
        this.lastLoc = el.dataset.id;
        this.stack = [];
        return g.startRun(this.chosenMode, el.dataset.id);
      case 'pause': return g.online ? this.online.toggleRaceMenu() : g.pause();
      case 'resume': return g.resume();
      case 'restart': return g.restart();
      case 'menu': g.startDemo(this.lastLoc); return this.show('menu');
      case 'fullscreen': return this.toggleFullscreen();
      case 'dismiss-rotate':
        document.body.classList.add('rotate-dismissed');
        storage.get().rotateDismissed = true; storage.save();
        return;
      case 'car-prev': this.garageIndex = (this.garageIndex + CARS.length - 1) % CARS.length; this.previewColor = null; return this.renderGarage();
      case 'car-next': this.garageIndex = (this.garageIndex + 1) % CARS.length; this.previewColor = null; return this.renderGarage();
      case 'car-main': return this.garageMain();
      case 'paint': return this.paint(Number(el.dataset.color));
      case 'lang': return this.changeLang(el.dataset.id);
      case 'records-tab': this.recordsMode = el.dataset.id; return this.renderRecords();
      case 'reset':
        if (confirm(t('resetConfirm'))) { storage.resetAll(); this.garageIndex = 0; this.renderSettings(); this.updateCoins(); }
        return;
      default:
        if (this.online) this.online.action(a, el);
    }
  }

  toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      return;
    }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    Promise.resolve(req.call(el)).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }

  changeLang(id) {
    setLang(id);
    storage.get().settings.lang = id; storage.save();
    this.renderLangSwitches();
    this.show(this.current);
  }

  renderLangSwitches() {
    document.querySelectorAll('.lang-switch').forEach((box) => {
      box.innerHTML = LANGS.map((l) => `<button data-action="lang" data-id="${l.id}" class="${l.id === getLang() ? 'active' : ''}">${l.label}</button>`).join('');
    });
  }

  updateCoins() {
    document.querySelectorAll('.coins-value').forEach((el) => (el.textContent = fmt(storage.get().coins)));
  }

  // ---------- Главное меню, режимы, локации ----------
  renderMenu() { this.renderLangSwitches(); this.updateCoins(); }

  renderModes() {
    $('#mode-cards').innerHTML = MODE_IDS.map((id) => {
      const [c1, c2] = MODE_COLORS[id];
      const best = storage.bestScore(id);
      return `<button class="card" data-action="mode" data-id="${id}" style="background:linear-gradient(135deg,${c1},${c2})">
        <span class="card-icon">${MODE_ICONS[id]}</span>
        <h3>${t('mode_' + id)}</h3><p>${t('mode_' + id + '_d')}</p>
        ${best ? `<span class="card-record">🏆 ${t('recordShort', { n: fmt(best) })}</span>` : ''}
      </button>`;
    }).join('');
  }

  renderLocations() {
    $('#location-cards').innerHTML = LOCATION_IDS.map((id) => {
      const L = LOCATIONS[id];
      return `<button class="card" data-action="location" data-id="${id}" style="background:linear-gradient(160deg,${L.cardColors[0]},${L.cardColors[1]})">
        <span class="card-icon">${L.icon}</span>
        <h3>${t('loc_' + id)}</h3><p>${t('loc_' + id + '_d')}</p>
      </button>`;
    }).join('');
  }

  // ---------- Гараж ----------
  renderGarage() {
    const save = storage.get();
    const car = CARS[this.garageIndex];
    const owned = save.owned.includes(car.id);
    const savedColor = save.colors[car.id] ?? car.color;
    const color = this.previewColor ?? savedColor;
    this.game.showGarageCar(car, color);
    this.updateCoins();
    $('#garage-name').textContent = t('car_' + car.id);
    const stats = [['stat_speed', car.speed], ['stat_accel', car.accel], ['stat_handling', car.handling], ['stat_braking', car.braking]];
    $('#garage-stats').innerHTML = stats.map(([k, v]) => {
      const extra = k === 'stat_speed' ? `${150 + v * 16}` : v;
      return `<div class="stat"><span>${t(k)}</span><div class="stat-bar"><i style="width:${v * 10}%"></i></div><b>${extra}</b></div>`;
    }).join('');
    $('#garage-colors').innerHTML = PAINTS.map((c) =>
      `<button class="color-swatch ${c === color ? 'active' : ''}" data-action="paint" data-color="${c}" style="background:${hex(c)}"></button>`).join('');
    const btn = $('#garage-main-btn');
    let note = owned ? t('colorCost', { n: PAINT_PRICE }) : '';
    if (car.id === 'police') note = t('policeNote') + (owned ? ' · ' + note : '');
    if (owned) {
      const sel = save.selected === car.id;
      btn.textContent = sel ? t('selected') : t('select');
      btn.disabled = sel;
      btn.className = 'btn btn-primary';
    } else {
      btn.textContent = t('buy', { n: fmt(car.price) });
      btn.disabled = false;
      btn.className = 'btn btn-gold';
      if (save.coins < car.price) note = t('notEnough') + (car.id === 'police' ? ' · ' + t('policeNote') : '');
    }
    $('#garage-note').textContent = note;
  }

  garageMain() {
    const save = storage.get();
    const car = CARS[this.garageIndex];
    if (save.owned.includes(car.id)) {
      save.selected = car.id; storage.save();
    } else {
      if (!storage.spendCoins(car.price)) { this.flashNote(); return; }
      save.owned.push(car.id);
      save.selected = car.id;
      if (this.previewColor != null) save.colors[car.id] = this.previewColor;
      this.previewColor = null;
      storage.save();
      this.audio.coin();
    }
    this.renderGarage();
  }

  paint(color) {
    const save = storage.get();
    const car = CARS[this.garageIndex];
    if (!save.owned.includes(car.id)) { this.previewColor = color; return this.renderGarage(); }
    const current = save.colors[car.id] ?? car.color;
    if (color === current) return;
    if (!storage.spendCoins(PAINT_PRICE)) { this.flashNote(); return; }
    save.colors[car.id] = color;
    storage.save();
    this.audio.coin();
    this.renderGarage();
  }

  flashNote() {
    const n = $('#garage-note');
    n.textContent = t('notEnough');
    n.style.color = '#ff4a4a';
    setTimeout(() => (n.style.color = ''), 900);
  }

  // ---------- Рекорды ----------
  renderRecords() {
    $('#records-tabs').innerHTML = MODE_IDS.map((id) =>
      `<button data-action="records-tab" data-id="${id}" class="${id === this.recordsMode ? 'active' : ''}">${MODE_ICONS[id]} ${t('mode_' + id)}</button>`).join('');
    const list = storage.getRecords(this.recordsMode);
    const table = $('#records-table');
    if (!list.length) { table.innerHTML = `<tr><td class="empty">${t('noRecords')}</td></tr>`; return; }
    const locale = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }[getLang()];
    table.innerHTML = `<tr><th>${t('th_place')}</th><th>${t('th_score')}</th><th>${t('th_date')}</th><th>${t('th_car')}</th><th>${t('th_loc')}</th></tr>` +
      list.map((r, i) => `<tr><td>${i + 1}</td><td class="score">${fmt(r.score)}</td><td>${new Date(r.date).toLocaleDateString(locale)}</td>
        <td>${t('car_' + carById(r.car).id)}</td><td>${t('loc_' + r.loc)}</td></tr>`).join('');
  }

  // ---------- Настройки ----------
  bindSettings() {
    const s = () => storage.get().settings;
    $('#set-music').addEventListener('input', (e) => { s().music = +e.target.value; this.audio.setVolumes(s().music, s().sfx); storage.save(); });
    $('#set-sfx').addEventListener('input', (e) => { s().sfx = +e.target.value; this.audio.setVolumes(s().music, s().sfx); storage.save(); });
    $('#set-sfx').addEventListener('change', () => this.audio.coin());
    $('#set-quality').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      s().quality = b.dataset.value; storage.save();
      this.game.applyQuality();
      if (this.game.state === 'menu') this.game.startDemo(this.lastLoc);
      this.renderSettings();
    });
    $('#set-tilt').addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const on = b.dataset.value === 'on';
      const ok = await this.input.enableTilt(on);
      if (on && !ok) { alert(t('tiltDenied')); s().tilt = false; }
      else s().tilt = on;
      storage.save();
      this.renderSettings();
    });
  }

  renderSettings() {
    const s = storage.get().settings;
    $('#set-music').value = s.music;
    $('#set-sfx').value = s.sfx;
    document.querySelectorAll('#set-quality button').forEach((b) => b.classList.toggle('active', b.dataset.value === s.quality));
    document.querySelectorAll('#set-tilt button').forEach((b) => b.classList.toggle('active', (b.dataset.value === 'on') === !!this.input.tiltEnabled));
    this.renderLangSwitches();
  }

  // ---------- HUD ----------
  setText(id, value) {
    if (this.hudCache[id] === value) return;
    this.hudCache[id] = value;
    document.getElementById(id).textContent = value;
  }

  updateHud(g) {
    this.setText('hud-score', fmt(g.score));
    this.setText('hud-speed', String(Math.round(g.speedKmh)));
    this.setText('hud-dist', g.distance >= 1000 ? (g.distance / 1000).toFixed(2) + ' ' + t('km') : Math.floor(g.distance) + ' ' + t('m'));
    this.setText('hud-coins', fmt(g.score / 10));
    this.setText('hud-combo', g.combo > 0 ? t('combo', { n: 1 + g.combo * 0.5 }) : '');
    const center = g.mode.hud(g);
    if (this.hudCache.center !== center) { this.hudCache.center = center; $('#hud-center').innerHTML = center; }
    this.updateAbilities(g.player);
  }

  // Шкала энергии и состояние кнопок «Прыжок» / «Полёт» (кольцо перезарядки, неактивный вид)
  updateAbilities(p) {
    const c = this.hudCache;
    const en = Math.round(p.energy * 100);
    if (c.en !== en) { c.en = en; $('#hud-energy').style.width = en + '%'; }
    const flying = p.airMode === 'fly';
    const enState = (flying ? 'flying ' : '') + (flying && p.energy < 0.2 ? 'low' : '');
    if (c.enState !== enState) { c.enState = enState; $('#hud-energy-box').className = 'hud-energy ' + enState; }

    const cd = p.airMode === 'ground' ? Math.ceil((p.jumpCD / JUMP_COOLDOWN) * 40) / 40 : 1;
    const jumpReady = p.canJump;
    const jKey = cd + '|' + jumpReady;
    if (c.jump !== jKey) {
      c.jump = jKey;
      for (const el of [$('#ab-jump'), $('#tc-jump')]) {
        el.style.setProperty('--cd', jumpReady ? 0 : cd);
        el.classList.toggle('off', !jumpReady);
        el.classList.toggle('ready', jumpReady);
      }
    }
    const flyOk = flying || p.energy >= FLY_MIN_ENERGY;
    const fKey = flyOk + '|' + flying;
    if (c.fly !== fKey) {
      c.fly = fKey;
      for (const el of [$('#ab-fly'), $('#tc-fly')]) {
        el.classList.toggle('off', !flyOk);
        el.classList.toggle('active', flying);
        el.classList.toggle('ready', flyOk && !flying);
      }
    }
  }

  // Подсказка обучения; target — какую кнопку подсветить ('jump' / 'fly')
  setHint(text, sub = '', target = null) {
    const key = text ? text + '|' + sub : '';
    if (this.hudCache.hint === key) return;
    this.hudCache.hint = key;
    const el = $('#hud-hint');
    el.classList.toggle('show', !!text);
    el.innerHTML = '';
    if (text) {
      el.textContent = text;
      if (sub) { const sm = document.createElement('small'); sm.textContent = sub; el.appendChild(sm); }
    }
    document.querySelectorAll('.hint-pulse').forEach((b) => b.classList.remove('hint-pulse'));
    if (target) [$('#ab-' + target), $('#tc-' + target)].forEach((b) => b.classList.add('hint-pulse'));
  }

  setOncoming(text) { this.setText('hud-oncoming', text); }

  popup(text, cls = '') {
    const box = $('#popups');
    while (box.children.length > 2) box.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'popup ' + cls;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  flash() {
    const f = $('#flash');
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }

  // ---------- Результаты ----------
  showResults(r) {
    const title = { crashed: t('crashed'), timeUp: t('timeUp'), escaped: t('escaped') }[r.reason];
    $('#results-title').textContent = title;
    $('#results-record').classList.toggle('show', r.isRecord);
    const dist = r.distance >= 1000 ? (r.distance / 1000).toFixed(2) + ' ' + t('km') : Math.floor(r.distance) + ' ' + t('m');
    const cells = [
      ['score', fmt(r.score), 'wide'],
      ['distance', dist], ['maxSpeed', r.maxSpeed + ' ' + t('kmh')],
      ['nearMisses', r.nearMisses], ['coinsEarned', '+' + fmt(r.coins)],
      ['jumps', r.jumps], ['flyTime', r.flyTime.toFixed(1) + ' ' + t('sec')],
      ...r.extra.map(([k, v]) => [k, v]),
      ['best', fmt(r.best)],
    ];
    if (cells.length % 2 === 0) cells[cells.length - 1][2] = 'wide';
    $('#results-grid').innerHTML = cells.map(([k, v, cls]) => `<div class="${cls || ''}"><small>${t(k)}</small><b>${v}</b></div>`).join('');
    this.updateCoins();
    this.show('results');
  }
}
