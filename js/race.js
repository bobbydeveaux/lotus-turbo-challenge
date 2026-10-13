'use strict';
// ── Race simulation: player physics, AI rivals, timing, collisions ───────────
const VMAX = 75;            // m/s (~168 mph) top speed in 5th
const MPH = 2.23694;
const GEARS = [
  null,
  { top: 0.27, acc: 13.5 },
  { top: 0.44, acc: 11.0 },
  { top: 0.62, acc: 8.6 },
  { top: 0.81, acc: 6.6 },
  { top: 1.0, acc: 5.0 },
];
const CAR_HALF_W = 0.92;
const CAR_LEN = 4.4;
const TURBO_TIME = 2.6;

function torque(r) {
  return U.clamp(0.38 + 1.25 * r - 0.63 * r * r, 0.25, 1);
}

class Racer {
  constructor(o) {
    Object.assign(this, {
      z: 0, x: 0, vx: 0, speed: 0, seg: null, braking: false, spin: 0,
      finished: false, finishTime: 0, finishPos: 0,
    }, o);
  }
}

class Race {
  constructor(opts) {
    this.opts = opts;
    this.stageIdx = opts.stage;
    this.stage = STAGES[opts.stage];
    this.theme = THEMES[this.stage.theme];
    this.diff = DIFFICULTY[opts.difficulty];
    this.track = new Track(this.stage, this.theme);
    this.t = 0;
    this.state = 'countdown';
    this.countdown = 3.99;
    this.flash = 0;
    this.nextThunder = 6 + Math.random() * 8;
    this.finishOrder = [];
    this.events = [];
    this.raceClock = 0;

    const tr = this.track;
    const nP = opts.players.length;
    this.players = opts.players.map((p, i) => new Racer({
      isPlayer: true, idx: i, name: p.name, col: p.col, auto: p.gears === 'auto',
      gear: 1, rpm: 0, steer: 0, turbos: 3, turboT: 0, crashT: 0, slideT: 0,
      offroad: false, bounce: 0, shake: 0, visYaw: 0, pitch: 0, bgFar: 0, bgNear: 0,
      particles: [], flakes: [], msgs: [], nextCp: 0, out: false, position: 20, throttle: 0,
      timeLeft: this.sectionTime(0, START_SEG, tr.checkpoints[0] ?? tr.finishSeg) + 5,
      skid: 0, wet: 0, bestSpeed: 0, crashes: 0, splits: [],
    }));
    const rivals = RIVALS.slice(0, 20 - nP);
    this.ai = rivals.map((r) => new Racer({
      isPlayer: false, name: r.name, col: r.col,
      vmax: VMAX * r.skill * this.diff.ai * (0.98 + Math.random() * 0.04),
      lane: 0, laneT: 0, think: 0,
    }));
    // grid: rivals in front, players at the back
    const grid = [...this.ai, ...this.players.slice().reverse()];
    grid.forEach((c, j) => {
      c.z = (START_SEG - 1) * SEG - 3 - j * 6.5;
      c.x = (j % 2 ? 2.4 : -2.4) * (tr.roadHalf / 6);
      c.lane = c.x;
    });
    this.racers = [...this.players, ...this.ai];
    for (const c of this.racers) this.placeInSeg(c);
    for (const pl of this.players) this.initFlakes(pl);
  }

  sectionTime(_, fromSeg, toSeg) {
    return Math.round((((toSeg - fromSeg) * SEG) / 56) * this.diff.time);
  }

