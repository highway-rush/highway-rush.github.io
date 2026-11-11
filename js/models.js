// Все 3D-модели собираются в коде из простых фигур (low-poly).
// Чтобы было мало «draw calls», детали «запекаются» в одну геометрию с цветами вершин:
//   слой 'lit'  — обычные освещаемые детали (общий материал MeshLambert + vertexColors)
//   слой 'glow' — светящиеся детали: фары, окна ночью (MeshBasic, не зависит от света)
//   слой 'body' — кузов игрока (отдельный материал, чтобы менять цвет)
import * as THREE from 'three';

// ---------- Общие материалы ----------
export const MAT = {
  lit: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  blinker: new THREE.MeshBasicMaterial({ color: 0xffa000 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
};

// ---------- Кэш базовых геометрий ----------
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  cone12: new THREE.ConeGeometry(1, 1, 12),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodec: new THREE.DodecahedronGeometry(1, 0),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};
const nonIndexedCache = new Map();
function nonIndexed(geo) {
  let g = nonIndexedCache.get(geo.uuid);
  if (!g) { g = geo.index ? geo.toNonIndexed() : geo; nonIndexedCache.set(geo.uuid, g); }
  return g;
}

// Наклонная «трапеция» (для кабины со скошенными стёклами)
const taperCache = new Map();
function taperGeo(wb, wt, h, db, dt, zoff) {
  const key = [wb, wt, h, db, dt, zoff].join('|');
  if (taperCache.has(key)) return taperCache.get(key);
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    const x = p.getX(i) * (top ? wt : wb);
    const z = p.getZ(i) * (top ? dt : db) + (top ? zoff : 0);
    p.setXYZ(i, x, p.getY(i) * h, z);
  }
  g.computeVertexNormals();
  taperCache.set(key, g);
  return g;
}

