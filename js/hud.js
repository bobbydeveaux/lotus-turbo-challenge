'use strict';
// ── In-race HUD (chunky cartoon style) ───────────────────────────────────────
const MAP_K = 2.6; // exaggerate bends on the minimap so they read at a glance

function trackMap(track) {
  if (track.map) return track.map;
  const pts = [];
  let x = 0, y = 0, h = 0;
  for (const s of track.segments) {
    pts.push({ x, y, h });
    h += (s.curve / SEG) * MAP_K;
    x += Math.sin(h) * SEG;
    y += Math.cos(h) * SEG;
  }
  track.map = pts;
  return pts;
}

function drawMinimap(ctx, cx, cy, R, race, pl) {
  const C = UI.C;
  const tr = race.track;
  const pts = trackMap(tr);
  const pi = U.clamp(Math.floor(pl.z / SEG), 0, pts.length - 1);
  const me = pts[pi];
  // ring: alternating Lotus yellow / green segments
  UI.disc(ctx, cx + 3, cy + 6, R + 12, 'rgba(0,0,0,0.45)', 0);
  const n = 24;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
    ctx.lineWidth = 12;
    ctx.strokeStyle = i % 3 === 0 ? C.red : i % 3 === 1 ? C.yellow : C.green;
    ctx.stroke();
  }
  UI.disc(ctx, cx, cy, R, '#e9d9b6', 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const k = R / 420;
  ctx.translate(cx, cy);
  ctx.rotate(me.h);
  ctx.scale(k, -k);
  ctx.translate(-me.x, -me.y);
  const lo = Math.max(0, pi - 90), hi = Math.min(pts.length - 1, pi + 110);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[lo].x, pts[lo].y);
    for (let i = lo + 1; i <= hi; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  ctx.lineCap = ctx.lineJoin = 'round';
  path(); ctx.lineWidth = 48; ctx.strokeStyle = C.ink; ctx.stroke();
  path(); ctx.lineWidth = 32; ctx.strokeStyle = '#fffaf0'; ctx.stroke();
  const dot = (p, r, col) => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = C.ink; ctx.stroke(); };
  for (const c of tr.checkpoints) if (c >= lo && c <= hi) dot(pts[c], 30, C.yellow);
  if (tr.finishSeg >= lo && tr.finishSeg <= hi) dot(pts[tr.finishSeg], 36, '#ffffff');
  for (const c of race.racers) {
    if (c === pl) continue;
    const ci = Math.floor(c.z / SEG);
    if (ci < lo || ci > hi) continue;
    dot(pts[ci], c.isPlayer ? 26 : 18, c.isPlayer ? '#ffffff' : C.red);
  }
  ctx.restore();
  // player arrow (always heading up)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -15); ctx.lineTo(11, 11); ctx.lineTo(0, 5); ctx.lineTo(-11, 11);
  ctx.closePath();
  ctx.fillStyle = C.red;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  UI.disc(ctx, cx, cy - R - 2, 13, C.red, 3);
  UI.text(ctx, 'N', cx, cy - R + 4, 16, '#fff', { align: 'center', stroke: null });
}

function drawSpeedo(ctx, cx, cy, R, pl) {
  const C = UI.C;
  const mph = pl.speed * MPH;
  UI.disc(ctx, cx + 4, cy + 8, R + 4, 'rgba(0,0,0,0.45)', 0);
  UI.disc(ctx, cx, cy, R, C.yellow, 5);
  UI.disc(ctx, cx, cy, R - 12, C.cream, 4);
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5, MAXV = 200;
  const ang = (v) => a0 + (v / MAXV) * sweep;
  // red zone
  ctx.beginPath();
  ctx.arc(cx, cy, R - 22, ang(160), ang(200));
  ctx.lineWidth = 12;
  ctx.strokeStyle = C.red;
  ctx.stroke();
  for (let v = 0; v <= MAXV; v += 10) {
    const a = ang(v), major = v % 40 === 0;
    const r1 = R - 18, r2 = r1 - (major ? 16 : 9);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.lineWidth = major ? 5 : 3;
    ctx.strokeStyle = C.ink;
    ctx.lineCap = 'round';
    ctx.stroke();
    if (major) {
      const rt = R - 50;
      UI.body(ctx, String(v), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt + 7, R * 0.16, C.ink, { align: 'center', weight: 700 });
    }
  }
  // needle
  const a = ang(U.clamp(mph, 0, MAXV));
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12);
  ctx.lineTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
  ctx.lineWidth = 9;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = C.red;
  ctx.stroke();
  UI.disc(ctx, cx, cy, 11, C.yellow, 4);
  UI.text(ctx, String(Math.round(mph)), cx, cy + R * 0.58, R * 0.42, C.ink, { align: 'center', stroke: null });
  UI.body(ctx, 'MPH', cx, cy + R * 0.78, R * 0.13, C.ink, { align: 'center', weight: 700 });
  // gear badge
  const gx = cx - R * 0.86, gy = cy - R * 0.78;
  const hot = !pl.auto && pl.rpm > 0.95;
  UI.disc(ctx, gx + 2, gy + 4, 30, 'rgba(0,0,0,0.45)', 0);
  UI.disc(ctx, gx, gy, 30, hot ? C.red : C.ink, 4);
  UI.text(ctx, String(pl.gear), gx, gy + 13, 36, hot ? '#fff' : C.yellow, { align: 'center', stroke: null });
  UI.tag(ctx, pl.auto ? 'AUTO' : 'MAN', gx, gy + 26, { size: 11, align: 'center', bg: C.yellow, fg: C.ink, sw: 2.5 });
}

