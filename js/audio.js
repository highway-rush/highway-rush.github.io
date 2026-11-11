// Весь звук синтезируется Web Audio API — без аудиофайлов.
// Мотор, гудок, удар, «впритык», сирена, монетки и тихая фоновая музыка.

export class Audio {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.5;
    this.sfxVol = 0.8;
    this.engineOn = false;
    this.sirenOn = false;
  }

  // Вызывать из обработчика нажатия (iPhone разрешает звук только после жеста пользователя)
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.applyVolumes();
      this.noiseBuf = this.makeNoise();
      this.buildEngine();
      this.buildSiren();
      this.startMusic();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes(music, sfx) {
    this.musicVol = music / 100;
    this.sfxVol = sfx / 100;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(this.musicVol * 0.35, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxVol, t, 0.05);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  makeNoise() {
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- Мотор ----------
  buildEngine() {
    const c = this.ctx;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 4;
    this.osc1 = c.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = c.createOscillator(); this.osc2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    // Шум ветра/шин
    this.wind = c.createBufferSource(); this.wind.buffer = this.noiseBuf; this.wind.loop = true;
    this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 800;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    this.osc1.start(); this.osc2.start(); this.wind.start();
  }

  // ratio — доля от макс. скорости (0..1), throttle — нажат ли газ
  setEngine(on, ratio = 0, throttle = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Имитация передач: тон растёт внутри передачи и падает при переключении
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(ratio * gears));
    const inGear = ratio * gears - g;
    const rpm = 0.25 + inGear * 0.75;
    const f = 45 + g * 8 + rpm * 85;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5 + 1, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(350 + rpm * 900 + (throttle ? 500 : 0), t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? (throttle ? 0.2 : 0.12) : 0, t, 0.1);
    this.windGain.gain.setTargetAtTime(on ? ratio * 0.12 : 0, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(500 + ratio * 1500, t, 0.2);
  }

  // ---------- Сирена ----------
  buildSiren() {
    const c = this.ctx;
    this.sirOsc = c.createOscillator(); this.sirOsc.type = 'square';
    this.sirOsc.frequency.value = 900;
    this.sirLfo = c.createOscillator(); this.sirLfo.frequency.value = 0.45;
    const lfoGain = c.createGain(); lfoGain.gain.value = 380;
    this.sirLfo.connect(lfoGain).connect(this.sirOsc.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    this.sirGain = c.createGain(); this.sirGain.gain.value = 0;
    this.sirOsc.connect(f).connect(this.sirGain).connect(this.sfx);
    this.sirOsc.start(); this.sirLfo.start();
  }

  setSiren(on) {
    if (!this.ctx) return;
    this.sirenOn = on;
    this.sirGain.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 0.1);
  }

  // ---------- Короткие эффекты ----------
  tone(type, freq, dur, vol, freqEnd, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, vol, filterType, f0, f1, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t); s.stop(t + dur + 0.05);
  }

  horn() {
    if (!this.ctx) return;
    this.tone('square', 392, 0.45, 0.12);
    this.tone('square', 494, 0.45, 0.1);
  }
  crash() {
    this.noise(0.9, 0.9, 'lowpass', 3000, 200);
    this.tone('sine', 120, 0.5, 0.6, 40);
    this.noise(0.4, 0.4, 'highpass', 4000, 0, 0.08);
    for (let i = 0; i < 4; i++) this.tone('triangle', 1800 + Math.random() * 2500, 0.12, 0.05, 0, 0.1 + i * 0.07);
  }
  nearMiss() {
    this.noise(0.35, 0.35, 'bandpass', 600, 3500);
    this.tone('sine', 880, 0.15, 0.08, 1320, 0.05);
  }
  scrape() { this.noise(0.25, 0.25, 'bandpass', 2500, 1200); }
  coin() { this.tone('square', 988, 0.08, 0.06); this.tone('square', 1319, 0.2, 0.06, 0, 0.07); }
  click() { this.tone('triangle', 660, 0.06, 0.08); }
  checkpoint() { [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, 0.18, 0.12, 0, i * 0.08)); }
  caught() { [784, 988, 1175, 1568].forEach((f, i) => this.tone('square', f, 0.14, 0.07, 0, i * 0.07)); }
  warn() { this.tone('square', 880, 0.08, 0.05); }

  // ---------- Фоновая музыка (простой синтвейв-луп) ----------
  startMusic() {
    const c = this.ctx;
    this.bpm = 104;
    this.step = 0;
    this.nextTime = c.currentTime + 0.1;
    const A = 220;
    const n = (semi) => A * Math.pow(2, semi / 12);
    // Am – F – C – G
    this.chords = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]].map((ch) => ch.map(n));
    this.bass = [0, -4, 3, -2].map((s) => n(s - 24));
    this.lead = [12, 15, 19, 15, 12, 10, 7, 10, 8, 12, 15, 12, 10, 14, 17, 14].map(n);
    this.timer = setInterval(() => this.schedule(), 50);
  }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const spb = 60 / this.bpm / 2; // восьмые
    while (this.nextTime < c.currentTime + 0.25) {
      const s = this.step, t = this.nextTime;
      const bar = Math.floor(s / 8) % 4;
      if (s % 8 === 0) this.chords[bar].forEach((f) => this.mNote('sawtooth', f, spb * 7.5, 0.035, t, 900));
      if (s % 2 === 0) this.mNote('triangle', this.bass[bar], spb * 1.6, 0.22, t, 500);
      if (s % 4 === 2) this.mNoise(t, 0.05, 6000);
      if (s % 8 === 4) this.mNoise(t, 0.12, 1800);
      if (s % 2 === 1 && Math.floor(s / 32) % 2 === 1) this.mNote('square', this.lead[(s >> 1) % 16], spb * 0.9, 0.03, t, 2400);
      this.nextTime += spb;
      this.step++;
    }
  }

  mNote(type, freq, dur, vol, t, cutoff) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  mNoise(t, vol, freq) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    s.connect(f).connect(g).connect(this.music);
    s.start(t, Math.random()); s.stop(t + 0.1);
  }
}