// ---------- Builder: собирает детали и «запекает» их ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class Builder {
  constructor() { this.layers = {}; }

  add(geo, color, layer, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    (this.layers[layer] ||= []).push({ geo, color, matrix: _m.clone() });
    return this;
  }
  box(w, h, d, x, y, z, color, layer = 'lit', ry = 0, rx = 0, rz = 0) {
    return this.add(G.box, color, layer, x, y, z, w, h, d, rx, ry, rz);
  }
  // Цилиндр вдоль оси Y (r — радиус, h — высота)
  cyl(r, h, x, y, z, color, layer = 'lit', seg = 8, rx = 0, ry = 0, rz = 0) {
    const g = seg === 12 ? G.cyl12 : seg === 6 ? G.cyl6 : G.cyl8;
    return this.add(g, color, layer, x, y, z, r, h, r, rx, ry, rz);
  }
  cone(r, h, x, y, z, color, layer = 'lit', seg = 6, ry = 0) {
    const g = seg === 12 ? G.cone12 : seg === 8 ? G.cone8 : G.cone6;
    return this.add(g, color, layer, x, y, z, r, h, r, 0, ry, 0);
  }
  blob(geoName, sx, sy, sz, x, y, z, color, layer = 'lit', ry = 0) {
    return this.add(G[geoName], color, layer, x, y, z, sx, sy, sz, 0, ry, 0);
  }
  plane(w, d, x, y, z, color, layer = 'lit') {
    return this.add(G.plane, color, layer, x, y, z, w, 1, d);
  }
  taper(wb, wt, h, db, dt, zoff, x, y, z, color, layer = 'lit') {
    return this.add(taperGeo(wb, wt, h, db, dt, zoff), color, layer, x, y, z, 1, 1, 1);
  }

  // Вернуть BufferGeometry слоя (позиции, нормали, uv, цвета вершин)
  bake(layer) {
    const parts = this.layers[layer];
    if (!parts || !parts.length) return null;
    let total = 0;
    for (const p of parts) total += nonIndexed(p.geo).attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0;
    for (const p of parts) {
      const g = nonIndexed(p.geo);
      const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
      nm.getNormalMatrix(p.matrix);
      _c.set(p.color);
      for (let i = 0; i < gp.count; i++, o++) {
        v.fromBufferAttribute(gp, i).applyMatrix4(p.matrix);
        n.fromBufferAttribute(gn, i).applyMatrix3(nm).normalize();
        pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        nor[o * 3] = n.x; nor[o * 3 + 1] = n.y; nor[o * 3 + 2] = n.z;
        col[o * 3] = _c.r; col[o * 3 + 1] = _c.g; col[o * 3 + 2] = _c.b;
        if (gu) { uv[o * 2] = gu.getX(i); uv[o * 2 + 1] = gu.getY(i); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  // Собрать группу мешей: materials = { layer: material }
  toGroup(materials) {
    const group = new THREE.Group();
    for (const layer in this.layers) {
      const geo = this.bake(layer);
      if (!geo) continue;
      const mat = materials[layer] || MAT[layer] || MAT.lit;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = layer;
      group.add(mesh);
    }
    return group;
  }
}

// ---------- Текстура мягкого светового пятна (рисуется на canvas) ----------
let glowTex = null;
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// =====================================================================
//                              МАШИНЫ
// =====================================================================
const DARK = 0x1b1b1f, TRIM = 0x2b2c31, GLASS = 0x1c2a3d, TIRE = 0x141414, RIM = 0xb8bcc4;
const HEAD = 0xfff4cf, TAIL = 0xff1428, CHROME = 0xd8dde4;

// Параметры кузовов легковых машин
const SHAPES = {
  sedan:  { L: 4.5, W: 1.85, clear: 0.26, bodyH: 0.56, cabL: 2.3, cabTop: 1.45, cabH: 0.56, cabZ: 0.2, r: 0.34, fz: 1.4, rz: 1.35 },
  hatch:  { L: 3.9, W: 1.78, clear: 0.26, bodyH: 0.6, cabL: 2.2, cabTop: 1.75, cabH: 0.62, cabZ: 0.45, r: 0.33, fz: 1.25, rz: 1.2 },
  muscle: { L: 4.8, W: 1.96, clear: 0.25, bodyH: 0.62, cabL: 1.95, cabTop: 1.2, cabH: 0.48, cabZ: 0.45, r: 0.38, fz: 1.5, rz: 1.5, stripes: true, scoop: true },
  sport:  { L: 4.4, W: 1.96, clear: 0.18, bodyH: 0.5, cabL: 1.95, cabTop: 1.1, cabH: 0.45, cabZ: 0.25, r: 0.35, fz: 1.4, rz: 1.35, spoiler: 'small' },
  super:  { L: 4.6, W: 2.06, clear: 0.14, bodyH: 0.44, cabL: 2.05, cabTop: 0.95, cabH: 0.42, cabZ: 0.0, r: 0.36, fz: 1.5, rz: 1.45, spoiler: 'big', intakes: true },
  police: { L: 4.6, W: 1.88, clear: 0.27, bodyH: 0.58, cabL: 2.35, cabTop: 1.5, cabH: 0.57, cabZ: 0.2, r: 0.35, fz: 1.45, rz: 1.4, police: true },
};

function wheels(b, W, r, w, zs, clear = 0) {
  for (const z of zs) for (const s of [-1, 1]) {
    const x = s * (W / 2 - w / 2 + 0.04);
    b.cyl(r, w, x, r, z, TIRE, 'lit', 8, 0, 0, Math.PI / 2);
    b.cyl(r * 0.55, w + 0.04, x, r, z, RIM, 'lit', 6, 0, 0, Math.PI / 2);
  }
}

function lights(b, W, L, y, wHead = 0.42, gapEdge = 0.32) {
  for (const s of [-1, 1]) {
    b.box(wHead, 0.14, 0.06, s * (W / 2 - gapEdge), y, -L / 2 - 0.01, HEAD, 'glow');
    b.box(wHead, 0.14, 0.06, s * (W / 2 - gapEdge), y, L / 2 + 0.01, TAIL, 'glow');
  }
}

function blinkers(group, W, L, y) {
  // Поворотники: 2 меша (левые и правые), включаются/выключаются целиком
  const make = (side) => {
    const b = new Builder();
    for (const z of [-L / 2 - 0.02, L / 2 + 0.02]) b.box(0.16, 0.12, 0.05, side * (W / 2 - 0.06), y, z, 0xffffff, 'glow');
    const mesh = new THREE.Mesh(b.bake('glow'), MAT.blinker);
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  return { left: make(-1), right: make(1) };
}

function passengerCar(b, s, bodyLayer, color) {
  const { L, W, clear, bodyH } = s;
  const yb = clear + bodyH / 2;
  const top = clear + bodyH;
  // Кузов: низ + немного сужающийся верх (капот/багажник)
  b.box(W, bodyH * 0.7, L, 0, clear + bodyH * 0.35, 0, color, bodyLayer);
  b.taper(W, W * 0.94, bodyH * 0.3, L, L * 0.94, 0, 0, clear + bodyH * 0.85, 0, color, bodyLayer);
  // Кабина со стёклами + крыша
  const cw = W * 0.86;
  b.taper(cw, cw * 0.84, s.cabH, s.cabL, s.cabTop, 0.08, 0, top + s.cabH / 2, s.cabZ, GLASS);
  b.box(cw * 0.86, 0.07, s.cabTop * 0.96, 0, top + s.cabH + 0.02, s.cabZ + 0.08, color, bodyLayer);
  // Стойки между окнами
  b.box(cw * 0.86, s.cabH * 0.95, 0.12, 0, top + s.cabH / 2, s.cabZ + 0.08, color, bodyLayer);
  // Бамперы, решётка, зеркала, номер
  b.box(W + 0.04, 0.24, 0.22, 0, clear + 0.12, -L / 2 + 0.06, TRIM);
  b.box(W + 0.04, 0.24, 0.22, 0, clear + 0.12, L / 2 - 0.06, TRIM);
  b.box(W * 0.42, 0.16, 0.05, 0, yb + 0.05, -L / 2 - 0.02, DARK);
  b.box(0.5, 0.14, 0.04, 0, clear + 0.3, L / 2 + 0.02, 0xf2f2f2);
  for (const sd of [-1, 1]) b.box(0.18, 0.12, 0.1, sd * (W / 2 + 0.06), top + 0.08, s.cabZ - s.cabL / 2 + 0.15, color, bodyLayer);
  // Тёмные колёсные арки
  for (const z of [-s.fz, s.rz]) for (const sd of [-1, 1]) b.box(0.06, s.r * 1.2, s.r * 2.4, sd * (W / 2 + 0.005), clear + 0.18, z, DARK);
  wheels(b, W, s.r, 0.26, [-s.fz, s.rz]);
  lights(b, W, L, yb + 0.08);

  if (s.stripes) {
    for (const sd of [-0.18, 0.18]) {
      b.box(0.2, 0.02, L * 0.94, sd, top + 0.005, 0, 0xf4f4f4);
      b.box(0.2, 0.02, s.cabTop * 0.96, sd, top + s.cabH + 0.065, s.cabZ + 0.08, 0xf4f4f4);
    }
  }
  if (s.scoop) b.box(0.7, 0.14, 0.9, 0, top + 0.07, -L / 2 + 1.1, DARK);
  if (s.spoiler) {
    const big = s.spoiler === 'big';
    const wy = top + (big ? 0.42 : 0.2);
    for (const sd of [-0.55, 0.55]) b.box(0.08, wy - top, 0.12, sd, top + (wy - top) / 2, L / 2 - 0.3, DARK);
    b.box(W * (big ? 0.98 : 0.85), 0.06, big ? 0.42 : 0.3, 0, wy, L / 2 - 0.3, big ? DARK : color, big ? 'lit' : bodyLayer);
  }
  if (s.intakes) for (const sd of [-1, 1]) b.box(0.05, 0.22, 0.9, sd * (W / 2 + 0.01), clear + bodyH * 0.55, 0.5, DARK);
  if (s.police) {
    // Тёмные двери (двухцветная окраска) и «кенгурятник»
    for (const sd of [-1, 1]) b.box(0.04, bodyH * 0.55, s.cabL * 0.95, sd * (W / 2 + 0.01), clear + bodyH * 0.45, s.cabZ, 0x15161c);
    b.box(W * 0.7, 0.3, 0.08, 0, clear + 0.25, -L / 2 - 0.1, DARK);
    b.box(0.08, 0.06, 0.06, 0, top + s.cabH + 0.08, s.cabZ + 0.08, DARK);
  }
  return { L, W, H: top + s.cabH };
}

function pickupCar(b, bodyLayer, color) {
  const L = 5.3, W = 1.98, clear = 0.42, bodyH = 0.66, top = clear + bodyH;
  b.box(W, bodyH, 2.6, 0, clear + bodyH / 2, -L / 2 + 1.3, color, bodyLayer); // нос + кабина низ
  b.taper(W * 0.92, W * 0.86, 0.68, 1.75, 1.45, 0.05, 0, top + 0.34, -0.45, GLASS);
  b.box(W * 0.8, 0.07, 1.42, 0, top + 0.7, -0.4, color, bodyLayer);
  b.box(W * 0.86, 0.64, 0.1, 0, top + 0.32, -0.4, color, bodyLayer);
  // Кузов-платформа
  b.box(W, 0.32, 2.7, 0, clear + 0.16, L / 2 - 1.35, color, bodyLayer);
  for (const sd of [-1, 1]) b.box(0.1, 0.5, 2.7, sd * (W / 2 - 0.05), top - 0.05, L / 2 - 1.35, color, bodyLayer);
  b.box(W, 0.5, 0.1, 0, top - 0.05, L / 2 - 0.05, color, bodyLayer);
  b.box(W - 0.2, 0.05, 2.6, 0, clear + 0.34, L / 2 - 1.35, DARK);
  b.box(W + 0.06, 0.26, 0.22, 0, clear + 0.1, -L / 2 + 0.06, CHROME);
  b.box(W + 0.06, 0.2, 0.2, 0, clear + 0.08, L / 2 + 0.02, TRIM);
  b.box(W * 0.6, 0.3, 0.05, 0, clear + 0.4, -L / 2 - 0.02, CHROME);
  wheels(b, W, 0.42, 0.3, [-1.65, 1.6]);
  lights(b, W, L, clear + 0.45, 0.38, 0.3);
  return { L, W, H: top + 0.75 };
}

function truckTractor(b, bodyLayer, color) {
  const L = 6.6, W = 2.45;
  // Рама и бензобаки
  b.box(1.2, 0.35, L - 0.4, 0, 0.8, 0.1, DARK);
  for (const sd of [-1, 1]) b.cyl(0.32, 1.1, sd * 1.0, 0.75, 0.2, CHROME, 'lit', 8, Math.PI / 2, 0, 0);
  // Кабина
  const cz = -L / 2 + 1.25;
  b.box(W, 2.1, 2.5, 0, 1.05 + 1.05 + 0.2, cz, color, bodyLayer);
  b.box(W - 0.2, 0.9, 0.06, 0, 2.75, cz - 1.26, GLASS);
  for (const sd of [-1, 1]) b.box(0.06, 0.75, 1.0, sd * (W / 2 + 0.01), 2.75, cz - 0.6, GLASS);
  b.taper(W, W * 0.92, 0.55, 2.4, 1.6, 0.35, 0, 3.6, cz + 0.1, color, bodyLayer); // обтекатель
  b.box(W * 0.75, 0.9, 0.06, 0, 1.65, cz - 1.27, CHROME); // решётка
  b.box(W + 0.1, 0.35, 0.3, 0, 0.75, -L / 2 + 0.05, TRIM);
  for (const sd of [-1, 1]) {
    b.cyl(0.09, 2.2, sd * (W / 2 - 0.15), 2.6, cz + 1.35, CHROME, 'lit', 6); // выхлопные трубы
    b.box(0.08, 0.5, 0.25, sd * (W / 2 + 0.25), 2.6, cz - 0.9, DARK); // зеркала
  }
  // Седельное устройство
  b.box(1.4, 0.12, 1.4, 0, 1.05, L / 2 - 1.6, 0x3a3a3a);
  for (const sd of [-1, 1]) b.box(0.5, 0.5, 0.06, sd * 0.9, 0.9, L / 2 - 0.05, DARK);
  wheels(b, W, 0.52, 0.42, [-L / 2 + 1.25, L / 2 - 1.8, L / 2 - 0.7]);
  for (const sd of [-1, 1]) {
    b.box(0.42, 0.22, 0.06, sd * (W / 2 - 0.35), 1.15, -L / 2 - 0.02, HEAD, 'glow');
    b.box(0.3, 0.16, 0.06, sd * (W / 2 - 0.3), 0.9, L / 2 + 0.01, TAIL, 'glow');
    b.box(0.3, 0.08, 0.08, sd * 0.5, 3.92, cz - 0.8, 0xffb300, 'glow'); // огни на крыше
  }
  return { L, W, H: 3.9 };
}

function van(b, color) {
  const L = 5.0, W = 2.02, clear = 0.32, H = 2.15;
  b.box(W, H - 0.45, L - 0.9, 0, clear + (H - 0.45) / 2 + 0.45, 0.45, color);
  b.box(W, 0.9, 0.9, 0, clear + 0.45, -L / 2 + 0.45, color);
  b.box(W, 0.45, L - 0.9, 0, clear + 0.22, 0.45, color);
  b.taper(W, W * 0.97, H - 0.9, 0.9, 0.35, 0.28, 0, clear + 0.9 + (H - 0.9) / 2, -L / 2 + 0.9 + 0.05, GLASS);
  for (const sd of [-1, 1]) b.box(0.04, 0.55, 2.4, sd * (W / 2 + 0.01), clear + H - 0.55, -0.1, GLASS);
  b.box(W + 0.04, 0.24, 0.2, 0, clear + 0.1, -L / 2 + 0.05, TRIM);
  b.box(W + 0.04, 0.24, 0.2, 0, clear + 0.1, L / 2 - 0.05, TRIM);
  wheels(b, W, 0.36, 0.26, [-L / 2 + 1.0, L / 2 - 1.0]);
  lights(b, W, L, clear + 0.6, 0.36, 0.3);
  return { L, W, H: clear + H };
}

function boxTruck(b, color) {
  const L = 8.6, W = 2.42;
  b.box(1.1, 0.35, L - 0.6, 0, 0.75, 0, DARK);
  b.box(W, 1.9, 2.0, 0, 1.75, -L / 2 + 1.0, color);
  b.box(W - 0.2, 0.8, 0.06, 0, 2.15, -L / 2 - 0.01, GLASS);
  b.box(W, 2.8, 6.2, 0, 2.5, L / 2 - 3.1, 0xe9ebee);
  b.box(W + 0.02, 0.35, 6.0, 0, 1.5, L / 2 - 3.1, color);
  b.box(W + 0.1, 0.3, 0.3, 0, 0.7, -L / 2 + 0.05, TRIM);
  wheels(b, W, 0.5, 0.4, [-L / 2 + 1.1, L / 2 - 2.2, L / 2 - 1.1]);
  for (const sd of [-1, 1]) {
    b.box(0.38, 0.2, 0.06, sd * (W / 2 - 0.35), 1.15, -L / 2 - 0.02, HEAD, 'glow');
    b.box(0.3, 0.18, 0.06, sd * (W / 2 - 0.3), 1.2, L / 2 + 0.01, TAIL, 'glow');
  }
  return { L, W, H: 3.9 };
}

function bus(b, color) {
  const L = 11.5, W = 2.52, clear = 0.35, H = 2.95;
  b.box(W, H, L, 0, clear + H / 2, 0, color);
  for (const sd of [-1, 1]) b.box(0.04, 0.95, L - 2.4, sd * (W / 2 + 0.01), clear + 2.05, 0.4, GLASS);
  b.box(W - 0.2, 1.3, 0.06, 0, clear + 1.85, -L / 2 - 0.01, GLASS);
  b.box(W - 0.4, 0.6, 0.06, 0, clear + 2.3, L / 2 + 0.01, GLASS);
  b.box(W + 0.02, 0.18, L, 0, clear + 1.2, 0, 0xf6f6f6);
  b.box(W - 0.3, 0.12, 2.5, 0, clear + H + 0.06, 1.5, 0xd8d8d8);
  b.box(W + 0.04, 0.3, 0.2, 0, clear + 0.15, -L / 2 + 0.05, TRIM);
  wheels(b, W, 0.5, 0.36, [-L / 2 + 2.4, L / 2 - 2.6]);
  lights(b, W, L, clear + 0.55, 0.36, 0.35);
  b.box(1.4, 0.25, 0.06, 0, clear + H - 0.25, -L / 2 - 0.02, 0xffb000, 'glow'); // табло маршрута
  return { L, W, H: clear + H };
}

// Создать машину. type: sedan|hatch|muscle|sport|super|police|pickup|truck|van|boxtruck|bus
// separateBody=true — кузов отдельным материалом (для игрока / гаража).
export function buildVehicle(type, color, separateBody = false) {
  const b = new Builder();
  const bodyLayer = separateBody ? 'body' : 'lit';
  let dims;
  if (SHAPES[type]) dims = passengerCar(b, SHAPES[type], bodyLayer, color);
  else if (type === 'pickup') dims = pickupCar(b, bodyLayer, color);
  else if (type === 'truck') dims = truckTractor(b, bodyLayer, color);
  else if (type === 'van') dims = van(b, color);
  else if (type === 'boxtruck') dims = boxTruck(b, color);
  else dims = bus(b, color);

  const bodyMat = separateBody ? new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x555555 }) : null;
  const group = b.toGroup(bodyMat ? { body: bodyMat } : {});
  // Мягкая тень под машиной (дешевле настоящих теней)
  const sh = new THREE.Mesh(G.plane, MAT.shadow);
  sh.scale.set(dims.W * 1.15, 1, dims.L * 1.08);
  sh.position.y = 0.03;
  sh.renderOrder = -1;
  sh.name = 'blobShadow';
  group.add(sh);

  const bl = blinkers(group, dims.W, dims.L, type === 'truck' || type === 'boxtruck' || type === 'bus' ? 1.0 : 0.62);
  const result = { group, length: dims.L, width: dims.W, height: dims.H, bodyMat, blinkL: bl.left, blinkR: bl.right, lightbar: null };

  if (type === 'police') {
    // Мигалка: два отдельных материала, которые мигают красным/синим
    const s = SHAPES.police;
    const y = s.clear + s.bodyH + s.cabH + 0.16;
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const blue = new THREE.MeshBasicMaterial({ color: 0x0044ff });
    const geo = new THREE.BoxGeometry(0.55, 0.14, 0.3);
    const mr = new THREE.Mesh(geo, red); mr.position.set(-0.32, y, s.cabZ + 0.08);
    const mb = new THREE.Mesh(geo, blue); mb.position.set(0.32, y, s.cabZ + 0.08);
    group.add(mr, mb);
    result.lightbar = { red, blue };
  }
  return result;
}

// =====================================================================
//                              ДЕКОР
// =====================================================================
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const Deco = {
  palm(b, x, z, s = 1) {
    const lean = rnd(-0.15, 0.15);
    let px = x, py = 0;
    for (let i = 0; i < 5; i++) {
      const h = 1.3 * s;
      b.cyl(0.22 * s * (1 - i * 0.08), h, px, py + h / 2, z, i % 2 ? 0x8a6a43 : 0x7a5c38, 'lit', 6, 0, 0, lean);
      px -= Math.sin(lean) * h; py += Math.cos(lean) * h;
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.add(G.cone6, i % 2 ? 0x2f9a3e : 0x3fb24c, 'lit', px + Math.cos(a) * 1.3 * s, py - 0.25 * s, z + Math.sin(a) * 1.3 * s,
        0.45 * s, 2.8 * s, 0.18 * s, Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    }
    b.blob('ico0', 0.35 * s, 0.35 * s, 0.35 * s, px, py, z, 0x6b4a2a);
  },
  tree(b, x, z, s = 1, snow = false, colors = [0x3c8f3a, 0x2f7d34, 0x4ea446]) {
    b.cyl(0.22 * s, 2 * s, x, s, z, 0x6b4a2e, 'lit', 6);
    const c = snow ? 0xeef4fa : pick(colors);
    b.blob('ico0', 1.5 * s, 1.7 * s, 1.5 * s, x, 2.8 * s, z, c, 'lit', rnd(0, 3));
    b.blob('ico0', 1.0 * s, 1.1 * s, 1.0 * s, x + 0.5 * s, 3.8 * s, z - 0.2 * s, c, 'lit', rnd(0, 3));
  },
  pine(b, x, z, s = 1, snow = false) {
    b.cyl(0.18 * s, 1.2 * s, x, 0.6 * s, z, 0x5a3d25, 'lit', 6);
    const g = 0x1f5e36;
    for (let i = 0; i < 3; i++) {
      const r = (1.6 - i * 0.4) * s, y = (1.6 + i * 1.2) * s;
      b.cone(r, 1.9 * s, x, y, z, g, 'lit', 7);
      if (snow) b.cone(r * 0.75, 0.9 * s, x, y + 0.55 * s, z, 0xf2f7fc, 'lit', 7);
    }
  },
  rock(b, x, z, s = 1, color = 0x8d8a83) {
    b.blob('dodec', s * rnd(0.9, 1.4), s * rnd(0.5, 0.9), s * rnd(0.8, 1.3), x, s * 0.25, z, color, 'lit', rnd(0, 6));
  },
  bush(b, x, z, s = 1, color = 0x3c9a44) {
    b.blob('ico0', s, s * 0.7, s, x, s * 0.4, z, color, 'lit', rnd(0, 6));
    b.blob('ico0', s * 0.7, s * 0.55, s * 0.7, x + s * 0.7, s * 0.3, z + s * 0.3, color, 'lit', rnd(0, 6));
  },
  house(b, x, z, snow = false) {
    const w = rnd(6, 9), d = rnd(6, 8), h = rnd(3, 4.2);
    const wall = pick([0xc96b4b, 0xd9c19a, 0x8fa9bf, 0xb7795a, 0xe2d6c0]);
    b.box(w, h, d, x, h / 2, z, wall);
    // Двускатная крыша из двух наклонных плит
    const roof = snow ? 0xf4f8fc : pick([0x7a2f26, 0x4a4f5c, 0x6b3a22]);
    const a = 0.55;
    for (const sd of [-1, 1]) b.box(w / 2 / Math.cos(a) + 0.4, 0.25, d + 0.6, x + sd * w / 4, h + Math.tan(a) * w / 4, z, roof, 'lit', 0, 0, -sd * a);
    b.box(w * 0.98, Math.tan(a) * w / 2, 0.1, x, h + Math.tan(a) * w / 4 - 0.1, z + d / 2 - 0.05, wall);
    b.box(w * 0.98, Math.tan(a) * w / 2, 0.1, x, h + Math.tan(a) * w / 4 - 0.1, z - d / 2 + 0.05, wall);
    const winLayer = snow ? 'glow' : 'lit';
    const winColor = snow ? 0xffd27a : 0x2c3f57;
    const face = x > 0 ? x - w / 2 - 0.03 : x + w / 2 + 0.03;
    for (const dz of [-d / 4, d / 4]) b.box(0.06, 1.0, 1.1, face, h * 0.55, z + dz, winColor, winLayer);
    b.box(1.0, 1.2, 0.8, x + w * 0.25, h + 1.2, z, 0x6d6d6d); // труба
  },
  building(b, x, z, w, d, h, night = true) {
    const wall = pick([0x2a2f3d, 0x343b4f, 0x3d3448, 0x24303a, 0x403c38]);
    b.box(w, h, d, x, h / 2, z, wall);
    b.box(w + 0.4, 0.5, d + 0.4, x, h + 0.25, z, 0x1c1f28);
    // Окна на фасаде, который смотрит на дорогу
    const face = x > 0 ? x - w / 2 - 0.04 : x + w / 2 + 0.04;
    const rows = Math.floor((h - 3) / 3.2), cols = Math.floor(d / 3);
    const palette = [0xffd88a, 0xffe7b0, 0x9fd4ff, 0xffc061];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const lit = Math.random() < 0.45;
      if (!lit && Math.random() < 0.5) continue;
      b.box(0.08, 1.6, 1.6, face, 3 + r * 3.2, z - d / 2 + 1.5 + c * 3, lit ? pick(palette) : 0x161a24, lit && night ? 'glow' : 'lit');
    }
    if (Math.random() < 0.3) b.box(0.15, 1.2, d * 0.6, face, 1.6, z, pick([0xff3d6e, 0x20d6ff, 0xffb800]), 'glow'); // вывеска
    if (Math.random() < 0.4) b.box(0.3, 0.3, 0.3, x, h + 2, z, 0xff2020, 'glow'); // огонёк на крыше
    if (Math.random() < 0.4) b.cyl(0.08, 3, x, h + 1.5, z, 0x555555, 'lit', 6);
  },
  streetLamp(b, x, z) {
    const side = x > 0 ? -1 : 1;
    b.cyl(0.12, 8, x, 4, z, 0x4a4e57, 'lit', 6);
    b.box(2.2, 0.15, 0.2, x + side * 1.05, 8, z, 0x4a4e57);
    b.box(0.9, 0.12, 0.4, x + side * 2.0, 7.9, z, 0xfff1c4, 'glow');
  },
  yurt(b, x, z, s = 1) {
    b.cyl(3 * s, 2.2 * s, x, 1.1 * s, z, 0xf1ece0, 'lit', 12);
    b.cone(3.2 * s, 1.8 * s, x, 3.1 * s, z, 0xe6dfcf, 'lit', 12);
    b.cyl(0.6 * s, 0.25 * s, x, 4.05 * s, z, 0x8b5a2b, 'lit', 8);
    // Орнамент — красная и синяя полосы
    b.cyl(3.03 * s, 0.25 * s, x, 1.7 * s, z, 0xb3262e, 'lit', 12);
    b.cyl(3.04 * s, 0.12 * s, x, 0.4 * s, z, 0x1f5fae, 'lit', 12);
    // Дверь смотрит на дорогу
    const face = x > 0 ? -1 : 1;
    b.box(0.1, 1.5 * s, 1.1 * s, x + face * 3.0 * s, 0.75 * s, z, 0xc7832c);
  },
  // Опора ЛЭП + провода на всю длину участка (len)
  pylon(b, x, z, len) {
    const c = 0x6c7078;
    for (const sd of [-1, 1]) for (const fz of [-1, 1]) b.box(0.18, 16, 0.18, x + sd * 0.9, 8, z + fz * 0.9, c, 'lit', 0, fz * 0.06, -sd * 0.06);
    b.box(6, 0.2, 0.25, x, 13, z, c);
    b.box(4.5, 0.2, 0.25, x, 15.5, z, c);
    for (const [wx, wy] of [[-2.8, 12.7], [2.8, 12.7], [-2.1, 15.2], [2.1, 15.2]]) {
      b.box(0.05, 0.05, len, x + wx, wy, z - len / 2, 0x22252b);
    }
  },
  hill(b, x, z, s, color) {
    b.blob('ico1', s * rnd(1.5, 2.5), s * rnd(0.3, 0.5), s * rnd(1.2, 2), x, -s * 0.05, z, color, 'lit', rnd(0, 6));
  },
  grass(b, x, z, color = 0x4c9a3a) {
    for (let i = 0; i < 3; i++) b.cone(0.12, rnd(0.5, 0.9), x + rnd(-0.4, 0.4), 0.3, z + rnd(-0.4, 0.4), color, 'lit', 6);
  },
  snowbank(b, x, z, len) {
    b.blob('ico0', 1.2, 0.5, len / 2, x, 0.1, z, 0xf2f6fa);
  },
  guardrail(b, x, z0, len) {
    b.box(0.08, 0.32, len, x, 0.62, z0 - len / 2, 0xc9cfd6);
    for (let i = 0; i < len; i += 4) b.box(0.12, 0.7, 0.12, x + Math.sign(x) * 0.1, 0.35, z0 - i - 2, 0x7d838c);
  },
};

// Арка чекпоинта для режима «На время»
export function buildCheckpoint(width) {
  const b = new Builder();
  for (const sd of [-1, 1]) {
    b.box(0.6, 6, 0.6, sd * (width / 2 + 0.8), 3, 0, 0xffffff);
    b.box(0.7, 0.4, 0.7, sd * (width / 2 + 0.8), 0.2, 0, 0xff3d6e);
  }
  b.box(width + 2.2, 1.2, 0.4, 0, 6.2, 0, 0xffb800, 'glow');
  for (let i = 0; i < 8; i++) b.box(0.9, 1.2, 0.42, -width / 2 + i * (width / 7), 6.2, 0, i % 2 ? 0x111111 : 0xffffff, 'glow');
  return b.toGroup({});
}

// Освободить память машины (общие материалы и геометрии не трогаем)
export function disposeVehicle(v) {
  if (!v) return;
  v.group.traverse((m) => {
    if (m.isMesh && m.name !== 'blobShadow' && m.geometry) m.geometry.dispose();
  });
  if (v.bodyMat) v.bodyMat.dispose();
  if (v.lightbar) { v.lightbar.red.dispose(); v.lightbar.blue.dispose(); }
}

// Освободить память группы, «запечённой» Builder'ом
export function disposeGroup(g) {
  if (!g) return;
  g.traverse((m) => { if (m.isMesh && m.geometry) m.geometry.dispose(); });
}
