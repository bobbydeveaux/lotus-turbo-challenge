'use strict';
// ── Track: segment list with curves, hills, scenery, hazards, gantries ───────
const SEG = 6;            // metres per segment
const DRAW_DIST = 260;    // segments drawn ahead
const RUMBLE_SEGS = 2;
const START_SEG = 34;     // start line (grid sits behind it)
const RUNOFF = DRAW_DIST + 40;

class Track {
  constructor(stage, theme) {
    this.stage = stage;
    this.theme = theme;
    this.roadHalf = theme.roadHalf || 6;
    this.lanes = theme.lanes || 3;
    this.segments = [];
    this.rng = U.rng(stage.seed * 7919 + 13);
    this.build();
  }

  lastY() {
    const s = this.segments;
    return s.length ? s[s.length - 1].p2.wy : 0;
  }

  addSeg(curve, y) {
    const n = this.segments.length;
    this.segments.push({
      i: n,
      curve,
      p1: { wy: this.lastY(), wz: n * SEG },
      p2: { wy: y, wz: (n + 1) * SEG },
      sprites: [],
      cars: [],
      decals: [],
      alt: Math.floor(n / RUMBLE_SEGS) % 2,
      dash: Math.floor(n / 2) % 3 === 0,
      fog: 0,
      clip: 0,
      lit: 0,
      line: null,
    });
  }

