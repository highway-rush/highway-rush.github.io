// Игровой цикл заезда: состояние, очки, комбо, столкновения, камера, гараж-превью.
import * as THREE from 'three';
import { World } from './world.js';
import { Traffic } from './traffic.js';
import { Player, FLY_MIN_ENERGY } from './player.js';
import { AirSystem } from './air.js';
import { LOCATIONS } from './locations.js';
import { createMode } from './modes.js';
import { carById } from './cars.js';
import { buildVehicle } from './models.js';
import * as storage from './storage.js';
import * as quests from './quests.js';
import { t } from './i18n.js';

const KMH = 3.6;

export class Game {
  constructor(renderer, ui, audio, input) {
    this.renderer = renderer; this.ui = ui; this.audio = audio; this.input = input;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);
    this.world = new World(this.scene);
    this.traffic = new Traffic(this.scene);
    this.player = new Player(this.scene);
    this.air = new AirSystem(this.scene);
    this.state = 'menu';
    this.envKey = '';
    this.time = 0;
    this.shake = 0;
    this.camTarget = new THREE.Vector3();
    this.buildGarageScene();
  }

  get quality() { return storage.get().settings.quality; }

  applyQuality() {
    const high = this.quality === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    this.renderer.shadowMap.enabled = high;
    this.envKey = ''; // при следующем заезде мир перестроится
  }

  buildEnvironment(locId, twoWay) {
    const key = `${locId}|${twoWay}|${this.quality}`;
    if (key === this.envKey) return;
    this.envKey = key;
    const high = this.quality === 'high';
    this.world.build(locId, twoWay, this.quality);
    this.traffic.configure(twoWay, this.world.fogFar);
    this.traffic.setShadows(high);
    this.loc = LOCATIONS[locId];
    this.player.setNight(!!this.loc.night || locId === 'rain');
  }

  // ---------- Меню: красивый «облёт» дороги на фоне ----------
  startDemo(locId = 'highway') {
    this.endMode();
    this.state = 'menu';
    this.buildEnvironment(locId, false);
    this.player.root.visible = false;
    this.player.groundShadow.visible = false;
    this.air.reset();
    this.audio.setFly(0);
    this.demo = { x: 100, z: 0, speed: 24, length: 0, width: 0 };
    this.world.resetPosition(0);
    this.traffic.reset(0);
    this.audio.setEngine(false);
    this.audio.setSiren(false);
  }

  // ---------- Заезд ----------
  startRun(modeId, locId) {
    this.endMode();
    this.modeId = modeId; this.locId = locId;
    this.mode = createMode(modeId);
    const save = storage.get();
    const carDef = carById(this.mode.forceCar || save.selected);
    this.carDef = carDef;
    const color = save.colors[carDef.id] ?? carDef.color;
    this.buildEnvironment(locId, this.mode.twoWay);
    this.player.setCar(carDef, color, this.quality === 'high');
    this.player.root.visible = true;
    this.player.groundShadow.visible = true;
    this.player.reset(this.mode.startX, 70);
    this.air.reset();
    this.input.releaseTouch();
    this.world.resetPosition(this.player.z);
    this.traffic.reset(this.player.z);
    this.mode.setup(this);
    this.score = 0; this.distance = 0; this.combo = 0; this.comboT = 0; this.nearMisses = 0;
    this.runTime = 0; this.shake = 0; this.crashT = 0;
    this.jumps = 0; this.flyTime = 0; this.jumpOverCount = 0; this.lowWarnT = 0;
    this.tutorialT = 0;
    this.batteries = 0; this.maxCombo = 0;
    this.questsDone = []; this.questT = 0;
    this.ghostUsed = !!this.ghost; // со «сквозь машины» задания не засчитываются
    this.state = 'playing';
    this.camera.position.set(this.player.x, 3.4, this.player.z + 8);
    this.audio.setSiren(this.mode.siren);
    this.ui.showHud();
    this.ui.popup(t('go'), 'gold');
  }

  endMode() {
    if (this.online) { this.online.dispose(); this.online = null; }
    if (this.mode) {
      this.mode.dispose(this);
      this.mode = null;
    }
  }

  restart() { this.startRun(this.modeId, this.locId); }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.setEngine(false);
    this.audio.setSiren(false);
    this.audio.setFly(0);
    this.input.releaseTouch();
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio.setSiren(this.mode.siren);
    this.ui.showHud();
  }

  addScore(n) { this.score += n; }

  get speedKmh() { return this.player.speed * KMH; }

  update(dt) {
    this.time += dt;
    if (this.state === 'menu') return this.updateDemo(dt);
    if (this.state === 'playing') return this.updatePlaying(dt);
    if (this.state === 'crashing') return this.updateCrashing(dt);
    if (this.state === 'online' && this.online) return this.online.update(dt);
  }

  updateDemo(dt) {
    const d = this.demo;
    d.z -= d.speed * dt;
    this.traffic.update(dt, d, 0, false);
    this.world.update(dt, d.z, d.speed, this.camera);
    const sway = Math.sin(this.time * 0.25);
    this.camera.position.set(sway * 6, 7 + Math.sin(this.time * 0.17) * 1.5, d.z + 10);
    this.camera.lookAt(sway * 2, 1, d.z - 40);
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
  }

  updatePlaying(dt) {
    const p = this.player;
    const inp = this.input.read();
    if (inp.horn) this.audio.horn();
    // Прыжок и полёт
    if (inp.jump) {
      if (p.jump()) { this.jumps++; this.audio.jump(); this.tutorialDone('jump'); }
      else if (p.airMode === 'ground') this.audio.denied();
    }
    if (inp.fly) {
      const r = p.toggleFly();
      if (r === 'on') this.tutorialDone('fly');
      else if (r === 'noenergy') { this.audio.denied(); this.ui.popup(t('noEnergy'), 'blue'); }
    }
    if (inp.ghost) {
      this.ghost = !this.ghost;
      if (this.ghost) this.ghostUsed = true;
      this.ui.popup(t(this.ghost ? 'ghostOn' : 'ghostOff'), 'blue');
    }
    const ev = p.update(dt, inp, this.loc.grip);
    if (ev.scrape) this.audio.scrape();
    if (ev.wingsOpen) this.audio.wings();
    if (ev.land) { this.audio.land(ev.land.hard); this.shake = Math.max(this.shake, 0.12 + ev.land.hard * 0.15); }
    if (ev.energyOut) this.ui.popup(t('lowEnergy'), 'blue');
    this.runTime += dt;
    this.distance = -p.z;
    if (p.flying) this.flyTime += dt;
    this.traffic.update(dt, p, this.distance, this.mode.siren);

    // Столкновения, «близкие обгоны» и прыжки через машины.
    // Столкновение — только если машины реально пересекаются и по высоте: над машиной можно пролететь,
    // а приземление на крышу — авария.
    let overNow = 0;
    for (const v of this.traffic.active) {
      const dx = Math.abs(v.x - p.x), dz = Math.abs(v.z - p.z);
      const lowEnough = p.y < (v.height || 1.5) - 0.15;
      if (!this.ghost && lowEnough && dx < (v.width + p.width) / 2 - 0.12 && dz < (v.length + p.length) / 2 - 0.15) {
        return this.onCrash(v);
      }
      const rel = v.z - p.z;
      if (Math.sign(rel) !== Math.sign(v.prevRel) && v.prevRel !== 0) {
        const lateral = dx - (v.width + p.width) / 2;
        if (p.airMode === 'jump' && lateral < 0.3 && !v.overDone) { v.overDone = true; overNow++; }
        else if (!v.nearDone && p.y < 0.6 && lateral < 1.1 && this.speedKmh > 60) this.onNearMiss();
        v.nearDone = true;
      }
      v.prevRel = rel;
    }
    if (overNow) this.onJumpOver(overNow);

    // Воздушные препятствия и батарейки
    const air = this.air.update(dt, this);
    if (air.hit) return this.onCrash(null);
    for (let i = 0; i < air.pickups; i++) this.onBattery();

    // Очки: только быстрее 50 км/ч, и чем быстрее — тем больше. В полёте ×1.5
    const kmh = this.speedKmh;
    if (kmh > 50) this.score += (kmh - 50) * 0.5 * dt * (1 + this.combo * 0.5) * this.mode.scoreMultiplier(this) * (p.flying ? 1.5 : 1);
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    // Предупреждение о низкой энергии в полёте
    if (p.airMode === 'fly' && p.energy < 0.2) {
      this.lowWarnT -= dt;
      if (this.lowWarnT <= 0) { this.audio.lowEnergy(); this.lowWarnT = 0.7; }
    } else this.lowWarnT = 0;

    const end = this.mode.update(dt, this);
    this.questT -= dt;
    if (this.questT <= 0) { this.questT = 0.2; this.checkQuests(); }
    if (this.mode.siren) p.updateLightbar(this.time);
    this.world.update(dt, p.z, p.speed, this.camera);
    this.updateCamera(dt);
    this.audio.setEngine(true, p.speed / p.phys.maxSpeed, inp.gas);
    this.audio.setFly(p.airMode === 'fly' ? 1 : p.airMode === 'glide' ? 0.35 : 0, p.speed / p.phys.maxSpeed);
    this.updateTutorial(dt);
    this.ui.updateHud(this);
    if (end) this.finishRun(end);
  }

  onJumpOver(count) {
    this.jumpOverCount += count;
    const bonus = 250 * count * (count > 1 ? 2 : 1);
    this.score += bonus;
    this.player.addEnergy(0.12 * count);
    this.ui.popup(count > 1 ? t('jumpOverN', { c: count, n: bonus }) : t('jumpOver', { n: bonus }), 'gold');
    this.audio.jumpOver();
  }

  onBattery() {
    this.batteries++;
    this.player.addEnergy(0.3);
    this.score += 100;
    this.ui.popup(t('battery', { n: 30 }), 'blue');
    this.audio.battery();
  }

  // ---------- Обучение при первом запуске ----------
  updateTutorial(dt) {
    const tut = storage.get().tutorial;
    this.tutorialT += dt;
    let hint = null;
    const touch = this.input.isTouch;
    if (!tut.jump && this.tutorialT > 2 && this.player.airMode === 'ground') hint = 'jump';
    else if (tut.jump && !tut.fly && this.tutorialT > 2 && this.player.energy >= FLY_MIN_ENERGY && this.player.airMode === 'ground') hint = 'fly';
    if (hint === 'jump') this.ui.setHint(t(touch ? 'tutJumpTouch' : 'tutJumpKey'), '', 'jump');
    else if (hint === 'fly') this.ui.setHint(t(touch ? 'tutFlyTouch' : 'tutFlyKey'), t('tutFlyMore'), 'fly');
    else this.ui.setHint(null);
  }

  tutorialDone(key) {
    const tut = storage.get().tutorial;
    if (tut[key]) return;
    tut[key] = true;
    this.tutorialT = 0.5; // небольшая пауза перед следующей подсказкой
    storage.save();
  }

  onNearMiss() {
    this.nearMisses++;
    this.combo = Math.min(this.combo + 1, 9);
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboT = 4;
    const bonus = 100 * this.combo;
    this.score += bonus;
    this.player.addEnergy(0.08);
    this.ui.popup(`${t('nearMiss')} +${bonus}`);
    this.audio.nearMiss();
  }

  onCrash(v) {
    const p = this.player;
    this.state = 'crashing';
    this.crashT = 0;
    this.shake = 0.8;
    const otherAlong = v && v.dir === -1 ? v.speed : 0;
    p.crash(otherAlong);
    if (v) { v.speed = 0; v.desired = 0; }
    this.ui.setHint(null);
    this.audio.crash();
    this.audio.setFly(0);
    this.audio.setEngine(false);
    this.audio.setSiren(false);
    this.ui.flash();
    if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) try { navigator.vibrate(200); } catch (_) { /* не все устройства */ }
  }

  updateCrashing(dt) {
    this.crashT += dt;
    this.player.update(dt, null, 1);
    this.traffic.update(dt, this.player, this.distance, false);
    this.world.update(dt, this.player.z, this.player.speed, this.camera);
    this.updateCamera(dt);
    if (this.crashT > 1.6) this.finishRun('crashed');
  }

  // ---------- Задания ----------
  questStats() {
    const m = this.mode;
    return {
      mode: this.modeId, loc: this.locId,
      dist: this.distance, speed: this.player.maxSpeedReached * KMH, near: this.nearMisses,
      jumps: this.jumps, over: this.jumpOverCount, fly: this.flyTime, batt: this.batteries,
      score: this.score, combo: this.maxCombo,
      cp: m.count || 0, caught: m.caughtCount || 0, oncoming: m.totalOn || 0,
    };
  }

  checkQuests() {
    if (this.ghostUsed) return;
    for (const d of quests.check(this.questStats())) {
      this.questsDone.push(d);
      this.ui.popup(t('questDone', { n: d.reward }), 'gold');
      this.audio.coin();
    }
  }

  finishRun(reason) {
    this.state = 'results';
    this.audio.setEngine(false);
    this.audio.setSiren(false);
    this.audio.setFly(0);
    this.ui.setHint(null);
    if (!this.ghostUsed && this.mode) {
      this.checkQuests();
      quests.saveBest(this.questStats());
    }
    const score = Math.floor(this.score);
    const coins = Math.floor(score / 10);
    storage.addCoins(coins);
    const isRecord = storage.addRecord(this.modeId, {
      score, date: Date.now(), car: this.carDef.id, loc: this.locId,
    });
    this.ui.showResults({
      reason, score, coins, isRecord,
      distance: this.distance,
      maxSpeed: Math.round(this.player.maxSpeedReached * KMH),
      nearMisses: this.nearMisses,
      jumps: this.jumps,
      flyTime: this.flyTime,
      best: storage.bestScore(this.modeId),
      extra: this.mode.extraResults(),
      quests: this.questsDone, ghostUsed: this.ghostUsed,
    });
  }

  updateCamera(dt) {
    const p = this.player, cam = this.camera;
    const ratio = Math.min(1, p.speed / 80);
    const k = 1 - Math.exp(-6 * dt);
    const fb = p.flyBlend; // 0 на земле, 1 в полёте — камера плавно поднимается и отдаляется
    const py = p.y || 0;
    cam.position.x += (p.x * 0.75 - cam.position.x) * k;
    cam.position.y += (3.3 + ratio * 0.5 + py * (0.6 + fb * 0.25) + fb * 2.2 - cam.position.y) * k;
    cam.position.z = p.z + 7.4 + ratio * 1.4 + fb * 3.5;
    const fov = 60 + ratio * 16;
    cam.fov += (fov - cam.fov) * k;
    cam.updateProjectionMatrix();
    this.camTarget.set(p.x * 0.85, 1.1 + py * 0.85, p.z - 12);
    cam.lookAt(this.camTarget);
    cam.rotateZ(-p.vx * 0.004);
    // Тряска: на большой скорости и при ударе
    const kmh = p.speed * KMH;
    let amp = kmh > 170 ? (kmh - 170) / 150 * 0.05 : 0;
    if (this.shake > 0) { amp += this.shake * 0.4; this.shake = Math.max(0, this.shake - dt * 1.2); }
    if (amp > 0) {
      cam.position.x += (Math.random() - 0.5) * amp;
      cam.position.y += (Math.random() - 0.5) * amp;
    }
  }

  // ---------- Гараж: отдельная маленькая сцена с вращающейся машиной ----------
  buildGarageScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x10142a);
    s.fog = new THREE.Fog(0x10142a, 14, 30);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.25, 40), new THREE.MeshPhongMaterial({ color: 0x252b48, shininess: 60 }));
    floor.position.y = -0.13;
    s.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.05, 6, 60), new THREE.MeshBasicMaterial({ color: 0xff3d6e }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    s.add(ring);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x151a33 }));
    ground.position.y = -0.26;
    s.add(ground);
    s.add(new THREE.HemisphereLight(0xc8d4ff, 0x30304a, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(5, 8, 6); s.add(key);
    const rim = new THREE.DirectionalLight(0xff6a9a, 1.0); rim.position.set(-6, 3, -6); s.add(rim);
    this.garageScene = s;
    this.garageCam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.garageCam.position.set(0, 2.6, 10);
    this.garageCam.lookAt(0, 0.7, 0);
    this.garagePivot = new THREE.Group();
    s.add(this.garagePivot);
    this.garageCache = {};
  }

  showGarageCar(carDef, color) {
    let entry = this.garageCache[carDef.id];
    if (!entry) {
      entry = buildVehicle(carDef.model, color, true);
      this.garageCache[carDef.id] = entry;
    }
    entry.bodyMat.color.setHex(color);
    this.garagePivot.clear();
    this.garagePivot.add(entry.group);
    this.garageEntry = entry;
    this.fitGarageCam();
  }

  fitGarageCam() {
    const entry = this.garageEntry;
    if (!entry) return;
    // Длинный тягач — отодвигаем камеру
    let far = Math.max(1, entry.length / 4.6);
    const aspect = this.garageCam.aspect || 1.5;
    if (aspect < 1.4) far *= Math.min(1.7, Math.sqrt(1.4 / aspect)); // узкий (портретный) экран — отодвигаем камеру
    this.garageCam.position.set(0, 2.4 * far, 9.5 * far);
    this.garageCam.lookAt(0, 0.3 + entry.height * 0.3, 0);
  }

  updateGarage(dt) {
    this.time += dt;
    this.garagePivot.rotation.y += dt * 0.5;
    if (this.garageEntry && this.garageEntry.lightbar) {
      const ph = Math.floor(this.time * 8) % 4;
      this.garageEntry.lightbar.red.color.setHex(ph % 2 === 0 ? 0xff2020 : 0x330000);
      this.garageEntry.lightbar.blue.color.setHex(ph % 2 === 1 ? 0x2a6bff : 0x000833);
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const gc = this.garageCam;
    gc.aspect = w / h;
    // Сдвигаем машину вправо (на широком экране) или вверх (на узком), чтобы не закрывала панель
    if (w > 600) gc.setViewOffset(w, h, -w * 0.18, 0, w, h);
    else gc.setViewOffset(w, h, 0, h * 0.2, w, h);
    gc.updateProjectionMatrix();
    this.fitGarageCam();
  }

  render(inGarage) {
    if (inGarage) this.renderer.render(this.garageScene, this.garageCam);
    else this.renderer.render(this.scene, this.camera);
  }
}
