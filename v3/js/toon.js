// Cel-shading materials: 3-step toon ramp, hard specular + rim on glossy parts,
// procedural snow caps, lit windows and chequers for the exported Blender models.
import * as THREE from 'three';

export const GRADIENT = (() => {
  const t = new THREE.DataTexture(new Uint8Array([80, 80, 170, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

const GLOSSY = new Set(['paint', 'glass', 'chrome', 'rim', 'tail', 'amber', 'mirror', 'steel', 'pole']);

// hard specular from the first directional light + a cool rim, added after lighting
function addGloss(mat, strength = 0.55) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      #if NUM_DIR_LIGHTS > 0
        vec3 gH = normalize(directionalLights[0].direction + geometryViewDir);
        float gS = step(0.965, dot(normal, gH));
        outgoingLight += vec3(gS * ${strength.toFixed(2)});
      #endif
      float gRim = 1.0 - max(dot(normal, geometryViewDir), 0.0);
      outgoingLight += vec3(0.2, 0.22, 0.3) * step(0.72, gRim) * 0.6;
      #include <opaque_fragment>`
    );
  };
  mat.customProgramCacheKey = () => 'gloss' + strength;
}

function addSnow(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      float snowUp = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), smoothstep(0.3, 0.55, snowUp));`
    );
  };
  mat.customProgramCacheKey = () => 'snow';
}

// pattern from object-space position (exported boxes carry no UVs)
function addPattern(mat, kind) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    const body = kind === 'windows'
      ? `vec2 wc = vec2((vObjPos.x + vObjPos.z) / 1.8, vObjPos.y / 2.6);
         vec2 wf = fract(wc);
         float win = step(wf.x, 0.6) * step(wf.y, 0.55);
         float lit = step(0.5, fract(sin(dot(floor(wc), vec2(12.9898, 78.233))) * 43758.5453));
         totalEmissiveRadiance = vec3(1.0, 0.72, 0.32) * win * lit * 1.4;`
      : `vec2 cc = floor(vObjPos.xy * 1.6);
         float ch = mod(cc.x + cc.y, 2.0);
         diffuseColor.rgb = mix(vec3(0.02), vec3(0.92), ch);`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace(kind === 'windows' ? '#include <emissivemap_fragment>' : '#include <color_fragment>', (m) => m + '\n' + body);
  };
  mat.customProgramCacheKey = () => 'pat' + kind;
}

export function toonFrom(src) {
  const m = new THREE.MeshToonMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0.7, 0.7, 0.7),
    gradientMap: GRADIENT,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0),
    emissiveIntensity: src.emissiveIntensity ?? 1,
    transparent: !!src.transparent,
    opacity: src.opacity ?? 1,
  });
  m.name = src.name;
  m.userData = { ...(src.userData || {}) };
  if (m.userData.snow) addSnow(m);
  else if (m.userData.windows) addPattern(m, 'windows');
  else if (m.userData.checker) { m.color.set(0xffffff); addPattern(m, 'checker'); }
  else if (GLOSSY.has(m.name)) addGloss(m, m.name === 'glass' ? 0.8 : 0.55);
  if (m.name === 'glass') m.color.set(0x0b0f16);
  return m;
}

export function toonColor(hex, extra = {}) {
  return new THREE.MeshToonMaterial({ color: hex, gradientMap: GRADIENT, ...extra });
}

export { addGloss };
