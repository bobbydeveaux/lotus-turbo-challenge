"""
Export the Blender-built models as glTF for the three.js version (v3).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      --python tools/blender/export_glb.py

Writes v3/assets/models/car.glb and v3/assets/models/<prop>.glb
Procedural colour nodes are flattened to plain material colours; materials keep
hints (snow / windows / checker) as glTF extras for the engine's toon shader.
"""
import bpy, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.argv = [sys.argv[0], "--", "__none__"]  # import the builders without rendering anything
import build_assets as B  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "v3", "assets", "models")
os.makedirs(OUT, exist_ok=True)
MAX_TRIS = {"default": 1600, "car": 20000, "tower": 200, "gantry": 3000}


def flatten_materials():
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        P = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not P:
            continue
        bc = P.inputs["Base Color"]
        if bc.is_linked:
            for l in list(bc.links):
                m.node_tree.links.remove(l)
            flat = m.get("flat")
            col = list(flat) if flat else [0.5, 0.5, 0.5]
            if m.get("windows"):
                col = [0.03, 0.035, 0.05]
            bc.default_value = (*col, 1)
        for name in ("Emission Color", "Emission Strength", "Normal"):
            s = P.inputs.get(name)
            if s and s.is_linked:
                for l in list(s.links):
                    m.node_tree.links.remove(l)
        if m.get("windows"):
            P.inputs["Emission Strength"].default_value = 0.0


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def prepare(limit):
    # outlines are drawn in-engine: drop the inverted-hull modifiers
    for ob in bpy.context.scene.objects:
        for md in list(getattr(ob, "modifiers", [])):
            if md.name == "ink":
                ob.modifiers.remove(md)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    total = sum(tri_count(o) for o in meshes)
    if total > limit:
        ratio = max(0.08, limit / total)
        for o in meshes:
            if tri_count(o) > 300:
                d = o.modifiers.new("decimate", "DECIMATE")
                d.ratio = ratio
    flatten_materials()
    total2 = sum(tri_count(o) for o in meshes)
    return total, total2


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_extras=True,
        export_yup=True,
        export_lights=False,
        export_cameras=False,
        export_materials="EXPORT",
    )


# ── car ──────────────────────────────────────────────────────────────────────
B.reset_scene()
root, paint, tail = B.build_esprit()
for ob in bpy.context.scene.objects:
    if ob.type == "FONT":
        ob.parent = root
a, b = prepare(MAX_TRIS["car"])
export(os.path.join(OUT, "car.glb"))
print("EXPORT car", a, "->", b)

# ── scenery ──────────────────────────────────────────────────────────────────
for name, fn, kw, ppm in B.SCENERY:
    B.reset_scene()
    root = B.empty(name)
    fn(root, **kw)
    key = "gantry" if name.startswith("gantry") else name if name in MAX_TRIS else "default"
    a, b = prepare(MAX_TRIS[key])
    export(os.path.join(OUT, name + ".glb"))
    print("EXPORT", name, a, "->", b)
print("EXPORT DONE")
