'use strict';
// ── Game flow: menus, championship, results, high scores, main loop ─────────
const W = 1280, H = 720;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const renderer = new (window.RendererImpl || Renderer)(ctx);
const C = UI.C;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  const cw = Math.round(W * s), ch = Math.round(H * s);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  Game.scale = canvas.width / W;
}

const THEME_LABEL = { forest: 'CLEAR', night: 'NIGHT', fog: 'DENSE FOG', snow: 'SNOW · LOW GRIP', desert: 'HOT & DUSTY', storm: 'STORM · WET', coast: 'SUNSET', motorway: 'NIGHT · 4 LANES' };
const todayKey = () => new Date().toISOString().slice(0, 10);
const dailyStage = () => (Math.floor(Date.now() / 86400000) * 3) % STAGES.length;

const Game = {
  mode: 'loading',
  scale: 1,
  t: 0,
  focus: { row: 0, col: 0 },
  selIdx: 0,
  setIdx: 0,
  pauseIdx: 0,
  hits: [],
  settings: Object.assign({ players: 1, gears: ['auto', 'auto'], difficulty: 1, music: true, sfx: true, arcadeStage: 0 }, U.store.get('settings', {})),
  hiscores: U.store.get('hiscores', [
    { name: 'GRM', score: 9000, stage: 8 }, { name: 'MFD', score: 7500, stage: 7 }, { name: 'LTS', score: 6000, stage: 6 },
    { name: 'ESP', score: 4500, stage: 5 }, { name: 'TRB', score: 3000, stage: 4 }, { name: 'SHN', score: 2000, stage: 3 },
    { name: 'AND', score: 1200, stage: 2 }, { name: 'JON', score: 500, stage: 1 },
  ]),
  bestTimes: U.store.get('besttimes', {}),
  daily: U.store.get('daily', {}),
  race: null,
  bgRace: null,
  champ: null,

  save() {
    U.store.set('settings', this.settings);
  },

  // ── flow ──────────────────────────────────────────────────────────────────
  newChamp(stage, n, extra = {}) {
    return Object.assign({ arcade: false, stage, points: {}, score: Array(n).fill(0), alive: Array(n).fill(true) }, extra);
  },

  startChampionship() {
    this.champ = this.newChamp(0, 1);
    this.loadStage(0, 1);
  },

  startSingle(stage, n) {
    this.settings.arcadeStage = stage;
    this.save();
    this.champ = this.newChamp(stage, n, { arcade: true });
    this.loadStage(stage, n);
  },

  startDaily() {
    const st = dailyStage();
    this.champ = this.newChamp(st, 1, { arcade: true, daily: todayKey() });
    this.loadStage(st, 1, 2);
  },

  loadStage(i, n, difficulty) {
    const players = [];
    for (let p = 0; p < n; p++) players.push({ name: 'PLAYER ' + (p + 1), col: p ? 'white' : 'red', gears: this.settings.gears[p] });
    this.race = new Race({ stage: i, players, difficulty: difficulty ?? this.settings.difficulty });
    renderer.setup(this.race.theme);
    this.mode = 'intro';
    this.introT = 0;
    Sound.stopEngines();
    Sound.setRain(0);
    Sound.playMusic(this.race.stage.music);
  },

  startDemo(stage) {
    this.demo = true;
    this.champ = this.newChamp(stage, 1, { arcade: true });
    this.race = new Race({ stage, players: [{ name: 'PLAYER 1', col: 'red', gears: 'auto' }], difficulty: 1 });
    renderer.setup(this.race.theme);
    this.beginRace();
  },

  beginRace() {
    this.mode = 'race';
    Sound.startEngines(this.race.players.length);
    Sound.setRain(this.race.theme.weather === 'storm' ? 1 : 0);
  },

  endRace() {
    const race = this.race;
    const res = race.results();
    const ch = this.champ;
    const earned = {};
    res.forEach((r) => {
      const pts = r.pos <= 10 && r.finished && !r.out ? POINTS[r.pos - 1] : 0;
      earned[r.name] = pts;
      ch.points[r.name] = (ch.points[r.name] || 0) + pts;
    });
    const summary = race.players.map((pl) => {
      const qualified = pl.finished && pl.finishPos <= 10;
      const bonus = pl.finished ? Math.round(pl.timeLeft * 10) * 10 : 0;
      const sc = earned[pl.name] * 100 + bonus + (pl.finished ? 500 : 0);
      ch.score[pl.idx] += sc;
      if (!qualified) ch.alive[pl.idx] = false;
      if (pl.finished) {
        const key = race.stageIdx;
        if (!this.bestTimes[key] || pl.finishTime < this.bestTimes[key]) {
          this.bestTimes[key] = pl.finishTime;
          U.store.set('besttimes', this.bestTimes);
          pl.newBest = true;
        }
        if (ch.daily && (!this.daily[ch.daily] || pl.finishTime < this.daily[ch.daily])) {
          this.daily[ch.daily] = pl.finishTime;
          U.store.set('daily', this.daily);
        }
      }
      return { pl, qualified, bonus, sc, pts: earned[pl.name] };
    });
    this.results = { res, summary, earned };
    this.mode = 'results';
    this.resultsT = 0;
    Sound.stopEngines();
    Sound.setRain(0);
    Sound.setSkid(0, 0);
    Sound.setSkid(1, 0);
    Sound.sfx(summary.some((s) => s.qualified) ? 'fanfare' : 'timeout');
  },

  afterResults() {
    const ch = this.champ;
    if (ch.arcade) { this.toTitle(); return; }
    const anyAlive = ch.alive.some((a) => a);
    if (anyAlive && ch.stage < STAGES.length - 1) {
      ch.stage++;
      this.loadStage(ch.stage, ch.score.length);
    } else {
      this.mode = 'champEnd';
      this.champWon = anyAlive;
      this.endT = 0;
      if (anyAlive) Sound.sfx('finish');
    }
  },

  afterChampEnd() {
    this.entryQueue = [];
    this.champ.score.forEach((s, i) => {
      if (s > this.hiscores[this.hiscores.length - 1].score) this.entryQueue.push({ idx: i, score: s, stage: this.champ.stage + 1 });
    });
    this.nextEntry();
  },

  nextEntry() {
    if (!this.entryQueue || !this.entryQueue.length) { this.go('hiscores'); return; }
    this.entry = this.entryQueue.shift();
    this.entry.letters = [0, 0, 0];
    this.entry.pos = 0;
    this.mode = 'entry';
  },

  go(mode) {
    this.mode = mode;
    this.modeT = 0;
  },

  toTitle() {
    this.go('title');
    this.race = null;
    this.demo = false;
    Sound.stopEngines();
    Sound.setRain(0);
    Sound.playMusic(0);
  },

  // background attract race behind the menus
  ensureBgRace(dt) {
    if (!this.bgRace || this.bgRace.state === 'done' || this.bgRace.t > 70) {
      const st = Math.floor(Math.random() * STAGES.length);
      this.bgRace = new Race({ stage: st, players: [{ name: 'BG', col: 'red', gears: 'auto' }], difficulty: 1 });
      this.bgRace.countdown = 0.01;
    }
    const r = this.bgRace;
    const steps = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < steps; i++) r.update(dt / steps, [r.autopilot(r.players[0])]);
  },

  drawBg(dim = 0.45) {
    const r = this.bgRace;
    if (!r) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); return; }
    if (renderer.theme !== r.theme) renderer.setup(r.theme);
    renderer.drawView({ x: 0, y: 0, w: W, h: H }, r, r.players[0]);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(12,12,24,${dim * 0.6})`);
    g.addColorStop(1, `rgba(12,12,24,${Math.min(0.95, dim * 1.5)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  },

  // ── update ────────────────────────────────────────────────────────────────
  update(dt) {
    this.t += dt;
    this.modeT = (this.modeT || 0) + dt;
    Input.pollPads();
    const m = Input.menu();
    if (!['race', 'intro', 'paused', 'loading'].includes(this.mode)) this.ensureBgRace(dt);
    switch (this.mode) {
      case 'title':
        this.idleT = Input.anyHit() ? 0 : (this.idleT || 0) + dt;
        if (this.idleT > 40) { this.idleT = 0; this.startDemo(Math.floor(Math.random() * STAGES.length)); break; }
        this.updateTitle(m);
        break;
      case 'select': this.updateSelect(m); break;
      case 'settings': this.updateSettings(m); break;
      case 'controls':
      case 'hiscores':
        if ((m.ok || m.back) && this.modeT > 0.3) { this.go('title'); Sound.sfx('back'); }
        break;
      case 'intro':
        this.introT += dt;
        if ((m.ok || this.introT > 7) && this.introT > 0.4) { Sound.sfx('select'); this.beginRace(); }
        if (m.back) this.toTitle();
        break;
      case 'race': this.updateRace(dt); break;
      case 'paused':
        if (m.up || m.down) { this.pauseIdx ^= 1; Sound.sfx('move'); }
        if (Input.pausePressed() && !m.ok) this.resume();
        else if (m.ok) {
          Sound.sfx('select');
          if (this.pauseIdx === 0) this.resume();
          else this.toTitle();
        }
        break;
      case 'results':
        this.resultsT += dt;
        if (m.ok && this.resultsT > 0.8) { Sound.sfx('select'); this.afterResults(); }
        break;
      case 'champEnd':
        this.endT += dt;
        if (m.ok && this.endT > 1) { Sound.sfx('select'); this.afterChampEnd(); }
        break;
      case 'entry': this.updateEntry(m); break;
    }
    Input.endFrame();
  },

  resume() {
    this.mode = 'race';
    Sound.startEngines(this.race.players.length);
  },

  titleRows() {
    return [3, 1, 3];
  },

  titleActivate(row, col) {
    Sound.sfx('select');
    if (row === 0) {
      if (col === 0) this.startChampionship();
      else { this.selPlayers = col === 1 ? 1 : 2; this.selIdx = this.settings.arcadeStage; this.go('select'); }
    } else if (row === 1) this.startDaily();
    else this.go(['controls', 'hiscores', 'settings'][col]);
  },

  updateTitle(m) {
    const rows = this.titleRows();
    const f = this.focus;
    if (m.up && f.row > 0) { f.row--; Sound.sfx('move'); }
    if (m.down && f.row < rows.length - 1) { f.row++; Sound.sfx('move'); }
    f.col = Math.min(f.col, rows[f.row] - 1);
    if (m.left && f.col > 0) { f.col--; Sound.sfx('move'); }
    if (m.right && f.col < rows[f.row] - 1) { f.col++; Sound.sfx('move'); }
    if (m.ok) this.titleActivate(f.row, f.col);
  },

  updateSelect(m) {
    const n = STAGES.length;
    if (m.left) { this.selIdx = (this.selIdx + n - 1) % n; Sound.sfx('move'); }
    if (m.right) { this.selIdx = (this.selIdx + 1) % n; Sound.sfx('move'); }
    if (m.up || m.down) { this.selIdx = (this.selIdx + 4) % n; Sound.sfx('move'); }
    if (m.back) { this.go('title'); Sound.sfx('back'); }
    if (m.ok && this.modeT > 0.15) { Sound.sfx('select'); this.startSingle(this.selIdx, this.selPlayers); }
  },

  settingRows() {
    const s = this.settings;
    return [
      { label: 'PLAYER 1 GEARS', value: s.gears[0].toUpperCase(), change: () => (s.gears[0] = s.gears[0] === 'auto' ? 'manual' : 'auto') },
      { label: 'PLAYER 2 GEARS', value: s.gears[1].toUpperCase(), change: () => (s.gears[1] = s.gears[1] === 'auto' ? 'manual' : 'auto') },
      { label: 'DIFFICULTY', value: DIFFICULTY[s.difficulty].name, change: (d) => (s.difficulty = (s.difficulty + 3 + d) % 3) },
      { label: 'MUSIC', value: s.music ? 'ON' : 'OFF', change: () => { s.music = !s.music; Sound.musicOn = s.music; if (s.music) Sound.playMusic(0); else Sound.stopMusic(); } },
      { label: 'SOUND FX', value: s.sfx ? 'ON' : 'OFF', change: () => { s.sfx = !s.sfx; Sound.setSfx(s.sfx); } },
      { label: 'BACK', back: true },
    ];
  },

  updateSettings(m) {
    const rows = this.settingRows();
    if (m.up) { this.setIdx = (this.setIdx + rows.length - 1) % rows.length; Sound.sfx('move'); }
    if (m.down) { this.setIdx = (this.setIdx + 1) % rows.length; Sound.sfx('move'); }
    const r = rows[this.setIdx];
    if (m.back || (m.ok && r.back)) { this.go('title'); Sound.sfx('back'); return; }
    if ((m.left || m.right || m.ok) && r.change) { r.change(m.left ? -1 : 1); this.save(); Sound.sfx('move'); }
  },

  updateRace(dt) {
    const race = this.race;
    const twoP = race.players.length === 2;
    if (Input.pausePressed() && !this.demo) { this.mode = 'paused'; this.pauseIdx = 0; Sound.stopEngines(); return; }
    if (this.demo && (Input.anyHit() || race.state === 'done')) { this.toTitle(); return; }
    const inputs = race.players.map((p, i) => (this.demo || this.autopilot ? race.autopilot(p) : Input.player(i, twoP)));
    const steps = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < steps; i++) {
      race.update(dt / steps, i === 0 ? inputs : inputs.map((x) => ({ ...x, turbo: false, up: false, dn: false })));
      for (const e of race.events) Sound.sfx(e);
    }
    for (const pl of race.players) {
      Sound.engine(pl.idx, U.clamp(pl.rpm, 0, 1.1), pl.throttle, pl.turboT > 0, twoP ? 0.7 : 1, pl.speed / VMAX, pl.offroad);
      Sound.setSkid(pl.idx, pl.skid * (pl.speed > 10 ? 1 : 0));
    }
    // passing whooshes
    for (const pl of race.players) {
      for (const c of race.racers) {
        if (c === pl) continue;
        const d = c.z - pl.z;
        const key = '_side' + pl.idx;
        const side = d > 0 ? 1 : -1;
        if (c[key] !== undefined && c[key] !== side && Math.abs(c.x - pl.x) < 6 && Math.abs(pl.speed - c.speed) > 4) Sound.sfx('whoosh');
        c[key] = side;
      }
    }
    if (race.state === 'done' && race.doneT > 3.5) this.endRace();
  },

  updateEntry(m) {
    const e = this.entry;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .';
    if (m.up) { e.letters[e.pos] = (e.letters[e.pos] + 1) % A.length; Sound.sfx('move'); }
    if (m.down) { e.letters[e.pos] = (e.letters[e.pos] + A.length - 1) % A.length; Sound.sfx('move'); }
    if (m.left && e.pos > 0) { e.pos--; Sound.sfx('move'); }
    if (m.right || m.ok) {
      if (e.pos < 2) { e.pos++; Sound.sfx('move'); }
      else if (m.ok) {
        Sound.sfx('select');
        const name = e.letters.map((l) => A[l]).join('');
        this.hiscores.push({ name, score: e.score, stage: e.stage });
        this.hiscores.sort((a, b) => b.score - a.score);
        this.hiscores.length = 8;
        U.store.set('hiscores', this.hiscores);
        this.nextEntry();
      }
    }
  },

  // ── pointer support ───────────────────────────────────────────────────────
  hit(x, y, w, h, focus, act) {
    this.hits.push({ x, y, w, h, focus, act });
  },

  pointer(e, click) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        if (h.focus) h.focus();
        if (click && h.act) h.act();
        return;
      }
    }
    if (click && ['controls', 'hiscores', 'intro', 'results', 'champEnd'].includes(this.mode)) {
      if (this.mode === 'intro') this.beginRace();
      else if (this.mode === 'results' && this.resultsT > 0.8) this.afterResults();
      else if (this.mode === 'champEnd' && this.endT > 1) this.afterChampEnd();
      else if (this.mode === 'controls' || this.mode === 'hiscores') this.go('title');
    }
  },

  // ── draw ──────────────────────────────────────────────────────────────────
  draw() {
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.hits = [];
    if (renderer.beginFrame) renderer.beginFrame();
    switch (this.mode) {
      case 'loading': this.drawLoading(); break;
      case 'title': this.drawBg(0.35); this.drawTitle(); break;
      case 'select': this.drawBg(0.6); this.drawSelect(); break;
      case 'settings': this.drawBg(0.6); this.drawSettings(); break;
      case 'controls': this.drawBg(0.6); this.drawControls(); break;
      case 'hiscores': this.drawBg(0.6); this.drawHiscores(); break;
      case 'intro': this.drawRace(); this.drawIntro(); break;
      case 'race':
        this.drawRace();
        if (this.demo) {
          this.drawLogo(W / 2, 120, 0.5);
          if (Math.floor(this.t * 1.5) % 2) UI.tag(ctx, 'DEMO · PRESS ANY KEY', W / 2, H - 230, { size: 22, align: 'center', bg: C.yellow, fg: C.ink, sw: 4 });
        }
        break;
      case 'paused': this.drawRace(); this.drawPause(); break;
      case 'results': this.drawBg(0.7); this.drawResults(); break;
      case 'champEnd': this.drawHero(); this.drawChampEnd(); break;
      case 'entry': this.drawBg(0.7); this.drawEntry(); break;
    }
  },

  views() {
    return this.race.players.length === 2
      ? [{ x: 0, y: 0, w: W, h: H / 2 - 3 }, { x: 0, y: H / 2 + 3, w: W, h: H / 2 - 3 }]
      : [{ x: 0, y: 0, w: W, h: H }];
  },

  drawRace() {
    const race = this.race;
    const views = this.views();
    const split = views.length > 1;
    if (split && !renderer.is3D) { ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H); }
    race.players.forEach((pl, i) => {
      renderer.drawView(views[i], race, pl);
      if (this.mode !== 'intro' && !this.demo) drawHUD(ctx, views[i], race, pl, split);
    });
    if (split) { ctx.fillStyle = C.yellow; ctx.fillRect(0, H / 2 - 3, W, 6); }
  },

  drawHero() {
    const im = GFX.hero;
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);
    if (im) {
      const s = Math.max(W / im.width, H / im.height);
      ctx.drawImage(im, W / 2 - (im.width * s) / 2, H / 2 - (im.height * s) / 2, im.width * s, im.height * s);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
  },

  drawLoading() {
    this.drawHero();
    this.drawLogo(W / 2, 250, 1);
    const p = GFX.total ? GFX.progress / GFX.total : 0;
    UI.panel(ctx, W / 2 - 220, 470, 440, 28, { r: 14, sw: 4, drop: 4 });
    ctx.fillStyle = C.yellow;
    UI.rr(ctx, W / 2 - 214, 476, 428 * p, 16, 8);
    ctx.fill();
    UI.text(ctx, 'WARMING UP THE TURBO…', W / 2, 545, 22, C.cream, { align: 'center', sw: 5 });
  },

  drawLogo(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // red tag
    UI.panel(ctx, -250, -150, 300, 62, { fill: C.red, r: 8, sw: 5, drop: 6, tilt: -0.04 });
    UI.text(ctx, '★ LOTUS', -100, -103, 46, C.cream, { align: 'center', sw: 0, stroke: null, tilt: -0.04 });
    UI.text(ctx, 'TURBO', 0, 20, 150, C.yellow, { align: 'center', sw: 22, shadow: C.red, sd: 14, tilt: -0.03 });
    UI.text(ctx, 'CHALLENGE', 10, 128, 104, C.green, { align: 'center', sw: 18, shadow: C.yellow, sd: 11, tilt: -0.03 });
    // ribbon
    ctx.save();
    ctx.rotate(-0.025);
    ctx.fillStyle = C.yellow;
    ctx.beginPath();
    ctx.moveTo(-250, 150); ctx.lineTo(250, 150); ctx.lineTo(228, 172); ctx.lineTo(250, 194); ctx.lineTo(-250, 194); ctx.lineTo(-228, 172);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    UI.panel(ctx, -200, 154, 400, 36, { fill: C.ink, r: 4, sw: 0, drop: 0 });
    UI.text(ctx, 'ESPRIT · FLAT OUT SINCE ’87!', 0, 181, 22, C.cream, { align: 'center', stroke: null });
    ctx.restore();
    UI.text(ctx, '★', 290, -70, 90, C.yellow, { align: 'center', sw: 12, tilt: 0.2 });
    ctx.restore();
  },

  drawTitle() {
    this.drawLogo(W / 2, 175, 0.78);
    const f = this.focus;
    const cards = [
      { tag: '8 STAGES', title: 'CHAMPIONSHIP', desc: ['Start 20th. Finish top 10', 'to qualify for the next stage.'], col: C.red, fg: C.cream, foot: 'HIGH SCORE ' + this.hiscores[0].score },
      { tag: 'ANY STAGE', title: 'SINGLE RACE', desc: ['Pick a stage and chase', 'a new best time.'], col: C.yellow, fg: C.ink, foot: Object.keys(this.bestTimes).length + ' / 8 STAGES TIMED' },
      { tag: 'SPLIT SCREEN', title: '2 PLAYER', desc: ['Head to head on one screen.', 'P1 WASD · P2 ARROWS'], col: C.green, fg: C.cream, foot: 'GRAB A MATE' },
    ];
    const cw = 330, chh = 170, gap = 28, x0 = W / 2 - (cw * 3 + gap * 2) / 2, y0 = 352;
    cards.forEach((c, i) => {
      const sel = f.row === 0 && f.col === i;
      const x = x0 + i * (cw + gap), y = y0 - (sel ? 8 : 0);
      UI.panel(ctx, x, y, cw, chh, { fill: c.col, r: 16, sw: sel ? 7 : 4, stroke: sel ? '#ffffff' : C.ink, drop: sel ? 10 : 6, band: C.ink, bandH: 12 });
      ctx.save();
      UI.rr(ctx, x, y, cw, chh, 16);
      ctx.clip();
      for (let k = 0; k < cw; k += 24) {
        ctx.fillStyle = [C.yellow, C.green, C.red, C.cream][(k / 24) % 4];
        ctx.fillRect(x + k + 4, y + chh - 10, 14, 6);
      }
      ctx.restore();
      UI.tag(ctx, c.tag, x + 16, y + 14, { size: 15, bg: C.ink, fg: c.col === C.yellow ? C.yellow : C.cream });
      UI.text(ctx, c.title, x + 16, y + 82, 40, c.fg === C.ink ? C.ink : '#fff', { sw: c.fg === C.ink ? 0 : 8, stroke: c.fg === C.ink ? null : C.ink });
      c.desc.forEach((d, k) => UI.body(ctx, d, x + 18, y + 108 + k * 20, 16, c.fg === C.ink ? C.ink : C.cream, { weight: 600 }));
      UI.text(ctx, c.foot, x + 18, y + chh - 22, 14, c.fg === C.ink ? '#6a4a00' : 'rgba(255,255,255,0.8)', { stroke: null });
      this.hit(x, y, cw, chh, () => { f.row = 0; f.col = i; }, () => this.titleActivate(0, i));
    });
    // daily challenge bar
    const dsel = f.row === 1;
    const dx = x0, dy = 548, dw = cw * 3 + gap * 2, dh = 62;
    const st = STAGES[dailyStage()];
    const best = this.daily[todayKey()];
    const g = ctx.createLinearGradient(dx, 0, dx + dw, 0);
    g.addColorStop(0, '#1f5fd6');
    g.addColorStop(1, '#3fa0ff');
    UI.panel(ctx, dx, dy - (dsel ? 5 : 0), dw, dh, { fill: g, r: 14, sw: dsel ? 6 : 4, stroke: dsel ? '#fff' : C.ink, drop: 6 });
    const yy = dy - (dsel ? 5 : 0);
    UI.panel(ctx, dx + 14, yy + 10, 42, 42, { fill: C.yellow, r: 8, sw: 3, drop: 0 });
    UI.text(ctx, '★', dx + 35, yy + 43, 28, C.ink, { align: 'center', stroke: null });
    UI.text(ctx, 'DAILY CHALLENGE', dx + 72, yy + 33, 28, C.yellow, { sw: 6 });
    const d = new Date();
    UI.body(ctx, `${d.toDateString().toUpperCase()} · ${st.name} · HARD`, dx + 74, yy + 53, 15, C.cream, { weight: 700 });
    UI.body(ctx, "TODAY'S BEST", dx + dw - 22, yy + 22, 12, C.cream, { align: 'right', weight: 700 });
    UI.text(ctx, best ? U.fmtTime(best) : 'NOT YET!', dx + dw - 22, yy + 50, 28, C.yellow, { align: 'right', sw: 6 });
    this.hit(dx, dy, dw, dh, () => { f.row = 1; f.col = 0; }, () => this.titleActivate(1, 0));
    // buttons
    ['HOW TO PLAY', 'HALL OF FAME', 'SETTINGS'].forEach((b, i) => {
      const sel = f.row === 2 && f.col === i;
      const bw = 240, bx = W / 2 - (bw * 3 + 40) / 2 + i * (bw + 20), by = 628;
      UI.panel(ctx, bx, by - (sel ? 4 : 0), bw, 50, { fill: sel ? C.yellow : C.ink, r: 12, sw: sel ? 4 : 0, drop: 5 });
      UI.text(ctx, b, bx + bw / 2, by + 34 - (sel ? 4 : 0), 24, sel ? C.ink : C.cream, { align: 'center', stroke: null });
      this.hit(bx, by, bw, 50, () => { f.row = 2; f.col = i; }, () => this.titleActivate(2, i));
    });
    // chequered footer
    UI.chequer(ctx, 0, H - 14, W, 14, 14);
  },

  drawStageThumb(i, x, y, w, h) {
    const th = THEMES[STAGES[i].theme];
    ctx.save();
    UI.rr(ctx, x, y, w, h, 10);
    ctx.clip();
    const hz = y + h * 0.58;
    const g = ctx.createLinearGradient(0, y, 0, hz);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.6, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, hz - y);
    for (const [k, s] of [[th.bgFar, 0.32], [th.bgNear, 0.4]]) {
      const im = k && GFX.bgs[k];
      if (!im) continue;
      const ih = im.height * s, iw = im.width * s;
      ctx.drawImage(im, 0, 0, Math.min(im.width, (w / iw) * im.width), im.height, x, hz - ih + 4, Math.min(iw, w), ih);
    }
    ctx.fillStyle = th.grass[0];
    ctx.fillRect(x, hz, w, y + h - hz);
    ctx.fillStyle = th.rumble[1];
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 6, hz); ctx.lineTo(x + w / 2 + 6, hz); ctx.lineTo(x + w * 0.92, y + h); ctx.lineTo(x + w * 0.08, y + h);
    ctx.fill();
    ctx.fillStyle = th.road[0];
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 4, hz); ctx.lineTo(x + w / 2 + 4, hz); ctx.lineTo(x + w * 0.86, y + h); ctx.lineTo(x + w * 0.14, y + h);
    ctx.fill();
    if (th.night) { ctx.fillStyle = 'rgba(0,0,20,0.35)'; ctx.fillRect(x, y, w, h); }
    if (STAGES[i].theme === 'fog') { ctx.fillStyle = 'rgba(200,205,210,0.45)'; ctx.fillRect(x, y, w, h); }
    ctx.restore();
  },

  drawSelect() {
    UI.panel(ctx, 40, 30, 500, 76, { fill: C.ink, r: 10, sw: 0, drop: 6, tilt: -0.02, band: C.red, bandH: 8 });
    UI.text(ctx, this.selPlayers === 2 ? 'PICK A STAGE · 2P' : 'PICK YOUR STAGE', 64, 86, 44, C.yellow, { sw: 0, stroke: null, tilt: -0.02 });
    const cw = 280, ch = 228, gx = 22, gy = 24;
    const x0 = W / 2 - (cw * 4 + gx * 3) / 2, y0 = 140;
    STAGES.forEach((st, i) => {
      const sel = i === this.selIdx;
      const x = x0 + (i % 4) * (cw + gx), y = y0 + Math.floor(i / 4) * (ch + gy) - (sel ? 8 : 0);
      UI.panel(ctx, x, y, cw, ch, { fill: sel ? C.yellow : C.cream, r: 16, sw: sel ? 6 : 4, stroke: sel ? '#fff' : C.ink, drop: sel ? 10 : 6 });
      this.drawStageThumb(i, x + 10, y + 10, cw - 20, 120);
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.ink;
      UI.rr(ctx, x + 10, y + 10, cw - 20, 120, 10);
      ctx.stroke();
      UI.tag(ctx, 'STAGE ' + (i + 1), x + 18, y + 18, { size: 13, bg: C.ink, fg: C.yellow });
      UI.text(ctx, st.name, x + 16, y + 164, st.name.length > 13 ? 22 : 27, C.ink, { stroke: null });
      UI.body(ctx, THEME_LABEL[st.theme], x + 17, y + 188, 14, '#5a5560', { weight: 700 });
      const best = this.bestTimes[i];
      UI.body(ctx, best ? 'BEST ' + U.fmtTime(best) : 'NO TIME SET', x + 17, y + 210, 14, best ? C.dgreen : '#8a8590', { weight: 700 });
      this.hit(x, y, cw, ch, () => (this.selIdx = i), () => { Sound.sfx('select'); this.startSingle(i, this.selPlayers); });
    });
    // footer
    let x = W / 2 - 330;
    const y = H - 70;
    x += UI.key(ctx, '◀', x, y, 22) + 6;
    x += UI.key(ctx, '▶', x, y, 22) + 10;
    x += UI.text(ctx, 'CHOOSE', x, y + 24, 20, C.cream, { stroke: null }) + 40;
    UI.panel(ctx, x, y - 10, 210, 52, { fill: C.green, r: 12, sw: 4, drop: 6 });
    UI.text(ctx, 'RACE! ▶', x + 105, y + 26, 30, '#fff', { align: 'center', sw: 6 });
    this.hit(x, y - 10, 210, 52, null, () => { Sound.sfx('select'); this.startSingle(this.selIdx, this.selPlayers); });
    x += 250;
    x += UI.key(ctx, 'ESC', x, y, 22) + 10;
    UI.text(ctx, 'BACK', x, y + 24, 20, C.cream, { stroke: null });
  },

  drawSettings() {
    UI.panel(ctx, W / 2 - 330, 90, 660, 540, { r: 18, drop: 8, band: C.red, bandH: 10 });
    UI.text(ctx, 'SETTINGS', W / 2, 160, 52, C.yellow, { align: 'center', shadow: C.red });
    this.settingRows().forEach((r, i) => {
      const sel = i === this.setIdx;
      const y = 200 + i * 66;
      UI.panel(ctx, W / 2 - 290, y, 580, 52, { fill: sel ? C.yellow : C.panel2, r: 12, sw: sel ? 4 : 0, drop: 0 });
      UI.text(ctx, r.label, W / 2 - 266, y + 36, 24, sel ? C.ink : C.cream, { stroke: null, align: r.back ? 'left' : 'left' });
      if (r.value) UI.text(ctx, (sel ? '◀ ' : '') + r.value + (sel ? ' ▶' : ''), W / 2 + 266, y + 36, 24, sel ? C.red : C.yellow, { align: 'right', stroke: null });
      this.hit(W / 2 - 290, y, 580, 52, () => (this.setIdx = i), () => {
        if (r.back) { this.go('title'); Sound.sfx('back'); } else { r.change(1); this.save(); Sound.sfx('move'); }
      });
    });
  },

  drawControls() {
    UI.panel(ctx, 150, 70, 980, 580, { r: 18, drop: 8, band: C.green, bandH: 10 });
    UI.text(ctx, 'HOW TO PLAY', W / 2, 140, 52, C.yellow, { align: 'center', shadow: C.red });
    const rows = [
      ['STEER', ['◀', '▶'], ['A', 'D'], ['◀', '▶']],
      ['ACCELERATE', ['▲'], ['W'], ['▲']],
      ['BRAKE', ['▼'], ['S'], ['▼']],
      ['TURBO BOOST', ['SPACE'], ['SPACE'], ['ENTER']],
      ['GEAR UP / DOWN', ['E', 'Q'], ['E', 'Q'], ['/', '.']],
      ['PAUSE', ['ESC'], ['ESC'], ['ESC']],
    ];
    ['', '1 PLAYER', '2P · PLAYER 1', '2P · PLAYER 2'].forEach((h, i) => UI.text(ctx, h, 470 + (i - 1) * 220, 196, 20, C.orange, { align: 'center', stroke: null }));
    rows.forEach((r, i) => {
      const y = 222 + i * 50;
      UI.text(ctx, r[0], 200, y + 30, 24, C.cream, { stroke: null });
      for (let c = 1; c <= 3; c++) {
        const keys = r[c];
        let w = 0;
        for (const k of keys) w += Math.max(33, UI.measure(ctx, k, 13.6) + 15.4) + 6;
        let x = 470 + (c - 1) * 220 - w / 2;
        for (const k of keys) x += UI.key(ctx, k, x, y, 22) + 6;
      }
    });
    const tips = ['Start 20th — finish in the TOP 10 before the clock hits zero.', 'Checkpoints add time and one TURBO charge (max 5).', 'Puddles, oil and ice make you slide · logs and rocks = crash!'];
    tips.forEach((t, i) => UI.body(ctx, '• ' + t, 200, 560 + i * 26, 18, C.cream, { weight: 600 }));
  },

  drawHiscores() {
    UI.panel(ctx, W / 2 - 330, 70, 660, 580, { r: 18, drop: 8, band: C.yellow, bandH: 10 });
    UI.text(ctx, 'HALL OF FAME', W / 2, 140, 52, C.yellow, { align: 'center', shadow: C.red });
    this.hiscores.forEach((h, i) => {
      const y = 175 + i * 52;
      UI.panel(ctx, W / 2 - 290, y, 580, 44, { fill: i === 0 ? C.yellow : C.panel2, r: 10, sw: 0, drop: 0 });
      const fg = i === 0 ? C.ink : C.cream;
      UI.text(ctx, U.ordinal(i + 1), W / 2 - 270, y + 32, 22, i === 0 ? C.red : C.orange, { stroke: null });
      UI.text(ctx, h.name, W / 2 - 160, y + 33, 28, fg, { stroke: null });
      UI.text(ctx, String(h.score), W / 2 + 140, y + 33, 28, fg, { stroke: null, align: 'right' });
      UI.body(ctx, 'STAGE ' + h.stage, W / 2 + 270, y + 30, 15, i === 0 ? C.ink : C.grey, { align: 'right', weight: 700 });
    });
  },

  drawIntro() {
    const race = this.race;
    const st = race.stage;
    const th = race.theme;
    const a = Math.min(1, this.introT * 4);
    const slide = (1 - a) * 80;
    ctx.fillStyle = 'rgba(10,10,20,0.45)';
    ctx.fillRect(0, 0, W, H);
    const ch = this.champ;
    const x = W / 2 - 380 + slide;
    UI.panel(ctx, x, 190, 760, 300, { r: 18, drop: 10, band: C.red, bandH: 10, tilt: -0.015 });
    UI.tag(ctx, ch.daily ? 'DAILY CHALLENGE' : ch.arcade ? 'SINGLE RACE' : `STAGE ${race.stageIdx + 1} OF ${STAGES.length}`, x + 30, 168, { size: 22, bg: C.yellow, fg: C.ink, sw: 4, tilt: -0.04 });
    UI.text(ctx, st.name, W / 2 + slide, 300, 72, C.yellow, { align: 'center', shadow: C.red, sw: 12 });
    const km = ((race.track.finishSeg - START_SEG) * SEG) / 1000;
    const pills = [km.toFixed(1) + ' KM', st.checkpoints + ' CHECKPOINTS', THEME_LABEL[st.theme]];
    let pw = 0;
    for (const p of pills) pw += UI.measure(ctx, p, 20) + 22 + 14;
    let px = W / 2 - pw / 2 + slide;
    for (const p of pills) px += UI.tag(ctx, p, px, 335, { size: 20, bg: C.panel2, fg: C.cream }) + 14;
    if (!ch.arcade && ch.stage > 0) UI.body(ctx, `SCORE SO FAR: ${ch.score[0]}`, W / 2 + slide, 405, 20, C.grey, { align: 'center', weight: 700 });
    const best = this.bestTimes[race.stageIdx];
    if (best) UI.body(ctx, 'BEST TIME ' + U.fmtTime(best), W / 2 + slide, 432, 18, '#9fd8ff', { align: 'center', weight: 700 });
    if (Math.floor(this.t * 2) % 2) UI.text(ctx, 'PRESS ENTER TO RACE', W / 2 + slide, 474, 26, C.cream, { align: 'center', sw: 5 });
  },

  drawPause() {
    ctx.fillStyle = 'rgba(10,10,20,0.6)';
    ctx.fillRect(0, 0, W, H);
    UI.panel(ctx, W / 2 - 240, 220, 480, 280, { r: 18, drop: 10, band: C.yellow, bandH: 10 });
    UI.text(ctx, 'PAUSED', W / 2, 300, 64, C.yellow, { align: 'center', shadow: C.red });
    ['RESUME', 'RETIRE TO MENU'].forEach((s, i) => {
      const sel = i === this.pauseIdx;
      const y = 340 + i * 66;
      UI.panel(ctx, W / 2 - 190, y, 380, 52, { fill: sel ? C.yellow : C.panel2, r: 12, sw: sel ? 4 : 0, drop: 0 });
      UI.text(ctx, s, W / 2, y + 36, 26, sel ? C.ink : C.cream, { align: 'center', stroke: null });
      this.hit(W / 2 - 190, y, 380, 52, () => (this.pauseIdx = i), () => (i === 0 ? this.resume() : this.toTitle()));
    });
  },

  drawResults() {
    const { res, summary, earned } = this.results;
    const race = this.race;
    const ch = this.champ;
    UI.text(ctx, race.stage.name, 60, 78, 54, C.yellow, { shadow: C.red, tilt: -0.02 });
    UI.tag(ctx, 'RESULTS', 66 + UI.measure(ctx, race.stage.name, 54) + 20, 36, { size: 22, bg: C.cream, fg: C.ink, sw: 4, tilt: -0.04 });
    UI.panel(ctx, 50, 110, 600, 570, { r: 18, drop: 8 });
    const COLS = { red: '#e8382b', white: '#eee', blue: '#2f5fe0', yellow: '#f4c43a', green: '#1f9a4a', silver: '#a8aeb8', black: '#333', orange: '#f07020', purple: '#7a3ad0', teal: '#18a8a8' };
    res.forEach((r, i) => {
      const col = i < 10 ? 0 : 1;
      const x = 70 + col * 290, y = 128 + (i % 10) * 54;
      UI.panel(ctx, x, y, 270, 46, { fill: r.isPlayer ? C.yellow : i < 10 ? C.panel2 : '#24242e', r: 10, sw: r.isPlayer ? 3 : 0, drop: 0 });
      const fg = r.isPlayer ? C.ink : C.cream;
      UI.text(ctx, String(r.pos), x + 34, y + 33, 26, r.isPlayer ? C.red : i < 3 ? C.yellow : i < 10 ? C.cream : C.grey, { align: 'right', stroke: null });
      UI.disc(ctx, x + 54, y + 23, 9, COLS[r.col] || '#888', 2.5);
      UI.text(ctx, r.out ? r.name + ' ✗' : r.name, x + 72, y + 31, 20, fg, { stroke: null });
      if (earned[r.name]) UI.text(ctx, '+' + earned[r.name], x + 256, y + 31, 20, r.isPlayer ? C.dgreen : C.green, { align: 'right', stroke: null });
    });
    let y = 110;
    for (const s of summary) {
      const p = s.pl;
      const h = summary.length > 1 ? 280 : 400;
      UI.panel(ctx, 680, y, 550, h, { fill: C.cream, r: 18, drop: 8, band: s.qualified ? C.green : C.red, bandH: 12 });
      UI.text(ctx, summary.length > 1 ? 'PLAYER ' + (p.idx + 1) : 'YOUR RACE', 710, y + 52, 34, C.ink, { stroke: null });
      const fin = p.finished ? U.ordinal(p.finishPos) : 'OUT!';
      UI.text(ctx, fin, 1200, y + 76, 76, p.finished && p.finishPos <= 10 ? C.green : C.red, { align: 'right', shadow: C.ink, sd: 5, sw: 10 });
      const lines = [
        ['TIME', p.finished ? U.fmtTime(p.finishTime) + (p.newBest ? '  ★ BEST' : '') : '—'],
        ['TOP SPEED', Math.round(p.bestSpeed * MPH) + ' MPH'],
        ['CRASHES', String(p.crashes)],
        ['STAGE SCORE', String(s.sc)],
        ['TOTAL', String(ch.score[p.idx])],
      ];
      let ly = y + 112;
      for (const [a, b] of lines.slice(0, summary.length > 1 ? 4 : 5)) {
        UI.body(ctx, a, 712, ly, 18, '#6a6570', { weight: 700 });
        UI.text(ctx, b, 1200, ly, 24, C.ink, { align: 'right', stroke: null });
        ly += 36;
      }
      if (!ch.arcade) UI.tag(ctx, s.qualified ? 'QUALIFIED!' : 'FAILED TO QUALIFY', 955, y + h - 58, { size: 22, align: 'center', bg: s.qualified ? C.green : C.red, fg: '#fff', sw: 4, tilt: -0.03 });
      y += h + 16;
    }
    if (!ch.arcade && summary.length === 1) {
      const standings = Object.entries(ch.points).sort((a, b) => b[1] - a[1]).slice(0, 3);
      UI.panel(ctx, 680, y, 550, 680 - y, { r: 14, drop: 6 });
      UI.text(ctx, 'CHAMPIONSHIP', 700, y + 36, 22, C.yellow, { stroke: null });
      standings.forEach(([n, pt], i) => {
        UI.text(ctx, `${i + 1}. ${n}  ${pt}`, 700 + i * 180, y + 72, 18, n.startsWith('PLAYER') ? C.yellow : C.cream, { stroke: null });
      });
    }
    if (this.resultsT > 0.8) {
      UI.panel(ctx, W / 2 - 150, H - 34, 300, 30, { fill: C.ink, r: 15, sw: 0, drop: 0 });
      if (Math.floor(this.t * 2) % 2) UI.text(ctx, 'PRESS ENTER', W / 2, H - 12, 20, C.cream, { align: 'center', stroke: null });
    }
  },

  drawChampEnd() {
    const ch = this.champ;
    UI.burst(ctx, W / 2, 320, 700, this.t * 0.2, this.champWon ? C.yellow : C.red, 20, 0.12);
    if (this.champWon) {
      UI.text(ctx, 'CHAMPION!', W / 2, 250, 140, C.yellow, { align: 'center', shadow: C.red, sw: 20, tilt: -0.03 });
      const standings = Object.entries(ch.points).sort((a, b) => b[1] - a[1]);
      const top = standings[0];
      UI.tag(ctx, `${top[0]} WINS WITH ${top[1]} PTS`, W / 2, 300, { size: 26, align: 'center', bg: C.cream, fg: C.ink, sw: 4 });
    } else {
      UI.text(ctx, 'GAME OVER', W / 2, 250, 130, C.red, { align: 'center', shadow: C.yellow, sw: 18, tilt: -0.03 });
      UI.tag(ctx, 'REACHED STAGE ' + (ch.stage + 1) + ' · ' + STAGES[ch.stage].name, W / 2, 300, { size: 24, align: 'center', bg: C.cream, fg: C.ink, sw: 4 });
    }
    ch.score.forEach((s, i) => UI.text(ctx, (ch.score.length > 1 ? `P${i + 1} ` : '') + 'SCORE ' + s, W / 2, 440 + i * 64, 54, C.cream, { align: 'center', sw: 9 }));
    if (this.endT > 1 && Math.floor(this.t * 2) % 2) UI.text(ctx, 'PRESS ENTER', W / 2, 620, 26, C.cream, { align: 'center', sw: 5 });
  },

  drawEntry() {
    const e = this.entry;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .';
    UI.panel(ctx, W / 2 - 360, 170, 720, 380, { r: 18, drop: 10, band: C.yellow, bandH: 10 });
    UI.text(ctx, 'NEW HIGH SCORE!', W / 2, 250, 60, C.yellow, { align: 'center', shadow: C.red });
    UI.text(ctx, (this.champ.score.length > 1 ? `PLAYER ${e.idx + 1} · ` : '') + e.score, W / 2, 300, 32, C.cream, { align: 'center', stroke: null });
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 110 + i * 110;
      const sel = i === e.pos;
      UI.panel(ctx, x - 44, 330, 88, 110, { fill: sel ? C.yellow : C.panel2, r: 14, sw: sel ? 5 : 0, drop: 0 });
      UI.text(ctx, A[e.letters[i]], x, 415, 80, sel ? C.ink : C.cream, { align: 'center', stroke: null });
    }
    UI.body(ctx, '▲▼ LETTER   ◀▶ MOVE   ENTER OK', W / 2, 510, 18, C.grey, { align: 'center', weight: 700 });
  },
};

