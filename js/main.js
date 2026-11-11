// Точка входа: создаём рендерер, модули и запускаем игровой цикл.
import * as THREE from 'three';
import * as storage from './storage.js';
import { setLang, detectLang } from './i18n.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const save = storage.load();
setLang(save.settings.lang || detectLang());

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').prepend(renderer.domElement);

const audio = new Audio();
audio.setVolumes(save.settings.music, save.settings.sfx);
const input = new Input();
const ui = new UI(audio, input);
const game = new Game(renderer, ui, audio, input);
ui.setGame(game);
game.applyQuality();
input.onPause = () => {
  if (game.state === 'playing') game.pause();
  else if (game.state === 'paused' && ui.current === 'pause') game.resume();
};
// Наклон включался раньше — на Android включаем сразу; на iPhone нужно нажать в настройках ещё раз
if (save.settings.tilt && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') {
  input.enableTilt(true);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  game.resize(w, h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// Пауза, когда вкладка скрыта
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.pause();
    audio.suspend();
  } else {
    audio.resume();
  }
});

game.startDemo('highway');
ui.show('menu');

// Игровой цикл
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20); // защита от рывков после паузы
  const inGarage = ui.current === 'garage';
  if (inGarage) game.updateGarage(dt);
  else game.update(dt);
  game.render(inGarage);
  // Для отладки: window.__fps
  fpsT += dt; fpsN++;
  if (fpsT >= 1) { window.__fps = fpsN; fpsT = 0; fpsN = 0; }
});

window.__game = game; // удобно для проверки из консоли
