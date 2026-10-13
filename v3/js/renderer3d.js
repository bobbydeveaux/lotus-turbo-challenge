// three.js renderer that stands in for v2's canvas Renderer. main.js calls
// beginFrame() once, then drawView(view, race, player) per split-screen view.
import * as THREE from 'three';
import { loadKits } from './models.js';
import { World } from './world.js';
import { Atmosphere, TEX } from './fx.js';
import { InkPass } from './outline.js';

const PAINT = {
  red: [0.62, 0.012, 0.012], white: [0.8, 0.8, 0.78], blue: [0.02, 0.1, 0.55], yellow: [0.9, 0.62, 0.02], green: [0.01, 0.22, 0.06],
  silver: [0.42, 0.44, 0.46], black: [0.015, 0.015, 0.018], orange: [0.85, 0.2, 0.01], purple: [0.22, 0.03, 0.4], teal: [0.01, 0.38, 0.38],
};
const LIGHT = {
  forest: { sun: ['#fff2d6', 2.7], hemi: ['#bcd8ff', '#4a6a30', 1.25] },
  night: { sun: ['#9fb0ff', 0.45], hemi: ['#2a3266', '#0a0a10', 0.6], head: true },
  fog: { sun: ['#ffffff', 1.1], hemi: ['#d6dce0', '#606a58', 1.6] },
  snow: { sun: ['#ffffff', 2.3], hemi: ['#d6e6ff', '#9aa6b8', 1.3] },
  desert: { sun: ['#fff0d0', 3.0], hemi: ['#a8ccff', '#a08050', 1.15] },
  storm: { sun: ['#c8d4e6', 0.9], hemi: ['#6a7684', '#2a3a28', 1.15] },
  coast: { sun: ['#ffb680', 2.5], hemi: ['#d07090', '#806048', 1.05] },
  motorway: { sun: ['#b090ff', 0.55], hemi: ['#403066', '#101018', 0.65], head: true },
};
const MAX_PIXELS = 1.9e6;

