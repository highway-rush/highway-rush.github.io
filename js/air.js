// Воздушные препятствия (вертолёты, дроны, стаи птиц, эстакады с проёмом) и бонусы-«батарейки».
// Все объекты создаются один раз и переиспользуются (object pooling), как машины трафика.
import * as THREE from 'three';
import { Builder, getGlowTexture } from './models.js';
import { LANE_W, EDGE } from './world.js';

export const FLY_Y = 7;            // высота полёта (низ машины), м
const rnd = (a, b) => a + Math.random() * (b - a);
const laneX = (i) => (i - 1.5) * LANE_W;

// ---------- Модели ----------
function heliModel() {
  const b = new Builder();
  const c = Math.random() < 0.5 ? 0xd8342c : 0x2b5fd9;
  b.blob('ico1', 1.25, 1.15, 2.2, 0, 0, 0, c);                     // кабина
  b.blob('ico1', 1.0, 0.8, 1.0, 0, 0.15, -1.45, 0x9fd6ff, 'glow');  // стекло
  b.box(0.35, 0.35, 4.6, 0, 0.2, 3.3, c);                            // хвостовая балка
  b.box(0.12, 1.3, 0.8, 0, 0.75, 5.4, c);                            // киль
  b.box(1.6, 0.1, 0.5, 0, 0.3, 5.2, c);                              // стабилизатор
  for (const s of [-1, 1]) {
    b.box(0.1, 0.1, 3.2, s * 0.9, -1.35, 0, 0x30333a);               // полозья
    b.box(0.08, 0.5, 0.08, s * 0.8, -1.1, -0.7, 0x30333a);
    b.box(0.08, 0.5, 0.08, s * 0.8, -1.1, 0.8, 0x30333a);
  }
  b.cyl(0.18, 0.5, 0, 1.35, 0, 0x30333a, 'lit', 6);                  // вал винта
  b.box(0.18, 0.18, 0.1, 0, -0.4, -2.15, 0xff2020, 'glow');          // огонёк
  const group = b.toGroup({});
  const rb = new Builder();
  rb.box(10, 0.07, 0.42, 0, 0, 0, 0x22252b);
  rb.box(0.42, 0.07, 10, 0, 0, 0, 0x22252b);
  const rotor = rb.toGroup({}); rotor.position.y = 1.6;
  const tb = new Builder();
  tb.box(0.06, 1.6, 0.25, 0, 0, 0, 0x22252b);
  const tail = tb.toGroup({}); tail.position.set(0.25, 0.75, 5.5);
  group.add(rotor, tail);
  return {
    group, spin: [rotor, tail],
    boxes: [{ cx: 0, cy: 0, cz: 1.2, hx: 1.25, hy: 1.3, hz: 3.4 }, { cx: 0, cy: 1.6, cz: 0, hx: 4.6, hy: 0.25, hz: 4.6 }],
  };
}

function droneModel() {
  const b = new Builder();
  b.box(0.9, 0.35, 0.9, 0, 0, 0, 0x2b2e36);
  b.box(0.5, 0.2, 0.5, 0, -0.25, 0, 0x111318);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.box(0.12, 0.1, 1.1, x * 0.45, 0, z * 0.45, 0x2b2e36, 'lit', x * z > 0 ? Math.PI / 4 : -Math.PI / 4);
    b.cyl(0.55, 0.04, x * 0.85, 0.18, z * 0.85, 0x9aa0aa, 'lit', 12);
    b.box(0.14, 0.14, 0.14, x * 0.85, -0.05, z * 0.85, x < 0 ? 0xff2a2a : 0x2aff6a, 'glow');
  }
  const group = b.toGroup({});
  group.scale.setScalar(2.2);
  return { group, spin: [], boxes: [{ cx: 0, cy: 0, cz: 0, hx: 2.3, hy: 0.7, hz: 2.3 }] };
}

function flockModel() {
  const group = new THREE.Group();
  const birds = [];
  const bodyB = new Builder();
  bodyB.box(0.25, 0.22, 0.9, 0, 0, 0, 0xf1f1ee);
  bodyB.box(0.12, 0.08, 0.25, 0, -0.02, -0.55, 0xffb300);
  const bodyGeo = bodyB.bake('lit');
  const wingB = new Builder();
  wingB.box(1.0, 0.04, 0.45, 0.5, 0, 0, 0xdfe2e6);
  wingB.box(0.35, 0.05, 0.3, 0.95, 0, 0.08, 0x3a3d44);
  const wingGeo = wingB.bake('lit');
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (let i = 0; i < 7; i++) {
    const bird = new THREE.Group();
    bird.add(new THREE.Mesh(bodyGeo, mat));
    const wr = new THREE.Mesh(wingGeo, mat);
    const wl = new THREE.Mesh(wingGeo, mat); wl.scale.x = -1;
    bird.add(wr, wl);
    bird.scale.setScalar(1.4);
    // Клин из птиц
    const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
    bird.userData.off = new THREE.Vector3(side * row * 1.3, rnd(-0.6, 0.6), row * 1.6 * (i ? 1 : 0));
    bird.userData.phase = Math.random() * 6;
    group.add(bird);
    birds.push({ bird, wl, wr });
  }
  return { group, birds, spin: [], boxes: [{ cx: 0, cy: 0, cz: 2.4, hx: 4.6, hy: 1.1, hz: 3.4 }] };
}