function drawHUD(ctx, view, race, pl, split) {
  const C = UI.C;
  const W = view.w, H = view.h;
  const sc = split ? Math.min(W / 1280, (H / 720) * 1.5) : Math.min(W / 1280, H / 720);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(sc, sc);
  const VW = W / sc, VH = H / sc; // virtual 1280-wide space
  const pad = 22;

  // ── TIME ───────────────────────────────────────────────────────────────
  const tl = Math.ceil(pl.timeLeft);
  const low = pl.timeLeft < 10 && !pl.finished && !pl.out;
  const pulse = low ? 1 + 0.08 * Math.max(0, Math.sin(race.t * 12)) : 1;
  UI.tag(ctx, 'TIME', pad, pad, { size: 18, bg: C.ink, fg: C.yellow, tilt: -0.04 });
  UI.text(ctx, String(tl), pad + 4, pad + 118, 104, low ? C.red : C.yellow, { shadow: low ? C.yellow : C.red, scale: pulse });
  if (split) UI.tag(ctx, 'P' + (pl.idx + 1), pad + 120, pad, { size: 18, bg: pl.idx ? '#fff' : C.red, fg: pl.idx ? C.ink : '#fff' });

  // ── position + progress strip ─────────────────────────────────────────
  const py = pad + 138;
  UI.panel(ctx, pad, py, 280, 50, { r: 12, sw: 0, drop: 4 });
  UI.text(ctx, 'POS', pad + 14, py + 33, 18, C.cream, { stroke: null });
  const pw = UI.text(ctx, String(pl.position), pad + 62, py + 40, 38, pl.position <= 10 ? C.green : C.orange, { sw: 6 });
  UI.text(ctx, '/' + race.racers.length, pad + 66 + pw, py + 36, 20, C.grey, { stroke: null });
  // progress pips
  const tr = race.track;
  const len = (tr.finishSeg - START_SEG) * SEG;
  const prog = U.clamp((pl.z - START_SEG * SEG) / len, 0, 1);
  const bx = pad + 140, bw = 126, pips = 12;
  for (let i = 0; i < pips; i++) {
    const on = (i + 0.5) / pips < prog;
    ctx.fillStyle = on ? C.yellow : '#4a4a58';
    ctx.fillRect(bx + i * (bw / pips), py + 18, bw / pips - 3, 14);
  }
  for (const c of tr.checkpoints) {
    const x = bx + bw * ((c - START_SEG) * SEG / len);
    ctx.fillStyle = C.red;
    ctx.fillRect(x - 1.5, py + 12, 3, 26);
  }

  // ── objective / status card ───────────────────────────────────────────
  if (!split && race.state !== 'countdown') {
    const cps = tr.checkpoints;
    const next = pl.nextCp < cps.length ? cps[pl.nextCp] : tr.finishSeg;
    const dist = Math.max(0, (next * SEG - pl.z) / 1000);
    const head = pl.finished ? 'FINISHED!' : pl.out ? 'OUT OF TIME' : pl.nextCp < cps.length ? 'NEXT CHECKPOINT' : 'GO FOR THE FLAG!';
    const sub = pl.finished || pl.out ? 'Hang tight…' : dist.toFixed(2) + ' km · top 10 to qualify';
    const cy0 = py + 62;
    UI.panel(ctx, pad, cy0, 300, 62, { fill: C.cream, r: 8, sw: 3, drop: 4 });
    ctx.fillStyle = C.yellow;
    ctx.fillRect(pad + 2, cy0 + 2, 9, 58);
    UI.text(ctx, head, pad + 22, cy0 + 28, 21, C.ink, { stroke: null });
    UI.body(ctx, sub, pad + 22, cy0 + 50, 15, '#3a3a46');
  }

  // ── clock (top right) ─────────────────────────────────────────────────
  const clk = U.fmtTime(race.raceClock);
  const cw = UI.measure(ctx, clk, 40) + 36;
  UI.panel(ctx, VW - pad - cw, pad, cw, 58, { r: 12, sw: 0, drop: 4 });
  UI.text(ctx, clk, VW - pad - cw / 2, pad + 44, 40, C.white, { align: 'center', stroke: null });
  UI.tag(ctx, race.stage.name, VW - pad, pad + 66, { size: 15, align: 'right', bg: C.yellow, fg: C.ink, sw: 3 });
  if (pl.splits.length) UI.tag(ctx, 'CP ' + U.fmtTime(pl.splits[pl.splits.length - 1]), VW - pad, pad + 100, { size: 13, align: 'right', bg: C.ink, fg: '#9fd8ff' });

  // ── speedo + turbo ────────────────────────────────────────────────────
  const R = 118;
  const scx = VW - pad - R - 6, scy = VH - pad - R - 4;
  drawSpeedo(ctx, scx, scy, R, pl);
  const tw = 300, th = 68;
  const tx = scx - R - tw - 18, ty = VH - pad - th - 6;
  UI.panel(ctx, tx, ty, tw, th, { r: 14, sw: 0, drop: 5 });
  UI.bolt(ctx, tx + 14, ty + 12, 44, pl.turboT > 0 ? '#fff' : C.blue);
  UI.text(ctx, 'TURBO', tx + 68, ty + 28, 19, C.yellow, { stroke: null });
  for (let i = 0; i < 5; i++) {
    const on = i < pl.turbos;
    UI.panel(ctx, tx + 68 + i * 44, ty + 38, 38, 18, { r: 6, sw: 2, drop: 0, fill: on ? C.blue : '#3a3a48', stroke: C.ink });
  }
  if (pl.turboT > 0) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(tx + 68, ty + 60, 216 * (pl.turboT / TURBO_TIME), 4);
  }

  // ── minimap ───────────────────────────────────────────────────────────
  if (!split) drawMinimap(ctx, pad + 112, VH - pad - 118, 104, race, pl);

  // ── controls strip (first seconds) ────────────────────────────────────
  if (!split && (race.state === 'countdown' || race.raceClock < 5) && !Game.demo) {
    const items = [['▲', 'GAS'], ['▼', 'BRAKE'], ['◀▶', 'STEER'], ['SPACE', 'TURBO']];
    if (!pl.auto) items.push(['Q E', 'GEARS']);
    items.push(['ESC', 'PAUSE']);
    let w = 30;
    for (const [k, l] of items) w += UI.measure(ctx, k, 13) + 20 + UI.measure(ctx, l, 18) + 40;
    const x0 = VW / 2 - w / 2, y0 = VH - pad - 64 - 120;
    const alpha = race.state === 'countdown' ? 1 : U.clamp(5 - race.raceClock, 0, 1);
    ctx.globalAlpha = alpha;
    UI.panel(ctx, x0, y0, w, 56, { r: 28, sw: 0, drop: 5 });
    let x = x0 + 22;
    for (const [k, l] of items) {
      x += UI.key(ctx, k, x, y0 + 12, 22) + 9;
      x += UI.text(ctx, l, x, y0 + 36, 18, C.cream, { stroke: null }) + 26;
    }
    ctx.globalAlpha = 1;
  }

  // ── countdown ─────────────────────────────────────────────────────────
  if (race.state === 'countdown' || (race.state === 'race' && race.raceClock < 0.9)) {
    const go = race.state === 'race';
    const n = Math.ceil(race.countdown);
    if (go || n <= 3) {
      const frac = go ? race.raceClock / 0.9 : 1 - (race.countdown - Math.floor(race.countdown));
      const s = go ? 1 + frac * 0.5 : frac < 0.18 ? 1.6 - frac * 3.3 : 1;
      const col = go ? C.green : n === 3 ? C.red : n === 2 ? C.yellow : C.green;
      const a = go ? 1 - frac : 1;
      UI.burst(ctx, VW / 2, VH * 0.42, 300, race.t * 0.6, col, 18, 0.25 * a);
      UI.text(ctx, go ? 'GO!' : String(n), VW / 2, VH * 0.42 + 90, 250, col, { align: 'center', sw: 26, shadow: C.ink, sd: 18, scale: s, alpha: a });
    }
  }

  // ── messages ──────────────────────────────────────────────────────────
  let my = VH * 0.32;
  for (const m of pl.msgs) {
    if (m.text === 'GO!') continue;
    const age = m.max - m.t;
    const a = U.clamp(Math.min(m.t * 3, 1), 0, 1);
    const pop = 1 + Math.max(0, 0.22 - age) * 2.4;
    if (m.size >= 1) {
      const sz = 70 * m.size;
      UI.text(ctx, m.text, VW / 2, my, sz, m.col, { align: 'center', sw: sz * 0.17, shadow: m.col === C.red || m.col === '#ff3333' ? C.yellow : C.red, scale: pop, tilt: -0.05, alpha: a });
      my += sz * 0.95;
    } else {
      const w = UI.measure(ctx, m.text, 26, UI.DISPLAY) + 44;
      ctx.globalAlpha = a;
      UI.panel(ctx, VW / 2 - w / 2, my - 34, w, 48, { fill: C.cream, r: 24, sw: 4, drop: 5 });
      UI.text(ctx, m.text, VW / 2, my, 26, C.ink, { align: 'center', stroke: null });
      ctx.globalAlpha = 1;
      my += 64;
    }
  }

  if (pl.offroad && race.state === 'race' && pl.speed < 30 && Math.floor(race.t * 3) % 2 === 0) {
    UI.tag(ctx, 'OFF ROAD!', VW / 2, VH * 0.6, { size: 26, align: 'center', bg: C.orange, fg: C.ink, sw: 4, tilt: 0.03 });
  }
  ctx.restore();
}
