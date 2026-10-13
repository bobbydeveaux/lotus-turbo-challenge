// Build a 3D stage from a v2 Track: centreline, road, kerbs, terrain, instanced
// scenery, gantries, road hazards and night lamp light. Race physics still runs in
// track space (distance s, lateral x); frameAt() maps that to world space.
import * as THREE from 'three';
import { toonColor, GRADIENT } from './toon.js';

const TERRAIN_COLS = [0.7, 3.5, 8, 16, 30, 55, 90, 140];
const RELIEF = { forest: 14, night: 4, fog: 10, snow: 26, desert: 9, storm: 12, coast: 7, motorway: 2 };

// cheap smooth value noise
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  return vnoise(x, y) * 0.6 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.12;
}

const col3 = (hex) => new THREE.Color(hex).convertSRGBToLinear();

function centreline(track) {
  const segs = track.segments;
  for (const K of [3.2, 2.6, 2.0, 1.5, 1.1]) {
    const pts = [];
    let x = 0, z = 0, h = 0;
    for (let i = 0; i <= segs.length; i++) {
      pts.push({ x, z, h });
      const c = segs[Math.min(i, segs.length - 1)].curve;
      h += (c / SEG) * K;
      x += Math.sin(h) * SEG;
      z -= Math.cos(h) * SEG;
    }
    // reject layouts where distant parts of the road come close to each other
    const grid = new Map();
    let bad = false;
    const cell = 150;
    for (let i = 0; i < pts.length && !bad; i += 3) {
      const gx = Math.floor(pts[i].x / cell), gz = Math.floor(pts[i].z / cell);
      for (let dx = -1; dx <= 1 && !bad; dx++) {
        for (let dz = -1; dz <= 1 && !bad; dz++) {
          for (const j of grid.get(gx + dx + ',' + (gz + dz)) || []) {
            if (i - j > 80 && Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 260) { bad = true; break; }
          }
        }
      }
      const key = gx + ',' + gz;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    if (!bad || K === 1.1) return pts;
  }
}

export class World {
  constructor(track, theme, themeKey, kits) {
    this.track = track;
    this.theme = theme;
    this.group = new THREE.Group();
    this.pts = centreline(track);
    this.relief = RELIEF[themeKey] ?? 10;
    this.lampHeads = [];
    this.lampPools = [];
    this.buildRoad();
    this.buildTerrain();
    this.buildLines();
    this.buildDecals();
    this.buildProps(kits);
    this.minY = Math.min(...track.segments.map((s) => s.p1.wy)) - 40;
  }

  // world position + heading at track distance s and lateral offset x
  frameAt(s, x = 0, out = {}) {
    const pts = this.pts;
    const f = U.clamp(s / SEG, 0, pts.length - 1.001);
    const i = Math.floor(f), t = f - i;
    const a = pts[i], b = pts[i + 1];
    const h = a.h + (b.h - a.h) * t;
    out.h = h;
    out.x = a.x + (b.x - a.x) * t + Math.cos(h) * x;
    out.z = a.z + (b.z - a.z) * t + Math.sin(h) * x;
    out.y = this.track.heightAt(s);
    return out;
  }

  heightOff(i, side, d) {
    const k = U.clamp((d - 3) / 25, 0, 1);
    const n = fbm(i * 0.035 + side * 37, d * 0.02);
    return (n - 0.35) * this.relief * k * k + (this.theme.weather === 'snow' ? d * 0.08 * k : 0);
  }

  roadTexture() {
    const th = this.theme;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = th.road[0];
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = th.road[1];
    g.fillRect(0, 256, 256, 256);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`;
      g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
    }
    g.fillStyle = th.lane;
    const L = this.track.lanes;
    g.fillRect(8, 0, 4, 512);
    g.fillRect(244, 0, 4, 512);
    for (let k = 1; k < L; k++) g.fillRect((256 * k) / L - 2.5, 0, 5, 200);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  buildRoad() {
    const segs = this.track.segments, RH = this.track.roadHalf;
    const N = segs.length;
    const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2);
    const f = {};
    for (let i = 0; i <= N; i++) {
      for (let k = 0; k < 2; k++) {
        this.frameAt(i * SEG, k ? RH : -RH, f);
        pos.set([f.x, f.y, f.z], (i * 2 + k) * 3);
        uv.set([k, (i * SEG) / 12], (i * 2 + k) * 2);
      }
    }
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, toonColor(0xffffff, { map: this.roadTexture() }));
    road.receiveShadow = true;
    this.group.add(road);

    // kerbs: alternating per segment, separate vertices for hard colour bands
    const kp = [], kc = [];
    const rc = this.theme.rumble.map(col3);
    for (let i = 0; i < N; i++) {
      const cc = rc[segs[i].alt];
      for (const side of [-1, 1]) {
        const q = [];
        for (const [s, x] of [[i, RH], [i, RH + 0.75], [i + 1, RH], [i + 1, RH + 0.75]]) {
          this.frameAt(s * SEG, side * x, f);
          q.push([f.x, f.y + 0.04, f.z]);
        }
        const tri = side < 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
        for (const t of tri) { kp.push(...q[t]); kc.push(cc.r, cc.g, cc.b); }
      }
    }
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
    kg.setAttribute('color', new THREE.Float32BufferAttribute(kc, 3));
    kg.computeVertexNormals();
    const kerb = new THREE.Mesh(kg, toonColor(0xffffff, { vertexColors: true }));
    kerb.receiveShadow = true;
    this.group.add(kerb);
  }

  buildTerrain() {
    const segs = this.track.segments, RH = this.track.roadHalf, N = segs.length;
    const grass = this.theme.grass.map(col3), verge = (this.theme.verge || this.theme.grass).map(col3);
    const p = [], c = [];
    const f = {};
    const P = (i, side, d) => {
      this.frameAt(i * SEG, side * (RH + d), f);
      return [f.x, f.y + this.heightOff(i, side, d) - (d < 1 ? 0.0 : 0.05), f.z];
    };
    for (let i = 0; i < N; i++) {
      const stripe = Math.floor(i / 3) % 2;
      for (const side of [-1, 1]) {
        for (let k = 0; k < TERRAIN_COLS.length - 1; k++) {
          const d0 = TERRAIN_COLS[k], d1 = TERRAIN_COLS[k + 1];
          const q = [P(i, side, d0), P(i, side, d1), P(i + 1, side, d0), P(i + 1, side, d1)];
          const cc = k === 0 ? verge[segs[i].alt] : grass[stripe];
          const tri = side < 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
          for (const t of tri) { p.push(...q[t]); c.push(cc.r, cc.g, cc.b); }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, toonColor(0xffffff, { vertexColors: true }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  buildLines() {
    const tr = this.track, RH = tr.roadHalf;
    const chk = document.createElement('canvas');
    chk.width = 256;
    chk.height = 32;
    const g = chk.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); }
    const chkTex = new THREE.CanvasTexture(chk);
    chkTex.colorSpace = THREE.SRGBColorSpace;
    const f = {};
    for (const seg of tr.segments) {
      if (!seg.line) continue;
      const geo = new THREE.PlaneGeometry(RH * 2, seg.line === 'check' ? 1.2 : 2.4);
      geo.rotateX(-Math.PI / 2);
      const mat = seg.line === 'check' ? toonColor(0xffd23a) : toonColor(0xffffff, { map: chkTex });
      const m = new THREE.Mesh(geo, mat);
      this.frameAt(seg.p1.wz, 0, f);
      m.position.set(f.x, f.y + 0.02, f.z);
      m.rotation.y = -f.h;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  buildDecals() {
    const by = { puddle: [], ice: [], oil: [] };
    const f = {};
    for (const seg of this.track.segments) {
      for (const d of seg.decals) {
        const q = [];
        for (const [s, x] of [[seg.p1.wz, d.x - d.w], [seg.p1.wz, d.x + d.w], [seg.p2.wz, d.x - d.w], [seg.p2.wz, d.x + d.w]]) {
          this.frameAt(s, x, f);
          q.push([f.x, f.y + 0.03, f.z]);
        }
        for (const t of [0, 1, 2, 1, 3, 2]) by[d.type].push(...q[t]);
      }
    }
    const cols = { puddle: [0x7f9ec2, 0.65], ice: [0xe8f6ff, 0.8], oil: [0x0a0a10, 0.85] };
    for (const [type, p] of Object.entries(by)) {
      if (!p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.computeVertexNormals();
      const [c, o] = cols[type];
      const m = new THREE.Mesh(g, toonColor(c, { transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.group.add(m);
    }
  }

  buildProps(kits) {
    const tr = this.track, f = {};
    const CHUNK = 60;
    const buckets = new Map(); // name|chunk -> matrices
    const rnd = U.rng(tr.stage.seed * 31 + 7);
    const facing = /^(chev|bb_|lamp|gantry|barrier|cottage|log|snowpole)/;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const seg of tr.segments) {
      for (const sp of seg.sprites) {
        const kit = kits[sp.s];
        if (!kit) continue;
        this.frameAt(seg.p1.wz, sp.x, f);
        const off = Math.abs(sp.x) - tr.roadHalf;
        const ground = sp.onRoad || off < 1 ? f.y : f.y + this.heightOff(seg.i, Math.sign(sp.x), off);
        let yaw = -f.h;
        if (!facing.test(sp.s)) yaw += rnd() * Math.PI * 2;
        else if (sp.s === 'cottage') yaw += (rnd() - 0.5) * 0.6;
        let s = sp.scale;
        if (sp.gantry) s = (tr.roadHalf * 2 + 5) / kit.size.x;
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        sc.set(s, s, s);
        p.set(f.x, ground - 0.05, f.z);
        m4.compose(p, q, sc);
        const key = sp.s + '|' + Math.floor(seg.i / CHUNK);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(m4.clone());
        if (sp.light) {
          const hx = sp.light * 2.0;
          const head = new THREE.Vector3(hx, 8.8, 0).applyQuaternion(q).add(p);
          this.lampHeads.push(head);
          const road = this.frameAt(seg.p1.wz, sp.x + hx, {});
          this.lampPools.push(new THREE.Vector3(road.x, road.y + 0.05, road.z));
        }
      }
    }
    for (const [key, mats] of buckets) {
      const kit = kits[key.split('|')[0]];
      for (const part of kit.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = !/^(tower|bb_|cottage)/.test(key);
        im.receiveShadow = true;
        this.group.add(im);
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh) {
        o.geometry.dispose();
        if (o.material.map) o.material.map.dispose();
      }
      if (o.isInstancedMesh) o.dispose();
    });
  }
}
