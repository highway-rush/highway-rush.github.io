// Мир: бесконечная дорога из переиспользуемых участков, небо, свет, земля, погода.
import * as THREE from 'three';
import { Builder, MAT, getGlowTexture } from './models.js';
import { LOCATIONS } from './locations.js';

export const LANE_W = 3.6;
export const ROAD_HALF = LANE_W * 2;     // 4 полосы
export const SHOULDER = 1.3;
export const SEG_LEN = 40;
export const EDGE = ROAD_HALF + SHOULDER; // край асфальта

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.segments = [];
    this.active = [];
    this.spare = [];
    this.particles = null;
    this.locId = null;
    this.disposables = [];
  }

  clear() {
    this.root.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.segments = []; this.active = []; this.spare = [];
    this.particles = null;
  }

  build(locId, twoWay, quality) {
    this.clear();
    const loc = LOCATIONS[locId];
    this.loc = loc; this.locId = locId; this.twoWay = twoWay; this.quality = quality;
    const high = quality === 'high';
    const scene = this.scene;

    // Туман и дальность прорисовки
    const farMul = high ? 1 : 0.72;
    this.fogFar = loc.fogFar * farMul;
    scene.fog = new THREE.Fog(loc.fog, loc.fogNear * farMul, this.fogFar);
    scene.background = new THREE.Color(loc.sky[1]);

    // Небо: большая сфера с градиентом
    const skyGeo = new THREE.SphereGeometry(500, 20, 12);
    const top = new THREE.Color(loc.sky[0]), hor = new THREE.Color(loc.sky[1]), c = new THREE.Color();
    const cols = [];
    const p = skyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(0, p.getY(i) / 500);
      c.copy(hor).lerp(top, Math.pow(k, 0.6));
      cols.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -10;
    this.root.add(this.sky);
    this.disposables.push(skyGeo, skyMat);

    if (loc.sunDisc) {
      const sg = new THREE.CircleGeometry(loc.night ? 10 : 24, 24);
      const sm = new THREE.MeshBasicMaterial({ color: loc.sunDisc, fog: false, depthWrite: false });
      this.sun = new THREE.Mesh(sg, sm);
      this.sun.renderOrder = -9;
      this.sunDir = new THREE.Vector3(...loc.sunPos).normalize();
      this.root.add(this.sun);
      this.disposables.push(sg, sm);
    } else this.sun = null;

    // Свет
    this.hemi = new THREE.HemisphereLight(loc.hemi[0], loc.hemi[1], loc.hemi[2]);
    this.dir = new THREE.DirectionalLight(loc.sun[0], loc.sun[1]);
    this.sunOffset = new THREE.Vector3(...loc.sunPos).normalize().multiplyScalar(60);
    if (this.sunOffset.y < 30) this.sunOffset.y = 30;
    this.dir.castShadow = high;
    if (high) {
      this.dir.shadow.mapSize.set(1024, 1024);
      const sc = this.dir.shadow.camera;
      sc.left = -22; sc.right = 22; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 160;
      this.dir.shadow.bias = -0.0008;
    }
    this.root.add(this.hemi, this.dir, this.dir.target);

    // Земля (одна большая плоскость, едет вместе с игроком)
    const gg = new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2);
    const gm = new THREE.MeshLambertMaterial({ color: loc.ground });
    this.ground = new THREE.Mesh(gg, gm);
    this.ground.position.y = -0.06;
    this.root.add(this.ground);
    this.disposables.push(gg, gm);

    if (loc.water) {
      const wg = new THREE.PlaneGeometry(500, 1400).rotateX(-Math.PI / 2);
      const wm = new THREE.MeshPhongMaterial({ color: 0x2f4f63, shininess: 120, specular: 0x8899aa });
      this.water = new THREE.Mesh(wg, wm);
      this.water.position.set(EDGE + 12 + 250, -0.02, 0);
      this.root.add(this.water);
      this.disposables.push(wg, wm);
    } else this.water = null;

    // Материал дороги (на дожде — с бликами)
    this.roadMat = loc.wet
      ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x777777 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(this.roadMat);
    this.roadGeo = this.buildRoadGeometry(loc, twoWay);
    this.disposables.push(this.roadGeo);

    // Световые пятна от фонарей
    if (loc.lampPools) {
      this.poolMat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: 0xffcf7a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      this.poolGeo = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
      this.disposables.push(this.poolMat, this.poolGeo);
    }

    // Участки дороги: видимые + запасные «варианты» для разнообразия
    const visible = Math.ceil((this.fogFar + 60) / SEG_LEN) + 1;
    const variants = visible + (high ? 5 : 3);
    this.canMirror = !loc.water && locId !== 'steppe';
    for (let i = 0; i < variants; i++) {
      const seg = this.buildSegment(loc, high);
      this.segments.push(seg);
      this.spare.push(seg);
    }
    for (let i = 0; i < visible; i++) this.placeNext(30 - i * SEG_LEN);

    // Погода
    if (loc.particles) this.buildParticles(loc.particles, high);
  }

  buildRoadGeometry(loc, twoWay) {
    const b = new Builder();
    const L = SEG_LEN;
    b.plane(EDGE * 2, L, 0, 0, -L / 2, loc.road, 'road');
    for (const s of [-1, 1]) {
      b.plane(SHOULDER, L, s * (ROAD_HALF + SHOULDER / 2), 0.004, -L / 2, loc.shoulder, 'road');
      b.box(0.18, 0.02, L, s * (ROAD_HALF - 0.15), 0.01, -L / 2, loc.line, 'road');
    }
    if (twoWay) {
      for (const s of [-0.15, 0.15]) b.box(0.13, 0.02, L, s, 0.01, -L / 2, 0xffc21a, 'road');
      for (const x of [-LANE_W, LANE_W]) for (let z = 0; z < L; z += 10) b.box(0.14, 0.02, 4, x, 0.01, -z - 2, loc.line, 'road');
    } else {
      for (const x of [-LANE_W, 0, LANE_W]) for (let z = 0; z < L; z += 10) b.box(0.14, 0.02, 4, x, 0.01, -z - 2, loc.line, 'road');
    }
    return b.bake('road');
  }

  buildSegment(loc, high) {
    const b = new Builder();
    loc.decorate(b, 0, SEG_LEN, EDGE);
    const group = b.toGroup({});
    group.children.forEach((m) => { this.disposables.push(m.geometry); });
    const road = new THREE.Mesh(this.roadGeo, this.roadMat);
    road.receiveShadow = high;
    group.add(road);
    if (loc.lampPools) {
      for (const [x, z] of loc.lampPools(EDGE)) {
        const pm = new THREE.Mesh(this.poolGeo, this.poolMat);
        pm.position.set(x, 0.04, z);
        group.add(pm);
      }
    }
    group.visible = false;
    this.root.add(group);
    return { group, z0: 0 };
  }

  // Расставить участки заново вокруг точки focusZ (новый заезд в том же мире)
  resetPosition(focusZ) {
    for (const s of this.active) { s.group.visible = false; this.spare.push(s); }
    this.active = [];
    const visible = Math.ceil((this.fogFar + 60) / SEG_LEN) + 1;
    for (let i = 0; i < visible; i++) this.placeNext(focusZ + 30 - i * SEG_LEN);
  }

  placeNext(z0) {
    const i = (Math.random() * this.spare.length) | 0;
    const seg = this.spare.splice(i, 1)[0];
    seg.z0 = z0;
    seg.group.position.z = z0;
    seg.group.scale.x = this.canMirror && Math.random() < 0.5 ? -1 : 1;
    seg.group.visible = true;
    this.active.push(seg);
  }

  buildParticles(kind, high) {
    const count = kind === 'snow' ? (high ? 1600 : 700) : (high ? 1100 : 500);
    this.pBox = { w: 70, h: 28, z0: -90, z1: 12 };
    const pos = new Float32Array(count * (kind === 'rain' ? 6 : 3));
    const base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      base[i * 3] = (Math.random() - 0.5) * this.pBox.w;
      base[i * 3 + 1] = Math.random() * this.pBox.h;
      base[i * 3 + 2] = this.pBox.z0 + Math.random() * (this.pBox.z1 - this.pBox.z0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    let obj, mat;
    if (kind === 'snow') {
      mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, map: getGlowTexture(), transparent: true, depthWrite: false });
      obj = new THREE.Points(geo, mat);
    } else {
      mat = new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0.55 });
      obj = new THREE.LineSegments(geo, mat);
    }
    obj.frustumCulled = false;
    this.root.add(obj);
    this.disposables.push(geo, mat);
    this.particles = { kind, obj, base, pos, count, t: 0 };
  }

  update(dt, focusZ, speed, camera) {
    // Переработка участков: те, что остались позади, уходят вперёд
    while (this.active.length && this.active[0].z0 - SEG_LEN > focusZ + 40) {
      const old = this.active.shift();
      old.group.visible = false;
      this.spare.push(old);
      const last = this.active[this.active.length - 1];
      this.placeNext(last.z0 - SEG_LEN);
    }
    const snapZ = Math.round(focusZ / 50) * 50;
    this.ground.position.z = snapZ;
    if (this.water) this.water.position.z = snapZ;
    this.sky.position.copy(camera.position);
    if (this.sun) {
      this.sun.position.copy(camera.position).addScaledVector(this.sunDir, 420);
      this.sun.lookAt(camera.position);
    }
    this.dir.position.set(this.sunOffset.x, this.sunOffset.y, focusZ + this.sunOffset.z);
    this.dir.target.position.set(0, 0, focusZ - 10);

    // Погода
    const P = this.particles;
    if (P) {
      P.t += dt;
      const { base, pos, count } = P;
      const box = this.pBox;
      const fall = P.kind === 'snow' ? 3 : 24;
      for (let i = 0; i < count; i++) {
        let x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        y -= fall * dt;
        z += speed * dt;
        if (P.kind === 'snow') x += Math.sin(P.t * 1.3 + i) * 0.6 * dt;
        if (y < 0) { y += box.h; }
        if (z > box.z1) { z -= box.z1 - box.z0; x = (Math.random() - 0.5) * box.w; }
        base[i * 3] = x; base[i * 3 + 1] = y; base[i * 3 + 2] = z;
        if (P.kind === 'snow') {
          pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        } else {
          const len = 0.6 + speed * 0.012;
          pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
          pos[i * 6 + 3] = x; pos[i * 6 + 4] = y + len; pos[i * 6 + 5] = z - len * speed * 0.02;
        }
      }
      P.obj.geometry.attributes.position.needsUpdate = true;
      P.obj.position.set(0, 0, focusZ);
    }
  }
}
