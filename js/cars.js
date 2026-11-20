// Машины гаража. Характеристики 1..10 переводятся в физику в player.js.
export const CARS = [
  { id: 'sedan',  model: 'sedan',  price: 0,     color: 0xff4fa3, speed: 4, accel: 4, handling: 5, braking: 5 },
  { id: 'hatch',  model: 'hatch',  price: 1500,  color: 0xffc21a, speed: 4, accel: 6, handling: 7, braking: 6 },
  { id: 'pickup', model: 'pickup', price: 3000,  color: 0x4f6b3a, speed: 5, accel: 5, handling: 4, braking: 5 },
  { id: 'muscle', model: 'muscle', price: 5000,  color: 0xe8322e, speed: 7, accel: 8, handling: 4, braking: 5 },
  { id: 'truck',  model: 'truck',  price: 6500,  color: 0x2457b8, speed: 5, accel: 3, handling: 3, braking: 4 },
  { id: 'police', model: 'police', price: 8000,  color: 0xf4f6f8, speed: 7, accel: 7, handling: 7, braking: 7 },
  { id: 'sport',  model: 'sport',  price: 12000, color: 0xff6a00, speed: 8, accel: 8, handling: 8, braking: 8 },
  { id: 'super',  model: 'super',  price: 20000, color: 0x8be000, speed: 10, accel: 10, handling: 9, braking: 9 },
];

export const PAINTS = [0xf4f6f8, 0x1d1f24, 0xe8322e, 0xff6a00, 0xffc21a, 0x8be000, 0x1fb86a, 0x20c4e8, 0x2f7cf6, 0x6a3df0, 0xff4fa3, 0x8a8f99];
export const PAINT_PRICE = 200;

export function carById(id) { return CARS.find((c) => c.id === id) || CARS[0]; }

// Перевод «звёздочек» в физические величины
export function carPhysics(car) {
  return {
    maxSpeed: (150 + car.speed * 16) / 3.6,      // м/с: 214..310 км/ч
    accel: 4 + car.accel * 0.9,                    // м/с²
    brake: 12 + car.braking * 2.2,                 // м/с²
    steer: 7 + car.handling * 0.9,                 // боковая скорость, м/с
    grip: 5 + car.handling * 0.8,                  // насколько быстро машина «слушается» руля
  };
}
