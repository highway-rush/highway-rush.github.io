// Трафик: пул машин (создаются один раз), движение по полосам, перестроения с поворотником,
// уступание дороги полиции.
import { buildVehicle } from './models.js';
import { LANE_W } from './world.js';

const KMH = 1 / 3.6;
const rnd = (a, b) => a + Math.random() * (b - a);
const COLORS = [0xd8dadf, 0x22252c, 0xb02a2a, 0x2a56b0, 0x7d8590, 0xe6e1d3, 0x2f6b46, 0xe0a326, 0x6b2a8a, 0x2aa3b0, 0xc65a1c, 0x404855];
const TYPES = [
  ['sedan', 7], ['hatch', 5], ['pickup', 2], ['van', 3], ['boxtruck', 2], ['bus', 1], ['sport', 1], ['muscle', 1],
];
const SLOW_TYPES = new Set(['boxtruck', 'bus', 'van']);

function pickType() {
  const total = TYPES.reduce((s, t) => s + t[1], 0);
  let r = Math.random() * total;
  for (const [t, w] of TYPES) { if ((r -= w) < 0) return t; }
  return 'sedan';
}

export class Traffic {
  constructor(scene, poolSize = 30) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    this.extras = [];   // доп. машины (нарушитель), которых трафик тоже объезжает
    this.time = 0;
    for (let i = 0; i < poolSize; i++) {
      const type = i < TYPES.length ? TYPES[i][0] : pickType();
      const v = buildVehicle(type, COLORS[(Math.random() * COLORS.length) | 0]);
      v.group.visible = false;
      scene.add(v.group);
      this.pool.push({
        type, mesh: v.group, length: v.length, width: v.width, height: v.height, blinkL: v.blinkL, blinkR: v.blinkR,
        lane: 0, x: 0, z: 0, speed: 0, desired: 0, dir: -1, targetX: 0, blinkT: 0, blinkSide: 0,
        changing: false, cooldown: 0, prevRel: 0, nearDone: false, overDone: false, active: false,
      });
    }
  }

  setShadows(on) {
    for (const v of this.pool) v.mesh.traverse((m) => { if (m.isMesh && m.name === 'lit') m.castShadow = on; });
  }

  // twoWay: левые 2 полосы — встречные
  configure(twoWay, viewDist) {
    this.twoWay = twoWay;
    this.viewDist = viewDist;
    this.lanes = [-1.5, -0.5, 0.5, 1.5].map((k, i) => ({ x: k * LANE_W, dir: twoWay && i < 2 ? 1 : -1, idx: i }));
  }

  reset(playerZ) {
    for (const v of this.active) { v.active = false; v.mesh.visible = false; }
    this.active = [];
    this.extras = [];
    this.time = 0;
    // Начальное заполнение дороги
    for (let i = 0; i < 12; i++) this.spawn(playerZ, rnd(50, this.viewDist), 0);
  }

  targetCount(distance) {
    return Math.min(24, 11 + Math.floor(distance / 900));
  }

  laneFree(laneIdx, z, gap, ignore) {
    const x = this.lanes[laneIdx].x;
    for (const o of this.active) {
      if (o === ignore) continue;
      if ((Math.abs(o.x - x) < 2.4 || Math.abs(o.targetX - x) < 2.4) && Math.abs(o.z - z) < gap + o.length / 2) return false;
    }
    for (const o of this.extras) if (Math.abs(o.x - x) < 2.4 && Math.abs(o.z - z) < gap + 3) return false;
    return true;
  }

  spawn(playerZ, ahead, playerSpeed) {
    const v = this.pool.find((p) => !p.active);
    if (!v) return false;
    const laneIdx = (Math.random() * 4) | 0;
    const lane = this.lanes[laneIdx];
    const z = playerZ - ahead;
    if (!this.laneFree(laneIdx, z, 22, null)) return false;
    v.lane = laneIdx; v.dir = lane.dir;
    v.x = v.targetX = lane.x; v.z = z;
    const slow = SLOW_TYPES.has(v.type);
    if (v.dir === 1) v.desired = rnd(60, 95) * KMH;
    else v.desired = (slow ? rnd(50, 75) : rnd(60, 100) + (laneIdx === (this.twoWay ? 2 : 0) ? 10 : 0)) * KMH;
    v.speed = v.desired;
    v.blinkT = 0; v.changing = false; v.cooldown = rnd(2, 6); v.nearDone = false; v.overDone = false;
    v.prevRel = v.z - playerZ;
    v.mesh.rotation.y = v.dir === 1 ? Math.PI : 0;
    v.mesh.position.set(v.x, 0, v.z);
    v.mesh.visible = true;
    v.active = true;
    this.active.push(v);
    return true;
  }

  // Найти ближайшее препятствие впереди по ходу движения машины v
  leaderGap(v, player) {
    let best = Infinity, bestSpeed = 0;
    const check = (ox, oz, olen, ospeedAlong) => {
      if (Math.abs(ox - v.x) > 2.3) return;
      const d = (oz - v.z) * v.dir; // >0 значит впереди
      if (d <= 0) return;
      const gap = d - (olen + v.length) / 2;
      if (gap < best) { best = gap; bestSpeed = ospeedAlong; }
    };
    for (const o of this.active) {
      if (o === v) continue;
      check(o.x, o.z, o.length, o.dir === v.dir ? o.speed : -o.speed);
      if (o.changing) check(o.targetX, o.z, o.length, o.speed);
    }
    for (const o of this.extras) check(o.x, o.z, o.length, o.speed);
    // Игрок в воздухе — не препятствие для машин внизу
    if (player && !(player.y > 1)) check(player.x, player.z, player.length, v.dir === -1 ? player.speed : -player.speed);
    return { gap: best, speed: bestSpeed };
  }

  tryLaneChange(v, playerZ, urgent) {
    const options = [v.lane - 1, v.lane + 1].filter((i) => i >= 0 && i < 4 && this.lanes[i].dir === v.dir);
    if (!options.length) return false;
    if (Math.random() < 0.5) options.reverse();
    for (const i of options) {
      if (this.laneFree(i, v.z, 14, v) && Math.abs(v.z - playerZ) > (urgent ? 8 : 25)) {
        v.blinkSide = i < v.lane ? -1 : 1;
        v.blinkT = urgent ? 0.35 : 1.3;
        v.nextLane = i;
        v.cooldown = rnd(5, 10);
        return true;
      }
    }
    return false;
  }

  update(dt, player, distance, siren) {
    this.time += dt;
    const pz = player.z;
    for (let k = this.active.length - 1; k >= 0; k--) {
      const v = this.active[k];
      // Следование за впереди идущим
      const lead = this.leaderGap(v, player);
      const safe = 6 + v.speed * 0.9;
      let target = v.desired;
      if (lead.gap < safe) target = Math.min(v.desired, Math.max(0, lead.speed) - (safe - lead.gap) * 0.3);
      if (lead.gap < 2) target = 0;
      const acc = target > v.speed ? 3 : 9;
      v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), acc * dt);
      if (v.speed < 0) v.speed = 0;

      // Перестроения
      v.cooldown -= dt;
      const ahead = (pz - v.z) > 0; // машина впереди игрока
      if (v.blinkT <= 0 && !v.changing) {
        const yieldPolice = siren && v.dir === -1 && ahead && pz - v.z < 110 && Math.abs(v.x - player.x) < 2.6;
        if (yieldPolice && v.cooldown < 4) this.tryLaneChange(v, pz, true);
        else if (v.dir === -1 && v.cooldown <= 0 && v.type !== 'bus') {
          if (lead.gap < safe + 10 && lead.speed < v.desired - 3) this.tryLaneChange(v, pz, false);
          else if (Math.random() < dt * 0.08) this.tryLaneChange(v, pz, false);
          if (v.cooldown <= 0) v.cooldown = rnd(1, 3);
        }
      }
      if (v.blinkT > 0) {
        v.blinkT -= dt;
        if (v.blinkT <= 0) {
          if (this.laneFree(v.nextLane, v.z, 9, v)) {
            v.lane = v.nextLane; v.targetX = this.lanes[v.lane].x; v.changing = true;
          } else v.blinkSide = 0;
        }
      }
      if (v.changing) {
        const dx = v.targetX - v.x;
        const step = 2.2 * dt;
        if (Math.abs(dx) <= step) { v.x = v.targetX; v.changing = false; v.blinkSide = 0; }
        else v.x += Math.sign(dx) * step;
      }

      v.z += v.dir * v.speed * dt;
      v.mesh.position.set(v.x, 0, v.z);
      const yaw = v.changing ? -Math.sign(v.targetX - v.x) * 0.06 : 0;
      v.mesh.rotation.y = (v.dir === 1 ? Math.PI : 0) + yaw * (v.dir === 1 ? -1 : 1);
      const on = v.blinkSide !== 0 && (this.time % 0.6) < 0.3;
      // Для встречки (повёрнута на 180°) «лево/право» меняются местами
      const sideL = v.dir === 1 ? 1 : -1;
      v.blinkL.visible = on && v.blinkSide === sideL;
      v.blinkR.visible = on && v.blinkSide === -sideL;

      // Удаление машин, которые далеко позади или убежали вперёд
      if (v.z > pz + 45 || v.z < pz - this.viewDist - 120) {
        v.active = false; v.mesh.visible = false;
        this.active.splice(k, 1);
      }
    }
    // Досоздаём машины впереди
    const need = this.targetCount(distance);
    let tries = 3;
    while (this.active.length < need && tries-- > 0) {
      this.spawn(pz, rnd(this.viewDist * 0.65, this.viewDist * 0.98), player.speed);
    }
  }
}
