// Экраны онлайна: ник и вход в комнату, лобби, меню во время гонки, результаты.
// Связывает комнату (room.js) и гонку (race.js) с интерфейсом игры.
import { t } from '../i18n.js';
import * as storage from '../storage.js';
import { carById } from '../cars.js';
import { LOCATIONS, LOCATION_IDS } from '../locations.js';
import { getBackend, errorCode } from './backend.js';
import { Room, normalizeCode, CODE_RE, MAX_PLAYERS } from './room.js';
import { OnlineRace, fmtRaceTime, fmtDist } from './race.js';
import { checkNick } from './nick.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const LENGTHS = [3, 5, 10];
const MEDALS = ['🥇', '🥈', '🥉'];
const ERR = {
  offline: 'errOffline', notFound: 'errNotFound', full: 'errFull', inRace: 'errInRace',
  notConfigured: 'errNotConfigured', authDisabled: 'errAuth', authFailed: 'errOffline', denied: 'errDenied',
  connectionLost: 'errConnLost', roomClosed: 'errRoomClosed', unknown: 'errUnknown',
};

export class OnlineUI {
  constructor(ui, game, audio, input) {
    this.ui = ui; this.game = game; this.audio = audio; this.input = input;
    this.room = null;
    this.race = null;
    this.busy = false;
    this.raceRound = -1;
    this.offs = [];
    const code = $('#online-code');
    code.addEventListener('input', () => {
      const v = normalizeCode(code.value);
      if (v !== code.value) code.value = v;
    });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    $('#online-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    window.addEventListener('offline', () => { if (this.room) this.toast(t('errOffline')); });
  }

  // Машина и цвет — из гаража
  profile(nick) {
    const save = storage.get();
    const car = carById(save.selected);
    return { name: nick, car: car.id, color: save.colors[car.id] ?? car.color, loc: this.ui.lastLoc };
  }

  // ---------- Экран «Онлайн» ----------
  open(code) {
    if (this.room) return this.showLobby();
    this.ui.show('online', true);
    $('#online-nick').value = storage.get().nick || '';
    if (code) $('#online-code').value = normalizeCode(code);
    this.msg('');
    if (code && storage.get().nick) this.join(); // по ссылке — сразу входим
    else if (code) $('#online-nick').focus();
  }

  readNick() {
    const input = $('#online-nick');
    const r = checkNick(input.value);
    if (r.err) { this.msg(t(r.err), 'err'); input.focus(); return null; }
    input.value = r.nick;
    const save = storage.get();
    if (save.nick !== r.nick) { save.nick = r.nick; storage.save(); }
    return r.nick;
  }

  async connect() {
    this.msg(t('connecting'));
    try {
      this.backend = await getBackend();
      this.backend.onConnection = (c) => this.onConnection(c);
      return true;
    } catch (e) {
      this.showError(e);
      return false;
    }
  }

  showError(e) {
    const code = typeof e === 'string' ? e : errorCode(e);
    if (code === 'unknown' || code === 'denied') console.warn('[online]', e);
    this.msg(t(ERR[code] || 'errUnknown'), 'err');
  }

  setBusy(b) {
    this.busy = b;
    document.querySelectorAll('#screen-online .btn').forEach((el) => { if (el.dataset.action !== 'back') el.disabled = b; });
  }

  async create() {
    if (this.busy) return;
    const nick = this.readNick();
    if (!nick) return;
    this.setBusy(true);
    try {
      if (!(await this.connect())) return;
      const room = await Room.create(this.backend, this.profile(nick));
      this.enterRoom(room);
    } catch (e) { this.showError(e); }
    finally { this.setBusy(false); }
  }

  async join() {
    if (this.busy) return;
    const nick = this.readNick();
    if (!nick) return;
    const code = normalizeCode($('#online-code').value);
    if (!CODE_RE.test(code)) { this.msg(t('errCode'), 'err'); $('#online-code').focus(); return; }
    this.setBusy(true);
    try {
      if (!(await this.connect())) return;
      const room = await Room.join(this.backend, code, this.profile(nick));
      this.enterRoom(room);
    } catch (e) { this.showError(e); }
    finally { this.setBusy(false); }
  }

  enterRoom(room) {
    this.msg('');
    this.room = room;
    this.raceRound = room.meta ? room.meta.round : -1;
    for (const off of this.offs) off();
    this.offs = [
      room.on('meta', () => this.onRoomChange()),
      room.on('players', () => this.onRoomChange()),
      room.on('results', () => { if (this.ui.current === 'online-results') this.renderResults(); }),
      room.on('closed', (reason) => this.onClosed(reason)),
    ];
    this.showLobby();
  }

  showLobby() {
    this.ui.stack = ['menu'];
    this.ui.show('lobby');
    this.renderLobby();
  }

  onConnection(connected) {
    if (!this.room) return;
    if (!connected) { this.wasOffline = true; this.toast(t('reconnecting')); }
    else if (this.wasOffline) { this.wasOffline = false; this.toast(t('reconnected')); }
  }

  // ---------- Лобби ----------
  onRoomChange() {
    const room = this.room;
    if (!room || !room.meta) return;
    const m = room.meta;
    if (m.status === 'race' && m.round !== this.raceRound && !this.race && m.racers && m.racers[room.uid] && this.ui.current === 'lobby') {
      this.beginRace();
      return;
    }
    if (this.ui.current === 'lobby') this.renderLobby();
  }

  renderLobby() {
    const room = this.room;
    if (!room || !room.meta) return;
    const m = room.meta, list = room.sortedPlayers(), me = room.players[room.uid];
    $('#lobby-code').textContent = room.code;
    let html = '';
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const p = list.find((x) => x.slot === s);
      if (!p) { html += `<div class="lp empty"><i class="lp-color"></i><div class="lp-main"><small>${esc(t('waitingPlayer'))}</small></div></div>`; continue; }
      const mine = p.uid === room.uid;
      html += `<div class="lp${mine ? ' me' : ''}"><i class="lp-color" style="background:${hex(p.color)}"></i>
        <div class="lp-main"><b>${esc(p.name)}${p.uid === m.host ? ' <span class="lp-host">👑</span>' : ''}</b>
        <small>${esc(t('car_' + carById(p.car).id))}${mine ? ' · ' + esc(t('you')) : ''}${p.uid === m.host ? ' · ' + esc(t('host')) : ''}</small></div>
        <span class="lp-ready${p.ready ? ' ok' : ''}">${esc(p.ready ? t('ready') : t('notReady'))}</span></div>`;
    }
    $('#lobby-players').innerHTML = html;
    const dis = room.isHost ? '' : 'disabled';
    $('#lobby-loc').innerHTML = LOCATION_IDS.map((id) =>
      `<button data-action="on-loc" data-id="${id}" class="${id === m.loc ? 'active' : ''}" ${dis}>${LOCATIONS[id].icon} ${esc(t('loc_' + id))}</button>`).join('');
    $('#lobby-len').innerHTML = LENGTHS.map((n) =>
      `<button data-action="on-len" data-len="${n}" class="${n === m.len ? 'active' : ''}" ${dis}>${n} ${esc(t('km'))}</button>`).join('');
    const ready = !!(me && me.ready);
    const rb = $('#lobby-ready');
    rb.textContent = ready ? t('readyOn') : t('readyOff');
    rb.classList.toggle('btn-gold', !ready);
    rb.classList.toggle('is-ready', ready);
    const sb = $('#lobby-start');
    sb.style.display = room.isHost ? '' : 'none';
    sb.disabled = !room.canStart();
    let note;
    if (m.status === 'race') note = t('errInRace');
    else if (room.isHost) note = list.length < 2 ? t('needTwo') : !list.every((p) => p.ready) ? t('waitReady') : t('canStart');
    else note = t('hostStarts', { n: (room.players[m.host] || {}).name || '' });
    $('#lobby-note').textContent = note;
  }

