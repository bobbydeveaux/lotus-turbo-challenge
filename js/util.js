'use strict';
// ── Small maths / colour helpers ─────────────────────────────────────────────
const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  easeIn: (a, b, t) => a + (b - a) * t * t,
  easeOut: (a, b, t) => a + (b - a) * (1 - (1 - t) * (1 - t)),
  easeInOut: (a, b, t) => a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5),
  sign: (v) => (v < 0 ? -1 : v > 0 ? 1 : 0),
  approach(v, target, rate) {
    return v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
  },
  // xorshift PRNG — deterministic tracks per stage
  rng(seed) {
    let s = (seed >>> 0) || 1;
    const f = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.weighted = (arr) => {
      let tot = 0;
      for (const it of arr) tot += it.w;
      let r = f() * tot;
      for (const it of arr) if ((r -= it.w) <= 0) return it;
      return arr[arr.length - 1];
    };
    return f;
  },
  hex(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  },
  rgb(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  },
  rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  },
  mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  },
  mixStr(a, b, t) {
    return 'rgb(' + ((a[0] + (b[0] - a[0]) * t) | 0) + ',' + ((a[1] + (b[1] - a[1]) * t) | 0) + ',' + ((a[2] + (b[2] - a[2]) * t) | 0) + ')';
  },
  fmtTime(sec) {
    if (!isFinite(sec)) return '--:--.--';
    sec = Math.max(0, sec);
    const cs = Math.round(sec * 100);
    const m = Math.floor(cs / 6000);
    const s = (cs % 6000) / 100;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  },
  ordinal(n) {
    const s = ['TH', 'ST', 'ND', 'RD'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },
  store: {
    get(k, d) {
      try {
        const v = localStorage.getItem('lotus-etc-' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('lotus-etc-' + k, JSON.stringify(v));
      } catch (e) { /* storage unavailable */ }
    },
  },
};
