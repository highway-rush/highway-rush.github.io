// Онлайн-гонка: синхронный старт, общая трасса, штрафы, соперники, толкание, финиш.
//
// Схема без игрового сервера: каждый игрок сам считает только свою машину и 15–20 раз в секунду
// отправляет её состояние. Трафик, препятствия и батарейки у всех одинаковые, потому что считаются
// из общего seed и времени гонки (а не из кадров).
import { AirSystem } from '../air.js';
import { carById } from '../cars.js';
import { disposeGroup } from '../models.js';
import { ROAD_HALF } from '../world.js';
import * as storage from '../storage.js';
import { t } from '../i18n.js';
import { generateTrack, laneX, EDGE } from './track.js';
import { RemoteCar, makeFadeable, CAR_MASS, FLAG } from './remote-car.js';
import { TrafficView, HazardView, BatteryView, Sparks, buildFinishArch } from './race-views.js';

const KMH = 3.6;
const SEND_EVERY = 0.06;            // ~17 пакетов в секунду
const STOP_TIME = 2;                // после аварии машина стоит ~2 с
const GHOST_TIME = 2;               // и ещё 2 с неуязвима (полупрозрачная)
const RESTART_SPEED = 40 / KMH;     // скорость после штрафа
const STALE_MS = 250;               // устаревшая позиция соперника — не толкаемся
const GONE_MS = 15000;              // нет данных 15 с — соперник выбывает
const FINISH_LIMIT = 30;            // после первого финишёра остальным даётся 30 с
export const COINS_BY_PLACE = [300, 180, 120, 80];
const NO_INPUT = { steer: 0, analog: false, gas: false, brake: false, horn: false, jump: false, fly: false };
const hitTest = AirSystem.prototype.hits;
const r2 = (v) => Math.round(v * 100) / 100;
const $ = (id) => document.getElementById(id);

export function fmtRaceTime(ms) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m + ':' + rest.toFixed(2).padStart(5, '0');
}

export function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' ' + t('km') : Math.max(0, Math.round(m)) + ' ' + t('m');
}

let views = null; // модели трафика и препятствий создаются один раз и переиспользуются между гонками
function getViews(scene) {
  if (!views || views.scene !== scene) {
    views = { scene, traffic: new TrafficView(scene), hazards: new HazardView(scene), batteries: new BatteryView(scene), sparks: new Sparks(scene) };
  }
  return views;
}

export class OnlineRace {
  constructor(game, room) {
    this.game = game;
    this.room = room;
    this.onEnd = null;
  }

