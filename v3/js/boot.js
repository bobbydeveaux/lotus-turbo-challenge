// Boot v3: swap in the three.js renderer, point shared assets at the repo root,
// then start the shared game flow (../js/main.js).
import { Renderer3D } from './renderer3d.js';

const M = window.GFX_MANIFEST;
M.pages = []; // sprite atlases aren't needed in 3D (manifest sizes still drive collisions)
for (const b of Object.values(M.bgs)) b.src = '../' + b.src;
M.hero = '../' + M.hero;
window.RendererImpl = Renderer3D;

const s = document.createElement('script');
s.src = '../js/main.js';
document.body.appendChild(s);
