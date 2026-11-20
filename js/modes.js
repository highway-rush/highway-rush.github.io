// Режимы игры: Бесконечный, Встречка, На время, Полиция.
import { buildVehicle, buildCheckpoint, disposeVehicle, disposeGroup } from './models.js';
import { LANE_W, ROAD_HALF } from './world.js';
import { t } from './i18n.js';

export const MODE_IDS = ['endless', 'twoway', 'time', 'police'];
export const MODE_ICONS = { endless: '♾️', twoway: '↕️', time: '⏱️', police: '🚨' };
export const MODE_COLORS = { endless: ['#ff3d6e', '#ff9a3d'], twoway: ['#7a3dff', '#ff3d9a'], time: ['#00a3ff', '#20e3b2'], police: ['#1b3dff', '#ff2a2a'] };

const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

class BaseMode {
  constructor(id) { this.id = id; this.twoWay = false; this.siren = false; this.forceCar = null; this.startX = 1.8; }
  setup() {}
  update() { return null; }   // вернуть причину конца ('timeUp' / 'escaped') или null
  scoreMultiplier() { return 1; }
  hud() { return ''; }
  dispose() {}
  extraResults() { return []; }
}

class EndlessMode extends BaseMode {
  constructor() { super('endless'); }
}

class TwoWayMode extends BaseMode {
  constructor() { super('twoway'); this.twoWay = true; this.startX = LANE_W * 0.5; }
  setup() { this.onTime = 0; this.totalOn = 0; }
  isOncoming(g) { return g.player.x < -0.6; }
  scoreMultiplier(g) { return this.isOncoming(g) ? 2 : 1; }
  update(dt, g) {
    if (this.isOncoming(g) && g.speedKmh > 50) {
      this.onTime += dt; this.totalOn += dt;
    } else if (this.onTime > 0) {
      if (this.onTime >= 1.5) {
        const bonus = Math.floor(this.onTime) * 100;
        g.addScore(bonus);
        g.ui.popup(t('oncoming', { n: bonus }), 'blue');
        g.audio.coin();
      }
      this.onTime = 0;
    }
    g.ui.setOncoming(this.onTime > 0.3 ? `⇄ ${this.onTime.toFixed(1)} s` : '');
    return null;
  }
  extraResults() { return [['mode_twoway', this.totalOn.toFixed(1) + ' s']]; }
}

class TimeMode extends BaseMode {
  constructor() { super('time'); this.every = 1000; }
  setup(g) {
    this.timeLeft = 60;
    this.next = this.every;
    this.count = 0;
    this.gate = buildCheckpoint(ROAD_HALF * 2);
    g.scene.add(this.gate);
    this.gate.position.set(0, 0, -this.next);
    this.lastWarn = 99;
  }
  update(dt, g) {
    this.timeLeft -= dt;
    if (g.distance >= this.next) {
      this.count++;
      const add = Math.max(12, 25 - this.count * 1.5);
      this.timeLeft += add;
      g.ui.popup(t('checkpoint', { n: Math.round(add) }), 'gold');
      g.audio.checkpoint();
      g.addScore(500);
      this.next += this.every;
      this.gate.position.z = -this.next;
    }
    const s = Math.ceil(this.timeLeft);
    if (s <= 10 && s < this.lastWarn && s > 0) { this.lastWarn = s; g.audio.warn(); }
    if (s > 10) this.lastWarn = 99;
    return this.timeLeft <= 0 ? 'timeUp' : null;
  }
  hud(g) {
    const warn = this.timeLeft <= 10 ? ' warn' : '';
    const toCp = Math.max(0, Math.round(this.next - g.distance));
    return `<div class="big${warn}">${fmtTime(this.timeLeft)}</div><div class="sub">🏁 ${toCp} ${t('m')}</div>`;
  }
  dispose(g) { if (this.gate) { g.scene.remove(this.gate); disposeGroup(this.gate); } }
}

