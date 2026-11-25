// Отрисовка общей трассы онлайн-гонки. Модели создаются один раз и переиспользуются (pooling):
// на экране одновременно ~20–30 машин, хотя на всей трассе их сотни.
import * as THREE from 'three';
import { buildVehicle, Builder, getGlowTexture } from '../models.js';
import { heliModel, droneModel, flockModel, bridgeModel, layoutBridge, batteryModel } from '../air.js';
import { carState, birdsX, FIXED_COLOR, EDGE } from './track.js';

// ---------- Трафик ----------
export class TrafficView {
  constructor(scene) {
    this.scene = scene;
    this.pools = {};
    this.assigned = new Map(); // id машины → объект пула
    this.near = [];            // машины рядом с игроком (для столкновений)
    this.time = 0;
    this.shadows = false;
  }

  setShadows(on) {
    this.shadows = on;
    for (const k in this.pools) for (const o of this.pools[k]) this.applyShadow(o.mesh);
  }

  applyShadow(mesh) {
    mesh.traverse((m) => { if (m.isMesh && (m.name === 'lit' || m.name === 'body')) m.castShadow = this.shadows; });
  }

  build(type) {
    const fixed = FIXED_COLOR[type] != null;
    const v = buildVehicle(type, fixed ? FIXED_COLOR[type] : 0xffffff, !fixed);
    if (v.bodyMat) {
      // Кузов — отдельный простой материал, чтобы красить машину в цвет из seed
      const lam = new THREE.MeshLambertMaterial({ color: 0xffffff });
      v.group.traverse((o) => { if (o.material === v.bodyMat) o.material = lam; });
      v.bodyMat.dispose();
      v.bodyMat = lam;
    }
    v.group.visible = false;
    this.applyShadow(v.group);
    this.scene.add(v.group);
    return { v, mesh: v.group, used: false };
  }

  acquire(type) {
    const pool = this.pools[type] || (this.pools[type] = []);
    let o = pool.find((p) => !p.used);
    if (!o) { o = this.build(type); pool.push(o); }
    o.used = true;
    o.mesh.visible = true;
    return o;
  }

  release(o) { o.used = false; o.mesh.visible = false; }

  reset() {
    for (const o of this.assigned.values()) this.release(o);
    this.assigned.clear();
    this.near.length = 0;
  }

  // t — время гонки (с), pz — позиция игрока, viewDist — дальность прорисовки
  update(dt, cars, t, pz, viewDist) {
    this.time += dt;
    this.near.length = 0;
    const blinkOn = (this.time % 0.6) < 0.3;
    for (const c of cars) {
      const s = c.s || (c.s = {});
      carState(c, t, s);
      const visible = s.z < pz + 45 && s.z > pz - viewDist;
      let o = this.assigned.get(c.id);
      if (!visible) {
        if (o) { this.release(o); this.assigned.delete(c.id); }
        continue;
      }
      if (!o) {
        o = this.acquire(c.type);
        if (o.v.bodyMat) o.v.bodyMat.color.setHex(c.color);
        this.assigned.set(c.id, o);
        c.prevRel = s.z - pz; c.nearDone = false; c.overDone = false;
      }
      o.mesh.position.set(s.x, 0, s.z);
      o.mesh.rotation.y = s.yaw;
      o.v.blinkL.visible = blinkOn && s.blink === -1;
      o.v.blinkR.visible = blinkOn && s.blink === 1;
      if (Math.abs(s.z - pz) < 40) this.near.push(c);
    }
  }

  dispose() {
    this.reset();
    for (const k in this.pools) for (const o of this.pools[k]) this.scene.remove(o.mesh);
    this.pools = {};
  }
}

// ---------- Воздушные препятствия ----------
const MAKERS = { heli: heliModel, drone: droneModel, birds: flockModel, bridge: bridgeModel };

export class HazardView {
  constructor(scene) {
    this.scene = scene;
    this.pools = {};
    this.assigned = new Map();
    this.near = [];
  }

  acquire(type) {
    const pool = this.pools[type] || (this.pools[type] = []);
    let o = pool.find((p) => !p.used);
    if (!o) {
      o = MAKERS[type]();
      o.type = type;
      this.scene.add(o.group);
      pool.push(o);
    }
    o.used = true;
    o.group.visible = true;
    return o;
  }

  release(o) { o.used = false; o.group.visible = false; }

  reset() {
    for (const o of this.assigned.values()) this.release(o);
    this.assigned.clear();
    this.near.length = 0;
  }

  // Положение и анимация — функция от времени гонки t (одинаково у всех игроков)
  update(dt, hazards, t, pz, viewDist) {
    this.near.length = 0;
    for (const h of hazards) {
      const visible = h.z < pz + 30 && h.z > pz - viewDist;
      let o = this.assigned.get(h.id);
      if (!visible) {
        if (o) { this.release(o); this.assigned.delete(h.id); }
        continue;
      }
      if (!o) {
        o = this.acquire(h.type);
        if (h.type === 'bridge') layoutBridge(o, h.lane0, h.lanes);
        this.assigned.set(h.id, o);
      }
      const g = o.group, tt = t + h.ph;
      if (h.type === 'heli') {
        g.position.set(h.x, h.y + Math.sin(tt * 1.3) * 0.25, h.z);
        g.rotation.y = h.rot;
        o.spin[0].rotation.y += dt * 22; o.spin[1].rotation.x += dt * 30;
      } else if (h.type === 'drone') {
        g.position.set(h.x + Math.sin(tt * 0.9) * 0.8, h.y + Math.sin(tt * 2.2) * 0.45, h.z);
        g.rotation.y = tt * 0.8;
      } else if (h.type === 'birds') {
        g.position.set(birdsX(h, t), h.y + Math.sin(tt * 1.7) * 0.3, h.z);
        g.rotation.y = -h.dir * Math.PI / 2;
        g.visible = Math.abs(g.position.x) < EDGE + 38;
        for (const { bird, wl, wr } of o.birds) {
          const a = Math.sin(tt * 9 + bird.userData.phase) * 0.7;
          wr.rotation.z = a; wl.rotation.z = -a;
          bird.position.copy(bird.userData.off);
        }
      } else {
        g.position.set(0, 0, h.z);
        g.rotation.y = 0;
      }
      if (Math.abs(h.z - pz) < 14 && g.visible) this.near.push(o);
    }
  }

