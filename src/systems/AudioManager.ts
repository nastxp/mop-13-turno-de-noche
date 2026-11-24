/**
 * Audio 100 % sintetizado con WebAudio: efectos, bucles y música generativa
 * que cambia de intensidad según el caos de la nave.
 */
type LoopName = 'spray' | 'vacuum' | 'fire' | 'leak' | 'alarmHum';

interface Loop { gain: GainNode; nodes: AudioNode[]; level: number }

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private loops = new Map<LoopName, Loop>();
  vol = { master: 0.8, music: 0.45, sfx: 0.8 };
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;
  intensity = 0;
  party = false;
  musicOn = false;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  setVolumes(v: Partial<typeof this.vol>) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.9, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, when = 0, bus?: AudioNode, attack = 0.005) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, ftype: BiquadFilterType, freq: number, slideTo?: number, when = 0, q = 1) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = ftype;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  sfx(name: string) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    const minGap: Record<string, number> = { laser: 60, step: 60, squelch: 80, alarm: 7000, spark: 90, sparkle: 70, mop: 140, chime: 400, zap: 150 };
    const gap = minGap[name] ?? 50;
    if (now - (this.last.get(name) ?? 0) < gap) return;
    this.last.set(name, now);
    const T = (f: number, d: number, ty: OscillatorType, v: number, s?: number, w = 0) => this.tone(f, d, ty, v, s, w);
    const N = (d: number, v: number, ft: BiquadFilterType, f: number, s?: number, w = 0, q = 1) => this.noise(d, v, ft, f, s, w, q);
    switch (name) {
      case 'step': N(0.04, 0.05, 'highpass', 1800); T(110 + Math.random() * 30, 0.03, 'square', 0.015); break;
      case 'squelch': N(0.09, 0.07, 'bandpass', 600, 300, 0, 2); break;
      case 'mop': N(0.16, 0.06, 'bandpass', 1100, 450, 0, 1.5); break;
      case 'sparkle': T(1320, 0.07, 'sine', 0.04); T(1760, 0.07, 'sine', 0.04, undefined, 0.05); T(2350, 0.1, 'sine', 0.035, undefined, 0.1); break;
      case 'clean': T(660, 0.08, 'triangle', 0.06); T(880, 0.08, 'triangle', 0.06, undefined, 0.07); T(1320, 0.18, 'triangle', 0.06, undefined, 0.14); break;
      case 'pickup': T(880, 0.07, 'square', 0.035, 1320); break;
      case 'slip': T(900, 0.34, 'sine', 0.09, 160); T(70, 0.18, 'sine', 0.2, 40, 0.3); N(0.08, 0.08, 'lowpass', 400, undefined, 0.3); break;
      case 'thud': T(80, 0.15, 'sine', 0.2, 40); break;
      case 'vomit': N(0.55, 0.12, 'lowpass', 500, 200); T(110, 0.5, 'sawtooth', 0.04, 70); break;
      case 'zap': N(0.14, 0.09, 'highpass', 3000); T(1600, 0.1, 'square', 0.04, 300); break;
      case 'spark': N(0.03, 0.035, 'highpass', 4500); break;
      case 'alarm': for (let i = 0; i < 2; i++) { T(660, 0.16, 'square', 0.035, undefined, i * 0.4); T(880, 0.16, 'square', 0.035, undefined, i * 0.4 + 0.2); } break;
      case 'chime': T(1046, 0.25, 'sine', 0.06); T(784, 0.4, 'sine', 0.06, undefined, 0.22); break;
      case 'explosion': N(1.1, 0.35, 'lowpass', 900, 80); T(60, 0.8, 'sine', 0.3, 28); break;
      case 'hurt': T(240, 0.15, 'square', 0.06, 110); break;
      case 'flush': N(0.7, 0.09, 'bandpass', 500, 1600, 0, 1.2); N(0.4, 0.05, 'lowpass', 300, undefined, 0.4); break;
      case 'pour': N(0.35, 0.04, 'bandpass', 1300, 900, 0, 3); break;
      case 'plop': T(200, 0.09, 'sine', 0.1, 650); break;
      case 'squish': N(0.1, 0.09, 'bandpass', 320, 200, 0, 2); T(180, 0.1, 'sine', 0.08, 90); break;
      case 'alien': T(300, 0.13, 'square', 0.035, 900); T(900, 0.1, 'square', 0.03, 420, 0.13); break;
      case 'bite': N(0.06, 0.1, 'highpass', 1500); T(150, 0.07, 'square', 0.05); break;
      case 'gulp': T(320, 0.13, 'sine', 0.1, 140); break;
      case 'capture': T(400, 0.32, 'sine', 0.07, 1600); T(1320, 0.07, 'sine', 0.04, undefined, 0.3); T(1760, 0.12, 'sine', 0.04, undefined, 0.36); break;
      case 'door': N(0.22, 0.03, 'bandpass', 900, 300, 0, 2); break;
      case 'rinse': N(0.6, 0.07, 'lowpass', 2200, 700); break;
      case 'coin': T(988, 0.07, 'square', 0.04); T(1319, 0.22, 'square', 0.04, undefined, 0.07); break;
      case 'error': T(140, 0.22, 'square', 0.05); break;
      case 'seal': N(0.35, 0.07, 'lowpass', 700, 200); T(300, 0.2, 'sine', 0.06, 180); break;
      case 'ok': T(523, 0.07, 'triangle', 0.05); T(659, 0.07, 'triangle', 0.05, undefined, 0.06); T(784, 0.14, 'triangle', 0.05, undefined, 0.12); break;
      case 'steam': N(0.9, 0.09, 'highpass', 2200, 900); break;
      case 'horn': T(440, 0.3, 'sawtooth', 0.04, 660); T(660, 0.3, 'sawtooth', 0.03, 880, 0.25); break;
      case 'foamhit': N(0.05, 0.03, 'lowpass', 1200); break;
      case 'repair': T(180, 0.05, 'square', 0.04); N(0.04, 0.04, 'highpass', 2500, undefined, 0.06); break;
      case 'break': N(0.25, 0.12, 'highpass', 1200, 400); T(200, 0.2, 'square', 0.05, 60); break;
      case 'click': T(1200, 0.02, 'square', 0.03); break;
      case 'laser': T(1800, 0.09, 'square', 0.025, 500); N(0.05, 0.03, 'highpass', 3000); break;
      case 'death': T(440, 0.25, 'triangle', 0.05, 220); T(330, 0.35, 'triangle', 0.05, 160, 0.22); T(220, 0.6, 'triangle', 0.05, 110, 0.5); break;
      case 'roar': N(0.9, 0.18, 'lowpass', 600, 120); T(90, 0.8, 'sawtooth', 0.08, 50); break;
      case 'freeze': N(0.3, 0.06, 'highpass', 4000, 1500); T(2400, 0.2, 'sine', 0.03, 3200); break;
      case 'trap': T(700, 0.05, 'square', 0.05); N(0.08, 0.08, 'highpass', 2000, undefined, 0.03); break;
    }
  }

  /** Bucles continuos (espuma, aspiradora, fuego, fuga de aire). */
  loop(name: LoopName, level: number) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let l = this.loops.get(name);
    if (!l && level <= 0.001) return;
    const c = this.ctx;
    if (!l) {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.sfxBus);
      const nodes: AudioNode[] = [];
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      if (name === 'spray') { f.type = 'lowpass'; f.frequency.value = 3800; }
      else if (name === 'vacuum') { f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.5; }
      else if (name === 'fire') { f.type = 'lowpass'; f.frequency.value = 700; }
      else if (name === 'leak') { f.type = 'highpass'; f.frequency.value = 2600; }
      else { f.type = 'lowpass'; f.frequency.value = 200; }
      src.connect(f).connect(gain);
      src.start();
      nodes.push(src);
      if (name === 'vacuum' || name === 'leak') {
        const o = c.createOscillator();
        o.type = name === 'vacuum' ? 'sawtooth' : 'sine';
        o.frequency.value = name === 'vacuum' ? 96 : 1480;
        const og = c.createGain();
        og.gain.value = name === 'vacuum' ? 0.25 : 0.15;
        o.connect(og).connect(gain);
        o.start();
        nodes.push(o);
      }
      l = { gain, nodes, level: 0 };
      this.loops.set(name, l);
    }
    const base: Record<LoopName, number> = { spray: 0.06, vacuum: 0.05, fire: 0.07, leak: 0.03, alarmHum: 0.02 };
    l.level = level;
    l.gain.gain.setTargetAtTime(base[name] * Math.min(1, level), c.currentTime, 0.08);
  }

  stopLoops() {
    for (const [, l] of this.loops) {
      try { l.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.05); } catch { /* */ }
    }
  }

  // ─────────── música generativa ───────────
  startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    this.musicOn = true;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }

  stopMusic() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicOn = false;
  }

  setIntensity(v: number) { this.intensity = Math.max(0, Math.min(1, v)); }

  private schedule() {
    const c = this.ctx!;
    if (c.state !== 'running') return;
    const tense = this.intensity > 0.45;
    const bpm = this.party ? 124 : tense ? 104 : 74;
    const stepDur = 60 / bpm / 2; // corcheas
    while (this.nextNote < c.currentTime + 0.25) {
      this.playStep(this.step, this.nextNote, stepDur, tense);
      this.nextNote += stepDur;
      this.step++;
    }
  }

  private playStep(step: number, t: number, sd: number, tense: boolean) {
    const c = this.ctx!;
    const bar = Math.floor(step / 8);
    const prog = this.party ? [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]] : [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const chord = prog[Math.floor(bar / 2) % 4];
    const when = t - c.currentTime;
    const mb = this.musicBus;
    // pad al inicio de cada dos compases
    if (step % 16 === 0) {
      for (const n of chord) {
        for (const det of [-6, 6]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = NOTE(n - 12);
          o.detune.value = det;
          const f = c.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = tense ? 900 : 600;
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.012, t + 1.2);
          g.gain.exponentialRampToValueAtTime(0.0001, t + sd * 16 + 1.5);
          o.connect(f).connect(g).connect(mb);
          o.start(t);
          o.stop(t + sd * 16 + 1.6);
        }
      }
    }
    // arpegio
    const pent = this.party ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
    const p = this.party ? 0.85 : tense ? 0.8 : 0.55;
    if (Math.random() < p) {
      const root = chord[0] + 12;
      const n = root + pent[Math.floor(Math.random() * pent.length)] + (Math.random() < 0.25 ? 12 : 0);
      this.tone(NOTE(n), sd * 1.6, tense || this.party ? 'square' : 'triangle', tense ? 0.016 : 0.022, undefined, when, mb, 0.01);
    }
    // bajo pulsante en tensión o fiesta
    if ((tense || this.party) && step % 2 === 0) {
      this.tone(NOTE(chord[0] - 24), sd * 0.9, 'square', 0.03, undefined, when, mb, 0.005);
    }
    if (tense && step % 8 === 4) this.tone(NOTE(chord[0] - 12), sd * 0.5, 'sawtooth', 0.015, undefined, when, mb);
  }
}

export const audio = new AudioManager();
