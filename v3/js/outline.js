// Screen-space ink: render colour (+depth) and normals, then draw lines where depth
// or normal changes sharply. Gives constant-width outlines and panel lines on every
// mesh, including instanced scenery, with no gaps on hard-edged models.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNormal;
uniform vec2 texel; uniform float near; uniform float far; uniform vec3 ink; uniform float fadeStart; uniform float fadeEnd;
varying vec2 vUv;
float lin(vec2 uv){ float d = texture2D(tDepth, uv).x; return (near * far) / (far - d * (far - near)); }
vec3 nrm(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  float dc = lin(vUv);
  vec2 ox = vec2(texel.x, 0.0), oy = vec2(0.0, texel.y);
  float dl = lin(vUv - ox), dr = lin(vUv + ox), du = lin(vUv + oy), dd = lin(vUv - oy);
  float lap = abs(dl + dr + du + dd - 4.0 * dc) / max(dc, 0.5);
  float edgeD = smoothstep(0.035, 0.09, lap);
  vec3 nc = nrm(vUv);
  float nd = max(max(1.0 - dot(nc, nrm(vUv - ox)), 1.0 - dot(nc, nrm(vUv + ox))), max(1.0 - dot(nc, nrm(vUv + oy)), 1.0 - dot(nc, nrm(vUv - oy))));
  float edgeN = smoothstep(0.22, 0.5, nd) * step(dc, far * 0.9);
  float edge = max(edgeD, edgeN) * (1.0 - smoothstep(fadeStart, fadeEnd, dc));
  gl_FragColor = vec4(mix(col, ink, edge * 0.92), 1.0);
  #include <colorspace_fragment>
}`;

export class InkPass {
  constructor(renderer) {
    this.r = renderer;
    this.targets = new Map();
    this.normalMat = new THREE.MeshNormalMaterial();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
        texel: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 1000 },
        ink: { value: new THREE.Color(0x14141c).convertSRGBToLinear() }, fadeStart: { value: 220 }, fadeEnd: { value: 520 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  target(key, w, h) {
    let t = this.targets.get(key);
    if (!t || t.w !== w || t.h !== h) {
      if (t) { t.color.dispose(); t.normal.dispose(); }
      const depth = new THREE.DepthTexture(w, h);
      depth.type = THREE.UnsignedIntType;
      const color = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth });
      const normal = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
      t = { w, h, color, normal };
      this.targets.set(key, t);
    }
    return t;
  }

  // vp: viewport in device pixels {x, y (from bottom), w, h}
  render(scene, camera, vp, key, opts = {}) {
    const r = this.r;
    const t = this.target(key, vp.w, vp.h);
    r.setScissorTest(false);
    r.setRenderTarget(t.color);
    r.setViewport(0, 0, vp.w, vp.h);
    r.clear();
    camera.layers.enableAll();
    r.render(scene, camera);

    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.normalMat;
    camera.layers.set(0);
    r.setRenderTarget(t.normal);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;
    camera.layers.enableAll();
    r.setClearColor(0x000000, 1);

    const u = this.mat.uniforms;
    u.tColor.value = t.color.texture;
    u.tDepth.value = t.color.depthTexture;
    u.tNormal.value = t.normal.texture;
    const px = opts.thickness ?? 1;
    u.texel.value.set(px / vp.w, px / vp.h);
    u.near.value = camera.near;
    u.far.value = camera.far;
    u.fadeStart.value = opts.fadeStart ?? 220;
    u.fadeEnd.value = opts.fadeEnd ?? 520;
    r.setRenderTarget(null);
    r.setViewport(vp.x, vp.y, vp.w, vp.h);
    r.setScissor(vp.x, vp.y, vp.w, vp.h);
    r.setScissorTest(true);
    r.render(this.quadScene, this.quadCam);
    r.setScissorTest(false);
  }
}
