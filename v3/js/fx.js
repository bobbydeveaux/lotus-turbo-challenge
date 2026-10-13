// Sky dome, sun/moon/stars, clouds, wrap-around Blender panoramas, ground plane,
// weather, particles and glow sprites. Everything here lives on layer 1 so the
// ink pass ignores it (except the ground).
import * as THREE from 'three';

const FX_LAYER = 1;
const col = (hex) => new THREE.Color(hex);

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, s] of stops) gr.addColorStop(p, s);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const TEX = {
  glow: radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]),
  soft: radialTexture([[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64),
};

function onFx(o) {
  o.layers.set(FX_LAYER);
  o.traverse((c) => c.layers.set(FX_LAYER));
  return o;
}

// custom point shader: per-point size, colour and alpha
function pointsMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: TEX.soft }, scale: { value: 600 } },
    vertexShader: `uniform float scale; attribute float size; attribute vec4 rgba; varying vec4 vC;
      void main(){ vC = rgba; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec4 vC;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

class PointPool {
  constructor(n, additive, tex) {
    this.n = n;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.rgba = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('rgba', new THREE.BufferAttribute(this.rgba, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = pointsMaterial(additive);
    if (tex) this.mat.uniforms.map.value = tex;
    this.obj = onFx(new THREE.Points(this.geo, this.mat));
    this.obj.frustumCulled = false;
    this.count = 0;
  }
  begin() { this.count = 0; }
  push(x, y, z, size, r, g, b, a) {
    if (this.count >= this.n) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.rgba[i * 4] = r; this.rgba[i * 4 + 1] = g; this.rgba[i * 4 + 2] = b; this.rgba[i * 4 + 3] = a;
    this.size[i] = size;
  }
  end() {
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.rgba.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: col(0) }, mid: { value: col(0) }, bot: { value: col(0) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(bot, mix(mid, top, smoothstep(0.12, 0.6, h)), smoothstep(0.0, 0.12, h)) : bot;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = onFx(new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.skyMat));
    this.sky.renderOrder = -10;
    this.root.add(this.sky);
    // sun / moon
    this.sun = onFx(new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })));
    this.sunDisc = onFx(new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, '#fff'], [0.92, '#fff'], [1, 'rgba(255,255,255,0)']], 64), depthWrite: false, fog: false })));
    this.root.add(this.sun, this.sunDisc);
    // stars
    const sp = [];
    const r = U.rng(5);
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI * 2, e = Math.asin(0.05 + r() * 0.95);
      sp.push(Math.cos(a) * Math.cos(e) * 3500, Math.sin(e) * 3500, Math.sin(a) * Math.cos(e) * 3500);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = onFx(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 })));
    this.root.add(this.stars);
    // clouds
    this.cloudTex = radialTexture([[0, 'rgba(255,255,255,0.95)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']], 128);
    this.clouds = new THREE.Group();
    this.root.add(this.clouds);
    // panorama ring
    this.backs = [];
    // ground disc
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x3a6a2a });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(3200, 48).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.layers.set(FX_LAYER);
    this.ground.renderOrder = -5;
    this.root.add(this.ground);
    // weather + particles + glows
    this.rain = null;
    this.snow = null;
    this.dust = new PointPool(900, false);
    this.glows = new PointPool(400, true, TEX.glow);
    this.root.add(this.dust.obj, this.glows.obj);
    this.parts = [];
  }

  setTheme(theme, world) {
    const lin = (h) => new THREE.Color(h);
    this.skyMat.uniforms.top.value = lin(theme.sky[0]);
    this.skyMat.uniforms.mid.value = lin(theme.sky[1]);
    this.skyMat.uniforms.bot.value = lin(theme.sky[2]);
    this.theme = theme;
    this.stars.visible = !!theme.stars;
    const sun = theme.sun || (theme.moon ? { x: 0.2, y: 0.16, r: 22, col: '#f2f0e6' } : null);
    this.sun.visible = this.sunDisc.visible = !!sun;
    if (sun) {
      const elev = U.clamp(0.42 - sun.y, 0.03, 0.4);
      this.sunDir = new THREE.Vector3(Math.cos(sun.x * 6) * 0.9, elev * 1.6, -0.9).normalize();
      this.sun.material.color.set(theme.moon ? '#8fb4ff' : theme.sun.col || '#fff6d8');
      this.sunDisc.material.color.set(theme.moon ? '#f2f0e6' : '#fffbe8');
      this.sunSize = sun.r * (theme.moon ? 5 : 6.5);
    }
    // clouds
    this.clouds.clear();
    if (theme.clouds) {
      const r = U.rng(11);
      for (let i = 0; i < theme.clouds.count * 4; i++) {
        const m = new THREE.SpriteMaterial({ map: this.cloudTex, color: new THREE.Color(`rgb(${theme.clouds.col.join(',')})`), opacity: theme.clouds.alpha * 0.8, depthWrite: false, fog: false, transparent: true });
        const s = onFx(new THREE.Sprite(m));
        const a = r() * Math.PI * 2, e = 0.04 + r() * 0.22, d = 2600;
        s.position.set(Math.cos(a) * d, Math.sin(e) * d, Math.sin(a) * d);
        s.scale.set(500 + r() * 700, 160 + r() * 140, 1);
        this.clouds.add(s);
      }
    }
    // panoramas: far and near rings
    for (const b of this.backs) { this.root.remove(b); b.geometry.dispose(); b.material.dispose(); }
    this.backs = [];
    const ring = (name, radius, repeat, lift, opacity, tint) => {
      const img = name && GFX.bgs[name];
      if (!img) return;
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(repeat, 1);
      const h = ((Math.PI * 2 * radius) / repeat) * (img.height / img.width);
      const geo = new THREE.CylinderGeometry(radius, radius, h, 96, 1, true);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, opacity, color: tint ? new THREE.Color(...tint) : 0xffffff });
      const m = onFx(new THREE.Mesh(geo, mat));
      m.userData = { h, lift };
      m.renderOrder = -8 + this.backs.length;
      this.root.add(m);
      this.backs.push(m);
    };
    const tint = theme.bgTint || theme.tint;
    ring(theme.bgFar, 3000, 3, 0.012, theme.bgAlpha ?? 1, tint);
    ring(theme.bgNear, 2400, 4, 0.01, theme.bgAlpha ?? 1, theme.bgNearNoTint ? null : tint);
    // ground colour = far grass hazed into the fog
    const g = new THREE.Color(theme.grass[0]);
    const fogc = new THREE.Color(`rgb(${theme.fog.join(',')})`);
    this.groundMat.color.copy(g.lerp(fogc, theme.night ? 0.5 : 0.35));
    this.groundY = world.minY;
    // weather
    for (const w of ['rain', 'snow']) if (this[w]) { this.root.remove(this[w].obj || this[w]); this[w] = null; }
    if (theme.weather === 'storm') this.makeRain();
    if (theme.weather === 'snow') this.makeSnow();
  }

  makeRain() {
    const n = 2200, p = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rainDrops = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 80, y: Math.random() * 30, z: (Math.random() - 0.5) * 80 }));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbfd0e6, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    m.frustumCulled = false;
    this.rain = onFx(m);
    this.root.add(m);
  }

  makeSnow() {
    this.snow = new PointPool(2400, false);
    this.snowFlakes = Array.from({ length: 2400 }, () => ({ x: (Math.random() - 0.5) * 90, y: Math.random() * 35, z: (Math.random() - 0.5) * 90, s: 0.08 + Math.random() * 0.12 }));
    this.root.add(this.snow.obj);
  }

  // once per frame: animate weather + particles (weather is camera-relative)
  step(dt, t) {
    this.t = t;
    if (this.rain) {
      const p = this.rain.geometry.attributes.position.array;
      this.rainDrops.forEach((d, i) => {
        d.y -= dt * 28;
        if (d.y < -8) { d.y = 24; d.x = (Math.random() - 0.5) * 80; d.z = (Math.random() - 0.5) * 80; }
        p.set([d.x, d.y, d.z, d.x - 0.15, d.y - 1.1, d.z], i * 6);
      });
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow) {
      this.snow.begin();
      for (const f of this.snowFlakes) {
        f.y -= dt * (1.4 + f.s * 6);
        f.x += Math.sin(t * 0.7 + f.z) * dt * 0.6;
        if (f.y < -10) { f.y = 26; f.x = (Math.random() - 0.5) * 90; f.z = (Math.random() - 0.5) * 90; }
        this.snow.push(f.x, f.y, f.z, f.s * 2.2, 1, 1, 1, 0.9);
      }
      this.snow.end();
    }
    this.dust.begin();
    this.parts = this.parts.filter((q) => (q.life -= dt) > 0);
    for (const q of this.parts) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.vy -= 1.5 * dt;
      const k = q.life / q.max;
      this.dust.push(q.x, q.y, q.z, q.size * (1.8 - k), q.r, q.g, q.b, q.a * k);
    }
    this.dust.end();
  }

  // per view: centre the far things and the weather on this camera
  place(camera) {
    const cp = camera.position;
    this.sky.position.copy(cp);
    this.stars.position.copy(cp);
    this.clouds.position.copy(cp);
    this.clouds.rotation.y = (this.t || 0) * 0.002;
    if (this.sunDir) {
      const p = this.sunDir.clone().multiplyScalar(3600).add(cp);
      this.sun.position.copy(p);
      this.sunDisc.position.copy(p);
      this.sun.scale.setScalar(this.sunSize * 5);
      this.sunDisc.scale.setScalar(this.sunSize);
    }
    for (const b of this.backs) b.position.set(cp.x, cp.y - 30 + b.userData.h * 0.42, cp.z);
    this.ground.position.set(cp.x, Math.min(this.groundY, cp.y - 60), cp.z);
    if (this.rain) this.rain.position.copy(cp);
    if (this.snow) this.snow.obj.position.copy(cp);
  }

  emit(x, y, z, n, rgb, opts = {}) {
    for (let i = 0; i < n && this.parts.length < 880; i++) {
      const life = (opts.life ?? 0.7) * (0.7 + Math.random() * 0.6);
      this.parts.push({
        x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * (opts.spread ?? 2) + (opts.vx || 0), vy: (opts.up ?? 1.8) * (0.5 + Math.random()), vz: (Math.random() - 0.5) * (opts.spread ?? 2) + (opts.vz || 0),
        size: opts.size ?? 0.8, r: rgb[0], g: rgb[1], b: rgb[2], a: opts.alpha ?? 0.7, life, max: life,
      });
    }
  }
}
