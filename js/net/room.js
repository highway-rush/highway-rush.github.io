// Комната онлайн-игры: создание, вход по коду, игроки (до 4), хост, старт гонки, выход.
//
// Структура в базе (rooms/КОД):
//   meta     — { host, createdAt, status: lobby|race|results, loc, len, seed, startAt, round, racers }
//   slots/N  — uid игрока, занявшего место N (0..3). Так база сама не пускает пятого игрока.
//   players/uid — { name, car, color, ready, slot, joinedAt }
//   state/uid   — состояние машины в гонке (15–20 раз в секунду)
//   hits/кому/от_кого — событие «удар» (для звука и искр у соперника)
//   results/uid — { round, fin, time, dist, pass }
import { NetError, withTimeout, errorCode } from './backend.js';

export const MAX_PLAYERS = 4;
export const ROOM_TTL = 2 * 60 * 60 * 1000; // 2 часа
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих O/0 и I/1
export const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const T = 10000; // таймаут сетевых операций, мс

export function randomCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  let s = '';
  for (const n of a) s += CODE_ABC[n % CODE_ABC.length];
  return s;
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function isStale(room, now) {
  if (!room || !room.meta) return true;
  if (!room.players) return true;
  return typeof room.meta.createdAt === 'number' && now - room.meta.createdAt > ROOM_TTL;
}

export class Room {
  constructor(backend, code) {
    this.b = backend;
    this.code = code;
    this.uid = backend.uid;
    this.base = 'rooms/' + code;
    this.meta = null;
    this.players = {};
    this.results = {};
    this.states = {};
    this.hits = {};
    this.slot = -1;
    this.unsubs = [];
    this.handlers = {};
    this.closed = false;
    this.seenSelf = false;
    this.roomDisc = false;
  }

  // Подписка на событие; возвращает функцию отписки
  on(ev, cb) {
    const list = this.handlers[ev] || (this.handlers[ev] = []);
    list.push(cb);
    return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
  }
  emit(ev, ...args) { for (const cb of this.handlers[ev] || []) cb(...args); }

  get isHost() { return !!this.meta && this.meta.host === this.uid; }
  serverNow() { return this.b.serverNow(); }

  playerData(profile, slot) {
    return {
      name: profile.name, car: profile.car, color: profile.color,
      ready: false, slot, joinedAt: this.b.serverTimestamp(),
    };
  }

