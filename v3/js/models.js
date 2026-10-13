// Load the Blender GLBs and flatten each into "kits": one merged geometry per material,
// ready for instancing. The car also keeps its four wheels as separate pivots.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonFrom } from './toon.js';

export const PROPS = [
  'pine1', 'pine2', 'snowpine', 'oak', 'oak2', 'autumn', 'palm', 'palm2', 'deadtree', 'bush', 'bushflower',
  'rock', 'boulder', 'snowrock', 'redrock', 'cactus', 'lampL', 'lampR', 'chevL', 'chevR', 'bb_lotus', 'bb_turbo',
  'bb_gremlin', 'gantry_start', 'gantry_check', 'gantry_finish', 'log', 'cottage', 'snowpole', 'barrier', 'tower',
];

function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function mergeByMaterial(entries) {
  const byMat = new Map();
  for (const { geo, mat } of entries) {
    if (!byMat.has(mat.name)) byMat.set(mat.name, { mat, geos: [] });
    byMat.get(mat.name).geos.push(geo);
  }
  return [...byMat.values()].map(({ mat, geos }) => ({ material: mat, geometry: mergeGeometries(geos, false) }));
}

function collect(root, filter) {
  root.updateMatrixWorld(true);
  const out = [];
  const mats = new Map();
  root.traverse((o) => {
    if (!o.isMesh || (filter && !filter(o))) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const groups = o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const gr of groups) {
      const srcMat = list[gr.materialIndex || 0];
      if (!mats.has(srcMat.name)) mats.set(srcMat.name, toonFrom(srcMat));
      let geo = o.geometry;
      if (groups.length > 1) {
        geo = geo.clone();
        const idx = geo.index;
        if (idx) {
          const arr = idx.array.slice(gr.start, gr.start + gr.count);
          geo.setIndex(new THREE.BufferAttribute(arr, 1));
        }
      }
      geo = clean(geo);
      geo.applyMatrix4(o.matrixWorld);
      out.push({ geo, mat: mats.get(srcMat.name), name: o.name });
    }
  });
  return out;
}

export async function loadKits(base, onProgress) {
  const loader = new GLTFLoader();
  const kits = {};
  let done = 0;
  const total = PROPS.length + 1;
  const load = (name) => loader.loadAsync(`${base}/${name}.glb`).then((g) => { onProgress && onProgress(++done / total); return g.scene; });

  await Promise.all(PROPS.map(async (name) => {
    const scene = await load(name);
    const parts = mergeByMaterial(collect(scene));
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    kits[name] = { parts, box, size: box.getSize(new THREE.Vector3()) };
  }));

  // car: body + 4 wheel pivots
  const car = await load('car');
  const isWheel = (o) => /^(tyre|rim|holes)/.test(o.name);
  const body = mergeByMaterial(collect(car, (o) => !isWheel(o)));
  const wheelEntries = collect(car, isWheel);
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mine = wheelEntries.filter((e) => {
        e.geo.computeBoundingBox();
        const c = e.geo.boundingBox.getCenter(new THREE.Vector3());
        return Math.sign(c.x) === sx && Math.sign(c.z) === sz;
      });
      const box = new THREE.Box3();
      for (const e of mine) box.union(e.geo.boundingBox);
      const centre = box.getCenter(new THREE.Vector3());
      const parts = mergeByMaterial(mine.map((e) => ({ geo: e.geo.clone().translate(-centre.x, -centre.y, -centre.z), mat: e.mat })));
      wheels.push({ centre, parts, front: sz < 0, radius: box.getSize(new THREE.Vector3()).y / 2 });
    }
  }
  kits.car = { body, wheels };
  return kits;
}
