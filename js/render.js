'use strict';
// ── Pseudo-3D renderer (one call per split-screen viewport) ─────────────────
const CAM = { height: 2.6, dist: 3.4, depth: 1 / Math.tan((50 * Math.PI) / 180), near: 0.6 };
// sprite-space positions on the car (metres, measured from sprite bottom-centre)
const CAR_TAIL = { x: 0.56, y: 0.42 };
const CAR_EXHAUST = { x: -0.36, y: 0.16 };

function makeGlow(rgb, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.25, `rgba(${rgb},0.55)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.glowWarm = makeGlow('255,214,140', 128);
    this.glowRed = makeGlow('255,30,10', 64);
    this.glowBlue = makeGlow('120,180,255', 64);
    this.glowWhite = makeGlow('255,255,255', 128);
    const r = U.rng(99);
    this.stars = Array.from({ length: 160 }, () => ({ x: r(), y: r() * r(), s: r() < 0.1 ? 2 : 1, a: 0.4 + r() * 0.6 }));
  }

  setup(theme) {
    this.theme = theme;
    const P = (a) => a.map(U.hex);
    this.pal = {
      grass: P(theme.grass), verge: P(theme.verge || theme.grass), road: P(theme.road), rumble: P(theme.rumble),
      lane: U.hex(theme.lane), fog: theme.fog,
    };
    this.pages = GFX.tinted(theme.tint);
    const bgT = theme.bgTint || theme.tint;
    this.bgFar = theme.bgFar ? GFX.tintedBg(theme.bgFar, bgT) : null;
    this.bgNear = theme.bgNear ? (theme.bgNearNoTint ? GFX.bgs[theme.bgNear] : GFX.tintedBg(theme.bgNear, bgT)) : null;
    this.cloudCache = this.cloudCache || new Map();
    if (theme.clouds && !this.cloudCache.has(theme)) this.cloudCache.set(theme, this.makeClouds(theme.clouds));
    this.clouds = theme.clouds ? this.cloudCache.get(theme) : null;
  }

  makeClouds(cfg) {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 260;
    const g = c.getContext('2d');
    const r = U.rng(7);
    for (let i = 0; i < cfg.count; i++) {
      const cx = r() * 2048, cy = 40 + r() * 170, w = 120 + r() * 240;
      for (let k = 0; k < 14; k++) {
        const x = cx + (r() - 0.5) * w, y = cy + (r() - 0.5) * w * 0.18, rad = w * (0.12 + r() * 0.16);
        for (const ox of [-2048, 0, 2048]) {
          const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
          gr.addColorStop(0, U.rgba(cfg.col, cfg.alpha * 0.55));
          gr.addColorStop(1, U.rgba(cfg.col, 0));
          g.fillStyle = gr;
          g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
        }
      }
    }
    return c;
  }

  // ── sky + parallax ────────────────────────────────────────────────────────
  drawSky(W, H, hz, pl, race) {
    const ctx = this.ctx;
    const th = this.theme;
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.6, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hz + 2);
    const sc = H / 720;
    if (th.stars) {
      ctx.fillStyle = '#fff';
      for (const s of this.stars) {
        ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(race.t * 2 + s.x * 50));
        const x = (((s.x * W * 1.5 - pl.bgFar * 0.3) % W) + W) % W;
        ctx.fillRect(x, s.y * hz * 0.9, s.s * sc, s.s * sc);
      }
      ctx.globalAlpha = 1;
    }
    if (th.moon) {
      const x = ((((th.moon.x * W - pl.bgFar * 0.3) % (W * 1.6)) + W * 1.6) % (W * 1.6)) - W * 0.3;
      const y = th.moon.y * H, r = th.moon.r * sc;
      ctx.drawImage(this.glowBlue, x - r * 4, y - r * 4, r * 8, r * 8);
      ctx.fillStyle = '#f2f0e6';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(180,180,170,0.5)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.2, r * 0.25, 0, Math.PI * 2); ctx.arc(x + r * 0.35, y + r * 0.3, r * 0.18, 0, Math.PI * 2); ctx.fill();
    }
    if (th.sun) {
      const x = ((((th.sun.x * W - pl.bgFar * 0.3) % (W * 1.6)) + W * 1.6) % (W * 1.6)) - W * 0.3;
      const y = th.sun.y * H, r = th.sun.r * sc;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glowWarm, x - r * 6, y - r * 6, r * 12, r * 12);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = th.sun.col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    if (this.clouds) {
      const cw = 2048 * sc, ch = 260 * sc;
      let x = -((pl.bgFar * 0.5 + race.t * 6 * sc) % cw);
      if (x > 0) x -= cw;
      for (; x < W; x += cw) ctx.drawImage(this.clouds, x, hz * 0.05, cw, ch * (hz / (360 * sc)));
    }
    const lift = U.clamp(pl.pitch, -40, 40) * sc;
    const alpha = th.bgAlpha ?? 1;
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (this.bgFar) this.drawLayer(this.bgFar, pl.bgFar, W, hz + lift * 0.5, 1.0 * sc);
    if (this.bgNear) this.drawLayer(this.bgNear, pl.bgNear, W, hz + lift, 1.25 * sc);
    ctx.globalAlpha = 1;
  }

  drawLayer(img, off, W, baseY, sc) {
    const ctx = this.ctx;
    const tw = img.width * sc, th = img.height * sc;
    let x = -(((off % tw) + tw) % tw);
    const y = baseY - th + 20 * sc;
    for (; x < W; x += tw) ctx.drawImage(img, Math.floor(x), y, Math.ceil(tw) + 1, th);
  }

  // ── main view ─────────────────────────────────────────────────────────────
  drawView(view, race, pl) {
    const ctx = this.ctx;
    const W = view.w, H = view.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x, view.y, W, H);
    ctx.clip();
    const shake = pl.shake > 0 ? pl.shake : 0;
    ctx.translate(view.x + (Math.random() - 0.5) * shake * 8, view.y + (Math.random() - 0.5) * shake * 6);

    const track = race.track;
    const segs = track.segments;
    const th = this.theme;
    const pal = this.pal;
    const RH = track.roadHalf;
    const hz = Math.round(H * 0.4);
    const zoom = 1 - 0.08 * U.clamp((pl.speed - 50) / 40, 0, 1) - (pl.turboT > 0 ? 0.04 : 0);
    const k = CAM.depth * H * 0.89 * zoom;
    const camZ = pl.z - CAM.dist;
    const base = track.find(camZ);
    const basePct = (camZ - base.p1.wz) / SEG;
    const playerY = track.heightAt(pl.z);
    const camY = playerY + CAM.height + pl.bounce * 0.04;
    const camX = pl.x;
    const night = !!th.night;

    this.drawSky(W, H, hz, pl, race);

    // ground fill under horizon (fogged) — covers gaps over crests
    ctx.fillStyle = U.mixStr(pal.grass[0], pal.fog, night ? 1 : 0.55);
    ctx.fillRect(0, hz, W, H - hz);

    const project = (p, cx, wy, wz) => {
      const dz = wz - camZ;
      p.cz = dz;
      const s = k / Math.max(dz, 0.001);
      p.s = s;
      p.sx = W / 2 - cx * s;
      p.sy = hz - (wy - camY) * s;
      p.sw = RH * s;
    };

    let x = 0;
    let dx = -(base.curve * basePct);
    let maxy = H;
    const lastIdx = Math.min(segs.length - 1, base.i + DRAW_DIST - 1);
    const tmp = { wy: 0, wz: 0 };
    for (let idx = base.i; idx <= lastIdx; idx++) {
      const seg = segs[idx];
      const n = idx - base.i;
      const fd = n / DRAW_DIST;
      seg.fog = 1 - Math.exp(-fd * fd * th.fogDensity);
      seg.clip = maxy;
      seg.hx = dx;
      seg.ox = x;
      project(seg.p1, camX - x, seg.p1.wy, seg.p1.wz);
      project(seg.p2, camX - x - dx, seg.p2.wy, seg.p2.wz);
      x += dx;
      dx += seg.curve;
      seg.vis = false;
      if (seg.p2.cz <= CAM.near) continue;
      let p1 = seg.p1;
      if (p1.cz <= CAM.near) {
        // clip the first segment at the near plane
        const t = (CAM.near - p1.cz) / (seg.p2.cz - p1.cz);
        tmp.wy = U.lerp(seg.p1.wy, seg.p2.wy, t);
        tmp.wz = camZ + CAM.near;
        project(tmp, camX - (x - dx + seg.curve) - (dx - seg.curve) * t, tmp.wy, tmp.wz);
        p1 = tmp;
      }
      if (seg.p2.sy >= p1.sy || seg.p2.sy >= maxy) continue;
      seg.vis = p1 === seg.p1;
      this.drawSegment(W, seg, p1, seg.p2, n, night, RH, track.lanes);
      maxy = seg.p2.sy;
    }

    // sprites + cars, back to front
    const nearCars = [];
    for (let idx = lastIdx; idx > base.i; idx--) {
      const seg = segs[idx];
      if (seg.p1.cz <= CAM.near) continue;
      const alpha = 1 - seg.fog * 0.95;
      for (const sp of seg.sprites) {
        const s = seg.p1.s;
        const sx = seg.p1.sx + sp.x * s;
        if (sx < -W || sx > W * 2) continue;
        GFX.draw(ctx, this.pages, sp.s, sx, seg.p1.sy, s * sp.scale, seg.clip, alpha);
        if (night && sp.light && seg.p1.sy < seg.clip + 50) {
          const gs = s * 7 * (1 - seg.fog * 0.7);
          const lx = sx + sp.light * 2.0 * s, ly = seg.p1.sy - 8.75 * s;
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(this.glowWarm, lx - gs / 2, ly - gs / 2, gs, gs);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      for (const car of seg.cars) {
        if (car === pl) continue;
        if (car.z < pl.z) { nearCars.push({ car, seg }); continue; }
        this.drawCar(car, seg, W, k, night, alpha);
      }
    }

    this.drawPlayer(pl, W, H, hz, k, night, race);
    for (const nc of nearCars) this.drawCar(nc.car, nc.seg, W, k, night, 1);

    this.drawWeather(W, H, pl, race);
    if (night) {
      const vg = ctx.createRadialGradient(W / 2, H * 0.7, H * 0.2, W / 2, H * 0.6, H * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,10,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    if (pl.offroad && pl.speed > 5) {
      ctx.fillStyle = 'rgba(80,50,10,0.06)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  shade(c, n, seg, night) {
    if (!night) return c;
    const head = U.clamp(1.25 - n / 55, 0.18, 1);
    const l = Math.max(head, 0.18 + seg.lit * 0.75);
    return [c[0] * l, c[1] * l, c[2] * l];
  }

  drawSegment(W, seg, p1, p2, n, night, RH, lanes) {
    const ctx = this.ctx;
    const pal = this.pal;
    const f = seg.fog;
    const fogc = pal.fog;
    const a = seg.alt;
    const col = (c) => U.mixStr(this.shade(c, n, seg, night), fogc, f);
    const y1 = p1.sy, y2 = p2.sy;
    const x1 = p1.sx, x2 = p2.sx, w1 = p1.sw, w2 = p2.sw;
    const m1 = p1.s, m2 = p2.s; // pixels per metre

    ctx.fillStyle = col(pal.grass[a]);
    ctx.fillRect(0, Math.floor(y2), W, Math.ceil(y1 - y2) + 1);

    const poly = (ax, ay, bx, by, cx, cy, dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill();
    };
    // verge (darker strip beyond kerb)
    ctx.fillStyle = col(pal.verge[a]);
    const v1 = 3.5 * m1, v2 = 3.5 * m2;
    poly(x1 - w1 - v1, y1 + 1, x1 - w1, y1 + 1, x2 - w2, y2, x2 - w2 - v2, y2);
    poly(x1 + w1, y1 + 1, x1 + w1 + v1, y1 + 1, x2 + w2 + v2, y2, x2 + w2, y2);
    // kerbs
    const r1 = 0.7 * m1, r2 = 0.7 * m2;
    ctx.fillStyle = col(pal.rumble[a]);
    poly(x1 - w1 - r1, y1 + 1, x1 - w1, y1 + 1, x2 - w2, y2, x2 - w2 - r2, y2);
    poly(x1 + w1, y1 + 1, x1 + w1 + r1, y1 + 1, x2 + w2 + r2, y2, x2 + w2, y2);
    // tarmac
    ctx.fillStyle = col(pal.road[a]);
    poly(x1 - w1, y1 + 1, x1 + w1, y1 + 1, x2 + w2, y2, x2 - w2, y2);

    const lc = col(pal.lane);
    ctx.fillStyle = lc;
    // solid edge lines
    const e1 = 0.35 * m1, e2 = 0.35 * m2, l1 = 0.14 * m1, l2 = 0.14 * m2;
    if (l1 > 0.4) {
      poly(x1 - w1 + e1, y1 + 1, x1 - w1 + e1 + l1, y1 + 1, x2 - w2 + e2 + l2, y2, x2 - w2 + e2, y2);
      poly(x1 + w1 - e1 - l1, y1 + 1, x1 + w1 - e1, y1 + 1, x2 + w2 - e2, y2, x2 + w2 - e2 - l2, y2);
    }
    // lane dashes
    if (!seg.dash && l1 > 0.3) {
      for (let i = 1; i < lanes; i++) {
        const t = -1 + (2 * i) / lanes;
        const c1 = x1 + w1 * t, c2 = x2 + w2 * t;
        poly(c1 - l1, y1 + 1, c1 + l1, y1 + 1, c2 + l2, y2, c2 - l2, y2);
      }
    }
    // hazards painted on the road
    for (const d of seg.decals) {
      ctx.fillStyle = d.type === 'puddle' ? 'rgba(120,145,175,0.6)' : d.type === 'ice' ? 'rgba(225,240,255,0.75)' : 'rgba(8,8,12,0.78)';
      const c1 = x1 + d.x * m1, c2 = x2 + d.x * m2;
      poly(c1 - d.w * m1, y1 + 1, c1 + d.w * m1, y1 + 1, c2 + d.w * m2, y2, c2 - d.w * m2, y2);
      if (d.type !== 'oil') {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        poly(c1 - d.w * 0.3 * m1, y1, c1 + d.w * 0.1 * m1, y1, c2 + d.w * 0.1 * m2, y2, c2 - d.w * 0.3 * m2, y2);
      }
    }
    // start / finish chequers, checkpoint line
    if (seg.line) {
      if (seg.line === 'check') {
        ctx.fillStyle = col([255, 220, 40]);
        poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);
      } else {
        const N = 16;
        for (let row = 0; row < 2; row++) {
          const ya = U.lerp(y1, y2, row / 2), yb = U.lerp(y1, y2, (row + 1) / 2);
          const xa = U.lerp(x1, x2, row / 2), xb = U.lerp(x1, x2, (row + 1) / 2);
          const wa = U.lerp(w1, w2, row / 2), wb = U.lerp(w1, w2, (row + 1) / 2);
          for (let i = 0; i < N; i++) {
            ctx.fillStyle = (i + row) % 2 ? '#111' : '#f4f4f4';
            const ta = -1 + (2 * i) / N, tb = -1 + (2 * (i + 1)) / N;
            poly(xa + wa * ta, ya, xa + wa * tb, ya, xb + wb * tb, yb, xb + wb * ta, yb);
          }
        }
      }
    }
  }

  carScreen(car, seg) {
    const pct = (car.z - seg.p1.wz) / SEG;
    const s = U.lerp(seg.p1.s, seg.p2.s, pct);
    const ox = U.lerp(seg.p1.sx, seg.p2.sx, pct);
    return { s, sx: ox + car.x * s, sy: U.lerp(seg.p1.sy, seg.p2.sy, pct) };
  }

  drawCar(car, seg, W, k, night, alpha) {
    const ctx = this.ctx;
    const p = this.carScreen(car, seg);
    if (p.sy > seg.clip + 2) return;
    if (p.sx < -W * 0.5 || p.sx > W * 1.5) return;
    const roadHead = Math.atan2(seg.hx || 0, SEG);
    const carHead = roadHead + Math.atan2(car.vx || 0, Math.max(car.speed, 5)) + (car.spin || 0);
    const view = Math.atan((p.sx - W / 2) / k);
    const yaw = ((carHead - view) * 180) / Math.PI;
    const frame = carFrameForYaw(U.clamp(yaw, -34, 34));
    const name = 'car_' + car.col + '_' + frame;
    const s = p.s;
    if (p.sy <= seg.clip) {
      ctx.fillStyle = `rgba(0,0,0,${0.35 * alpha})`;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy - 0.05 * s, 1.15 * s, 0.32 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    GFX.draw(ctx, this.pages, name, p.sx, p.sy, s, seg.clip, alpha);
    if ((night || car.braking) && frame >= 2 && frame <= 6 && p.sy <= seg.clip) {
      const gs = s * (car.braking ? 1.6 : 1.0);
      const ty = p.sy - CAR_TAIL.y * s;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      for (const sd of [-1, 1]) ctx.drawImage(this.glowRed, p.sx + sd * CAR_TAIL.x * s - gs / 2, ty - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawPlayer(pl, W, H, hz, k, night, race) {
    const ctx = this.ctx;
    const s = k / CAM.dist;
    const sx = W / 2;
    const sy = hz + CAM.height * s - pl.bounce * s * 0.03;
    const frame = carFrameForYaw(pl.visYaw);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 0.04 * s, 1.15 * s, 0.3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    if (night) {
      // headlight spill on the road ahead
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18;
      ctx.drawImage(this.glowWarm, sx - W * 0.35, hz + (sy - hz) * 0.05, W * 0.7, (sy - hz) * 0.75);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    GFX.draw(ctx, this.pages, 'car_' + pl.col + '_' + frame, sx, sy, s);
    const lit = pl.braking || night;
    if (lit && frame >= 2 && frame <= 6) {
      const gs = s * (pl.braking ? 1.4 : 0.8);
      const ty = sy - CAR_TAIL.y * s;
      ctx.globalCompositeOperation = 'lighter';
      for (const sd of [-1, 1]) ctx.drawImage(this.glowRed, sx + sd * CAR_TAIL.x * s - gs / 2, ty - gs / 2, gs, gs);
      ctx.globalCompositeOperation = 'source-over';
    }
    // dust / spray / smoke kicked up behind the car
    for (const pt of pl.particles) {
      ctx.globalAlpha = pt.a * (pt.life / pt.max);
      ctx.fillStyle = pt.col;
      const r = pt.r * s * (1.6 - pt.life / pt.max);
      ctx.beginPath();
      ctx.arc(sx + pt.x * s, sy - pt.y * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (pl.turboT > 0 && frame >= 3 && frame <= 5) {
      const ex = sx + CAR_EXHAUST.x * s, ey = sy - CAR_EXHAUST.y * s;
      const fl = (0.5 + Math.random() * 0.6) * s;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glowBlue, ex - fl * 0.6, ey - fl * 0.5, fl * 1.2, fl);
      ctx.drawImage(this.glowWarm, ex - fl * 0.3, ey - fl * 0.3, fl * 0.6, fl * 0.6);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ── weather overlays ──────────────────────────────────────────────────────
  drawWeather(W, H, pl, race) {
    const ctx = this.ctx;
    const w = this.theme.weather;
    if (!w) return;
    const sc = H / 720;
    if (w === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const f of pl.flakes) {
        const x = f.x * W, y = f.y * H;
        const r = f.r * sc * (1 + f.z);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } else if (w === 'storm' || w === 'rain') {
      ctx.strokeStyle = 'rgba(190,205,225,0.35)';
      ctx.lineWidth = 1.3 * sc;
      ctx.beginPath();
      for (const f of pl.flakes) {
        const x = f.x * W, y = f.y * H;
        const len = (18 + f.z * 26) * sc;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.18, y + len);
      }
      ctx.stroke();
      if (race.flash > 0) {
        ctx.fillStyle = `rgba(230,235,255,${race.flash * 0.75})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }
}
