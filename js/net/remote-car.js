// Машина соперника: модель в его окраске, ник над крышей, крылья, плавное движение по сетевым пакетам.
//
// Плавность: пакеты складываются в буфер; машина рисуется с задержкой ~100 мс между двумя соседними пакетами
// (интерполяция). Чтобы соперник не «отставал» на эту задержку, продольная позиция сдвигается вперёд по его скорости.
// Если пакеты пропали — короткая экстраполяция (до 300 мс), потом машина замирает.
import * as THREE from 'three';
import { buildVehicle, buildWings, disposeVehicle } from '../models.js';
import { carById } from '../cars.js';
import { t } from '../i18n.js';

export const INTERP_DELAY = 100;   // мс
const MAX_EXTRAP = 300;             // мс
export const FLAG = { JUMP: 1, FLY: 2, GLIDE: 4, PENALTY: 8, GHOST: 16, FINISHED: 32 };

// Масса для толчков: грузовик толкает сильнее
export const CAR_MASS = { sedan: 1, hatch: 0.9, pickup: 1.4, muscle: 1.15, truck: 2.2, police: 1.1, sport: 1, super: 1.05 };

// Отдельные копии материалов машины, чтобы её можно было сделать полупрозрачной, не трогая остальные
export function makeFadeable(group) {
  const copies = new Map();
  group.traverse((m) => {
    if (!m.isMesh || m.name === 'blobShadow') return;
    let c = copies.get(m.material);
    if (!c) { c = m.material.clone(); copies.set(m.material, c); }
    m.material = c;
  });
  const list = [...copies.values()];
  const base = list.map((m) => ({ t: m.transparent, o: m.opacity, dw: m.depthWrite }));
  let cur = 1;
  return {
    setOpacity(o) {
      if (o === cur) return;
      cur = o;
      list.forEach((m, i) => {
        const b = base[i];
        m.transparent = o < 1 ? true : b.t;
        m.opacity = b.o * o;
        m.depthWrite = o < 1 ? false : b.dw;
      });
    },
    dispose() { list.forEach((m) => m.dispose()); },
  };
}

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.4, 1.32, 1);
  sprite.renderOrder = 10;
  return {
    sprite,
    draw(name, color, sub) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 320, 96);
      ctx.font = '800 34px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      const w = Math.min(300, ctx.measureText(name).width + 62);
      const x0 = (320 - w) / 2;
      ctx.fillStyle = 'rgba(8,12,28,0.72)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, 8, w, 50, 25); else ctx.rect(x0, 8, w, 50);
      ctx.fill();
      ctx.fillStyle = hex(color);
      ctx.beginPath(); ctx.arc(x0 + 27, 33, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(name, x0 + 46, 34, w - 56);
      if (sub) {
        ctx.font = '800 24px system-ui, sans-serif';
        ctx.fillStyle = '#ff6a6a'; ctx.textAlign = 'center';
        ctx.fillText(sub, 160, 78, 300);
        ctx.textAlign = 'left';
      }
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); mat.dispose(); },
  };
}

export class RemoteCar {
  constructor(scene, uid, info, startX, shadows) {
    this.scene = scene;
    this.uid = uid;
    this.name = info.name;
    this.color = info.color;
    this.def = carById(info.car);
    this.mass = CAR_MASS[this.def.id] || 1;
    const v = buildVehicle(this.def.model, info.color, true);
    this.vehicle = v;
    this.length = v.length; this.width = v.width; this.height = v.height;
    v.group.traverse((m) => { if (m.isMesh && (m.name === 'lit' || m.name === 'body')) m.castShadow = !!shadows; });
    this.wings = buildWings(v.width, v.length, v.height);
    v.group.add(this.wings.group);
    this.fade = makeFadeable(v.group);
    this.shadow = v.group.getObjectByName('blobShadow');
    this.root = new THREE.Group();
    this.root.add(v.group);
    this.label = makeLabel();
    this.label.sprite.position.y = v.height + 1.3;
    this.root.add(this.label.sprite);
    this.labelSub = null;
    this.label.draw(this.name, this.color, null);
    scene.add(this.root);

    this.buf = [];
    this.lastT = 0;
    this.lastRecv = -1e9;    // локальное время последнего пакета (performance.now)
    this.x = startX; this.z = 0; this.y = 0; this.speed = 0; this.vx = 0; this.wing = 0; this.flags = 0;
    this.prevY = 0;
    this.hasData = false;
    this.gone = false;
    this.lost = false;
    this.sync();
  }

  get finished() { return !!(this.flags & FLAG.FINISHED); }
  get ghost() { return !!(this.flags & (FLAG.PENALTY | FLAG.GHOST)); }
  get dist() { return -this.z; }