  shareLink() {
    const u = new URL(location.href);
    const keep = new URLSearchParams();
    if (u.searchParams.get('net') === 'local') keep.set('net', 'local'); // для локальной проверки
    keep.set('room', this.room.code);
    return u.origin + u.pathname + '?' + keep.toString();
  }

  async copyText(text, okKey) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(t(okKey));
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (__) { /* нет доступа к буферу */ }
      ta.remove();
      this.toast(ok ? t(okKey) : text);
    }
  }

  share() {
    const url = this.shareLink();
    if (navigator.share && this.input.isTouch) {
      navigator.share({ title: 'Highway Rush', text: t('shareText', { c: this.room.code }), url }).catch(() => {});
    } else this.copyText(url, 'linkCopied');
  }

  // ---------- Гонка ----------
  beginRace() {
    const room = this.room;
    this.raceRound = room.meta.round;
    room.setReady(false);
    const race = new OnlineRace(this.game, room);
    race.onEnd = () => this.showResults();
    this.race = race;
    race.begin();
    this.ui.stack = [];
    this.ui.showHud();
  }

  toggleRaceMenu(force) {
    const el = $('#race-menu');
    const show = force ?? !el.classList.contains('show');
    el.classList.toggle('show', show);
    if (show) this.input.releaseTouch();
  }

  disposeRace() {
    if (this.race) { this.race.dispose(); this.race = null; }
  }

  // ---------- Результаты ----------
  showResults() {
    this.toggleRaceMenu(false);
    this.ui.show('online-results');
    this.renderResults();
  }

  renderResults() {
    const race = this.race;
    if (!race) return;
    const rows = race.standings();
    const mineIdx = rows.findIndex((r) => r.me);
    const mine = rows[mineIdx];
    $('#or-title').textContent = mine.fin ? t('placeN', { n: mineIdx + 1 }) : t('timeOver');
    $('#or-sub').textContent = `${t('loc_' + race.locId)} · ${race.lenKm} ${t('km')}` + (mine.fin ? ' · ' + fmtRaceTime(mine.time) : '');
    $('#or-table').innerHTML = `<tr><th>${esc(t('th_place'))}</th><th>${esc(t('player'))}</th><th>${esc(t('raceTime'))}</th><th>${esc(t('bestPass'))}</th></tr>` +
      rows.map((r, i) => {
        const res = r.fin ? fmtRaceTime(r.time) : r.left ? t('leftRace') : r.racing ? t('stillRacing') : fmtDist(r.dist);
        return `<tr class="${r.me ? 'me' : ''}"><td class="pl">${r.left ? "—" : MEDALS[i] || i + 1}</td>
          <td><i class="lp-color sm" style="background:${hex(r.color)}"></i>${esc(r.name)}</td>
          <td class="${r.fin ? 'time' : 'muted'}">${esc(res)}</td><td>${r.pass ? r.pass + ' ' + esc(t('kmh')) : '—'}</td></tr>`;
      }).join('');
    $('#or-coins').innerHTML = race.coins != null ? `<i class="coin"></i> +${race.coins}` : '';
    this.ui.updateCoins();
  }

  rematch() {
    if (!this.room) return this.toMenu();
    this.disposeRace();
    this.game.startDemo(this.room.meta.loc);
    this.room.setReady(true);
    if (this.room.isHost) this.room.setStatus('lobby');
    this.showLobby();
  }

  // ---------- Выход ----------
  leaveRoom() {
    for (const off of this.offs) off();
    this.offs = [];
    const r = this.room;
    this.room = null;
    if (r) r.leave();
  }

  toMenu() {
    this.disposeRace();
    this.leaveRoom();
    this.game.startDemo(this.ui.lastLoc);
    this.ui.show('menu');
  }

  backToOnline() {
    this.disposeRace();
    this.leaveRoom();
    if (this.game.state !== 'menu') this.game.startDemo(this.ui.lastLoc);
    this.ui.stack = ['menu'];
    this.ui.show('online');
    $('#online-nick').value = storage.get().nick || '';
  }

  onClosed(reason) {
    this.disposeRace();
    for (const off of this.offs) off();
    this.offs = [];
    this.room = null;
    this.game.startDemo(this.ui.lastLoc);
    this.ui.stack = ['menu'];
    this.ui.show('online');
    this.msg(t(ERR[reason] || 'errUnknown'), 'err');
  }

  // ---------- Кнопки ----------
  // Возвращает true, если действие относится к онлайну
  action(a, el) {
    switch (a) {
      case 'online': this.open(); return true;
      case 'on-create': this.create(); return true;
      case 'on-join': this.join(); return true;
      case 'on-leave': this.backToOnline(); return true;
      case 'on-copy-code': this.copyText(this.room.code, 'codeCopied'); return true;
      case 'on-share': this.share(); return true;
      case 'on-ready': { const me = this.room && this.room.players[this.room.uid]; if (me) this.room.setReady(!me.ready); return true; }
      case 'on-start': if (this.room && !this.room.startRace()) this.renderLobby(); return true;
      case 'on-loc': this.room.setSettings({ loc: el.dataset.id }); this.ui.lastLoc = el.dataset.id; return true;
      case 'on-len': this.room.setSettings({ len: Number(el.dataset.len) }); return true;
      case 'on-rematch': this.rematch(); return true;
      case 'on-menu': this.toMenu(); return true;
      case 'race-resume': this.toggleRaceMenu(false); return true;
      case 'race-leave': this.toMenu(); return true;
    }
    return false;
  }

  msg(text, kind = '') {
    const el = $('#online-msg');
    el.textContent = text;
    el.className = 'online-msg ' + kind;
  }

  toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('show'), 2600);
  }
}