const concrete = new THREE.MeshLambertMaterial({ color: 0xa9a49a });
const stripe = new THREE.MeshBasicMaterial({ color: 0xffc21a });
const unitBox = new THREE.BoxGeometry(1, 1, 1);

function bridgeModel() {
  const group = new THREE.Group();
  const parts = {};
  for (const k of ['deck', 'beam', 'left', 'right', 'pillarL', 'pillarR', 'railL', 'railR']) {
    parts[k] = new THREE.Mesh(unitBox, k.startsWith('rail') ? stripe : concrete);
    group.add(parts[k]);
  }
  for (const k of ['fTop', 'fBot', 'fL', 'fR']) { parts[k] = new THREE.Mesh(unitBox, stripe); group.add(parts[k]); }
  return { group, parts, spin: [], boxes: [] };
}

const BEAM_Y = 4.6, GAP_Y0 = 5.7, GAP_Y1 = 9.7, DECK_Y = 11, DEPTH = 3;
const OUT = EDGE + 3; // ширина эстакады чуть больше дороги

function layoutBridge(h, lane0, lanes) {
  const P = h.parts;
  const gx0 = laneX(lane0) - LANE_W / 2 - 0.4;
  const gx1 = laneX(lane0 + lanes - 1) + LANE_W / 2 + 0.4;
  const set = (m, x0, x1, y0, y1, d = DEPTH) => {
    m.scale.set(Math.max(0.01, x1 - x0), y1 - y0, d);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  };
  set(P.deck, -OUT, OUT, GAP_Y1, DECK_Y);
  set(P.beam, -OUT, OUT, BEAM_Y, GAP_Y0);
  set(P.left, -OUT, gx0, GAP_Y0, GAP_Y1);
  set(P.right, gx1, OUT, GAP_Y0, GAP_Y1);
  set(P.pillarL, -OUT, -OUT + 1.6, 0, BEAM_Y, 2);
  set(P.pillarR, OUT - 1.6, OUT, 0, BEAM_Y, 2);
  set(P.railL, -OUT, OUT, DECK_Y, DECK_Y + 0.35, 0.25); P.railL.position.z = -DEPTH / 2 + 0.15;
  set(P.railR, -OUT, OUT, DECK_Y, DECK_Y + 0.35, 0.25); P.railR.position.z = DEPTH / 2 - 0.15;
  // Жёлтая рамка вокруг проёма — чтобы его было хорошо видно
  const f = 0.3, z = -DEPTH / 2 - 0.05;
  set(P.fTop, gx0, gx1, GAP_Y1 - f, GAP_Y1, 0.1); P.fTop.position.z = z;
  set(P.fBot, gx0, gx1, GAP_Y0, GAP_Y0 + f, 0.1); P.fBot.position.z = z;
  set(P.fL, gx0, gx0 + f, GAP_Y0, GAP_Y1, 0.1); P.fL.position.z = z;
  set(P.fR, gx1 - f, gx1, GAP_Y0, GAP_Y1, 0.1); P.fR.position.z = z;
  const hz = DEPTH / 2;
  h.boxes = [
    { cx: 0, cy: (GAP_Y1 + DECK_Y) / 2, cz: 0, hx: OUT, hy: (DECK_Y - GAP_Y1) / 2, hz },
    { cx: 0, cy: (BEAM_Y + GAP_Y0) / 2, cz: 0, hx: OUT, hy: (GAP_Y0 - BEAM_Y) / 2, hz },
    { cx: (-OUT + gx0) / 2, cy: (GAP_Y0 + GAP_Y1) / 2, cz: 0, hx: (gx0 + OUT) / 2, hy: (GAP_Y1 - GAP_Y0) / 2, hz },
    { cx: (gx1 + OUT) / 2, cy: (GAP_Y0 + GAP_Y1) / 2, cz: 0, hx: (OUT - gx1) / 2, hy: (GAP_Y1 - GAP_Y0) / 2, hz },
  ];
}