  // ---------- Создание ----------
  static async create(b, profile) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode();
      const existing = await withTimeout(b.get('rooms/' + code), T);
      if (existing) {
        if (!isStale(existing, b.serverNow())) continue;
        try { await withTimeout(b.remove('rooms/' + code), T); } catch (_) { continue; }
      }
      const room = new Room(b, code);
      const meta = {
        host: b.uid, createdAt: b.serverTimestamp(), status: 'lobby',
        loc: profile.loc || 'highway', len: 5, round: 0, seed: 0, startAt: 0,
      };
      try {
        await withTimeout(b.update(room.base, {
          meta, 'slots/0': b.uid, ['players/' + b.uid]: room.playerData(profile, 0),
        }), T);
      } catch (e) {
        if (errorCode(e) === 'denied') continue; // такой код уже занят — пробуем другой
        throw e;
      }
      room.slot = 0;
      await room.attach();
      return room;
    }
    throw new NetError('unknown');
  }

  // ---------- Вход по коду ----------
  static async join(b, code, profile) {
    if (!CODE_RE.test(code)) throw new NetError('notFound');
    const room = new Room(b, code);
    const data = await withTimeout(b.get(room.base), T);
    if (!data || !data.meta) throw new NetError('notFound');
    if (isStale(data, b.serverNow())) {
      b.remove(room.base).catch(() => {}); // пустая или старая комната — удаляем
      throw new NetError('notFound');
    }
    if (data.meta.status === 'race') throw new NetError('inRace');
    const slots = data.slots || {};
    const players = data.players || {};
    if (Object.keys(players).length >= MAX_PLAYERS) throw new NetError('full');
    for (let s = 0; s < MAX_PLAYERS && room.slot < 0; s++) {
      const holder = slots[s];
      if (holder && players[holder]) continue;
      if (holder) await b.remove(room.base + '/slots/' + s).catch(() => {}); // «повисшее» место
      let res;
      try {
        res = await withTimeout(b.transaction(room.base + '/slots/' + s, (cur) => (cur == null ? b.uid : undefined)), T);
      } catch (e) {
        if (errorCode(e) !== 'denied') throw e;
        res = { committed: false };
      }
      if (res.committed) room.slot = s;
    }
    if (room.slot < 0) {
      const meta = await b.get(room.base + '/meta').catch(() => null);
      throw new NetError(meta && meta.status === 'race' ? 'inRace' : 'full');
    }
    try {
      await withTimeout(b.set(room.base + '/players/' + b.uid, room.playerData(profile, room.slot)), T);
    } catch (e) {
      b.remove(room.base + '/slots/' + room.slot).catch(() => {});
      throw e;
    }
    await room.attach();
    return room;
  }

  async setPersonalDisconnect() {
    const b = this.b, base = this.base;
    await Promise.all([
      b.onDisconnectRemove(base + '/players/' + this.uid),
      b.onDisconnectRemove(base + '/slots/' + this.slot),
      b.onDisconnectRemove(base + '/state/' + this.uid),
    ]);
  }

  async attach() {
    const b = this.b, base = this.base;
    // Если вкладку закрыли или пропал интернет — база сама уберёт игрока из комнаты
    await this.setPersonalDisconnect();
    const onErr = () => this.close('connectionLost');
    this.unsubs.push(b.listen(base + '/meta', (v) => this.onMeta(v), onErr));
    this.unsubs.push(b.listen(base + '/players', (v) => this.onPlayers(v), onErr));
    this.unsubs.push(b.listen(base + '/results', (v) => { this.results = v || {}; this.emit('results', this.results); }));
    this.unsubs.push(b.listen(base + '/state', (v) => { this.states = v || {}; this.emit('state', this.states); }));
    this.unsubs.push(b.listen(base + '/hits/' + this.uid, (v) => { this.hits = v || {}; this.emit('hits', this.hits); }));
  }

  onMeta(v) {
    if (this.closed) return;
    if (!v) return this.close('roomClosed');
    this.meta = v;
    this.checkHost();
    this.emit('meta', v);
  }

  onPlayers(v) {
    if (this.closed) return;
    this.players = v || {};
    if (this.players[this.uid]) this.seenSelf = true;
    else if (this.seenSelf) return this.close('connectionLost'); // нас удалили (долго не было связи)
    this.checkHost();
    this.updateRoomDisconnect();
    this.emit('players', this.players);
  }

  // Если хост вышел, хостом становится следующий игрок (по номеру места)
  checkHost() {
    const m = this.meta;
    if (!m || !this.players[this.uid] || this.players[m.host]) return;
    const next = this.sortedPlayers()[0];
    if (next && next.uid === this.uid) this.b.update(this.base + '/meta', { host: this.uid }).catch(() => {});
  }

  // Последний игрок в комнате: при обрыве связи удаляется вся комната
  async updateRoomDisconnect() {
    const alone = Object.keys(this.players).length === 1 && !!this.players[this.uid];
    if (alone === this.roomDisc) return;
    this.roomDisc = alone;
    try {
      if (alone) await this.b.onDisconnectRemove(this.base);
      else {
        await this.b.cancelOnDisconnect(this.base); // отменяет и личные — ставим их заново
        await this.setPersonalDisconnect();
      }
    } catch (_) { /* не критично */ }
  }

  sortedPlayers() {
    return Object.entries(this.players)
      .map(([uid, p]) => ({ uid, ...p }))
      .sort((a, b) => a.slot - b.slot);
  }

  // ---------- Действия игрока ----------
  setReady(ready) { return this.b.update(this.base + '/players/' + this.uid, { ready: !!ready }).catch(() => {}); }
  updateProfile(p) { return this.b.update(this.base + '/players/' + this.uid, { name: p.name, car: p.car, color: p.color }).catch(() => {}); }
  sendState(s) { this.b.set(this.base + '/state/' + this.uid, s).catch(() => {}); }
  sendHit(to, h) { this.b.set(this.base + '/hits/' + to + '/' + this.uid, h).catch(() => {}); }
  sendResult(r) { return this.b.set(this.base + '/results/' + this.uid, r).catch(() => {}); }

  // ---------- Действия хоста ----------
  setSettings(patch) { if (this.isHost) this.b.update(this.base + '/meta', patch).catch(() => {}); }
  setStatus(status) { if (this.isHost && this.meta.status !== status) this.b.update(this.base + '/meta', { status }).catch(() => {}); }

  canStart() {
    const list = this.sortedPlayers();
    return this.isHost && this.meta.status !== 'race' && list.length >= 2 && list.every((p) => p.ready);
  }

  startRace() {
    if (!this.canStart()) return false;
    const racers = {};
    for (const p of this.sortedPlayers()) racers[p.uid] = true;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    this.b.update(this.base + '/meta', {
      status: 'race', seed, startAt: Math.round(this.serverNow() + 4500), round: (this.meta.round || 0) + 1, racers,
    }).catch(() => {});
    return true;
  }

  // ---------- Выход ----------
  async leave() {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    const b = this.b, base = this.base;
    try {
      const others = Object.keys(this.players).filter((u) => u !== this.uid);
      await b.cancelOnDisconnect(base).catch(() => {});
      if (!others.length) await withTimeout(b.remove(base), 5000);
      else {
        await withTimeout(Promise.all([
          b.remove(base + '/players/' + this.uid),
          b.remove(base + '/slots/' + this.slot),
          b.remove(base + '/state/' + this.uid),
        ]), 5000);
        // Остальные могли выйти одновременно с нами — тогда комната пустая, удаляем её целиком
        const rest = await withTimeout(b.get(base + '/players'), 5000);
        if (!rest) await withTimeout(b.remove(base), 5000);
      }
    } catch (_) { /* onDisconnect всё равно уберёт */ }
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.b.cancelOnDisconnect(this.base).catch(() => {});
    this.emit('closed', reason);
  }
}