  addRoad(enter, hold, leave, curve, dy) {
    const sy = this.lastY();
    const ey = sy + dy;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) this.addSeg(U.easeIn(0, curve, n / enter), U.easeInOut(sy, ey, n / total));
    for (let n = 0; n < hold; n++) this.addSeg(curve, U.easeInOut(sy, ey, (enter + n) / total));
    for (let n = 0; n < leave; n++) this.addSeg(U.easeInOut(curve, 0, n / leave), U.easeInOut(sy, ey, (enter + hold + n) / total));
  }

  build() {
    const r = this.rng;
    const st = this.stage;
    const L = st.length;
    const CURVES = [0.010, 0.018, 0.027, 0.038, 0.05];

    this.addRoad(10, 40, 10, 0, 0);
    while (this.segments.length < L - 60) {
      const roll = r();
      const hill = () => {
        if (r() > st.hilly) return 0;
        let dy = r.range(-1, 1) * 45 * st.hilly;
        const y = this.lastY();
        if (y > 90) dy = -Math.abs(dy);
        if (y < -90) dy = Math.abs(dy);
        return dy;
      };
      const ci = Math.min(CURVES.length - 1, Math.floor(r() * (2 + st.curvy * 4)));
      const curve = CURVES[ci] * (r() < 0.5 ? -1 : 1);
      if (roll < 0.22 * (1.2 - st.curvy)) {
        this.addRoad(10, r.int(20, 60), 10, 0, hill());
      } else if (roll < 0.35) {
        // S-bend
        const e = r.int(12, 22);
        this.addRoad(e, r.int(12, 30), e, curve, hill());
        this.addRoad(e, r.int(12, 30), e, -curve, hill());
      } else if (roll < 0.45 && st.hilly > 0.3) {
        // rollercoaster bumps
        for (let k = 0; k < 3; k++) this.addRoad(8, 6, 8, 0, (k % 2 ? -1 : 1) * r.range(10, 22) * st.hilly);
      } else {
        this.addRoad(r.int(15, 30), r.int(20, 70), r.int(15, 30), curve, hill());
      }
    }
    const remain = L - this.segments.length;
    this.addRoad(10, Math.max(10, remain - 20), 10, 0, -this.lastY() * 0.3);
    this.finishSeg = this.segments.length - 1;
    // run-off past the finish
    this.addRoad(20, RUNOFF, 20, 0, 0);
    this.length = this.segments.length * SEG;

    // gantries + timing lines
    this.checkpoints = [];
    for (let k = 1; k <= st.checkpoints; k++) this.checkpoints.push(Math.round((this.finishSeg * k) / (st.checkpoints + 1)));
    this.placeGantry(START_SEG, 'gantry_start', 'start');
    for (const c of this.checkpoints) this.placeGantry(c, 'gantry_check', 'check');
    this.placeGantry(this.finishSeg, 'gantry_finish', 'finish');

    this.placeScenery();
    this.placeHazards();
  }

  placeGantry(i, sprite, line) {
    const seg = this.segments[i];
    const g = GFX.sprite(sprite);
    const scale = g ? (this.roadHalf * 2 + 5) / (g.wm * 0.94) : 1;
    seg.sprites.push({ s: sprite, x: 0, scale, hit: 0, gantry: true });
    seg.line = line;
  }

  nearGantry(i, d) {
    if (Math.abs(i - START_SEG) < d || Math.abs(i - this.finishSeg) < d) return true;
    for (const c of this.checkpoints) if (Math.abs(i - c) < d) return true;
    return false;
  }

  placeScenery() {
    const r = this.rng;
    const th = this.theme;
    const RH = this.roadHalf;
    const segs = this.segments;
    for (const seg of segs) {
      const i = seg.i;
      const blockSide = { '-1': false, '1': false };
      // curve warning chevrons on the outside of bends
      if (Math.abs(seg.curve) >= 0.02 && i % 6 === 0 && !th.regular?.some((g) => g.wall)) {
        const side = seg.curve > 0 ? -1 : 1;
        seg.sprites.push({ s: seg.curve > 0 ? 'chevR' : 'chevL', x: side * (RH + 1.6), scale: 1, hit: 0.45 });
        blockSide[side] = true;
      }
      if (th.regular) {
        for (const g of th.regular) {
          if ((i + (g.phase || 0)) % g.every !== 0) continue;
          if (g.gantryClear !== false && this.nearGantry(i, 2) && !g.wall) continue;
          const sides = g.side ? [g.side] : [-1, 1];
          for (const sd of sides) {
            const spr = { s: g.s, x: sd * (RH + g.off), scale: 1, hit: g.hit || 0, wall: !!g.wall };
            if (g.light) {
              spr.light = g.light;
              for (let d = -2; d <= 2; d++) if (segs[i + d]) segs[i + d].lit = Math.max(segs[i + d].lit, 1 - Math.abs(d) * 0.3);
            }
            seg.sprites.push(spr);
          }
        }
      }
      if (this.nearGantry(i, 3)) continue;
      for (const sd of [-1, 1]) {
        if (blockSide[sd]) continue;
        let p = th.density * 0.5;
        while (r() < p) {
          const it = r.weighted(th.scenery);
          const big = /^(bb_|cottage|tower)/.test(it.s);
          seg.sprites.push({
            s: it.s,
            x: sd * (RH + r.range(it.min, it.max)),
            scale: big ? 1 : r.range(0.8, 1.25),
            hit: it.hit,
          });
          p *= 0.45;
        }
      }
    }
  }

  placeHazards() {
    const r = this.rng;
    const hz = this.theme.hazards || {};
    const RH = this.roadHalf;
    for (const seg of this.segments) {
      const i = seg.i;
      if (i < 80 || i > this.finishSeg - 20 || this.nearGantry(i, 12)) continue;
      if (hz.log && r() < hz.log) seg.sprites.push({ s: 'log', x: r.range(-RH + 2.2, RH - 2.2), scale: 1, hit: 0.48, onRoad: true });
      if (hz.rock && r() < hz.rock) seg.sprites.push({ s: 'rock', x: r.range(-RH + 1, RH - 1), scale: 0.5, hit: 0.4, onRoad: true });
      for (const type of ['puddle', 'ice', 'oil']) {
        if (hz[type] && r() < hz[type]) {
          const len = r.int(2, 4);
          const d = { type, x: r.range(-RH + 1.5, RH - 1.5), w: r.range(1.0, 2.0) };
          for (let k = 0; k < len; k++) if (this.segments[i + k]) this.segments[i + k].decals.push(d);
        }
      }
    }
  }

  find(z) {
    const n = Math.floor(z / SEG);
    return this.segments[U.clamp(n, 0, this.segments.length - 1)];
  }

  heightAt(z) {
    const seg = this.find(z);
    const t = (z % SEG) / SEG;
    return U.lerp(seg.p1.wy, seg.p2.wy, t);
  }
}
