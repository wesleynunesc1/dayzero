import type { SoundName } from '../world/World';

/**
 * Áudio sintetizado com WebAudio (sem arquivos externos — assets provisórios).
 * Volume e panorâmica dependem da posição relativa ao ouvinte.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambient: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private radio: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private heart = 0;
  enabled = true;
  volume = 0.7;
  private lastPlay = new Map<string, number>();

  /** Precisa ser chamado após um gesto do usuário (política dos navegadores). */
  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
    } catch {
      this.enabled = false;
    }
  }

  private startAmbient() {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    this.ambient = { src, gain: g };
  }

  setRadio(on: boolean) {
    if (!this.ctx || !this.master) return;
    if (on && !this.radio) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400;
      f.Q.value = 0.8;
      const g = c.createGain();
      g.gain.value = 0.035;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this.radio = { src, gain: g };
    } else if (!on && this.radio) {
      this.radio.src.stop();
      this.radio = null;
    }
  }

  private engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private rainLoop: { gain: GainNode } | null = null;

  /** Ronco contínuo do motor (rpm 0..1), 0 = desligado. */
  setEngine(on: boolean, rpm: number) {
    if (!this.ctx || !this.master) return;
    if (on && !this.engine) {
      const c = this.ctx;
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start();
      this.engine = { osc, gain, filter };
    }
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(38 + rpm * 70, t, 0.1);
    this.engine.filter.frequency.setTargetAtTime(300 + rpm * 700, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(on ? 0.05 + rpm * 0.06 : 0, t, 0.15);
    if (!on && this.engine.gain.gain.value < 0.003) {
      this.engine.osc.stop();
      this.engine = null;
    }
  }

  /** Chiado da chuva (0..1). */
  setRain(k: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    if (k > 0.01 && !this.rainLoop) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1200;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this.rainLoop = { gain: g };
    }
    if (this.rainLoop) this.rainLoop.gain.gain.setTargetAtTime(k * 0.07, this.ctx.currentTime, 0.5);
  }

  setMuted(m: boolean) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** Batimentos cardíacos quando a vida está baixa. */
  updateHeart(dt: number, hpFrac: number) {
    if (!this.ctx || hpFrac > 0.35) return;
    this.heart -= dt;
    if (this.heart <= 0) {
      this.heart = 0.55 + hpFrac * 1.4;
      this.tone(55, 0.12, 0.25, 'sine', 0);
      setTimeout(() => this.tone(50, 0.1, 0.18, 'sine', 0), 140);
    }
  }

  playAt(name: SoundName, x: number, y: number, vol: number, lx: number, ly: number) {
    if (!this.ctx || !this.enabled) return;
    const d = Math.hypot(x - lx, y - ly);
    const maxD = name === 'gunshot' ? 900 : name === 'glass' || name === 'door_break' ? 500 : 300;
    if (d > maxD) return;
    const att = Math.max(0, 1 - d / maxD) ** 1.3;
    const pan = Math.max(-1, Math.min(1, (x - lx) / 200));
    this.play(name, vol * att, pan);
  }

  play(name: SoundName, vol = 1, pan = 0) {
    const c = this.ctx;
    if (!c || !this.enabled || vol < 0.01) return;
    // evita empilhar o mesmo som no mesmo instante
    const now = c.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);
    switch (name) {
      case 'step':
        this.noise(0.05, vol * 0.25, 900, 'lowpass', pan);
        break;
      case 'swing':
        this.noise(0.12, vol * 0.25, 1800, 'bandpass', pan, 600);
        break;
      case 'punch':
        this.noise(0.08, vol * 0.6, 400, 'lowpass', pan);
        this.tone(90, 0.08, vol * 0.4, 'sine', pan);
        break;
      case 'hit':
        this.noise(0.1, vol * 0.7, 600, 'lowpass', pan);
        this.tone(70, 0.1, vol * 0.4, 'triangle', pan);
        break;
      case 'gunshot':
        this.noise(0.35, vol * 1.0, 2400, 'lowpass', pan, 300);
        this.tone(60, 0.25, vol * 0.8, 'sine', pan, 30);
        break;
      case 'empty':
        this.tone(1800, 0.03, vol * 0.25, 'square', pan);
        break;
      case 'reload':
        this.tone(900, 0.04, vol * 0.2, 'square', pan);
        setTimeout(() => this.tone(600, 0.05, vol * 0.25, 'square', pan), 700);
        break;
      case 'glass':
        for (let i = 0; i < 6; i++) setTimeout(() => this.tone(2500 + Math.random() * 3000, 0.08, vol * 0.18, 'triangle', pan), i * 25);
        this.noise(0.25, vol * 0.5, 5000, 'highpass', pan);
        break;
      case 'door_open':
        this.tone(220, 0.25, vol * 0.12, 'sawtooth', pan, 160);
        break;
      case 'door_close':
        this.noise(0.08, vol * 0.4, 300, 'lowpass', pan);
        break;
      case 'door_bash':
        this.noise(0.15, vol * 0.8, 250, 'lowpass', pan);
        this.tone(55, 0.15, vol * 0.5, 'sine', pan);
        break;
      case 'door_break':
        this.noise(0.4, vol, 700, 'lowpass', pan, 150);
        break;
      case 'groan':
        this.groan(vol * 0.35, pan, 70 + Math.random() * 40);
        break;
      case 'alert':
        this.groan(vol * 0.6, pan, 110 + Math.random() * 40);
        break;
      case 'zdie':
        this.groan(vol * 0.4, pan, 60);
        break;
      case 'pickup':
        this.tone(520, 0.05, vol * 0.15, 'triangle', pan);
        break;
      case 'container':
        this.noise(0.12, vol * 0.25, 1200, 'bandpass', pan);
        break;
      case 'hurt':
        this.noise(0.12, vol * 0.5, 500, 'lowpass', pan);
        this.tone(160, 0.18, vol * 0.25, 'sawtooth', pan, 90);
        break;
      case 'bite':
        this.noise(0.2, vol * 0.7, 900, 'bandpass', pan);
        this.tone(120, 0.3, vol * 0.4, 'sawtooth', pan, 60);
        break;
      case 'eat':
      case 'drink':
      case 'cloth':
        this.noise(0.25, vol * 0.2, name === 'drink' ? 700 : 1500, 'bandpass', pan);
        break;
      case 'engine_start':
        this.noise(0.6, vol * 0.6, 300, 'lowpass', pan, 900);
        this.tone(45, 0.7, vol * 0.5, 'sawtooth', pan, 70);
        break;
      case 'engine_stop':
        this.tone(70, 0.6, vol * 0.4, 'sawtooth', pan, 30);
        break;
      case 'shout':
        this.tone(330, 0.5, vol * 0.25, 'sawtooth', pan, 260);
        break;
    }
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType, pan: number, endFreq?: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType, pan: number, endFreq?: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.master!);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  private groan(vol: number, pan: number, base: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const dur = 0.7 + Math.random() * 0.6;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 2;
    const lfo = c.createOscillator();
    lfo.frequency.value = 7;
    const lg = c.createGain();
    lg.gain.value = 6;
    lfo.connect(lg).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(f).connect(g).connect(p).connect(this.master!);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur);
    lfo.stop(t + dur);
  }
}