class PoliceMode extends BaseMode {
  constructor() { super('police'); this.siren = true; this.forceCar = 'police'; }
  setup(g) {
    this.caughtCount = 0;
    this.chase = 60;
    this.progress = 0;
    const v = buildVehicle('sport', 0xd11f2f);
    this.vehicle = v;
    this.mesh = v.group;
    g.scene.add(this.mesh);
    this.suspect = { x: 0, z: 0, speed: 0, length: v.length, width: v.width, targetX: 0, lane: 1 };
    this.spawnSuspect(g, 140);
  }
  spawnSuspect(g, ahead) {
    const s = this.suspect;
    s.lane = (Math.random() * 4) | 0;
    s.x = s.targetX = (s.lane - 1.5) * LANE_W;
    s.z = g.player.z - ahead;
    s.base = (125 + this.caughtCount * 14) / 3.6;
    s.speed = s.base;
    g.traffic.extras = [s];
    // Убираем трафик, который оказался прямо на месте появления
    for (const v of g.traffic.active) {
      if (Math.abs(v.x - s.x) < 2.5 && Math.abs(v.z - s.z) < 15) { v.z -= 30; }
    }
  }
  update(dt, g) {
    const s = this.suspect;
    const p = g.player;
    // ИИ нарушителя: едет быстро и объезжает машины
    let blockGap = Infinity, blockSpeed = 0;
    for (const v of g.traffic.active) {
      if (Math.abs(v.x - s.x) > 2.4) continue;
      const d = s.z - v.z;
      if (d > 0 && d < blockGap) { blockGap = d - (v.length + s.length) / 2; blockSpeed = v.dir === -1 ? v.speed : -v.speed; }
    }
    if (blockGap < 40 && s.x === s.targetX) {
      const opts = [s.lane - 1, s.lane + 1].filter((i) => i >= 0 && i < 4);
      if (Math.random() < 0.5) opts.reverse();
      for (const i of opts) {
        const lx = (i - 1.5) * LANE_W;
        let free = true;
        for (const v of g.traffic.active) if (Math.abs(v.x - lx) < 2.6 && Math.abs(v.z - s.z) < 16 + v.length / 2) { free = false; break; }
        if (free) { s.lane = i; s.targetX = lx; break; }
      }
    }
    // Немного «резинки»: если игрок сильно отстал, нарушитель чуть сбавляет
    const gapToPlayer = p.z - s.z;
    let desired = s.base * (gapToPlayer > 220 ? 0.85 : 1);
    if (blockGap < 22 && s.x === s.targetX) desired = Math.min(desired, Math.max(0, blockSpeed));
    s.speed += Math.sign(desired - s.speed) * Math.min(Math.abs(desired - s.speed), 8 * dt);
    const dx = s.targetX - s.x;
    const step = 6 * dt;
    s.x = Math.abs(dx) <= step ? s.targetX : s.x + Math.sign(dx) * step;
    s.z -= s.speed * dt;
    this.mesh.position.set(s.x, 0, s.z);
    this.mesh.rotation.y = -Math.sign(dx) * Math.min(0.15, Math.abs(dx) * 0.08);

    // Столкновение с нарушителем — не авария, а толчок
    if (p.y < 1.2 && Math.abs(p.x - s.x) < (p.width + s.width) / 2 && Math.abs(p.z - s.z) < (p.length + s.length) / 2) {
      p.speed = Math.min(p.speed, s.speed * 0.9);
      p.z = s.z + (p.length + s.length) / 2 + 0.05;
    }

    // Поимка: держаться рядом 2 секунды
    const near = Math.abs(p.z - s.z) < 11 && Math.abs(p.x - s.x) < 4;
    if (near) this.progress += dt;
    else this.progress = Math.max(0, this.progress - dt * 0.5);
    if (this.progress >= 2) {
      this.caughtCount++;
      const bonus = 1000 * this.caughtCount;
      g.addScore(bonus);
      g.ui.popup(t('caught', { n: bonus }), 'gold');
      g.audio.caught();
      this.progress = 0;
      this.chase = 60;
      this.spawnSuspect(g, 180);
    }
    this.chase -= dt;
    this.dist = Math.max(0, Math.round(gapToPlayer));
    return this.chase <= 0 ? 'escaped' : null;
  }
  hud() {
    const warn = this.chase <= 10 ? ' warn' : '';
    return `<div class="sub">🚨 ${t('suspect')}: ${this.dist} ${t('m')} · ${t('caughtCount')}: ${this.caughtCount}</div>` +
      `<div class="big${warn}">${fmtTime(this.chase)}</div>` +
      `<div class="catch-bar"><i style="width:${Math.min(100, this.progress / 2 * 100)}%"></i></div>` +
      (this.progress > 0 ? `<div class="sub">${t('catchIt')}</div>` : '');
  }
  dispose(g) { if (this.mesh) { g.scene.remove(this.mesh); disposeVehicle(this.vehicle); } g.traffic.extras = []; }
  extraResults() { return [['caughtCount', this.caughtCount]]; }
}

export function createMode(id) {
  switch (id) {
    case 'twoway': return new TwoWayMode();
    case 'time': return new TimeMode();
    case 'police': return new PoliceMode();
    default: return new EndlessMode();
  }
}
