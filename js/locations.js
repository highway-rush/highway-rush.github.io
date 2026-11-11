// Локации: цвета, освещение, туман, погода, декор вдоль дороги.
import { Deco } from './models.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const side = () => (Math.random() < 0.5 ? -1 : 1);

// Каждая функция decorate(b, z0, len, edge) заполняет один участок дороги длиной len,
// начинающийся в z0 (участок идёт в сторону -Z). edge — расстояние от центра до обочины.
export const LOCATIONS = {
  highway: {
    icon: '🌴', cardColors: ['#4fb7ff', '#5bd06a'],
    sky: [0x3d8fe0, 0xbfe3ff], fog: 0xcfe8ff, fogNear: 60, fogFar: 330,
    ground: 0x5cae48, road: 0x3b3e45, shoulder: 0x8c8f96, line: 0xf4f4f4,
    hemi: [0xffffff, 0x4a7a3a, 1.1], sun: [0xfff2d6, 1.6], sunPos: [-40, 70, -30],
    sunDisc: 0xfff6c8, particles: null, grip: 1, night: false,
    decorate(b, z0, len, edge) {
      Deco.guardrail(b, -edge - 0.8, z0, len);
      Deco.guardrail(b, edge + 0.8, z0, len);
      for (let i = 0; i < 4; i++) {
        const s = side();
        Deco.palm(b, s * rnd(edge + 4, edge + 9), z0 - rnd(0, len), rnd(0.9, 1.3));
      }
      for (let i = 0; i < 3; i++) Deco.rock(b, side() * rnd(edge + 3, edge + 40), z0 - rnd(0, len), rnd(0.6, 2.2));
      for (let i = 0; i < 4; i++) Deco.bush(b, side() * rnd(edge + 3, edge + 30), z0 - rnd(0, len), rnd(0.6, 1.2));
      for (let i = 0; i < 6; i++) Deco.grass(b, side() * rnd(edge + 2, edge + 20), z0 - rnd(0, len));
      if (Math.random() < 0.5) Deco.palm(b, side() * rnd(edge + 15, edge + 40), z0 - rnd(0, len), rnd(1, 1.5));
      Deco.hill(b, side() * rnd(120, 180), z0 - rnd(0, len), rnd(25, 45), 0x4f9c3e);
    },
  },

  snow: {
    icon: '❄️', cardColors: ['#4f78a8', '#a9c8e8'],
    sky: [0x9fb3c8, 0xe3ebf2], fog: 0xdfe7ef, fogNear: 30, fogFar: 230,
    ground: 0xf1f5f9, road: 0x50555e, shoulder: 0xc7ced8, line: 0xe8eef4,
    hemi: [0xf2f6ff, 0x9aa7b8, 1.15], sun: [0xffffff, 0.8], sunPos: [-30, 60, -40],
    sunDisc: null, particles: 'snow', grip: 0.45, night: false,
    decorate(b, z0, len, edge) {
      Deco.guardrail(b, -edge - 0.8, z0, len);
      Deco.guardrail(b, edge + 0.8, z0, len);
      Deco.snowbank(b, -edge - 2.2, z0 - len / 2, len);
      Deco.snowbank(b, edge + 2.2, z0 - len / 2, len);
      for (let i = 0; i < 6; i++) Deco.pine(b, side() * rnd(edge + 5, edge + 45), z0 - rnd(0, len), rnd(0.9, 1.6), true);
      if (Math.random() < 0.6) Deco.house(b, side() * rnd(edge + 14, edge + 26), z0 - rnd(5, len - 5), true);
      for (let i = 0; i < 2; i++) Deco.tree(b, side() * rnd(edge + 6, edge + 30), z0 - rnd(0, len), rnd(0.8, 1.2), true);
      Deco.hill(b, side() * rnd(110, 170), z0 - rnd(0, len), rnd(30, 50), 0xf6f9fc);
    },
  },

  city: {
    icon: '🌃', cardColors: ['#14183a', '#ff3d9a'],
    sky: [0x05060f, 0x1c1838], fog: 0x14142a, fogNear: 40, fogFar: 260,
    ground: 0x2a2c33, road: 0x24262c, shoulder: 0x55585f, line: 0xd8d8d8,
    hemi: [0x5a64a0, 0x1a1a22, 0.55], sun: [0x8090ff, 0.35], sunPos: [30, 60, -20],
    sunDisc: null, particles: null, grip: 1, night: true, streetLamps: true,
    decorate(b, z0, len, edge) {
      // Тротуары
      for (const s of [-1, 1]) {
        b.box(5, 0.25, len, s * (edge + 3), 0.12, z0 - len / 2, 0x6b6e75);
        b.box(0.3, 0.3, len, s * (edge + 0.6), 0.15, z0 - len / 2, 0x9a9da4);
      }
      for (const s of [-1, 1]) {
        let z = z0 - rnd(0, 3);
        while (z > z0 - len + 4) {
          const d = rnd(9, 15);
          const w = rnd(10, 18);
          const h = Math.random() < 0.25 ? rnd(40, 70) : rnd(12, 32);
          Deco.building(b, s * (edge + 6 + w / 2 + rnd(0, 3)), z - d / 2, w, d, h, true);
          z -= d + rnd(1, 4);
        }
      }
      Deco.streetLamp(b, -edge - 1.2, z0 - 10);
      Deco.streetLamp(b, edge + 1.2, z0 - 30);
    },
    // Где на этом участке лежат световые пятна от фонарей (x, смещение по z)
    lampPools: (edge) => [[-edge + 1.0, -10], [edge - 1.0, -30]],
  },

  rain: {
    icon: '🌧️', cardColors: ['#3c4a5c', '#8aa0b8'],
    sky: [0x4b5866, 0x8796a6], fog: 0x76838f, fogNear: 15, fogFar: 170,
    ground: 0x3f6b3a, road: 0x2c2f35, shoulder: 0x6b6f76, line: 0xdcdcdc,
    hemi: [0xb8c4d0, 0x3a4a3a, 0.9], sun: [0xc8d4e0, 0.6], sunPos: [-20, 60, -30],
    sunDisc: null, particles: 'rain', grip: 0.75, night: false, wet: true, water: true,
    decorate(b, z0, len, edge) {
      Deco.guardrail(b, -edge - 0.8, z0, len);
      Deco.guardrail(b, edge + 0.8, z0, len);
      for (let i = 0; i < 5; i++) Deco.tree(b, -rnd(edge + 4, edge + 40), z0 - rnd(0, len), rnd(0.9, 1.4), false, [0x2d6b34, 0x245c2c, 0x3a7a3a]);
      for (let i = 0; i < 2; i++) Deco.pine(b, -rnd(edge + 6, edge + 35), z0 - rnd(0, len), rnd(1, 1.4));
      for (let i = 0; i < 3; i++) Deco.rock(b, edge + rnd(2.5, 7), z0 - rnd(0, len), rnd(0.5, 1.4), 0x6d6f73);
      for (let i = 0; i < 3; i++) Deco.bush(b, edge + rnd(3, 8), z0 - rnd(0, len), rnd(0.5, 0.9), 0x2f6b32);
      // Камыши у воды
      for (let i = 0; i < 4; i++) Deco.grass(b, edge + rnd(8, 11), z0 - rnd(0, len), 0x6b8a3a);
      Deco.hill(b, -rnd(110, 170), z0 - rnd(0, len), rnd(30, 50), 0x3d5e3a);
      Deco.hill(b, rnd(150, 220), z0 - rnd(0, len), rnd(40, 60), 0x4a5a52);
    },
  },

  steppe: {
    icon: '🏕️', cardColors: ['#ff8a3d', '#ffd36b'],
    sky: [0x3a3d7a, 0xff9a52], fog: 0xf0a070, fogNear: 60, fogFar: 340,
    ground: 0xc2a25e, road: 0x46454a, shoulder: 0x9a8a6a, line: 0xf2e8d8,
    hemi: [0xffd7a8, 0x7a5a3a, 1.0], sun: [0xffa860, 1.4], sunPos: [0, 18, -120],
    sunDisc: 0xffb070, particles: null, grip: 1, night: false,
    decorate(b, z0, len, edge) {
      Deco.pylon(b, edge + 22, z0, len);
      for (let i = 0; i < 10; i++) Deco.grass(b, side() * rnd(edge + 2, edge + 50), z0 - rnd(0, len), Math.random() < 0.5 ? 0xa89048 : 0x8a8a3a);
      if (Math.random() < 0.45) {
        const s = side();
        const x = s * rnd(edge + 35, edge + 70), z = z0 - rnd(5, len - 5);
        Deco.yurt(b, x, z, rnd(0.9, 1.2));
        if (Math.random() < 0.5) Deco.yurt(b, x + s * rnd(8, 12), z - rnd(-6, 6), rnd(0.7, 0.9));
      }
      for (let i = 0; i < 2; i++) Deco.rock(b, side() * rnd(edge + 4, edge + 60), z0 - rnd(0, len), rnd(0.4, 1.2), 0x9a8468);
      if (Math.random() < 0.3) Deco.bush(b, side() * rnd(edge + 6, edge + 40), z0 - rnd(0, len), rnd(0.5, 0.8), 0x7a7a3a);
      Deco.hill(b, side() * rnd(160, 260), z0 - rnd(0, len), rnd(25, 40), Math.random() < 0.5 ? 0xb08f52 : 0xa3884e);
    },
  },
};

export const LOCATION_IDS = ['highway', 'snow', 'city', 'rain', 'steppe'];