  // ---------- Подготовка ----------
  begin() {
    const g = this.game, room = this.room, m = room.meta, me = room.players[room.uid];
    this.round = m.round;
    this.lenKm = m.len;
    this.locId = m.loc;
    this.startAt = m.startAt;
    this.roundStart = m.startAt - 4500; // момент нажатия «Старт» (по серверу)
    this.track = generateTrack(m.seed, m.len);
    this.L = this.track.length;
    this.racers = Object.keys(m.racers || {}).sort((a, b) => ((room.players[a] || {}).slot ?? 9) - ((room.players[b] || {}).slot ?? 9));
    if (!this.racers.includes(room.uid)) this.racers.push(room.uid);

    g.endMode();
    g.online = this;
    g.state = 'online';
    g.buildEnvironment(m.loc, false);
    // Одиночный трафик и препятствия не нужны
    for (const v of g.traffic.active) { v.active = false; v.mesh.visible = false; }
    g.traffic.active = []; g.traffic.extras = [];
    g.air.reset();

    const high = g.quality === 'high';
    const carDef = carById(me.car);
    const p = g.player;
    p.setCar(carDef, me.color, high);
    p.root.visible = true; p.groundShadow.visible = true;
    p.reset(laneX(me.slot), 0);
    this.fade = makeFadeable(p.mesh);
    this.mass = CAR_MASS[carDef.id] || 1;
    g.world.resetPosition(0);
    g.input.releaseTouch();

    const V = this.v = getViews(g.scene);
    V.traffic.reset(); V.hazards.reset(); V.batteries.reset();
    V.traffic.setShadows(high);

    this.finishArch = buildFinishArch(ROAD_HALF * 2);
    this.finishArch.position.z = -this.L;
    this.startArch = buildFinishArch(ROAD_HALF * 2, false);
    this.startArch.position.z = -4;
    g.scene.add(this.finishArch, this.startArch);

    // Соперники
    this.names = {};
    this.opps = new Map();
    for (const uid of this.racers) {
      const info = room.players[uid];
      if (!info) continue;
      this.names[uid] = { name: info.name, color: info.color, car: info.car };
      if (uid !== room.uid) this.opps.set(uid, new RemoteCar(g.scene, uid, info, laneX(info.slot), high));
    }
    this.racers = this.racers.filter((uid) => this.names[uid]);

    // Состояние гонки
    this.time = 0; this.rt = -5; this.sendT = 0;
    this.penT = 0; this.penalties = 0;
    this.finished = false; this.dnf = false; this.finishTime = 0;
    this.over = false; this.coins = null; this.stopSending = false;
    this.distance = 0; this.bestPass = 0; this.jumps = 0; this.flyTime = 0; this.lowWarnT = 0;
    this.deadline = null;
    this.bumpCd = {};
    this.lastHit = {};
    this.cdText = null;
    this.beginL = performance.now();
    g.shake = 0;
    g.camera.position.set(p.x, 3.4, p.z + 8);
    g.audio.setSiren(false);
    g.ui.setHint(null);

    this.offs = [
      room.on('state', (s) => this.onStates(s)),
      room.on('hits', (h) => this.onHits(h)),
      room.on('players', (pl) => this.onPlayers(pl)),
    ];
    for (const uid in room.hits) this.lastHit[uid] = (room.hits[uid] && room.hits[uid].t) || 0;
    this.onStates(room.states);
    this.buildHud();
  }

  // ---------- Сеть ----------
  onStates(states) {
    const nowL = performance.now();
    for (const [uid, o] of this.opps) {
      const s = states && states[uid];
      if (s && s.t >= this.roundStart - 500) o.push(s, nowL);
    }
  }

  onHits(hits) {
    const now = this.room.serverNow();
    for (const from in hits) {
      const h = hits[from];
      if (!h || !(h.t > (this.lastHit[from] || this.roundStart))) continue;
      this.lastHit[from] = h.t;
      if (now - h.t < 1500) this.hitFx(this.opps.get(from), h.k || 0.5);
    }
  }

  onPlayers(players) {
    for (const [uid, o] of this.opps) {
      if (!players[uid] && !o.gone) this.dropOpponent(o);
    }
  }

  dropOpponent(o) {
    o.setGone();
    this.game.ui.popup(t('playerLeft', { n: o.name }), 'blue');
    const dot = this.dots && this.dots[o.uid];
    if (dot) dot.classList.add('gone');
  }

  sendState(now) {
    const p = this.game.player;
    let f = 0;
    if (p.airMode === 'jump') f |= FLAG.JUMP;
    else if (p.airMode === 'fly') f |= FLAG.FLY;
    else if (p.airMode === 'glide') f |= FLAG.GLIDE;
    if (this.penT > GHOST_TIME) f |= FLAG.PENALTY;
    else if (this.penT > 0) f |= FLAG.GHOST;
    if (this.finished) f |= FLAG.FINISHED;
    this.room.sendState({
      x: r2(p.x), z: r2(p.z), y: r2(p.y || 0), s: r2(p.speed), v: r2(p.vx), r: r2(p.steerVal),
      f, e: Math.round(p.energy * 100), w: Math.round(p.wingT * 100), t: Math.round(now),
    });
  }

  roundResults() {
    const out = {};
    const all = this.room.results || {};
    for (const uid of this.racers) {
      const r = all[uid];
      if (r && r.round === this.round) out[uid] = r;
    }
    return out;
  }