// ── boot + loop ──────────────────────────────────────────────────────────────
window.addEventListener('resize', resize);
resize();
Input.init();
Sound.musicOn = Game.settings.music;

const unlockAudio = () => {
  Sound.init();
  Sound.resume();
  Sound.setSfx(Game.settings.sfx);
  if (Game.mode === 'title' && !Sound.timer && Sound.musicOn) Sound.playMusic(0);
};
window.addEventListener('keydown', unlockAudio);
canvas.addEventListener('pointerdown', (e) => { unlockAudio(); Game.pointer(e, true); });
canvas.addEventListener('pointermove', (e) => Game.pointer(e, false));

const fontsReady = document.fonts
  ? Promise.race([Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('600 20px "Fredoka"')]), new Promise((r) => setTimeout(r, 2500))])
  : Promise.resolve();

Promise.all([GFX.load(), fontsReady, renderer.ready]).then(() => {
  Game.go('title');
  const q = new URLSearchParams(location.search);
  Game.autopilot = q.has('autopilot');
  if (q.has('players')) Game.settings.players = +q.get('players') === 2 ? 2 : 1;
  if (q.has('demo')) Game.startDemo(U.clamp(+q.get('demo') || 0, 0, STAGES.length - 1));
  if (q.has('race')) Game.startSingle(U.clamp(+q.get('race') || 0, 0, STAGES.length - 1), Game.settings.players);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  Game.update(dt);
  Game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