function batteryModel() {
  const b = new Builder();
  b.cyl(0.42, 1.1, 0, 0, 0, 0x39ff7a, 'glow', 12);
  b.cyl(0.44, 0.18, 0, -0.5, 0, 0x2a2d33, 'lit', 12);
  b.cyl(0.44, 0.12, 0, 0.5, 0, 0x2a2d33, 'lit', 12);
  b.cyl(0.18, 0.18, 0, 0.65, 0, 0xd0d4da, 'lit', 8);
  b.box(0.1, 0.45, 0.06, 0, 0.05, -0.43, 0xffffff, 'glow');
  b.box(0.3, 0.1, 0.06, 0, 0.05, -0.43, 0xffffff, 'glow');
  const group = b.toGroup({});
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0x4dff8a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(3.2, 3.2, 1);
  group.add(halo);
  return { group };
}

// ---------- Система ----------
export class AirSystem {
  constructor(scene) {
    this.scene = scene;
    this.hazards = [];
    const add = (type, make, n) => {
      for (let i = 0; i < n; i++) {
        const h = make();
        h.type = type; h.active = false; h.group.visible = false;
        scene.add(h.group);
        this.hazards.push(h);
      }
    };
    add('heli', heliModel, 3);
    add('drone', droneModel, 4);
    add('birds', flockModel, 3);
    add('bridge', bridgeModel, 2);
    this.batteries = [];
    for (let i = 0; i < 6; i++) {
      const bt = batteryModel();
      bt.active = false; bt.group.visible = false;
      scene.add(bt.group);
      this.batteries.push(bt);
    }
    this._box = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  }

  reset() {
    for (const h of this.hazards) { h.active = false; h.group.visible = false; }
    for (const b of this.batteries) { b.active = false; b.group.visible = false; }
    this.hazT = 0.6;
    this.batT = rnd(4, 7);
    this.airBatT = 3;
    this.lastHazZ = Infinity;
    this.time = 0;
    this.spawned = 0;
  }

  activeHazards() { return this.hazards.filter((h) => h.active); }

  spawnHazard(p, runTime) {
    // Вид препятствия; эстакады — реже
    const r = Math.random();
    const type = r < 0.28 ? 'heli' : r < 0.55 ? 'drone' : r < 0.8 ? 'birds' : 'bridge';
    const h = this.hazards.find((x) => !x.active && x.type === type) || this.hazards.find((x) => !x.active && x.type !== 'bridge');
    if (!h) return;
    let z = p.z - rnd(190, 240);
    if (z > this.lastHazZ - 35) z = this.lastHazZ - 35; // не ставим препятствия вплотную друг к другу
    this.lastHazZ = z;
    h.active = true; h.group.visible = true;
    h.z = z; h.t = Math.random() * 10;
    if (h.type === 'heli') {
      // Вертолёт старается встать на полосу, где летит игрок (иногда — на соседнюю)
      const pl = Math.round(p.x / LANE_W + 1.5);
      const lane = Math.max(0, Math.min(3, Math.random() < 0.6 ? pl : (Math.random() * 4) | 0));
      h.x = laneX(lane); h.y = FLY_Y + 1.1;
      h.group.rotation.y = rnd(-0.6, 0.6);
    } else if (h.type === 'drone') {
      h.x = laneX((Math.random() * 4) | 0) + rnd(-0.8, 0.8); h.y = FLY_Y + rnd(0.2, 1.4);
    } else if (h.type === 'birds') {
      h.dir = Math.random() < 0.5 ? -1 : 1;
      h.x = -h.dir * (EDGE + 10); h.y = FLY_Y + rnd(0.3, 1.2);
      h.vx = h.dir * rnd(5, 7.5);
      h.group.rotation.y = -h.dir * Math.PI / 2; // клин летит поперёк дороги
      // Стая должна пересечь дорогу примерно к моменту, когда до неё долетит игрок
      const eta = (p.z - z) / Math.max(20, p.speed);
      h.x = -h.dir * Math.min(EDGE + 25, Math.abs(h.vx) * eta * 0.9);
    } else {
      const lanes = runTime > 90 ? 1 : (Math.random() < 0.5 ? 1 : 2);
      const lane0 = (Math.random() * (5 - lanes)) | 0;
      layoutBridge(h, lane0, lanes);
      h.x = 0; h.y = 0;
      h.group.rotation.y = 0;
    }
    h.group.position.set(h.x, h.y, h.z);
    this.spawned++;
  }

  spawnBattery(p, traffic, inAir) {
    const b = this.batteries.find((x) => !x.active);
    if (!b) return;
    const lane = (Math.random() * 4) | 0;
    const x = laneX(lane), z = p.z - rnd(150, 210);
    if (!inAir) for (const v of traffic.active) if (Math.abs(v.x - x) < 2.5 && Math.abs(v.z - z) < 14) return;
    b.active = true; b.group.visible = true;
    b.x = x; b.z = z; b.baseY = inAir ? FLY_Y + 0.8 : 1.1; b.t = Math.random() * 6;
    b.group.position.set(x, b.baseY, z);
  }