  // ---------- Кадр ----------
  update(dt) {
    const g = this.game, p = g.player, room = this.room, V = this.v;
    this.time += dt;
    const now = room.serverNow(), nowL = performance.now();
    const rt = (now - this.startAt) / 1000;
    this.rt = rt;
    const started = rt >= 0;
    this.updateCountdown(rt);

    // Управление: до старта, во время штрафа и после финиша — без руля и газа
    let inp = g.input.read();
    if (inp.ghost) { // 6+7 — езда сквозь машины трафика (общий флаг с одиночной игрой)
      g.ghost = !g.ghost;
      g.ui.popup(t(g.ghost ? 'ghostOn' : 'ghostOff'), 'blue');
    }
    const stopped = this.penT > GHOST_TIME;
    if (!started || stopped || this.finished) inp = NO_INPUT;
    else {
      if (inp.horn) g.audio.horn();
      if (inp.jump) {
        if (p.jump()) { this.jumps++; g.audio.jump(); }
        else if (p.airMode === 'ground') g.audio.denied();
      }
      if (inp.fly) {
        const r = p.toggleFly();
        if (r === 'noenergy') { g.audio.denied(); g.ui.popup(t('noEnergy'), 'blue'); }
      }
    }
    const ev = p.update(dt, inp, g.loc.grip);
    if (!started) { p.speed = 0; p.z = 0; }
    if (ev.scrape) g.audio.scrape();
    if (ev.wingsOpen) g.audio.wings();
    if (ev.land) { g.audio.land(ev.land.hard); g.shake = Math.max(g.shake, 0.12 + ev.land.hard * 0.15); }
    if (ev.energyOut) g.ui.popup(t('lowEnergy'), 'blue');
    if (this.finished) p.speed = Math.max(0, p.speed - 6 * dt); // после финиша плавно тормозим
    this.updatePenalty(dt);

    this.distance = Math.max(0, -p.z);
    if (p.flying) this.flyTime += dt;
    const viewDist = g.world.fogFar + 20;
    const ghost = this.penT > 0 || this.finished || !started;

    // Трафик: позиции — функция от времени гонки
    V.traffic.update(dt, this.track.cars, rt, p.z, viewDist);
    this.trafficCollisions(ghost || g.ghost);

    // Воздушные препятствия
    V.hazards.update(dt, this.track.hazards, rt, p.z, viewDist);
    if (!ghost && V.hazards.near.length) {
      const B = this._box || (this._box = {});
      B.x0 = p.x - p.width / 2 + 0.15; B.x1 = p.x + p.width / 2 - 0.15;
      B.y0 = p.y + 0.1; B.y1 = p.y + p.height - 0.1;
      B.z0 = p.z - p.length / 2 + 0.2; B.z1 = p.z + p.length / 2 - 0.2;
      for (const o of V.hazards.near) if (hitTest(o, B)) { this.penalty(); break; }
    }

    // Батарейки (у каждого свои)
    const picked = V.batteries.update(dt, this.track.batteries, rt, p, viewDist);
    for (let i = 0; i < picked; i++) {
      p.addEnergy(0.3);
      g.ui.popup(t('battery', { n: 30 }), 'blue');
      g.audio.battery();
    }

    this.updateOpponents(dt, now, nowL, started);
    V.sparks.update(dt);
    p.sync();

    if (started && !this.finished && this.distance >= this.L) this.onFinish(rt);
    this.checkEnd(rt);

    this.sendT += dt;
    if (this.sendT >= SEND_EVERY && !this.stopSending) {
      this.sendT = Math.min(this.sendT - SEND_EVERY, SEND_EVERY);
      this.sendState(now);
    }

    // Мир, камера, звук
    g.world.update(dt, p.z, p.speed, g.camera);
    g.updateCamera(dt);
    g.audio.setEngine(true, p.speed / p.phys.maxSpeed, inp.gas);
    g.audio.setFly(p.airMode === 'fly' ? 1 : p.airMode === 'glide' ? 0.35 : 0, p.speed / p.phys.maxSpeed);
    if (p.airMode === 'fly' && p.energy < 0.2) {
      this.lowWarnT -= dt;
      if (this.lowWarnT <= 0) { g.audio.lowEnergy(); this.lowWarnT = 0.7; }
    } else this.lowWarnT = 0;
    this.updateHud(nowL);
  }

