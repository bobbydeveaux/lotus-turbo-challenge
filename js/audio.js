'use strict';
// ── Web Audio: engine synth, SFX and a step-sequenced soundtrack ─────────────
const NOTE = (() => {
  const names = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  return (n) => {
    const m = /^([A-G][#b]?)(\d)$/.exec(n);
    return m ? 12 * (+m[2] + 1) + names[m[1]] : null;
  };
})();
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const SONGS = [
  {
    name: 'MAGNETIC HIGHWAY', bpm: 140,
    chords: { A: ['A2:m', 'F2:M', 'C3:M', 'G2:M'], B: ['F2:M', 'G2:M', 'E2:m', 'A2:m'] },
    lead: {
      A: [
        'E5 - - - A5 - - - G5 - E5 - D5 - C5 -',
        'C5 - - - A4 - C5 - F5 - - - E5 - - -',
        'E5 - G5 - C6 - - - B5 - G5 - E5 - G5 -',
        'D5 - - - B4 - D5 - G5 - - - - - . .',
      ],
      B: [
        'A5 - - - G5 - F5 - E5 - F5 - G5 - - -',
        'B5 - - - A5 - G5 - D5 - - - G5 - A5 -',
        'B5 - - - G5 - - - E5 - G5 - B5 - E6 -',
        'C6 - - - B5 - A5 - E5 - - - A5 - - -',
      ],
    },
    order: ['I', 'A', 'A', 'B', 'B'],
  },
  {
    name: 'NIGHT DRIVE', bpm: 128,
    chords: { A: ['D3:m', 'A#2:M', 'F2:M', 'C3:M'], B: ['A#2:M', 'C3:M', 'D3:m', 'D3:m'] },
    lead: {
      A: [
        'D5 - - - F5 - - - A5 - - - G5 - F5 -',
        'F5 - - - D5 - - - A#4 - - - C5 - D5 -',
        'C5 - - - F5 - - - A5 - C6 - A5 - G5 -',
        'E5 - - - - - - - C5 - D5 - E5 - G5 -',
      ],
      B: [
        'F5 - - - G5 - - - A5 - - - A#5 - A5 -',
        'G5 - - - E5 - - - C5 - - - E5 - G5 -',
        'A5 - - - - - - - D6 - - - C6 - A5 -',
        'A5 - - - - - - - . . . . . . . .',
      ],
    },
    order: ['I', 'A', 'A', 'B', 'B'],
  },
];

const Sound = {
  ctx: null,
  enabled: true,
  musicOn: true,
  engines: [],

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);
    // shared noise
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // music echo
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.32;
    const fb = c.createGain();
    fb.gain.value = 0.28;
    const wet = c.createGain();
    wet.gain.value = 0.25;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.musicBus);
    this.echo = delay;
    // ambience
    this.rain = this.loopNoise(1400, 'lowpass', 0);
    this.skid = [this.loopNoise(1100, 'bandpass', 0, 6), this.loopNoise(1100, 'bandpass', 0, 6)];
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  loopNoise(freq, type, gain, q) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start();
    return { g, f };
  },

  // ── engines ───────────────────────────────────────────────────────────────
  // Each car: two detuned saws + sub through a soft-clipper, an intake-noise
  // layer, a turbo whistle, and per-player wind + gravel beds.
  startEngines(n) {
    if (!this.ctx) return;
    this.stopEngines();
    const c = this.ctx;
    const curve = new Float32Array(512);
    for (let j = 0; j < 512; j++) { const x = j / 256 - 1; curve[j] = Math.tanh(x * 3) * 0.9; }
    for (let i = 0; i < n; i++) {
      const out = c.createGain();
      out.gain.value = 0;
      let dest = this.sfxBus;
      if (c.createStereoPanner) {
        const pan = c.createStereoPanner();
        pan.pan.value = n > 1 ? (i ? 0.45 : -0.45) : 0;
        pan.connect(this.sfxBus);
        dest = pan;
      }
      out.connect(dest);
      const ws = c.createWaveShaper();
      ws.curve = curve;
      ws.oversample = '2x';
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 2.5;
      const peak = c.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 180;
      peak.gain.value = 6;
      ws.connect(f); f.connect(peak); peak.connect(out);
      const osc = (type, gain) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; g.gain.value = gain;
        o.connect(g); g.connect(ws); o.start();
        return o;
      };
      const o1 = osc('sawtooth', 0.55), o2 = osc('sawtooth', 0.4), o3 = osc('sine', 0.7);
      // throbbing firing pulse: amplitude-modulate the engine at the firing rate
      const am = c.createGain(); am.gain.value = 0.75;
      const lfo = c.createOscillator(); lfo.type = 'square';
      const lfoG = c.createGain(); lfoG.gain.value = 0.25;
      lfo.connect(lfoG); lfoG.connect(am.gain); lfo.start();
      out.disconnect(); out.connect(am); am.connect(dest);
      // intake roar
      const intake = this.noiseLayer('bandpass', 900, 1.2, out);
      // turbo whistle
      const tw = c.createOscillator(); tw.type = 'sine';
      const twG = c.createGain(); twG.gain.value = 0;
      tw.connect(twG); twG.connect(dest); tw.start();
      // wind + gravel (not run through the engine shaper)
      const wind = this.noiseLayer('lowpass', 500, 0.7, dest);
      const gravel = this.noiseLayer('bandpass', 160, 1.5, dest);
      this.engines.push({ o1, o2, o3, lfo, tw, twG, f, out, intake, wind, gravel, prevThr: 0, popT: 0, nodes: [o1, o2, o3, lfo, tw, intake.src, wind.src, gravel.src] });
    }
  },

  noiseLayer(type, freq, q, dest) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(0, Math.random() * 1.5);
    return { src, f, g };
  },

  stopEngines() {
    for (const e of this.engines) {
      for (const n of e.nodes) { try { n.stop(); } catch (err) { /* already stopped */ } }
      e.out.disconnect();
      e.wind.g.disconnect();
      e.gravel.g.disconnect();
      e.twG.disconnect();
    }
    this.engines = [];
  },

  engine(i, rpm, throttle, turbo, vol = 1, speed = 0, offroad = false) {
    const e = this.engines[i];
    if (!e) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm * 165;
    e.o1.frequency.setTargetAtTime(f, t, 0.025);
    e.o2.frequency.setTargetAtTime(f * 1.007 * 2, t, 0.025);
    e.o3.frequency.setTargetAtTime(f * 0.5, t, 0.025);
    e.lfo.frequency.setTargetAtTime(f * 0.5, t, 0.025);
    e.f.frequency.setTargetAtTime(380 + rpm * 1700 + throttle * 900, t, 0.04);
    e.out.gain.setTargetAtTime((0.06 + throttle * 0.07 + rpm * 0.03) * vol, t, 0.05);
    e.intake.f.frequency.setTargetAtTime(600 + rpm * 2400, t, 0.05);
    e.intake.g.gain.setTargetAtTime(throttle * rpm * 0.35 * vol, t, 0.05);
    e.tw.frequency.setTargetAtTime(2200 + rpm * 2600, t, 0.08);
    e.twG.gain.setTargetAtTime((turbo ? 0.03 : rpm * throttle * 0.008) * vol, t, 0.1);
    e.wind.f.frequency.setTargetAtTime(300 + speed * 1600, t, 0.2);
    e.wind.g.gain.setTargetAtTime(speed * speed * 0.16 * vol, t, 0.2);
    e.gravel.g.gain.setTargetAtTime(offroad ? Math.min(1, speed * 2) * 0.5 * vol : 0, t, 0.06);
    // lift-off crackle: a few pops when you back off at high revs
    if (e.prevThr > 0.8 && throttle < 0.3 && rpm > 0.65) e.popT = 0.5;
    if (e.popT > 0) {
      e.popT -= 1 / 60;
      if (Math.random() < 0.18) this.pop(vol);
    }
    e.prevThr = throttle;
  },

  pop(vol = 1) {
    this.burst(0.35 * vol, 0.05, 700, 'lowpass');
    this.tone(70 + Math.random() * 40, 'square', 0.12 * vol, 0.04);
  },

  setSfx(on) {
    if (this.sfxBus) this.sfxBus.gain.value = on ? 0.9 : 0;
  },

  setSkid(i, v) {
    if (!this.ctx || !this.skid[i]) return;
    this.skid[i].g.gain.setTargetAtTime(v * 0.2, this.ctx.currentTime, 0.05);
    this.skid[i].f.frequency.setTargetAtTime(900 + Math.sin(this.ctx.currentTime * 31) * 200, this.ctx.currentTime, 0.02);
  },

  setRain(v) {
    if (!this.ctx) return;
    this.rain.g.gain.setTargetAtTime(v * 0.12, this.ctx.currentTime, 0.4);
  },

  // ── one-shots ─────────────────────────────────────────────────────────────
  tone(freq, type, vol, dur, when = 0, slide = 0, bus) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  },

  burst(vol, dur, freq, type = 'lowpass', when = 0, bus, sweepTo) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },

  chord(notes, type, vol, dur, when = 0) {
    for (const n of notes) this.tone(mtof(n), type, vol, dur, when);
  },

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'crash':
        this.burst(1.0, 0.8, 1200, 'lowpass', 0, null, 150);
        this.burst(0.5, 0.35, 4000, 'highpass');
        this.tone(110, 'square', 0.45, 0.45, 0, 0.25);
        for (let k = 0; k < 5; k++) this.tone(1800 + Math.random() * 2400, 'triangle', 0.06, 0.15, 0.05 + k * 0.05);
        break;
      case 'bump':
        this.burst(0.55, 0.16, 600); this.tone(80, 'sine', 0.55, 0.16, 0, 0.5); break;
      case 'splash':
        this.burst(0.45, 0.6, 3000, 'bandpass', 0, null, 600); break;
      case 'whoosh':
        this.burst(0.28, 0.45, 2400, 'bandpass', 0, null, 400); break;
      case 'checkpoint':
        [0, 4, 7, 12].forEach((n, i) => this.tone(mtof(76 + n), 'square', 0.1, 0.16, i * 0.06));
        this.chord([88, 91, 95], 'triangle', 0.08, 0.5, 0.26);
        break;
      case 'beep': this.tone(523, 'square', 0.2, 0.22); this.tone(1046, 'sine', 0.08, 0.22); break;
      case 'go':
        this.tone(1046, 'square', 0.22, 0.7); this.tone(1568, 'sine', 0.1, 0.7);
        this.burst(0.25, 0.5, 3000, 'highpass');
        break;
      case 'gear':
        this.burst(0.18, 0.05, 1500, 'bandpass');
        this.burst(0.14, 0.28, 5000, 'highpass', 0.02, null, 2500); // blow-off "pssh"
        break;
      case 'turbo':
        this.burst(0.4, 1.0, 600, 'bandpass', 0, null, 5000);
        this.tone(200, 'sawtooth', 0.12, 0.7, 0, 4);
        break;
      case 'thunder':
        this.burst(0.9, 2.8, 220, 'lowpass', 0, null, 60); this.burst(0.6, 1.2, 500, 'lowpass', 0.12); break;
      case 'move': this.tone(880, 'triangle', 0.09, 0.06); this.tone(1320, 'sine', 0.03, 0.05); break;
      case 'select':
        this.tone(660, 'square', 0.09, 0.08); this.tone(990, 'square', 0.09, 0.1, 0.06); this.tone(1320, 'square', 0.08, 0.14, 0.12);
        this.burst(0.12, 0.25, 2500, 'bandpass', 0, null, 6000);
        break;
      case 'back': this.tone(880, 'square', 0.08, 0.08); this.tone(587, 'square', 0.08, 0.12, 0.07); break;
      case 'timeout':
        [0, -3, -7, -12].forEach((n, i) => this.tone(mtof(64 + n), 'sawtooth', 0.14, 0.38, i * 0.22)); break;
      case 'finish':
        [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => this.tone(mtof(67 + n), 'square', 0.11, 0.22, i * 0.1));
        this.chord([79, 83, 86, 91], 'triangle', 0.07, 1.2, 0.8);
        break;
      case 'fanfare':
        [[60, 64, 67], [62, 65, 69], [64, 67, 71], [65, 69, 72, 77]].forEach((ch, i) => this.chord(ch, 'square', 0.05, i === 3 ? 1.1 : 0.2, i * 0.18));
        break;
      case 'warn': this.tone(1200, 'square', 0.07, 0.07); break;
    }
  },

  // ── music sequencer ───────────────────────────────────────────────────────
  playMusic(idx) {
    if (!this.ctx) return;
    this.stopMusic();
    if (!this.musicOn) return;
    const song = SONGS[idx % SONGS.length];
    this.song = song;
    this.step = 0;
    this.section = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.echo.delayTime.value = (60 / song.bpm) * 0.75;
    this.leadHold = null;
    this.timer = setInterval(() => this.schedule(), 25);
  },

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  schedule() {
    const c = this.ctx;
    const song = this.song;
    const st = 60 / song.bpm / 4;
    while (this.nextTime < c.currentTime + 0.15) {
      const sec = song.order[this.section % song.order.length];
      const barInSec = Math.floor(this.step / 16);
      const s16 = this.step % 16;
      const chordSet = song.chords[sec === 'I' ? 'A' : sec];
      this.playStep(song, sec, chordSet[barInSec], barInSec, s16, this.nextTime, st);
      this.nextTime += st;
      this.step++;
      if (this.step >= 64) { this.step = 0; this.section++; if (this.section >= song.order.length) this.section = 1; }
    }
  },

  playStep(song, sec, chordStr, bar, s, t, st) {
    const [rootN, q] = chordStr.split(':');
    const root = NOTE(rootN);
    const third = q === 'm' ? 3 : 4;
    const intro = sec === 'I';
    // drums
    if (s % 4 === 0) this.kick(t);
    if (!intro && (s === 4 || s === 12)) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.09 : 0.05);
    if (!intro && s === 15 && bar === 3) this.snare(t, 0.5);
    // bass: driving 8ths with octave jumps
    const bp = [0, null, 12, null, 0, null, 12, 0, 0, null, 12, null, 0, 12, 0, 7];
    if (bp[s] !== null) this.synth(mtof(root + bp[s]), 'sawtooth', 0.16, st * 1.6, t, 900, 'bass');
    // arpeggio
    const arp = [0, third, 7, 12, 7, third, 0, third, 7, 12, 12 + third, 12, 7, third, 7, 12];
    if (!intro || bar >= 2) this.synth(mtof(root + 24 + arp[s]), 'triangle', 0.05, st * 0.9, t, 4000);
    // pad on bar start
    if (s === 0) for (const iv of [0, third, 7]) this.synth(mtof(root + 12 + iv), 'sawtooth', 0.025, st * 15, t, 1400, 'pad');
    // lead
    if (!intro) {
      const line = song.lead[sec][bar].split(/\s+/);
      const tok = line[s];
      if (tok && tok !== '-' && tok !== '.') {
        let len = 1;
        while (line[s + len] === '-') len++;
        const m = NOTE(tok);
        if (m) this.lead(mtof(m), len * st, t);
      }
    }
  },

  synth(freq, type, vol, dur, t, cutoff, kind) {
    const c = this.ctx;
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    if (kind === 'bass') { f.Q.value = 6; f.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + dur); }
    const atk = kind === 'pad' ? dur * 0.3 : 0.005;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    if (kind === 'pad') g.connect(this.echo);
    o.start(t); o.stop(t + dur + 0.05);
  },

  lead(freq, dur, t) {
    const c = this.ctx;
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.01);
    g.gain.setValueAtTime(0.06, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98 + 0.05);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(dur, 0.4));
    lfo.connect(lg);
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      o.detune.value = det;
      lg.connect(o.frequency);
      o.connect(f);
      o.start(t); o.stop(t + dur + 0.1);
    }
    f.connect(g); g.connect(this.musicBus); g.connect(this.echo);
    lfo.start(t); lfo.stop(t + dur + 0.1);
  },

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.3);
  },

  snare(t, v = 1) {
    this.burst(0.28 * v, 0.18, 2500, 'bandpass', t - this.ctx.currentTime, this.musicBus);
    this.tone(190, 'triangle', 0.15 * v, 0.1, t - this.ctx.currentTime, 0.6, this.musicBus);
  },

  hat(t, v) {
    this.burst(v, 0.04, 8000, 'highpass', t - this.ctx.currentTime, this.musicBus);
  },
};
