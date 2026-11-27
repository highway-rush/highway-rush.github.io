// Машина игрока: физика (газ, тормоз, накат, плавный руль, занос), прыжок, полёт на крыльях,
// эффекты (пыль, искры, тень), мигалка.
import * as THREE from 'three';
import { buildVehicle, buildWings, getGlowTexture, disposeVehicle } from './models.js';
import { carPhysics } from './cars.js';
import { EDGE, ROAD_HALF, LANE_W } from './world.js';
import { FLY_Y } from './air.js';

const GRAVITY = 18;          // м/с² — «игровая» гравитация: дуга плавная, но бодрая
const JUMP_HEIGHT = 6;       // чуть выше грузовика (3.9 м), чтобы успеть его перелететь
export const JUMP_COOLDOWN = 3;
export const FLY_MIN_ENERGY = 0.15;
const FLY_DRAIN = 1 / 7;     // полной шкалы хватает на ~7 секунд
const FLY_RESTART_COST = 0.1; // повторное включение полёта в воздухе (~0.7 с полёта)

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.mesh = null;
    this.x = 1.8; this.z = 0; this.y = 0; this.speed = 0; this.vx = 0; this.vy = 0; this.steerVal = 0;
    this.length = 4.5; this.width = 1.9; this.height = 1.4;
    this.crashed = false;
    this.maxSpeedReached = 0;
    this.airMode = 'ground'; // ground | jump | fly | glide
    this.energy = 0.5;
    this.jumpCD = 0;
    this.wingT = 0;
    this.flyBlend = 0;
    this.time = 0;

    // Свет фар на дороге (ночью) — мягкое пятно, дешевле настоящего прожектора
    const beamMat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: 0xfff0c0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 22).rotateX(-Math.PI / 2), beamMat);
    this.beam.position.set(0, 0.05, -14);
    this.beam.visible = false;
    this.scene.add(this.beam);

    // Тень на дороге: всегда под машиной, показывает, куда она приземлится
    this.groundShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.groundShadow.renderOrder = -1;
    scene.add(this.groundShadow);

    // Обломки при аварии (переиспользуемые кубики)
    this.debris = [];
    const dGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const dMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(dGeo, i % 3 ? dMat : new THREE.MeshBasicMaterial({ color: 0xffb000 }));
      m.visible = false;
      scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3(), r: new THREE.Vector3() });
    }

    // Пыль и искры при приземлении (переиспользуемые спрайты)
    this.puffs = [];
    for (let i = 0; i < 18; i++) {
      const spark = i % 3 === 0;
      const mat = new THREE.SpriteMaterial({
        map: getGlowTexture(), color: spark ? 0xffb340 : 0xd8d2c4, transparent: true, depthWrite: false,
        blending: spark ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, spark, v: new THREE.Vector3(), life: 0, max: 1 });
    }
  }

  setCar(carDef, color, shadows) {
    if (this.wings) { this.wings.group.removeFromParent(); this.wings.dispose(); }
    if (this.mesh) { this.root.remove(this.mesh); disposeVehicle(this.vehicle); }
    const v = buildVehicle(carDef.model, color, true);
    this.vehicle = v;
    this.mesh = v.group;
    this.length = v.length; this.width = v.width; this.height = v.height;
    this.phys = carPhysics(carDef);
    this.carDef = carDef;
    this.mesh.traverse((m) => { if (m.isMesh && (m.name === 'lit' || m.name === 'body')) m.castShadow = !!shadows; });
    // Собственную тень машины прячем: вместо неё — тень на дороге, которая остаётся внизу при прыжке
    const sh = this.mesh.getObjectByName('blobShadow');
    if (sh) sh.visible = false;
    this.groundShadow.scale.set(v.width * 1.15, 1, v.length * 1.08);
    this.root.add(this.mesh);
    this.wings = buildWings(v.width, v.length, v.height);
    this.mesh.add(this.wings.group);
  }

  setNight(on) { this.beam.visible = on; }

  reset(x = 1.8, speedKmh = 60) {
    this.x = x; this.z = 0; this.y = 0; this.vx = 0; this.vy = 0; this.steerVal = 0;
    this.speed = speedKmh / 3.6;
    this.crashed = false; this.crashT = 0;
    this.maxSpeedReached = this.speed;
    this.scrape = 0;
    this.airMode = 'ground';
    this.energy = 0.5;
    this.jumpCD = 0;
    this.wingT = 0; this.flyBlend = 0;
    this.sq = 0; this.sqV = 0;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.set(0, 0, 0);
    this.mesh.scale.set(1, 1, 1);
    this.wings.update(0, 0, false);
    for (const d of this.debris) d.m.visible = false;
    for (const p of this.puffs) { p.s.visible = false; p.life = 0; }
    this.sync();
  }

  get airborne() { return this.airMode !== 'ground'; }
  get flying() { return this.airMode === 'fly' || this.airMode === 'glide'; }
  get canJump() { return this.airMode === 'ground' && this.jumpCD <= 0 && !this.crashed; }
  get canFly() { return this.airMode === 'fly' || (this.energy >= FLY_MIN_ENERGY && !this.crashed); }

  jump() {
    if (!this.canJump) return false;
    this.airMode = 'jump';
    this.vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
    this.jumpCD = JUMP_COOLDOWN;
    this.sq = -0.12; this.sqV = 0; // кузов чуть приседает перед отрывом
    return true;
  }

  // Включить/выключить полёт. Возвращает 'on', 'off' или 'noenergy'
  toggleFly() {
    if (this.crashed) return null;
    if (this.airMode === 'fly') { this.airMode = 'glide'; return 'off'; }
    if (this.energy < FLY_MIN_ENERGY) return 'noenergy';
    // Повторное включение из планирования стоит энергии и не даёт толчка вверх,
    // иначе частыми нажатиями можно лететь почти бесплатно
    if (this.airMode === 'glide') this.energy -= FLY_RESTART_COST;
    else if (this.vy < 2) this.vy = 4;
    this.airMode = 'fly';
    return 'on';
  }

  addEnergy(n) { this.energy = Math.min(1, this.energy + n); }

  // grip: сцепление локации (снег < 1 — машина скользит)
  update(dt, input, grip) {
    const p = this.phys;
    this.time += dt;
    if (this.crashed) return this.updateCrash(dt);
    const events = {};
    this.jumpCD = Math.max(0, this.jumpCD - dt);
    const mode = this.airMode;

    // Скорость
    const maxSpeed = this.flying ? p.maxSpeed * 1.15 : p.maxSpeed;
    if (mode === 'jump') {
      // В прыжке скорость почти не меняется
      this.speed -= this.speed * 0.02 * dt;
    } else {
      if (input.gas) {
        const k = this.speed / maxSpeed;
        this.speed += p.accel * Math.max(0, 1 - k * k) * dt * (this.flying ? 1.3 : 1);
      } else if (!input.brake) {
        this.speed -= (1.2 + this.speed * 0.018) * dt * (this.flying ? 0.3 : 1); // накат
      }
      if (input.brake) this.speed -= p.brake * dt * (this.flying ? 0.6 : 1);
    }
    // Выше максимума (после полёта) скорость снижается плавно, без рывка
    if (this.speed > maxSpeed) this.speed -= (this.speed - maxSpeed) * Math.min(1, 1.5 * dt);
    this.speed = Math.max(0, this.speed);

    // Руль: плавное «поворачивание», без прыжков по полосам. В воздухе нет скольжения.
    const airGrip = this.airborne ? 1 : grip;
    const steerTarget = input.steer;
    const rate = input.analog ? 12 : 5;
    this.steerVal += (steerTarget - this.steerVal) * Math.min(1, rate * dt);
    const steerPow = Math.min(1, this.speed / 14) * (1 - Math.min(0.3, this.speed / 300));
    const targetVx = this.steerVal * p.steer * steerPow;
    const g = p.grip * airGrip;
    this.vx += (targetVx - this.vx) * Math.min(1, g * dt);
    this.x += this.vx * dt;

    // Отбойники по краям. Обочина узкая: даже прижавшись к отбойнику,
    // нельзя проехать мимо легковушки на крайней полосе, не задев её.
    const limit = Math.min(EDGE - this.width / 2 - 0.15, ROAD_HALF - LANE_W / 2 + 1.35);
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      if (Math.abs(this.vx) > 1 && !this.airborne) events.scrape = true;
      this.vx = -this.vx * 0.3;
      if (!this.airborne) this.speed -= 10 * dt;
      this.scrape = 0.25;
    }
    this.scrape = Math.max(0, (this.scrape || 0) - dt);

    // Вертикаль: прыжок, полёт, планирование
    if (mode === 'jump') {
      this.vy -= GRAVITY * dt;
    } else if (mode === 'fly') {
      this.energy = Math.max(0, this.energy - FLY_DRAIN * dt);
      const want = Math.max(-6, Math.min(9, (FLY_Y - this.y) * 2.2));
      this.vy += (want - this.vy) * Math.min(1, 4 * dt);
      if (this.energy <= 0) { this.airMode = 'glide'; events.energyOut = true; }
    } else if (mode === 'glide') {
      this.vy += (-3.4 - this.vy) * Math.min(1, 2.5 * dt);
    }
    if (mode !== 'ground') {
      this.y += this.vy * dt;
      if (this.y <= 0 && this.vy <= 0) {
        events.land = { hard: Math.min(1.5, Math.abs(this.vy) / 10), fromFly: mode !== 'jump' };
        this.y = 0; this.vy = 0;
        this.airMode = 'ground';
        this.sqV = -2.2 * (0.5 + events.land.hard);
        this.spawnDust(events.land.hard);
      }
    }

    this.z -= this.speed * dt;
    if (this.speed > this.maxSpeedReached) this.maxSpeedReached = this.speed;

    // Крылья: раскрываются в полёте, складываются после посадки
    const wingTarget = this.flying ? 1 : 0;
    const prevWing = this.wingT;
    this.wingT += Math.sign(wingTarget - this.wingT) * Math.min(Math.abs(wingTarget - this.wingT), dt * 2.4);
    if (prevWing === 0 && this.wingT > 0) events.wingsOpen = true;
    this.wings.update(this.wingT, this.time, this.airMode === 'fly');
    this.flyBlend += ((this.flying ? 1 : 0) - this.flyBlend) * Math.min(1, dt * 1.6);

    // Наклоны кузова
    const yaw = -this.vx * 0.025 + (airGrip < 0.8 ? -(this.vx - targetVx) * 0.04 : 0);
    this.mesh.rotation.y += (yaw - this.mesh.rotation.y) * Math.min(1, 10 * dt);
    const roll = this.flying ? -this.vx * 0.035 : -this.vx * 0.006;
    this.mesh.rotation.z += (roll - this.mesh.rotation.z) * Math.min(1, 8 * dt);
    let pitch = input.brake ? 0.02 : input.gas ? -0.012 : 0;
    if (mode === 'jump') pitch = Math.max(-0.22, Math.min(0.25, this.vy * 0.018)); // нос вверх при взлёте, вниз при падении
    else if (this.flying) pitch = Math.max(-0.15, Math.min(0.2, this.vy * 0.03)) + 0.03;
    this.mesh.rotation.x += (pitch - this.mesh.rotation.x) * Math.min(1, 8 * dt);

    // Пружинящая подвеска при приземлении (затухающее колебание)
    this.sqV += (-140 * this.sq - 9 * this.sqV) * dt;
    this.sq += this.sqV * dt;
    this.mesh.scale.set(1 - this.sq * 0.4, 1 + this.sq, 1 - this.sq * 0.25);

    this.updatePuffs(dt);
    this.sync();
    return events;
  }

  spawnDust(hard) {
    let n = 0;
    for (const p of this.puffs) {
      if (p.life > 0 || n >= 12) continue;
      n++;
      const side = Math.random() < 0.5 ? -1 : 1;
      p.s.position.set(this.x + side * (this.width / 2 + 0.2 + Math.random() * 0.4), 0.35, this.z + (Math.random() * 0.8 - 0.1) * this.length);
      const sp = p.spark ? 7 : 3.5;
      p.v.set(side * (1 + Math.random()) * sp * 0.6, (p.spark ? 3 : 1.2) + Math.random() * 2 * hard, (Math.random() - 0.5) * 3 - this.speed * (p.spark ? 0.85 : 0.8)); // пыль летит почти вместе с машиной и плавно отстаёт
      p.max = p.life = p.spark ? 0.45 : 0.9;
      p.s.visible = true;
      p.s.scale.setScalar(p.spark ? 0.55 : 1.6);
    }
  }

  updatePuffs(dt) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.v.y -= (p.spark ? 14 : 2) * dt;
      p.s.position.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      p.s.material.opacity = k * (p.spark ? 1 : 0.85);
      if (!p.spark) p.s.scale.setScalar(1.6 + (1 - k) * 3.2);
    }
  }

  crash(otherSpeedAlong) {
    this.crashed = true;
    this.crashT = 0;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 3);
    this.vy = Math.max(this.vy, 0) + 2.5 + Math.min(4, this.speed * 0.05);
    this.y = this.y || 0;
    this.airMode = 'ground';
    this.speed = Math.max(0, Math.min(this.speed, otherSpeedAlong + this.speed * 0.25));
    for (const d of this.debris) {
      d.m.visible = true;
      d.m.position.set(this.x + (Math.random() - 0.5) * 1.5, this.y + 0.8, this.z - this.length / 2);
      d.v.set((Math.random() - 0.5) * 10, 3 + Math.random() * 6, -this.speed * 0.6 + (Math.random() - 0.5) * 8);
      d.r.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    }
  }

  updateCrash(dt) {
    this.crashT += dt;
    this.speed = Math.max(0, this.speed - 22 * dt);
    this.z -= this.speed * dt;
    this.x += this.vx * dt;
    this.vx *= 1 - Math.min(1, 2 * dt);
    this.vy -= 18 * dt;
    this.y = Math.max(0, (this.y || 0) + this.vy * dt);
    if (this.y === 0 && this.vy < 0) this.vy = -this.vy * 0.3;
    this.spin *= 1 - Math.min(1, 1.6 * dt);
    this.mesh.rotation.y += this.spin * dt;
    this.mesh.rotation.z = Math.sin(this.crashT * 9) * 0.05 * Math.max(0, 1 - this.crashT);
    this.wingT = Math.max(0, this.wingT - dt * 3);
    this.wings.update(this.wingT, this.time, false);
    for (const d of this.debris) {
      if (!d.m.visible) continue;
      d.v.y -= 20 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.12) { d.m.position.y = 0.12; d.v.multiplyScalar(0.5); d.v.y = Math.abs(d.v.y) * 0.4; }
      d.m.rotation.x += d.r.x * dt; d.m.rotation.y += d.r.y * dt;
    }
    this.updatePuffs(dt);
    this.sync();
    return {};
  }

  sync() {
    this.root.position.set(this.x, this.y || 0, this.z);
    this.beam.position.set(this.x, 0.05, this.z - 14);
    this.beam.material.opacity = 0.5 / (1 + this.y * 0.25);
    // Тень остаётся на дороге и бледнеет/уменьшается с высотой
    const h = this.y || 0;
    this.groundShadow.position.set(this.x, 0.035, this.z);
    const k = 1 / (1 + h * 0.08);
    this.groundShadow.scale.x = this.width * 1.15 * k;
    this.groundShadow.scale.z = this.length * 1.08 * k;
    this.groundShadow.material.opacity = 0.42 * Math.max(0.35, k);
  }

  updateLightbar(t) {
    const lb = this.vehicle && this.vehicle.lightbar;
    if (!lb) return;
    const phase = Math.floor(t * 8) % 4;
    lb.red.color.setHex(phase === 0 || phase === 2 ? 0xff2020 : 0x330000);
    lb.blue.color.setHex(phase === 1 || phase === 3 ? 0x2a6bff : 0x000833);
  }
}