  trafficCollisions(ghost) {
    const g = this.game, p = g.player;
    const kmh = p.speed * KMH;
    let overNow = 0;
    for (const c of this.v.traffic.near) {
      const s = c.s;
      const dx = Math.abs(s.x - p.x), dz = Math.abs(s.z - p.z);
      const low = p.y < c.h - 0.15;
      if (!ghost && low && dx < (c.wid + p.width) / 2 - 0.12 && dz < (c.len + p.length) / 2 - 0.15) {
        if (s.z > p.z && s.speed > p.speed) {
          // Машина трафика догнала нас сзади — просто подталкивает, без штрафа
          p.speed = s.speed + 0.5;
          p.z = s.z - (c.len + p.length) / 2 + 0.1;
          if ((this.bumpCd.traffic || 0) < this.time) { this.bumpCd.traffic = this.time + 0.5; g.audio.scrape(); }
        } else {
          this.penalty();
          return;
        }
      }
      // «Впритык» и прыжки через машины — дают энергию для полёта
      const rel = s.z - p.z;
      if (Math.sign(rel) !== Math.sign(c.prevRel) && c.prevRel !== 0) {
        const lateral = dx - (c.wid + p.width) / 2;
        if (p.airMode === 'jump' && lateral < 0.3 && !c.overDone) { c.overDone = true; overNow++; }
        else if (!c.nearDone && p.y < 0.6 && lateral < 1.1 && kmh > 60 && rel > 0) {
          p.addEnergy(0.08);
          if (kmh > this.bestPass) this.bestPass = kmh;
          g.ui.popup(t('nearMiss'));
          g.audio.nearMiss();
        }
        c.nearDone = true;
      }
      c.prevRel = rel;
    }
    if (overNow) {
      p.addEnergy(0.12 * overNow);
      g.ui.popup(overNow > 1 ? t('jumpOverOnlineN', { c: overNow }) : t('jumpOverOnline'), 'gold');
      g.audio.jumpOver();
    }
  }

