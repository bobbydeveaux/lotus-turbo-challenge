'use strict';
// ── Chunky cartoon UI kit: outlined lettering, rounded panels, keycaps ───────
const UI = {
  DISPLAY: '"Lilita One", "Russo One", Impact, sans-serif',
  BODY: '"Fredoka", "Russo One", "Arial Rounded MT Bold", sans-serif',
  C: {
    ink: '#16161d', panel: '#1e1e28', panel2: '#2a2a36', cream: '#fff7e6', yellow: '#ffd23a', red: '#e8382b',
    green: '#2fbf6a', dgreen: '#1f8a4a', blue: '#3a8dff', orange: '#ff8a2a', grey: '#a3a8b6', white: '#ffffff',
  },

  rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  // rounded panel with hard drop shadow and ink border
  panel(ctx, x, y, w, h, o = {}) {
    const r = o.r ?? 14, sw = o.sw ?? 4, drop = o.drop ?? 6;
    ctx.save();
    if (o.tilt) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(o.tilt);
      ctx.translate(-x - w / 2, -y - h / 2);
    }
    if (drop) {
      ctx.fillStyle = o.dropCol || 'rgba(0,0,0,0.45)';
      this.rr(ctx, x + drop * 0.5, y + drop, w, h, r);
      ctx.fill();
    }
    this.rr(ctx, x, y, w, h, r);
    ctx.fillStyle = o.fill || this.C.panel;
    ctx.fill();
    if (o.band) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = o.band;
      ctx.fillRect(x, y + h - (o.bandH ?? 8), w, o.bandH ?? 8);
      ctx.restore();
    }
    if (sw) {
      ctx.lineWidth = sw;
      ctx.strokeStyle = o.stroke || this.C.ink;
      this.rr(ctx, x, y, w, h, r);
      ctx.stroke();
    }
    ctx.restore();
  },

  // outlined display text with a stacked colour shadow
  text(ctx, s, x, y, size, fill, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || ''} ${Math.round(size)}px ${o.font || this.DISPLAY}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.translate(x, y);
    if (o.tilt) ctx.rotate(o.tilt);
    if (o.scale) ctx.scale(o.scale, o.scale);
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    const sw = o.sw ?? size * 0.16;
    const st = o.stroke === undefined ? this.C.ink : o.stroke;
    if (o.shadow) {
      const d = o.sd ?? size * 0.09;
      if (st && sw) { ctx.lineWidth = sw; ctx.strokeStyle = st; ctx.strokeText(s, d * 0.5, d); }
      ctx.fillStyle = o.shadow;
      ctx.fillText(s, d * 0.5, d);
    }
    if (st && sw) { ctx.lineWidth = sw; ctx.strokeStyle = st; ctx.strokeText(s, 0, 0); }
    ctx.fillStyle = fill;
    ctx.fillText(s, 0, 0);
    const w = ctx.measureText(s).width * (o.scale || 1);
    ctx.restore();
    return w;
  },

  // plain body text (no outline)
  body(ctx, s, x, y, size, fill, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 600} ${Math.round(size)}px ${this.BODY}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillStyle = fill;
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  },

  measure(ctx, s, size, font) {
    ctx.save();
    ctx.font = `${Math.round(size)}px ${font || this.DISPLAY}`;
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  },

  // small label pill
  tag(ctx, s, x, y, o = {}) {
    const size = o.size || 16;
    const w = this.measure(ctx, s, size) + size * 1.1;
    const h = size * 1.55;
    const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.panel(ctx, x0, y, w, h, { fill: o.bg || this.C.ink, r: o.r ?? 7, sw: o.sw ?? 0, drop: o.drop ?? 0, tilt: o.tilt, stroke: o.stroke });
    this.text(ctx, s, x0 + w / 2, y + h * 0.74, size, o.fg || this.C.yellow, { align: 'center', stroke: null, tilt: o.tilt });
    return w;
  },

  // keyboard keycap
  key(ctx, label, x, y, size) {
    const w = Math.max(size * 1.5, this.measure(ctx, label, size * 0.62) + size * 0.7);
    this.panel(ctx, x, y, w, size * 1.4, { fill: this.C.cream, r: size * 0.25, sw: 2.5, drop: 3, dropCol: '#000' });
    this.text(ctx, label, x + w / 2, y + size * 0.95, size * 0.62, this.C.ink, { align: 'center', stroke: null });
    return w;
  },

  // rotating sunburst behind big moments
  burst(ctx, x, y, r, t, col, rays = 16, alpha = 0.35) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a, a + Math.PI / rays);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

  bolt(ctx, x, y, s, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 34, s / 34);
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(3, 19); ctx.lineTo(13, 19); ctx.lineTo(8, 34); ctx.lineTo(26, 12); ctx.lineTo(16, 12); ctx.lineTo(23, 0);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.C.ink;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  },

  chequer(ctx, x, y, w, h, sq, a = '#f4f4f4', b = '#16161d') {
    const rows = Math.max(1, Math.round(h / sq));
    const sh = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0, cx = x; cx < x + w; c++, cx += sq) {
        ctx.fillStyle = (r + c) % 2 ? b : a;
        ctx.fillRect(cx, y + r * sh, Math.min(sq, x + w - cx), sh);
      }
    }
  },

  // circle with ink outline
  disc(ctx, x, y, r, fill, sw = 4) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (sw) { ctx.lineWidth = sw; ctx.strokeStyle = this.C.ink; ctx.stroke(); }
  },
};

// legacy helper used by older screens
const FONT = UI.DISPLAY;
function txt(ctx, s, x, y, size, col, align = 'left') {
  return UI.text(ctx, s, x, y, size, col, { align, sw: size * 0.14 });
}