  dispose() {
    this.reset();
    for (const k in this.pools) for (const o of this.pools[k]) this.scene.remove(o.group);
    this.pools = {};
  }
}

// ---------- Батарейки ----------
export class BatteryView {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.assigned = new Map();
    this.taken = new Set(); // свои подобранные батарейки (у каждого игрока свои)
  }

  reset() {
    for (const o of this.assigned.values()) { o.used = false; o.group.visible = false; }
    this.assigned.clear();
    this.taken.clear();
  }

  // Возвращает число подобранных батареек
  update(dt, batteries, t, p, viewDist) {
    let picked = 0;
    for (const b of batteries) {
      const visible = !this.taken.has(b.id) && b.z < p.z + 20 && b.z > p.z - viewDist;
      let o = this.assigned.get(b.id);
      if (!visible) {
        if (o) { o.used = false; o.group.visible = false; this.assigned.delete(b.id); }
        continue;
      }
      if (!o) {
        o = this.pool.find((x) => !x.used);
        if (!o) { o = batteryModel(); this.scene.add(o.group); this.pool.push(o); }
        o.used = true; o.group.visible = true;
        this.assigned.set(b.id, o);
      }
      const by = b.y + Math.sin(t * 3 + b.ph) * 0.2;
      o.group.position.set(b.x, by, b.z);
      o.group.rotation.y = t * 2.5 + b.ph;
      if (Math.abs(b.x - p.x) < 1.7 && Math.abs(b.z - p.z) < p.length / 2 + 0.8 && by > p.y - 0.6 && by < p.y + p.height + 1.2) {
        this.taken.add(b.id);
        o.used = false; o.group.visible = false; this.assigned.delete(b.id);
        picked++;
      }
    }
    return picked;
  }

  dispose() {
    this.reset();
    for (const o of this.pool) this.scene.remove(o.group);
    this.pool = [];
  }
}

// ---------- Старт и финиш: арка с клетчатым флагом и клетчатая полоса на асфальте ----------
export function buildFinishArch(width, label = true) {
  const b = new Builder();
  const half = width / 2 + 1.2;
  for (const sd of [-1, 1]) {
    b.box(0.7, 7.4, 0.7, sd * half, 3.7, 0, 0xf4f4f4);
    b.box(0.9, 0.5, 0.9, sd * half, 0.25, 0, 0xff3d6e);
  }
  // Клетчатое полотно 2 ряда
  const n = 16, cw = (half * 2) / n;
  for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) {
    b.box(cw, 0.7, 0.3, -half + cw * (i + 0.5), 6.85 + r * 0.7, 0, (i + r) % 2 ? 0x111111 : 0xffffff, 'glow');
  }
  b.box(half * 2 + 0.8, 0.18, 0.4, 0, 7.6, 0, 0xffb800, 'glow');
  b.box(half * 2 + 0.8, 0.18, 0.4, 0, 6.42, 0, 0xffb800, 'glow');
  // Клетчатая линия на дороге
  const m = 18, sw = width / m;
  for (let r = 0; r < 2; r++) for (let i = 0; i < m; i++) {
    b.box(sw, 0.02, 0.9, -width / 2 + sw * (i + 0.5), 0.03, (r - 0.5) * 0.9, (i + r) % 2 ? 0x161616 : 0xf4f4f4);
  }
  const group = b.toGroup({});
  if (label) {
    // Мягкое свечение над аркой, чтобы финиш был виден издалека
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffd34d, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(26, 8, 1);
    halo.position.y = 7.2;
    group.add(halo);
  }
  return group;
}

// ---------- Искры при ударе ----------
export class Sparks {
  constructor(scene, n = 16) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffb340, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      s.scale.setScalar(0.5);
      scene.add(s);
      this.items.push({ s, v: new THREE.Vector3(), life: 0 });
    }
    this.scene = scene;
  }

  burst(x, y, z, side, speed) {
    let n = 0;
    for (const p of this.items) {
      if (p.life > 0 || n >= 8) continue;
      n++;
      p.s.position.set(x, y, z);
      p.v.set(side * (2 + Math.random() * 5), 1.5 + Math.random() * 3.5, -speed * 0.85 + (Math.random() - 0.5) * 6);
      p.life = 0.35 + Math.random() * 0.25;
      p.s.visible = true;
    }
  }

  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.v.y -= 14 * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.opacity = Math.min(1, p.life * 3);
    }
  }

  dispose() {
    for (const p of this.items) { this.scene.remove(p.s); p.s.material.dispose(); }
  }
}
