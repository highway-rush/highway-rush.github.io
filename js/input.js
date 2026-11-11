// Управление: клавиатура, сенсорные кнопки (мультитач), наклон телефона.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, horn: false };
    this.tiltEnabled = false;
    this.tiltValue = 0;
    this.hornPressed = false; // флаг «нажали гудок» (сбрасывается после чтения)
    this.onPause = null;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (this.isTouch) document.body.classList.add('touch');

    window.addEventListener('keydown', (e) => {
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k) && e.target.tagName !== 'INPUT') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'KeyH') this.hornPressed = true;
      if ((k === 'Escape' || k === 'KeyP') && this.onPause) this.onPause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseTouch(); });

    // Сенсорные кнопки. Pointer Events сами поддерживают несколько пальцев одновременно.
    document.querySelectorAll('[data-ctl]').forEach((btn) => {
      const ctl = btn.dataset.ctl;
      const pointers = new Set();
      const set = () => {
        const on = pointers.size > 0;
        this.touch[ctl] = on;
        btn.classList.toggle('pressed', on);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pointers.add(e.pointerId);
        try { btn.releasePointerCapture(e.pointerId); } catch (_) { /* для перехода пальца между кнопками */ }
        if (ctl === 'horn') this.hornPressed = true;
        set();
      });
      const up = (e) => { pointers.delete(e.pointerId); set(); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('pointerenter', (e) => { if (e.buttons || e.pointerType === 'touch') { pointers.add(e.pointerId); set(); } });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Запрет зума и прокрутки страницы
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.screen:not(#hud)')) e.preventDefault();
    }, { passive: false });

    this.onOrientation = (e) => {
      if (e.gamma == null) return;
      const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
      let v;
      if (angle === 90) v = e.beta;
      else if (angle === -90 || angle === 270) v = -e.beta;
      else v = e.gamma;
      this.tiltValue = Math.max(-1, Math.min(1, v / 22));
    };
  }

  releaseTouch() {
    for (const k in this.touch) this.touch[k] = false;
    document.querySelectorAll('[data-ctl].pressed').forEach((b) => b.classList.remove('pressed'));
  }

  // Включить наклон. На iPhone нужно разрешение — вызывать только из обработчика нажатия.
  async enableTilt(on) {
    if (!on) {
      this.tiltEnabled = false;
      window.removeEventListener('deviceorientation', this.onOrientation);
      document.body.classList.remove('tilt');
      return true;
    }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
    } catch (e) { return false; }
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.tiltEnabled = true;
    if (this.isTouch) document.body.classList.add('tilt');
    return true;
  }

  read() {
    const k = this.keys, t = this.touch;
    const left = k.has('ArrowLeft') || k.has('KeyA') || t.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || t.right;
    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    let analog = false;
    if (this.tiltEnabled && !left && !right) {
      const dz = 0.08;
      const v = this.tiltValue;
      steer = Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
      analog = true;
    }
    const horn = this.hornPressed;
    this.hornPressed = false;
    return {
      steer, analog,
      gas: k.has('ArrowUp') || k.has('KeyW') || t.gas,
      brake: k.has('ArrowDown') || k.has('KeyS') || k.has('Space') || t.brake,
      horn,
      hornHeld: k.has('KeyH') || t.horn,
    };
  }
}