export class Renderer3D {
  constructor(ctx) {
    this.ctx = ctx;
    this.is3D = true;
    this.glCanvas = document.getElementById('gl');
    const r = (this.r = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    r.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.heads = [0, 1].map(() => {
      const s = new THREE.SpotLight(0xfff1d0, 0, 160, 0.42, 0.5, 0);
      this.scene.add(s, s.target);
      return s;
    });
    this.atmo = new Atmosphere(this.scene);
    this.ink = new InkPass(r);
    this.cams = [0, 1].map(() => new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4600));
    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);
    this.cars = new Map();
    this.camState = new Map();
    this.worlds = new Map();
    this.last = performance.now();
    this.frame = 0;
    this.ready = loadKits('assets/models', (p) => (this.loadProgress = p)).then((k) => (this.kits = k));
  }

  // main.js compatibility
  setup(theme) { this.theme = theme; }

  beginFrame() {
    const now = performance.now();
    this.dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    this.stepped = false;
    const oc = this.ctx.canvas;
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (oc.width * oc.height)));
    const w = Math.round(oc.width * k), h = Math.round(oc.height * k);
    if (this.glCanvas.width !== w || this.glCanvas.height !== h) this.r.setSize(w, h, false);
    this.glCanvas.style.width = oc.style.width;
    this.glCanvas.style.height = oc.style.height;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, oc.width, oc.height);
    this.ctx.restore();
    this.r.setRenderTarget(null);
    this.r.setScissorTest(false);
    this.r.setClearColor(0x000000, 1);
    this.r.clear();
  }

  // ── world / theme switching ────────────────────────────────────────────────
  useWorld(race) {
    if (this.world && this.world.track === race.track) return;
    if (this.world) this.scene.remove(this.world.group);
    let w = this.worlds.get(race.track);
    if (!w) {
      w = new World(race.track, race.theme, race.stage.theme, this.kits);
      this.worlds.set(race.track, w);
      while (this.worlds.size > 3) {
        const [k, old] = this.worlds.entries().next().value;
        old.dispose();
        this.worlds.delete(k);
      }
    }
    this.world = w;
    this.scene.add(w.group);
    const th = race.theme;
    const L = LIGHT[race.stage.theme] || LIGHT.forest;
    this.sun.color.set(L.sun[0]);
    this.sun.intensity = L.sun[1];
    this.hemi.color.set(L.hemi[0]);
    this.hemi.groundColor.set(L.hemi[1]);
    this.hemi.intensity = this.hemiBase = L.hemi[2];
    this.headOn = !!L.head;
    const fogc = new THREE.Color(`rgb(${th.fog.join(',')})`);
    this.scene.fog = new THREE.FogExp2(fogc, Math.sqrt(th.fogDensity) / 1400);
    this.atmo.setTheme(th, w);
    this.sunDir = this.atmo.sunDir ? this.atmo.sunDir.clone() : new THREE.Vector3(0.4, 0.8, -0.3).normalize();
    if (this.sunDir.y < 0.25) this.sunDir.y = 0.25;
    this.sunDir.normalize();
    // lamp pools on the road at night
    if (this.pools) { this.scene.remove(this.pools); this.pools.dispose(); this.pools = null; }
    if (th.night && w.lampPools.length) {
      const geo = new THREE.CircleGeometry(7, 24).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ map: TEX.glow, color: 0xffc070, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const im = new THREE.InstancedMesh(geo, mat, w.lampPools.length);
      const m4 = new THREE.Matrix4();
      w.lampPools.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
      im.computeBoundingSphere();
      im.layers.set(1);
      this.pools = im;
      this.scene.add(im);
    }
    // fresh cars for the new race
    this.carGroup.clear();
    this.cars.clear();
    this.camState.clear();
  }

  makeCar(col) {
    const kit = this.kits.car;
    const g = new THREE.Group();
    const paint = new THREE.Color(...(PAINT[col] || PAINT.red));
    const mats = new Map();
    const matFor = (m) => {
      if (m.name !== 'paint' && m.name !== 'tail') return m;
      if (!mats.has(m.name)) {
        const c = m.clone();
        c.onBeforeCompile = m.onBeforeCompile;
        c.customProgramCacheKey = m.customProgramCacheKey;
        if (m.name === 'paint') c.color.copy(paint);
        mats.set(m.name, c);
      }
      return mats.get(m.name);
    };
    for (const p of kit.body) {
      const mesh = new THREE.Mesh(p.geometry, matFor(p.material));
      mesh.castShadow = true;
      g.add(mesh);
    }
    const wheels = kit.wheels.map((w) => {
      const wg = new THREE.Group();
      wg.position.copy(w.centre);
      wg.rotation.order = 'YXZ';
      for (const p of w.parts) {
        const mesh = new THREE.Mesh(p.geometry, p.material);
        mesh.castShadow = true;
        wg.add(mesh);
      }
      g.add(wg);
      return { g: wg, front: w.front, r: w.radius };
    });
    g.rotation.order = 'YXZ';
    return { g, wheels, tail: mats.get('tail'), spin: 0 };
  }

  updateCars(race) {
    const w = this.world, tr = race.track, f = {};
    for (const c of race.racers) {
      let car = this.cars.get(c);
      if (!car) {
        car = this.makeCar(c.col);
        this.cars.set(c, car);
        this.carGroup.add(car.g);
      }
      w.frameAt(c.z, c.x, f);
      const slope = (tr.heightAt(c.z + 2) - tr.heightAt(c.z - 2)) / 4;
      let yaw = f.h + (c.spin || 0);
      let roll = 0;
      if (c.isPlayer) {
        yaw += (c.visYaw * Math.PI) / 180 * 0.5;
        roll = c.steer * 0.035 * Math.min(1, c.speed / 30);
      } else {
        yaw += Math.atan2(c.vx || 0, Math.max(c.speed, 5));
      }
      car.g.position.set(f.x, f.y + (c.isPlayer ? Math.abs(c.bounce || 0) * 0.004 : 0), f.z);
      car.g.rotation.set(Math.atan(slope) + (c.isPlayer ? -c.throttle * 0.012 + (c.braking ? 0.015 : 0) : 0), -yaw, roll);
      car.spin += (c.speed * this.dt) / 0.31;
      for (const wh of car.wheels) {
        wh.g.rotation.x = -car.spin;
        wh.g.rotation.y = wh.front && c.isPlayer ? -c.steer * 0.35 : 0;
      }
      if (car.tail) car.tail.emissiveIntensity = c.braking ? 3 : 1;
      car.f = { ...f, yaw };
    }
  }

  // world-space point on a car (local metres; car front is -Z)
  carPoint(car, lx, ly, lz) {
    return new THREE.Vector3(lx, ly, lz).applyEuler(car.g.rotation).add(car.g.position);
  }

  stepEffects(race) {
    const atmo = this.atmo, th = race.theme;
    atmo.step(this.dt, race.t);
    // particles behind each human car
    for (const pl of race.players) {
      const car = this.cars.get(pl);
      if (!car || pl.speed < 6) continue;
      const sp = pl.speed / VMAX;
      for (const sx of [-0.8, 0.8]) {
        const p = this.carPoint(car, sx, 0.15, 1.5);
        if (pl.offroad && Math.random() < sp * 1.6) {
          const c = th.weather === 'snow' ? [1, 1, 1] : th.dust ? th.dust.map((v) => v / 255) : new THREE.Color(th.grass[0]).toArray().map((v) => Math.min(1, v * 1.6));
          atmo.emit(p.x, p.y, p.z, 2, c, { size: 0.45, up: 2.2, life: 0.8 });
        }
        if ((th.weather === 'storm' && sp > 0.4 && Math.random() < 0.4) || (pl.lastDecal && pl.lastDecal.type === 'puddle')) atmo.emit(p.x, p.y, p.z, 1, [0.85, 0.9, 1], { size: 0.3, up: 2.6, life: 0.45, alpha: 0.45 });
        if (th.weather === 'snow' && sp > 0.35 && Math.random() < sp) atmo.emit(p.x, p.y, p.z, 1, [1, 1, 1], { size: 0.3, up: 1.6, life: 0.55, alpha: 0.55 });
        if (pl.skid > 0.5 && Math.random() < 0.7) atmo.emit(p.x, p.y, p.z, 1, [0.9, 0.9, 0.9], { size: 0.55, up: 1.0, life: 1.0, alpha: 0.3, spread: 1 });
      }
    }
    // glows: lamps, tail lights, turbo flames
    const g = atmo.glows;
    g.begin();
    const cam0 = this.cams[0].position;
    if (th.night) {
      for (const h of this.world.lampHeads) if (h.distanceToSquared(cam0) < 700 * 700) g.push(h.x, h.y, h.z, 7, 1, 0.82, 0.55, 0.9);
    }
    for (const c of race.racers) {
      const car = this.cars.get(c);
      if (!car || (!th.night && !c.braking)) continue;
      if (car.g.position.distanceToSquared(cam0) > 500 * 500) continue;
      for (const sx of [-0.56, 0.56]) {
        const p = this.carPoint(car, sx, 0.6, 2.2);
        g.push(p.x, p.y, p.z, c.braking ? 1.7 : 1.0, 1, 0.08, 0.04, 0.9);
      }
    }
    for (const pl of race.players) {
      if (pl.turboT <= 0) continue;
      const car = this.cars.get(pl);
      const p = this.carPoint(car, -0.36, 0.32, 2.3);
      g.push(p.x, p.y, p.z, 1.2 + Math.random() * 0.6, 0.3, 0.55, 1, 1);
      g.push(p.x, p.y, p.z, 0.6, 1, 0.8, 0.5, 1);
    }
    g.end();
    // lightning
    this.hemi.intensity = this.hemiBase + (race.flash || 0) * 3;
  }

  // chase camera for one player: built in track space so it never lags along the
  // road at speed; only the sideways offset, height and yaw are smoothed
  placeCamera(cam, pl, view) {
    const w = this.world, tr = w.track;
    const car = this.cars.get(pl);
    const wide = view.w / view.h > 2.5; // split-screen views are short and wide
    const back = wide ? 7.6 : 6.4, up = wide ? 2.7 : 2.25, ahead = 10;
    let st = this.camState.get(pl);
    const yawOff = car ? car.f.yaw - car.f.h : 0;
    const yTarget = Math.max(tr.heightAt(pl.z - back), tr.heightAt(pl.z) - 0.5) + up;
    if (!st) {
      st = { x: pl.x, yaw: yawOff, y: yTarget };
      this.camState.set(pl, st);
    }
    st.x += (pl.x - st.x) * (1 - Math.exp(-this.dt * 7));
    st.yaw += (yawOff * 0.3 - st.yaw) * (1 - Math.exp(-this.dt * 5));
    st.y += (yTarget - st.y) * (1 - Math.exp(-this.dt * 8));
    const f = w.frameAt(pl.z - back, st.x, {});
    const hdg = f.h + st.yaw;
    const t = w.frameAt(pl.z + ahead, pl.x * 0.6, {});
    cam.position.set(f.x - Math.sin(st.yaw) * 0.0, st.y, f.z);
    if (pl.shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * pl.shake * 0.35, (Math.random() - 0.5) * pl.shake * 0.25, 0));
    cam.lookAt(t.x, t.y + (wide ? 0.4 : 0.9), t.z);
    const hfov = (wide ? 92 : 72) + U.clamp((pl.speed - 30) / 50, 0, 1) * 12 + (pl.turboT > 0 ? 6 : 0);
    const aspect = view.w / view.h;
    cam.aspect = aspect;
    cam.fov = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    cam.updateProjectionMatrix();
  }

  drawView(view, race, pl) {
    if (!this.kits) return;
    this.useWorld(race);
    if (this.carsFrame !== this.frame) {
      this.carsFrame = this.frame;
      this.updateCars(race);
    }
    const idx = race.players.indexOf(pl);
    const cam = this.cams[Math.max(0, idx)];
    this.placeCamera(cam, pl, view);
    if (!this.stepped) { this.stepped = true; this.stepEffects(race); }
    this.atmo.place(cam);
    // shadow frustum + headlight follow this player
    const car = this.cars.get(pl);
    const cp = car.g.position;
    this.sun.position.copy(cp).addScaledVector(this.sunDir, 150);
    this.sun.target.position.copy(cp).addScaledVector(new THREE.Vector3(Math.sin(car.f.h), 0, -Math.cos(car.f.h)), 25);
    race.players.forEach((p, i) => {
      const s = this.heads[i];
      const c = this.cars.get(p);
      s.intensity = this.headOn && c ? 2.2 : 0;
      if (c) {
        s.position.copy(this.carPoint(c, 0, 0.9, -2.0));
        s.target.position.copy(this.carPoint(c, 0, -0.5, -40));
      }
    });
    const sx = this.glCanvas.width / 1280;
    const vp = { x: Math.round(view.x * sx), y: Math.round(this.glCanvas.height - (view.y + view.h) * sx), w: Math.round(view.w * sx), h: Math.round(view.h * sx) };
    const fd = race.theme.fogDensity;
    this.ink.render(this.scene, cam, vp, 'v' + idx + (race === Game.bgRace ? 'bg' : ''), {
      thickness: Math.max(1, sx * 1.15),
      fadeStart: 900 / Math.sqrt(fd),
      fadeEnd: 1900 / Math.sqrt(fd),
    });
    // 2D overlays on the HUD canvas
    const ctx = this.ctx;
    if (race.flash > 0) {
      ctx.fillStyle = `rgba(230,235,255,${race.flash * 0.6})`;
      ctx.fillRect(view.x, view.y, view.w, view.h);
    }
    if (race.theme.night) {
      const g = ctx.createRadialGradient(view.x + view.w / 2, view.y + view.h * 0.6, view.h * 0.25, view.x + view.w / 2, view.y + view.h * 0.6, view.h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,12,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(view.x, view.y, view.w, view.h);
    }
  }
}
