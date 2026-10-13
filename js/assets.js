'use strict';
// ── Blender-rendered sprite atlases, panoramas and tinting ───────────────────
const GFX = {
  M: window.GFX_MANIFEST,
  pages: [],
  bgs: {},
  hero: null,
  tintCache: {},
  progress: 0,

  load() {
    const jobs = [];
    const img = (src) =>
      new Promise((res) => {
        const im = new Image();
        im.onload = () => { this.progress++; res(im); };
        im.onerror = () => { console.warn('failed to load', src); this.progress++; res(null); };
        im.src = src;
      });
    this.total = this.M.pages.length + Object.keys(this.M.bgs).length + 1;
    this.M.pages.forEach((src, i) => jobs.push(img(src).then((im) => (this.pages[i] = im))));
    for (const [k, b] of Object.entries(this.M.bgs)) jobs.push(img(b.src).then((im) => (this.bgs[k] = im)));
    jobs.push(img(this.M.hero).then((im) => (this.hero = im)));
    return Promise.all(jobs);
  },

  sprite(name) {
    return this.M.sprites[name];
  },

  // Returns per-page canvases multiplied by an RGB tint (alpha preserved).
  tinted(tint) {
    if (!tint) return this.pages;
    const key = tint.join(',');
    if (this.tintCache[key]) return this.tintCache[key];
    const col = 'rgb(' + tint.map((v) => Math.round(v * 255)).join(',') + ')';
    const out = this.pages.map((pg) => {
      if (!pg) return pg;
      const c = document.createElement('canvas');
      c.width = pg.width;
      c.height = pg.height;
      const g = c.getContext('2d');
      g.drawImage(pg, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = col;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(pg, 0, 0);
      return c;
    });
    this.tintCache[key] = out;
    return out;
  },

  tintedBg(name, tint) {
    const im = this.bgs[name];
    if (!im || !tint) return im;
    const key = name + '|' + tint.join(',');
    if (this.tintCache[key]) return this.tintCache[key];
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(' + tint.map((v) => Math.round(v * 255)).join(',') + ')';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(im, 0, 0);
    this.tintCache[key] = c;
    return c;
  },

  // Draw sprite anchored bottom-centre at (x, y) with width w (px); clipY hides anything below.
  draw(ctx, pages, name, x, y, scale, clipY, alpha) {
    const s = this.M.sprites[name];
    if (!s) return;
    const pg = pages[s.p];
    if (!pg) return;
    const dw = s.wm * scale;
    const dh = s.hm * scale;
    if (dh < 1 || dw < 1) return;
    let sh = s.h;
    let ddh = dh;
    const top = y - dh;
    if (clipY !== undefined && y > clipY) {
      const vis = clipY - top;
      if (vis <= 0) return;
      ddh = vis;
      sh = s.h * (vis / dh);
    }
    if (alpha !== undefined && alpha < 1) {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(pg, s.x, s.y, s.w, Math.max(1, sh), x - dw / 2, top, dw, ddh);
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = 1;
  },
};

// Car frame helpers: frames rendered at these yaw angles (degrees, + = nose right)
const CAR_YAWS = [-30, -20, -12, -6, 0, 6, 12, 20, 30];
function carFrameForYaw(deg) {
  let best = 4, bd = 1e9;
  for (let i = 0; i < CAR_YAWS.length; i++) {
    const d = Math.abs(CAR_YAWS[i] - deg);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