  // Возвращает { hit } если игрок врезался, и { pickups } — сколько батареек подобрано
  update(dt, game) {
    const p = game.player;
    this.time += dt;
    const flying = p.airMode === 'fly' || p.airMode === 'glide';
    const takingOff = p.airMode === 'fly' && p.wingT < 1;

    // Препятствия появляются только в полёте (или прямо перед взлётом)
    if (flying || takingOff) {
      this.hazT -= dt;
      if (this.hazT <= 0) {
        this.spawnHazard(p, game.runTime);
        // Со временем препятствий становится больше
        this.hazT = Math.max(0.75, 2.4 - game.runTime / 100) * rnd(0.8, 1.2);
      }
      this.airBatT -= dt;
      if (this.airBatT <= 0) { this.spawnBattery(p, game.traffic, true); this.airBatT = rnd(3.5, 5.5); }
    } else {
      this.hazT = Math.min(this.hazT, 0.4);
    }
    this.batT -= dt;
    if (this.batT <= 0) { this.spawnBattery(p, game.traffic, false); this.batT = rnd(6, 11); }

    // Коробка игрока
    const B = this._box;
    B.x0 = p.x - p.width / 2 + 0.15; B.x1 = p.x + p.width / 2 - 0.15;
    B.y0 = p.y + 0.1; B.y1 = p.y + p.height - 0.1;
    B.z0 = p.z - p.length / 2 + 0.2; B.z1 = p.z + p.length / 2 - 0.2;

    let hit = null;
    for (const h of this.hazards) {
      if (!h.active) continue;
      h.t += dt;
      if (h.type === 'heli') {
        h.spin[0].rotation.y += dt * 22; h.spin[1].rotation.x += dt * 30;
        h.group.position.y = h.y + Math.sin(h.t * 1.3) * 0.25;
      } else if (h.type === 'drone') {
        h.group.position.y = h.y + Math.sin(h.t * 2.2) * 0.45;
        h.group.position.x = h.x + Math.sin(h.t * 0.9) * 0.8;
        h.group.rotation.y += dt * 0.8;
      } else if (h.type === 'birds') {
        h.x += h.vx * dt;
        h.group.position.x = h.x;
        h.group.position.y = h.y + Math.sin(h.t * 1.7) * 0.3;
        for (const { bird, wl, wr } of h.birds) {
          const a = Math.sin(h.t * 9 + bird.userData.phase) * 0.7;
          wr.rotation.z = a; wl.rotation.z = -a;
          bird.position.copy(bird.userData.off);
        }
        if (Math.abs(h.x) > EDGE + 40) { h.active = false; h.group.visible = false; continue; }
      }
      if (h.z > p.z + 25) { h.active = false; h.group.visible = false; continue; }
      if (!hit && Math.abs(h.z - p.z) < 12 && this.hits(h, B)) hit = h;
    }

    let pickups = 0;
    for (const b of this.batteries) {
      if (!b.active) continue;
      b.t += dt;
      b.group.rotation.y += dt * 2.5;
      b.group.position.y = b.baseY + Math.sin(b.t * 3) * 0.2;
      if (b.z > p.z + 20) { b.active = false; b.group.visible = false; continue; }
      const by = b.group.position.y;
      if (Math.abs(b.x - p.x) < 1.7 && Math.abs(b.z - p.z) < p.length / 2 + 0.8 && by > p.y - 0.6 && by < p.y + p.height + 1.2) {
        b.active = false; b.group.visible = false;
        pickups++;
      }
    }
    return { hit, pickups };
  }

  // Пересечение коробки игрока с коробками препятствия (с учётом поворота вокруг Y)
  hits(h, B) {
    const g = h.group;
    const cos = Math.cos(g.rotation.y), sin = Math.sin(g.rotation.y);
    const s = g.scale.x;
    for (const bx of h.boxes) {
      // Центр коробки в мире
      const lx = bx.cx * s, lz = bx.cz * s;
      const cx = g.position.x + lx * cos + lz * sin;
      const cz = g.position.z - lx * sin + lz * cos;
      const cy = g.position.y + bx.cy * s;
      // Повёрнутую коробку приближаем осевой (берём описанный прямоугольник)
      const hx = (Math.abs(bx.hx * cos) + Math.abs(bx.hz * sin)) * s;
      const hz = (Math.abs(bx.hx * sin) + Math.abs(bx.hz * cos)) * s;
      const hy = bx.hy * s;
      if (B.x1 > cx - hx && B.x0 < cx + hx && B.y1 > cy - hy && B.y0 < cy + hy && B.z1 > cz - hz && B.z0 < cz + hz) return true;
    }
    return false;
  }
}