  // Новый пакет состояния
  push(p, nowLocal) {
    if (!p || typeof p.t !== 'number' || p.t <= this.lastT) return;
    this.lastT = p.t;
    this.buf.push(p);
    if (this.buf.length > 40) this.buf.shift();
    this.lastRecv = nowLocal;
  }

  // Возраст последнего пакета, мс
  age(nowLocal) { return nowLocal - this.lastRecv; }

  update(dt, serverNow, nowLocal, time) {
    const b = this.buf;
    if (b.length) {
      const rt = serverNow - INTERP_DELAY;
      const last = b[b.length - 1];
      let x, z, y, s, vx, w, f, sampleT;
      if (rt <= b[0].t) {
        ({ x, z, y, s, v: vx, w, f } = b[0]); sampleT = b[0].t;
      } else if (rt >= last.t) {
        const ex = Math.min(rt - last.t, MAX_EXTRAP) / 1000;
        x = last.x + last.v * ex; z = last.z - last.s * ex; y = last.y; s = last.s; vx = last.v; w = last.w; f = last.f;
        sampleT = last.t + ex * 1000;
      } else {
        let i = b.length - 2;
        while (i > 0 && b[i].t > rt) i--;
        const a = b[i], c = b[i + 1];
        const k = (rt - a.t) / Math.max(1, c.t - a.t);
        x = a.x + (c.x - a.x) * k; z = a.z + (c.z - a.z) * k; y = a.y + (c.y - a.y) * k;
        s = a.s + (c.s - a.s) * k; vx = a.v + (c.v - a.v) * k; w = a.w + (c.w - a.w) * k; f = k < 0.5 ? a.f : c.f;
        sampleT = rt;
      }
      // Старые пакеты больше не нужны
      while (b.length > 2 && b[1].t < rt - 200) b.shift();
      // Компенсация задержки по направлению движения: ставим соперника туда, где он сейчас
      const lead = Math.max(0, Math.min(0.6, (serverNow - sampleT) / 1000));
      const tz = z - s * lead;
      const tx = Math.max(-9, Math.min(9, x + vx * Math.min(lead, 0.12)));
      if (!this.hasData || Math.abs(tz - this.z) > 30) {
        this.x = tx; this.z = tz; this.hasData = true;
      } else {
        // Движение по скорости + мягкая подтяжка к цели: без рывков и без отставания
        this.z -= this.speed * dt; this.x += this.vx * dt;
        const kk = 1 - Math.exp(-10 * dt);
        this.z += (tz - this.z) * kk; this.x += (tx - this.x) * kk;
      }
      this.speed = s; this.vx = vx; this.y = Math.max(0, y); this.wing = w / 100; this.flags = f;
    }
    this.lost = this.hasData && this.age(nowLocal) > 5000;
    this.sync(dt, time);
  }

  sync(dt = 0, time = 0) {
    const g = this.vehicle.group;
    this.root.position.set(this.x, this.y, this.z);
    // Наклоны кузова как у своей машины
    const flying = !!(this.flags & (FLAG.FLY | FLAG.GLIDE));
    const vy = dt > 0 ? (this.y - this.prevY) / dt : 0;
    this.prevY = this.y;
    const k = Math.min(1, 8 * dt);
    g.rotation.y += (-this.vx * 0.025 - g.rotation.y) * k;
    g.rotation.z += ((flying ? -this.vx * 0.035 : -this.vx * 0.006) - g.rotation.z) * k;
    const pitch = this.y > 0.05 ? Math.max(-0.2, Math.min(0.22, vy * 0.02)) : 0;
    g.rotation.x += (pitch - g.rotation.x) * k;
    this.wings.update(this.wing, time, !!(this.flags & FLAG.FLY));
    // Тень остаётся на дороге
    if (this.shadow) {
      this.shadow.position.y = 0.03 - this.y;
      const s = 1 / (1 + this.y * 0.08);
      this.shadow.scale.set(this.width * 1.15 * s, 1, this.length * 1.08 * s);
    }
    // Штраф — мигает, неуязвимость — полупрозрачная
    const pen = this.flags & FLAG.PENALTY;
    g.visible = !pen || Math.floor(time * 10) % 2 === 0;
    this.fade.setOpacity(this.flags & (FLAG.GHOST | FLAG.PENALTY) || this.lost ? 0.45 : 1);
    const sub = this.lost ? 'noConn' : null;
    if (sub !== this.labelSub) { this.labelSub = sub; this.label.draw(this.name, this.color, sub ? t('noConn') : null); }
  }

  setGone() {
    this.gone = true;
    this.root.visible = false;
  }

  dispose() {
    this.scene.remove(this.root);
    this.wings.dispose();
    this.fade.dispose();
    this.label.dispose();
    disposeVehicle(this.vehicle);
  }
}