  // ---------- Штраф за аварию ----------
  penalty() {
    const g = this.game, p = g.player;
    if (this.penT > 0 || this.finished) return;
    this.penT = STOP_TIME + GHOST_TIME;
    this.penalties++;
    if (p.airborne) { p.airMode = 'jump'; p.vy = Math.min(p.vy, 0); } // падает вниз
    p.vx *= 0.3;
    g.shake = 0.6;
    g.audio.crash();
    g.audio.setFly(0);
    g.ui.flash();
    g.ui.popup(t('penalty'), '');
    this.v.sparks.burst(p.x, 0.8 + p.y, p.z - p.length / 2, Math.random() < 0.5 ? -1 : 1, p.speed);
    if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) try { navigator.vibrate(150); } catch (_) { /* нет вибрации */ }
  }

  updatePenalty(dt) {
    if (this.penT <= 0) return;
    const p = this.game.player;
    const wasStopped = this.penT > GHOST_TIME;
    this.penT -= dt;
    if (this.penT > GHOST_TIME) {
      p.speed = Math.max(0, p.speed - 45 * dt);
      p.vx *= 1 - Math.min(1, 6 * dt);
      p.mesh.visible = Math.floor(this.time * 12) % 2 === 0; // мигает
    } else if (wasStopped) {
      p.mesh.visible = true;
      if (!this.finished) p.speed = Math.max(p.speed, RESTART_SPEED);
    }
    if (this.penT <= 0) { this.penT = 0; p.mesh.visible = true; }
    this.fade.setOpacity(this.penT > 0 ? 0.45 : 1);
  }

  // ---------- Соперники и толкание ----------
  updateOpponents(dt, now, nowL, started) {
    const p = this.game.player;
    for (const o of this.opps.values()) {
      if (o.gone) continue;
      o.update(dt, now, nowL, this.time);
      const age = o.hasData ? o.age(nowL) : nowL - this.beginL;
      if (age > GONE_MS) { this.dropOpponent(o); continue; }
      if (!started || this.penT > 0 || this.finished) continue;
      if (o.ghost || o.finished || age > STALE_MS) continue;   // защита от «ударов из ниоткуда»
      if (p.y > 0.3 || o.y > 0.3) continue;                   // в воздухе не сталкиваемся
      const dx = p.x - o.x, dz = p.z - o.z;
      const ox = (p.width + o.width) / 2 - Math.abs(dx);
      const oz = (p.length + o.length) / 2 - Math.abs(dz);
      if (ox > 0 && oz > 0) this.bump(o, dx, dz, ox, oz, now);
    }
  }

  // Каждый игрок отталкивает только свою машину — у соперника происходит то же самое, поэтому толчок симметричный
  bump(o, dx, dz, ox, oz, now) {
    const g = this.game, p = g.player;
    const ratio = Math.min(1.6, Math.max(0.45, 2 * o.mass / (this.mass + o.mass)));
    let strength;
    if (ox < oz * 0.9) {
      // Удар бортом: толчок в сторону
      const side = Math.sign(dx) || 1;
      p.x += side * Math.min(0.5, ox * 0.6 * ratio);
      const rel = Math.abs(p.vx - o.vx);
      const push = Math.min(9, (2.5 + rel * 0.5) * ratio);
      if (p.vx * side < push) p.vx = side * push;
      p.speed *= 1 - 0.02 * ratio;
      strength = Math.min(1, 0.3 + rel / 10);
    } else if (dz > 0) {
      // Я сзади — врезался в соперника: теряю скорость
      p.z += Math.min(0.5, oz * 0.6 * ratio);
      const rel = p.speed - o.speed;
      if (rel > 0) p.speed -= Math.min(10, rel * 0.6 * ratio + 0.5);
      p.vx += (Math.sign(dx) || 1) * 1.2;
      strength = Math.min(1, 0.2 + Math.max(0, rel) / 15);
    } else {
      // Меня толкнули сзади: немного разгоняет
      p.z -= Math.min(0.5, oz * 0.6 * ratio);
      const rel = o.speed - p.speed;
      if (rel > 0) p.speed += Math.min(8, rel * 0.45 * ratio);
      p.vx += (Math.sign(dx) || 1) * 1.2;
      strength = Math.min(1, 0.2 + Math.max(0, rel) / 15);
    }
    p.speed = Math.max(0, p.speed);
    if ((this.bumpCd[o.uid] || 0) < this.time) {
      this.bumpCd[o.uid] = this.time + 0.35;
      this.room.sendHit(o.uid, { t: Math.round(now), k: r2(strength) });
      this.hitFx(o, strength);
    }
  }

  hitFx(o, k) {
    const g = this.game, p = g.player;
    const side = o ? Math.sign(o.x - p.x) || 1 : 1;
    this.v.sparks.burst(p.x + side * p.width / 2, 0.6 + p.y, p.z, -side, p.speed);
    g.audio.scrape();
    g.shake = Math.max(g.shake, 0.12 + k * 0.25);
  }

  // ---------- Финиш ----------
  onFinish(rt) {
    const g = this.game, p = g.player;
    const over = this.distance - this.L;
    this.finishTime = Math.max(0, rt - (p.speed > 1 ? over / p.speed : 0)); // точный момент пересечения линии
    this.finished = true;
    this.penT = 0; this.fade.setOpacity(1); p.mesh.visible = true;
    this.room.sendResult({ round: this.round, fin: true, time: Math.round(this.finishTime * 1000), dist: Math.round(this.L), pass: Math.round(this.bestPass) });
    g.audio.checkpoint();
    g.ui.popup(t('finish'), 'gold');
  }

  checkEnd(rt) {
    const res = this.roundResults();
    let first = Infinity;
    for (const uid in res) if (res[uid].fin) first = Math.min(first, res[uid].time / 1000);
    if (first < Infinity) this.deadline = first + FINISH_LIMIT;
    // Время вышло — место определяется по пройденной дистанции
    if (this.deadline != null && !this.finished && rt >= this.deadline) {
      this.finished = true; this.dnf = true;
      this.penT = 0; this.fade.setOpacity(1); this.game.player.mesh.visible = true;
      this.room.sendResult({ round: this.round, fin: false, time: 0, dist: Math.round(Math.min(this.distance, this.L)), pass: Math.round(this.bestPass) });
      this.game.ui.popup(t('timeOver'), 'blue');
    }
    if (this.over) return;
    const me = this.room.uid;
    const active = this.racers.filter((uid) => uid === me || !this.opps.get(uid)?.gone);
    const allIn = active.every((uid) => res[uid]);
    if ((allIn && res[me]) || (this.deadline != null && rt > this.deadline + 4 && res[me])) {
      this.over = true;
      this.awardCoins();
      this.room.setStatus('results');
      setTimeout(() => { this.stopSending = true; }, 1500);
      if (this.onEnd) this.onEnd(this);
    }
  }

  // Итоговая таблица: финишировавшие по времени, остальные — по дистанции
  standings() {
    const res = this.roundResults();
    const me = this.room.uid;
    const rows = this.racers.map((uid) => {
      const r = res[uid], o = this.opps.get(uid), info = this.names[uid];
      const isMe = uid === me;
      const liveDist = isMe ? this.distance : o ? o.dist : 0;
      return {
        uid, me: isMe, name: info.name, color: info.color, car: info.car,
        fin: !!(r && r.fin), time: r && r.fin ? r.time : null,
        dist: Math.min(this.L, r ? r.dist : liveDist),
        pass: r ? r.pass : isMe ? Math.round(this.bestPass) : 0,
        left: !r && !!o && o.gone, racing: !r && !(o && o.gone),
      };
    });
    rows.sort((a, b) => (a.fin !== b.fin ? (a.fin ? -1 : 1) : a.fin ? a.time - b.time : b.dist - a.dist));
    return rows;
  }

  awardCoins() {
    if (this.coins != null) return;
    const rows = this.standings();
    const place = rows.findIndex((r) => r.me) + 1;
    const mine = rows[place - 1];
    let coins = COINS_BY_PLACE[place - 1] || 60;
    if (!mine.fin) coins = Math.round(coins * 0.5);
    coins = Math.round(coins * this.lenKm / 5);
    this.coins = coins;
    this.place = place;
    storage.addCoins(coins);
  }

  // ---------- Место в гонке (по ходу) ----------
  livePlace() {
    const res = this.roundResults();
    const me = this.room.uid;
    const list = [];
    for (const uid of this.racers) {
      const o = this.opps.get(uid);
      if (o && o.gone) continue;
      const r = res[uid];
      const isMe = uid === me;
      list.push({ uid, fin: !!(r && r.fin), time: r && r.fin ? r.time : 0, dist: isMe ? this.distance : o ? o.dist : 0 });
    }
    list.sort((a, b) => (a.fin !== b.fin ? (a.fin ? -1 : 1) : a.fin ? a.time - b.time : b.dist - a.dist));
    return { place: list.findIndex((x) => x.uid === me) + 1, n: list.length };
  }

  // ---------- HUD ----------
  buildHud() {
    const track = $('rp-track');
    track.querySelectorAll('.rp-dot').forEach((d) => d.remove());
    this.dots = {};
    for (const uid of this.racers) {
      const d = document.createElement('i');
      d.className = 'rp-dot' + (uid === this.room.uid ? ' me' : '');
      d.style.background = '#' + (this.names[uid].color >>> 0).toString(16).padStart(6, '0');
      track.appendChild(d);
      this.dots[uid] = d;
    }
    const box = $('opp-arrows');
    box.innerHTML = '';
    this.arrows = {};
    for (const [uid, o] of this.opps) {
      const a = document.createElement('div');
      a.className = 'opp-arrow';
      a.style.setProperty('--c', '#' + (o.color >>> 0).toString(16).padStart(6, '0'));
      a.innerHTML = '<b></b><span></span>';
      a.querySelector('span').textContent = o.name;
      box.appendChild(a);
      this.arrows[uid] = { el: a, b: a.querySelector('b'), key: '' };
    }
    $('race-wait').classList.remove('show');
    $('race-menu').classList.remove('show');
    this.hudT = 0;
  }

  updateCountdown(rt) {
    let txt = '';
    if (rt < 0) { const n = Math.ceil(-rt); txt = n <= 3 ? String(n) : t('getReady'); }
    else if (rt < 0.9) txt = t('startGo');
    if (txt === this.cdText) return;
    const prev = this.cdText;
    this.cdText = txt;
    const el = $('countdown');
    el.textContent = txt;
    el.classList.toggle('show', !!txt);
    el.classList.toggle('go', txt === t('startGo'));
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (prev === null) return;
    if (/^[123]$/.test(txt)) this.game.audio.warn();
    else if (txt === t('startGo')) this.game.audio.checkpoint();
  }

  updateHud(nowL) {
    const g = this.game, ui = g.ui, p = g.player;
    ui.setText('hud-speed', String(Math.round(p.speed * KMH)));
    ui.updateAbilities(p);
    this.hudT -= 1;
    if (this.hudT > 0) return; // текст обновляем не каждый кадр
    this.hudT = 4;
    const { place, n } = this.livePlace();
    ui.setText('race-place', String(place));
    ui.setText('race-place-n', '/' + n);
    ui.setText('race-togo', this.finished ? '🏁' : fmtDist(this.L - this.distance));
    for (const uid of this.racers) {
      const dot = this.dots[uid];
      const o = this.opps.get(uid);
      const d = uid === this.room.uid ? this.distance : o ? o.dist : 0;
      const pct = (Math.max(0, Math.min(1, d / this.L)) * 100).toFixed(1) + '%';
      if (dot.style.left !== pct) dot.style.left = pct;
      if (o) dot.classList.toggle('lost', o.lost);
    }
    // Стрелки на краю экрана: соперник позади или далеко впереди
    for (const [uid, o] of this.opps) {
      const a = this.arrows[uid];
      const rel = o.z - p.z;
      let mode = '';
      if (!o.gone && o.hasData) mode = rel > 8 ? 'down' : rel < -150 ? 'up' : '';
      const key = mode && mode + Math.round(Math.abs(rel) / 5) + '|' + Math.round(o.x);
      if (key === a.key) continue;
      a.key = key;
      a.el.className = 'opp-arrow' + (mode ? ' show ' + mode : '');
      if (!mode) continue;
      a.el.style.left = (50 + Math.max(-1, Math.min(1, o.x / EDGE)) * 32) + '%';
      a.b.textContent = (mode === 'down' ? '▼ ' : '▲ ') + fmtDist(Math.abs(rel));
    }
    // После финиша: место, время и сколько ждать остальных
    const wait = $('race-wait');
    if (this.finished && !this.over) {
      const rows = this.standings();
      const me = rows.find((r) => r.me);
      const myPlace = rows.indexOf(me) + 1;
      const left = this.deadline != null ? Math.max(0, Math.ceil(this.deadline - this.rt)) : null;
      const html = (this.dnf ? `<b>${t('timeOver')}</b>` : `<b>${t('finishPlace', { n: myPlace })}</b><span>${fmtRaceTime(this.finishTime * 1000)}</span>`) +
        `<small>${t('waitOthers')}${left != null ? ' · 0:' + String(left).padStart(2, '0') : ''}</small>`;
      if (this.waitHtml !== html) { this.waitHtml = html; wait.innerHTML = html; }
      wait.classList.add('show');
    } else wait.classList.remove('show');
  }

  // ---------- Завершение ----------
  dispose() {
    const g = this.game;
    for (const off of this.offs || []) off();
    this.offs = [];
    if (this.v) { this.v.traffic.reset(); this.v.hazards.reset(); this.v.batteries.reset(); }
    for (const arch of [this.finishArch, this.startArch]) if (arch) { g.scene.remove(arch); disposeGroup(arch); }
    for (const o of (this.opps || new Map()).values()) o.dispose();
    this.opps = new Map();
    if (this.fade) this.fade.dispose();
    if (g.player.mesh) g.player.mesh.visible = true;
    $('opp-arrows').innerHTML = '';
    $('countdown').classList.remove('show');
    $('race-wait').classList.remove('show');
    $('race-menu').classList.remove('show');
    if (g.online === this) g.online = null;
  }
}
