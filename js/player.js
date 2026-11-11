// Машина игрока: физика (газ, тормоз, накат, плавный руль, занос), эффекты, мигалка.
import * as THREE from 'three';
import { buildVehicle, getGlowTexture, disposeVehicle } from './models.js';
import { carPhysics } from './cars.js';
import { EDGE } from './world.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.mesh = null;
    this.x = 1.8; this.z = 0; this.speed = 0; this.vx = 0; this.steerVal = 0;
    this.length = 4.5; this.width = 1.9;
    this.crashed = false;
    this.maxSpeedReached = 0;

    // Свет фар на дороге (ночью) — мягкое пятно, дешевле настоящего прожектора
    const beamMat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: 0xfff0c0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 22).rotateX(-Math.PI / 2), beamMat);
    this.beam.position.set(0, 0.05, -14);
    this.beam.visible = false;
    this.root.add(this.beam);

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
  }

  setCar(carDef, color, shadows) {
    if (this.mesh) { this.root.remove(this.mesh); disposeVehicle(this.vehicle); }
    const v = buildVehicle(carDef.model, color, true);
    this.vehicle = v;
    this.mesh = v.group;
    this.length = v.length; this.width = v.width;
    this.phys = carPhysics(carDef);
    this.carDef = carDef;
    this.mesh.traverse((m) => { if (m.isMesh && (m.name === 'lit' || m.name === 'body')) m.castShadow = !!shadows; });
    const sh = this.mesh.getObjectByName('blobShadow');
    if (sh) sh.visible = !shadows;
    this.root.add(this.mesh);
  }

  setNight(on) { this.beam.visible = on; }

  reset(x = 1.8, speedKmh = 60) {
    this.x = x; this.z = 0; this.vx = 0; this.steerVal = 0;
    this.speed = speedKmh / 3.6;
    this.crashed = false; this.crashT = 0;
    this.maxSpeedReached = this.speed;
    this.scrape = 0;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.set(0, 0, 0);
    for (const d of this.debris) d.m.visible = false;
    this.sync();
  }

  // grip: сцепление локации (снег < 1 — машина скользит)
  update(dt, input, grip) {
    const p = this.phys;
    if (this.crashed) return this.updateCrash(dt);
    const events = {};

    // Скорость
    if (input.gas) {
      const k = this.speed / p.maxSpeed;
      this.speed += p.accel * Math.max(0, 1 - k * k) * dt;
    } else if (!input.brake) {
      this.speed -= (1.2 + this.speed * 0.018) * dt; // накат: постепенно сбрасываем скорость
    }
    if (input.brake) this.speed -= p.brake * dt;
    this.speed = Math.max(0, Math.min(this.speed, p.maxSpeed));

    // Руль: плавное «поворачивание», без прыжков по полосам
    const steerTarget = input.steer;
    const rate = input.analog ? 12 : 5;
    this.steerVal += (steerTarget - this.steerVal) * Math.min(1, rate * dt);
    const steerPow = Math.min(1, this.speed / 14) * (1 - Math.min(0.3, this.speed / 300));
    const targetVx = this.steerVal * p.steer * steerPow;
    const g = p.grip * grip;
    this.vx += (targetVx - this.vx) * Math.min(1, g * dt);
    this.x += this.vx * dt;

    // Отбойники по краям
    const limit = EDGE - this.width / 2 - 0.15;
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      if (Math.abs(this.vx) > 1) events.scrape = true;
      this.vx = -this.vx * 0.3;
      this.speed -= 10 * dt;
      this.scrape = 0.25;
    }
    this.scrape = Math.max(0, (this.scrape || 0) - dt);

    this.z -= this.speed * dt;
    if (this.speed > this.maxSpeedReached) this.maxSpeedReached = this.speed;

    // Наклоны кузова для живости
    const yaw = -this.vx * 0.025 + (grip < 0.8 ? -(this.vx - targetVx) * 0.04 : 0);
    this.mesh.rotation.y += (yaw - this.mesh.rotation.y) * Math.min(1, 10 * dt);
    this.mesh.rotation.z += (-this.vx * 0.006 - this.mesh.rotation.z) * Math.min(1, 8 * dt);
    const pitch = input.brake ? 0.02 : input.gas ? -0.012 : 0;
    this.mesh.rotation.x += (pitch - this.mesh.rotation.x) * Math.min(1, 6 * dt);
    this.sync();
    return events;
  }

  crash(otherSpeedAlong) {
    this.crashed = true;
    this.crashT = 0;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 3);
    this.vy = 2.5 + Math.min(4, this.speed * 0.05);
    this.y = 0;
    this.speed = Math.max(0, Math.min(this.speed, otherSpeedAlong + this.speed * 0.25));
    for (const d of this.debris) {
      d.m.visible = true;
      d.m.position.set(this.x + (Math.random() - 0.5) * 1.5, 0.8, this.z - this.length / 2);
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
    for (const d of this.debris) {
      if (!d.m.visible) continue;
      d.v.y -= 20 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.12) { d.m.position.y = 0.12; d.v.multiplyScalar(0.5); d.v.y = Math.abs(d.v.y) * 0.4; }
      d.m.rotation.x += d.r.x * dt; d.m.rotation.y += d.r.y * dt;
    }
    this.sync();
    return {};
  }

  sync() {
    this.root.position.set(this.x, this.y || 0, this.z);
  }

  updateLightbar(t) {
    const lb = this.vehicle && this.vehicle.lightbar;
    if (!lb) return;
    const phase = Math.floor(t * 8) % 4;
    lb.red.color.setHex(phase === 0 || phase === 2 ? 0xff2020 : 0x330000);
    lb.blue.color.setHex(phase === 1 || phase === 3 ? 0x2a6bff : 0x000833);
  }
}
