# Lotus Esprit Turbo Challenge (remake)

**Play:** [v1 (original)](https://bobbydeveaux.github.io/lotus-turbo-challenge/v1/) · [v2 (sprites)](https://bobbydeveaux.github.io/lotus-turbo-challenge/) · [v3 (three.js, full 3D)](https://bobbydeveaux.github.io/lotus-turbo-challenge/v3/)

A pseudo-3D arcade racer in the spirit of the Amiga Lotus games. All car, scenery and
backdrop graphics are modelled procedurally and rendered in Blender.

## Play

Open `index.html` in a browser (no server needed). If you'd rather run it from a server:
`python3 -m http.server` and visit http://localhost:8000.

- **Look**: every sprite is cel-shaded in Blender (3-band toon ramp, hard specular, ink outlines),
  with a chunky cartoon UI and a live race running behind the menus.
- **Championship**: 8 stages (Forest, Night City, Fog, Snow, Desert, Storm, Sunset Coast, Motorway).
  Finish in the top 10 before the clock runs out to qualify. Checkpoints add time plus a turbo.
- **Single race**: pick any stage from the stage grid. **Daily challenge**: a new stage each day on Hard.
- **2-player split screen**: P1 on WASD + Space, P2 on the arrows + Enter.
- Auto or manual gears, 3 difficulty levels, gamepad support, high-score table.
- Leave the title screen idle and an attract-mode demo starts. `index.html?demo=3` jumps straight into one.

## Rebuild the graphics

```sh
# 1. model + render everything in Blender (≈1–2 min); groups: cars scenery bg hero
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python tools/blender/build_assets.py -- cars scenery bg hero

# 2. crop + pack into WebP atlases and regenerate js/gfx-manifest.js (needs Pillow)
python3 tools/pack_atlas.py
```

Add `real` to the group list to render the older PBR look instead of cel shading.

`tools/blender/build_assets.py` builds the Esprit (lofted wedge body, cabin, spoiler,
louvres, tail lights, wheels) and renders it in 10 colours × 9 yaw angles. It also builds the
trees, rocks, cacti, lamps, signs, billboards and gantries, and the seamless panoramic
backdrops. Seamlessness comes from sampling noise on a cylinder.

## Code layout

| file | role |
|---|---|
| `js/track.js` | segment-based track: curves, hills, scenery, hazards, checkpoints |
| `js/render.js` | pseudo-3D renderer: parallax, road, sprites, weather, night lighting |
| `js/race.js` | physics (gears, turbo, grip, drift), AI rivals, collisions, timing |
| `js/audio.js` | Web Audio engine synth, SFX and a two-track step-sequenced soundtrack |
| `js/stages.js` | themes and stage definitions |
| `js/hud.js`, `js/main.js` | HUD, menus, championship flow, high scores |

The original single-file version lives in `v1/`.

## v3 — full 3D (three.js)

`v3/` renders the same game in real 3D. Track generation, physics, AI, audio, menus
and HUD are shared with v2 (`js/`); only the renderer changes.

- Models come from the same Blender builders, exported as glTF:
  `Blender -b --factory-startup --python tools/blender/export_glb.py` → `v3/assets/models/`
- `v3/js/toon.js` – MeshToonMaterial with a 3-step ramp, hard specular + rim, snow caps
- `v3/js/outline.js` – screen-space ink lines from depth + normal edges
- `v3/js/world.js` – road, kerbs, terrain and instanced scenery built from the track
- `v3/js/fx.js` – sky, Blender panoramas on a ring, weather, particles, glows
- `v3/js/renderer3d.js` – cars, chase camera, lighting, shadows, split-screen views

ES modules need a web server locally: `python3 -m http.server` then open `/v3/`.