  initFlakes(pl) {
    const w = this.theme.weather;
    const n = w === 'snow' ? 220 : w ? 260 : 0;
    pl.flakes = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), r: 1 + Math.random() * 2 }));
  }

  placeInSeg(c) {
    const seg = this.track.find(c.z);
    if (c.seg === seg) return;
    if (c.seg) {
      const i = c.seg.cars.indexOf(c);
      if (i >= 0) c.seg.cars.splice(i, 1);
    }
    seg.cars.push(c);
    c.seg = seg;
  }

  msg(pl, text, col = '#ffdd33', dur = 1.8, size = 1) {
    pl.msgs.push({ text, col, t: dur, max: dur, size });
  }

  // ── main update ───────────────────────────────────────────────────────────
  update(dt, inputs) {
    this.t += dt;
    this.events.length = 0;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) this.events.push('beep');
      if (this.countdown <= 0) {
        this.state = 'race';
        this.events.push('go');
        for (const pl of this.players) this.msg(pl, 'GO!', '#55ff55', 1.0, 1.6);
      }
    } else if (this.state === 'race' || this.state === 'done') {
      this.raceClock += dt;
    }

    for (const pl of this.players) this.updatePlayer(pl, dt, inputs[pl.idx]);
    if (this.state !== 'countdown') for (const c of this.ai) this.updateAI(c, dt);
    for (const c of this.racers) this.placeInSeg(c);
    this.updatePositions();
    this.updateWeather(dt);

    if (this.state === 'race' && this.players.every((p) => p.finished || p.out)) {
      this.state = 'done';
      this.doneT = 0;
    }
    if (this.state === 'done') this.doneT += dt;
  }

  updateWeather(dt) {
    const w = this.theme.weather;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (w === 'storm') {
      this.nextThunder -= dt;
      if (this.nextThunder <= 0) {
        this.flash = 1;
        this.nextThunder = 7 + Math.random() * 12;
        this.pendingThunder = 0.4 + Math.random() * 0.8;
      }
      if (this.pendingThunder > 0) {
        this.pendingThunder -= dt;
        if (this.pendingThunder <= 0) this.events.push('thunder');
      }
    }
    for (const pl of this.players) {
      const sp = pl.speed / VMAX;
      for (const f of pl.flakes) {
        if (w === 'snow') {
          const dx = f.x - 0.5, dy = f.y - 0.4;
          f.x += (dx * sp * 2.2 * (0.5 + f.z) + 0.02) * dt - pl.vx * 0.003 * dt * 10;
          f.y += (0.06 + f.z * 0.1 + dy * sp * 2.2 * (0.5 + f.z)) * dt;
          if (f.x < -0.02 || f.x > 1.02 || f.y > 1.02 || f.y < -0.02) {
            if (sp > 0.2) { f.x = 0.5 + (Math.random() - 0.5) * 0.7; f.y = 0.4 + (Math.random() - 0.5) * 0.5; }
            else { f.x = Math.random(); f.y = -0.02; }
            f.z = Math.random();
          }
        } else {
          f.y += (1.4 + f.z * 1.2 + sp * 0.6) * dt;
          f.x -= (0.25 + sp * 0.2) * dt * (f.x - 0.5 + 0.6) * 0.5;
          if (f.y > 1.05) { f.y = -0.05 - Math.random() * 0.1; f.x = Math.random() * 1.2 - 0.1; f.z = Math.random(); }
        }
      }
    }
  }

  // ── player ────────────────────────────────────────────────────────────────
  updatePlayer(pl, dt, inp) {
    const tr = this.track;
    const th = this.theme;
    const RH = tr.roadHalf;
    const racing = this.state === 'race' && !pl.finished && !pl.out;
    if (!racing) {
      // countdown: free-rev only; after finish / timeout: coast & keep straight
      inp = this.state === 'countdown' ? { steer: 0, accel: inp.accel, brake: 0 } : { steer: U.clamp(-pl.x * 0.3, -1, 1), accel: 0, brake: pl.out ? 0.3 : 0.15 };
    }
    for (const m of pl.msgs) m.t -= dt;
    pl.msgs = pl.msgs.filter((m) => m.t > 0);
    pl.shake = Math.max(0, pl.shake - dt * 2);
    const seg = tr.find(pl.z);
    let grip = th.grip || 1;

    // surface hazards
    let onDecal = null;
    for (const d of seg.decals) if (Math.abs(pl.x - d.x) < d.w + 0.7) onDecal = d;
    if (onDecal && pl.speed > 12) {
      if (onDecal.type === 'ice') grip *= 0.3;
      if (onDecal.type === 'puddle' || onDecal.type === 'oil') {
        if (pl.lastDecal !== onDecal) {
          pl.lastDecal = onDecal;
          pl.slideT = onDecal.type === 'oil' ? 1.0 : 0.6;
          pl.slideDir = Math.random() < 0.5 ? -1 : 1;
          pl.speed *= onDecal.type === 'oil' ? 0.92 : 0.9;
          if (onDecal.type === 'puddle') { this.events.push('splash'); pl.wet = 0.6; }
        }
      }
    } else if (!onDecal) pl.lastDecal = null;
    if (pl.slideT > 0) {
      pl.slideT -= dt;
      grip *= 0.35;
      pl.vx += pl.slideDir * 9 * dt * (pl.speed / VMAX);
    }

    // steering input (smoothed)
    const crashed = pl.crashT > 0;
    if (crashed) {
      pl.crashT -= dt;
      inp = { steer: 0, accel: 0, brake: 0 };
      pl.spin = Math.sin(pl.crashT * 9) * 0.6 * pl.crashT;
    } else pl.spin = 0;
    pl.steer = U.approach(pl.steer, inp.steer, dt * (inp.steer ? 4.5 : 7));

    // gears / engine
    if (inp.turbo && racing && pl.turbos > 0 && pl.turboT <= 0 && !crashed) {
      pl.turbos--;
      pl.turboT = TURBO_TIME;
      this.events.push('turbo');
      this.msg(pl, 'TURBO!', '#66ccff', 1.0, 1.2);
    }
    if (pl.turboT > 0) pl.turboT -= dt;
    const tboost = pl.turboT > 0 ? 1.16 : 1;
    if (!pl.auto && racing) {
      if (inp.up && pl.gear < 5) { pl.gear++; this.events.push('gear'); }
      if (inp.dn && pl.gear > 1) { pl.gear--; this.events.push('gear'); }
    }
    let gearTop = GEARS[pl.gear].top * VMAX * tboost;
    pl.rpm = pl.speed / gearTop;
    if (pl.auto || !racing) {
      if (pl.rpm > 0.96 && pl.gear < 5 && inp.accel) { pl.gear++; this.events.push('gear'); }
      else if (pl.gear > 1 && pl.speed < GEARS[pl.gear - 1].top * VMAX * 0.6) pl.gear--;
      gearTop = GEARS[pl.gear].top * VMAX * tboost;
      pl.rpm = pl.speed / gearTop;
    }
    pl.throttle = U.approach(pl.throttle, inp.accel, dt * 6);

    let a = 0;
    if (this.state === 'countdown') {
      pl.rpmFree = U.approach(pl.rpmFree || 0, inp.accel ? 0.85 : 0.08, dt * (inp.accel ? 1.8 : 1.2));
      pl.rpm = pl.rpmFree;
    } else {
      if (inp.accel > 0) {
        if (pl.rpm < 1) a += GEARS[pl.gear].acc * torque(pl.rpm) * inp.accel * (pl.turboT > 0 ? 1.7 : 1);
        else a -= 2.5;
      } else {
        a -= 1.2 + (6 - pl.gear) * 0.35;
      }
      if (pl.rpm > 1.04) a -= (pl.rpm - 1) * 30; // over-rev after downshift
      if (inp.brake > 0) a -= 26 * inp.brake;
      a -= 1.2 + 0.00038 * pl.speed * pl.speed;
    }
    pl.braking = inp.brake > 0 && pl.speed > 1;

    // off-road
    pl.offroad = Math.abs(pl.x) > RH + 0.3;
    const onKerb = !pl.offroad && Math.abs(pl.x) > RH - 0.4;
    if (pl.offroad) {
      a -= 3 + 0.004 * pl.speed * pl.speed;
      if (pl.speed > 26) a -= 10;
    }
    pl.speed = U.clamp(pl.speed + a * dt, 0, VMAX * 1.25);
    pl.bestSpeed = Math.max(pl.bestSpeed, pl.speed);

    // lateral motion: steering vs. centrifugal drift
    const steerRate = Math.min(pl.speed * 0.42, 10.5) * (0.65 + 0.35 * grip);
    const targetVx = pl.steer * steerRate;
    pl.vx = U.approach(pl.vx, targetVx, dt * 26 * grip);
    const kappa = seg.curve / (SEG * SEG);
    const drift = pl.speed * pl.speed * kappa * (1.5 / Math.max(0.5, grip));
    pl.x += (pl.vx - drift) * dt;
    pl.x = U.clamp(pl.x, -RH - 30, RH + 30);
    const cornerLoad = Math.abs(pl.steer) * pl.speed / VMAX;
    pl.skid = U.approach(pl.skid, (cornerLoad > 0.75 && Math.abs(drift) > 4) || pl.slideT > 0 || (pl.braking && pl.speed > 40) ? 1 : 0, dt * 5);

    const prevZ = pl.z;
    pl.z += pl.speed * dt;

    // visuals
    const yawTarget = pl.steer * 15 + U.clamp(-drift * 1.2, -8, 8) + (pl.slideT > 0 ? pl.slideDir * 18 : 0);
    pl.visYaw = crashed ? pl.spin * 50 : U.approach(pl.visYaw, yawTarget, dt * 120);
    pl.bgFar += seg.curve * pl.speed * dt * 40;
    pl.bgNear += seg.curve * pl.speed * dt * 75;
    pl.pitch = U.lerp(pl.pitch, (tr.heightAt(pl.z + 60) - tr.heightAt(pl.z)) * 1.6, dt * 3);
    const sp = pl.speed / VMAX;
    pl.bounce = (pl.offroad ? Math.sin(this.t * 37) * 6 * sp + (Math.random() - 0.5) * 6 * sp : 0) + (onKerb ? Math.sin(this.t * 60) * 2.5 * sp : 0) + Math.sin(this.t * 11) * 0.6 * sp;
    if (pl.offroad && pl.speed > 10) pl.shake = Math.max(pl.shake, 0.15 * sp);
    this.emitParticles(pl, dt, onDecal);

    // collisions
    this.collideSprites(pl, prevZ);
    this.collideCars(pl);

    // checkpoints & finish
    if (this.state === 'race' && !pl.finished && !pl.out) {
      const cps = tr.checkpoints;
      if (pl.nextCp < cps.length && pl.z >= cps[pl.nextCp] * SEG) {
        const from = cps[pl.nextCp];
        const to = cps[pl.nextCp + 1] ?? tr.finishSeg;
        const add = this.sectionTime(0, from, to);
        pl.timeLeft += add;
        pl.splits.push(this.raceClock);
        pl.nextCp++;
        pl.turbos = Math.min(5, pl.turbos + 1);
        this.events.push('checkpoint');
        this.msg(pl, 'CHECKPOINT', '#ffdd33', 2.2, 1.3);
        this.msg(pl, 'EXTENDED PLAY  +' + add + 's', '#ffffff', 2.2, 0.7);
      }
      if (pl.z >= tr.finishSeg * SEG) {
        pl.finished = true;
        pl.finishTime = this.raceClock;
        this.finishOrder.push(pl);
        pl.finishPos = this.finishOrder.length;
        this.events.push('finish');
        this.msg(pl, 'FINISHED ' + U.ordinal(pl.finishPos), pl.finishPos <= 10 ? '#55ff55' : '#ff8844', 6, 1.4);
      }
      pl.timeLeft -= dt;
      if (pl.timeLeft <= 0 && !pl.finished) {
        pl.timeLeft = 0;
        pl.out = true;
        this.events.push('timeout');
        this.msg(pl, 'OUT OF TIME', '#ff3333', 8, 1.6);
      } else if (pl.timeLeft < 10 && Math.ceil(pl.timeLeft) !== Math.ceil(pl.timeLeft + dt)) {
        this.events.push('warn');
      }
    }
  }

  emitParticles(pl, dt, decal) {
    const th = this.theme;
    const sp = pl.speed / VMAX;
    const ps = pl.particles;
    for (const p of ps) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 1.5 * dt;
    }
    pl.particles = ps.filter((p) => p.life > 0);
    if (pl.particles.length > 140) return;
    const emit = (n, col, a, r, vy, life) => {
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        pl.particles.push({ x: side * 0.75 + (Math.random() - 0.5) * 0.3, y: 0.15, vx: side * (0.5 + Math.random() * 1.5) - pl.vx * 0.1, vy: vy * (0.6 + Math.random() * 0.8), col, a, r, life, max: life });
      }
    };
    if (pl.offroad && pl.speed > 8) {
      const col = th.weather === 'snow' ? '#f4f8ff' : th.dust ? U.rgb(th.dust) : U.rgb(U.hex(th.grass[0]).map((v) => v * 0.8));
      if (Math.random() < sp * 1.5) emit(2, col, 0.7, 0.16, 2.5, 0.6);
    }
    if ((decal && decal.type === 'puddle' && pl.speed > 12) || (th.weather === 'storm' && pl.speed > 30 && Math.random() < 0.25)) emit(2, 'rgba(210,225,240,1)', 0.35, 0.13, 3.5, 0.45);
    if (th.weather === 'snow' && pl.speed > 25 && Math.random() < sp * 0.6) emit(1, '#ffffff', 0.5, 0.12, 2, 0.5);
    if (pl.skid > 0.5 && pl.speed > 15 && Math.random() < 0.6) emit(1, 'rgba(220,220,220,1)', 0.3, 0.18, 1.2, 0.9);
  }

  collideSprites(pl, prevZ) {
    const tr = this.track;
    const front0 = prevZ + 1.8, front1 = pl.z + 1.8;
    const s0 = tr.find(front0).i, s1 = tr.find(front1).i;
    for (let i = s0; i <= s1; i++) {
      const seg = tr.segments[i];
      const sz = seg.p1.wz;
      if (!(front0 < sz + 0.01 && front1 >= sz) && !(i === s0 && seg.sprites.some((s) => s.wall))) continue;
      for (const sp of seg.sprites) {
        if (!sp.hit && !sp.wall) continue;
        const def = GFX.sprite(sp.s);
        if (!def) continue;
        if (sp.wall) {
          const edge = Math.abs(sp.x) - 0.4;
          if (Math.sign(pl.x) === Math.sign(sp.x) && Math.abs(pl.x) + CAR_HALF_W > edge) {
            pl.x = Math.sign(sp.x) * (edge - CAR_HALF_W);
            pl.vx = -Math.sign(sp.x) * 3;
            if (pl.speed > 20 && !pl.scrapeT) { this.events.push('bump'); pl.scrapeT = 0.4; }
            pl.speed *= 0.985;
            pl.shake = Math.max(pl.shake, 0.3);
          }
          continue;
        }
        const hw = sp.hit * def.wm * sp.scale;
        if (Math.abs(pl.x - sp.x) < hw + CAR_HALF_W) this.crash(pl, sp);
      }
    }
    if (pl.scrapeT) pl.scrapeT = Math.max(0, pl.scrapeT - 1 / 60);
  }

  crash(pl, sp) {
    if (pl.crashT > 0) return;
    if (pl.speed > 22) {
      pl.speed *= 0.12;
      pl.crashT = 1.1;
      pl.shake = 1;
      pl.crashes++;
      pl.vx = 0;
      this.events.push('crash');
      this.msg(pl, 'CRASH!', '#ff4422', 1.0, 1.2);
    } else {
      pl.speed *= 0.4;
      pl.shake = 0.4;
      this.events.push('bump');
    }
    // nudge away from the obstacle so we don't snag it again
    const dir = pl.x < sp.x ? -1 : 1;
    pl.x += dir * 0.4;
  }

  collideCars(pl) {
    if (pl.crashT > 0) return;
    for (const c of this.racers) {
      if (c === pl) continue;
      const dz = c.z - pl.z;
      if (Math.abs(dz) > CAR_LEN) continue;
      const dx = c.x - pl.x;
      if (Math.abs(dx) > CAR_HALF_W * 2) continue;
      if (dz > 0) {
        // rear-ended someone
        if (pl.speed > c.speed) {
          const hard = pl.speed - c.speed > 15;
          pl.speed = c.speed * (hard ? 0.7 : 0.92);
          pl.z = c.z - CAR_LEN;
          if (!c.isPlayer) c.speed = Math.min(c.vmax, c.speed + 3);
          pl.shake = hard ? 0.6 : 0.3;
          this.events.push('bump');
        }
      } else if (c.speed > pl.speed) {
        // hit from behind
        if (!c.isPlayer) { c.speed = pl.speed * 0.9; c.z = pl.z - CAR_LEN; }
        pl.speed = Math.min(pl.speed + 4, VMAX);
        this.events.push('bump');
      }
      // side shove
      const push = (CAR_HALF_W * 2 - Math.abs(dx)) * 0.5 * (dx > 0 ? 1 : -1);
      pl.x -= push;
      if (!c.isPlayer) { c.x += push; c.lane = c.x; }
    }
  }

  // autopilot for demo / attract mode: drives a human car like a decent rival
  autopilot(pl) {
    const tr = this.track;
    const RH = tr.roadHalf;
    const seg = tr.find(pl.z);
    const grip = this.theme.grip || 1;
    const drift = pl.speed * pl.speed * (seg.curve / (SEG * SEG)) * (1.5 / Math.max(0.5, grip));
    if (pl.aiLane === undefined) pl.aiLane = 0;
    for (const o of this.racers) {
      if (o === pl) continue;
      const dz = o.z - pl.z;
      if (dz > 0 && dz < 32 && Math.abs(o.x - pl.aiLane) < 2.3 && o.speed < pl.speed) {
        const l = o.x - 2.9, r = o.x + 2.9;
        pl.aiLane = l > -RH + 1.3 && (Math.abs(l - pl.x) < Math.abs(r - pl.x) || r > RH - 1.3) ? l : r;
      }
    }
    for (let i = 1; i < 14; i++) {
      const s2 = tr.segments[Math.min(seg.i + i, tr.segments.length - 1)];
      for (const sp of s2.sprites) if (sp.onRoad && Math.abs(sp.x - pl.aiLane) < 3.4) pl.aiLane = sp.x + (sp.x > 0 ? -3.8 : 3.8);
      for (const d of s2.decals) if (Math.abs(d.x - pl.aiLane) < d.w + 1.2) pl.aiLane = d.x + (d.x > 0 ? -(d.w + 2) : d.w + 2);
    }
    pl.aiLane = U.clamp(pl.aiLane, -RH + 1.3, RH - 1.3);
    let maxC = 0;
    for (let i = 0; i < 22; i++) maxC = Math.max(maxC, Math.abs(tr.segments[Math.min(seg.i + i, tr.segments.length - 1)].curve));
    const limit = VMAX * (1 - U.clamp((maxC - 0.02) * 7, 0, 0.3)) * Math.min(1, grip + 0.15);
    const steerRate = Math.max(1, Math.min(pl.speed * 0.42, 10.5) * (0.65 + 0.35 * grip));
    const vx = drift + U.clamp((pl.aiLane - pl.x) * 1.3, -6, 6);
    const over = pl.speed > limit;
    return {
      steer: U.clamp(vx / steerRate, -1, 1),
      accel: over ? 0 : 1,
      brake: over && pl.speed > limit + 4 ? 0.5 : 0,
      turbo: maxC < 0.012 && pl.speed > 50 && Math.random() < 0.004,
      up: false, dn: false,
    };
  }

  // ── AI ────────────────────────────────────────────────────────────────────
  updateAI(c, dt) {
    const tr = this.track;
    const RH = tr.roadHalf;
    const seg = tr.find(c.z);
    // look ahead for curves
    let maxC = 0;
    for (let i = 0; i < 25; i++) maxC = Math.max(maxC, Math.abs(tr.segments[Math.min(seg.i + i, tr.segments.length - 1)].curve));
    let target = c.vmax * (1 - U.clamp((maxC - 0.012) * 9, 0, 0.32));
    // gentle rubber-banding relative to the lead human
    const lead = this.players.reduce((a, b) => (b.z > a.z ? b : a));
    const gap = c.z - lead.z;
    if (gap > 500) target *= 0.94;
    else if (gap < -250) target *= 1.06;
    if (c.finished) target = Math.max(0, target * (1 - (c.z - tr.finishSeg * SEG) / 600));
    if (c.z > (tr.finishSeg + RUNOFF * 0.6) * SEG) target = 0;

    // traffic awareness
    c.think -= dt;
    let blocker = null;
    for (const o of this.racers) {
      if (o === c) continue;
      const dz = o.z - c.z;
      if (dz > 0 && dz < 28 && Math.abs(o.x - c.x) < 2.3) { if (!blocker || dz < blocker.z - c.z) blocker = o; }
    }
    for (let i = 1; i < 12; i++) {
      const s2 = tr.segments[Math.min(seg.i + i, tr.segments.length - 1)];
      for (const sp of s2.sprites) {
        if (sp.onRoad && Math.abs(sp.x - c.lane) < 3.2) c.lane = sp.x + (sp.x > 0 ? -3.6 : 3.6);
      }
    }
    if (blocker) {
      if (c.speed > blocker.speed - 1 && c.think <= 0) {
        const left = blocker.x - 2.8, right = blocker.x + 2.8;
        const canL = left > -RH + 1.2, canR = right < RH - 1.2;
        c.lane = canL && canR ? (Math.abs(left - c.x) < Math.abs(right - c.x) ? left : right) : canL ? left : canR ? right : c.x;
        c.think = 0.6;
        if (!canL && !canR) target = Math.min(target, blocker.speed);
      }
      if (blocker.z - c.z < 9 && Math.abs(blocker.x - c.x) < 2) target = Math.min(target, blocker.speed * 0.97);
    } else if (c.think <= 0 && Math.random() < 0.004) {
      c.lane = (Math.random() * 2 - 1) * (RH - 1.6);
      c.think = 2;
    }
    c.lane = U.clamp(c.lane, -RH + 1.2, RH - 1.2);

    const acc = c.speed < target ? 7.5 * (1 - c.speed / (VMAX * 1.3)) + 2 : -9;
    c.braking = c.speed > target + 4;
    c.speed = U.clamp(c.speed + acc * dt, 0, Math.max(target, c.speed - 9 * dt));
    if (c.speed < target && c.speed + acc * dt > target) c.speed = target;
    const want = U.clamp((c.lane - c.x) * 1.4, -5, 5);
    c.vx = U.approach(c.vx, want, dt * 10);
    c.x += c.vx * dt;
    c.z += c.speed * dt;

    if (!c.finished && c.z >= tr.finishSeg * SEG) {
      c.finished = true;
      c.finishTime = this.raceClock;
      this.finishOrder.push(c);
      c.finishPos = this.finishOrder.length;
    }
  }

  updatePositions() {
    const sorted = this.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishPos - b.finishPos;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.z - a.z;
    });
    sorted.forEach((c, i) => (c.position = i + 1));
    this.order = sorted;
  }

  // final classification once the humans are done
  results() {
    return this.order.map((c) => ({
      name: c.name, col: c.col, isPlayer: c.isPlayer, idx: c.idx, pos: c.position,
      finished: c.finished || !c.isPlayer, out: !!c.out,
      time: c.finished ? c.finishTime : null,
    }));
  }
}
