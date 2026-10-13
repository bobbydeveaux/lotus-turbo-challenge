"""
Procedural asset builder for Lotus Esprit Turbo Challenge (remake).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      --python tools/blender/build_assets.py -- [groups...]

Groups: cars scenery bg hero   (default: all)

Renders raw PNGs + meta JSON into tools/blender/_renders/.
tools/pack_atlas.py then crops/packs them into assets/gfx/*.webp + js/gfx-manifest.js
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "_renders")
os.makedirs(RAW, exist_ok=True)
META_PATH = os.path.join(RAW, "meta.json")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STYLE = "real" if "real" in argv else "toon"   # pass `real` for the old PBR look
argv = [a for a in argv if a != "real"]
GROUPS = set(argv) or {"cars", "scenery", "bg", "hero"}
INK = {"m": 0.015}  # outline thickness in metres for the next render

META = {}
if os.path.exists(META_PATH):
    with open(META_PATH) as f:
        META = json.load(f)

FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
]
rad = math.radians


# ───────────────────────────────────────────────────────────── scene setup
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    try:
        sc.eevee.taa_render_samples = 48
    except Exception:
        pass
    try:
        sc.eevee.use_raytracing = True
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.resolution_percentage = 100
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Punchy"
    except Exception:
        try:
            sc.view_settings.view_transform = "Standard"
        except Exception:
            pass
    return sc


def world_gradient(zen=(0.20, 0.35, 0.65), hor=(0.75, 0.80, 0.85), gnd=(0.12, 0.10, 0.08), strength=1.0):
    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs[0])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs[0])
    el = ramp.color_ramp.elements
    el[0].position = 0.0
    el[0].color = (*gnd, 1)
    el[1].position = 0.5
    el[1].color = (*hor, 1)
    e = el.new(0.47)
    e.color = (*[c * 0.5 for c in gnd], 1)
    e = el.new(0.75)
    e.color = (*zen, 1)
    el[-1].color = (*zen, 1)
    bg.inputs["Strength"].default_value = strength
    return w


def add_sun(rx, rz, strength=3.5, color=(1, 0.97, 0.92), angle=3.0):
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = strength
    ld.color = color
    ld.angle = rad(angle)
    ob = bpy.data.objects.new("sun", ld)
    bpy.context.collection.objects.link(ob)
    ob.rotation_euler = (rad(rx), 0, rad(rz))
    return ob


def add_area(loc, target, energy, size=4, color=(1, 1, 1)):
    ld = bpy.data.lights.new("area", "AREA")
    ld.energy = energy
    ld.size = size
    ld.color = color
    ob = bpy.data.objects.new("area", ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def ortho_camera():
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.clip_start = 0.1
    cd.clip_end = 2000
    ob = bpy.data.objects.new("cam", cd)
    bpy.context.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def aim_camera(cam, target, elev_deg, yaw_deg=0, dist=60):
    e, y = rad(elev_deg), rad(yaw_deg)
    t = Vector(target)
    d = Vector((math.sin(y) * math.cos(e), -math.cos(y) * math.cos(e), math.sin(e)))
    cam.location = t + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


# ───────────────────────────────────────────────────────────── cel shading
TOON_RAMP = [  # (position, shade colour) — cool shadows, warm mid, full light
    (0.0, (0.34, 0.36, 0.55)),
    (0.10, (0.62, 0.62, 0.74)),
    (0.42, (1.0, 1.0, 1.0)),
]


def _src(nt, sock):
    """return the socket feeding `sock`, or None if it's unlinked"""
    return sock.links[0].from_socket if sock.is_linked else None


def toonify_material(m):
    if m.get("toon_done") or m.get("no_toon") or not m.node_tree:
        return
    nt = m.node_tree
    P = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if not P or not out:
        return
    m["toon_done"] = True
    N = nt.nodes.new
    L = nt.links.new
    base = _src(nt, P.inputs["Base Color"])
    if base is None:
        rgb = N("ShaderNodeRGB")
        rgb.name = "toon_base"
        rgb.outputs[0].default_value = P.inputs["Base Color"].default_value
        base = rgb.outputs[0]
    metallic = P.inputs["Metallic"].default_value
    coat = P.inputs["Coat Weight"].default_value if "Coat Weight" in P.inputs else 0
    rough = P.inputs["Roughness"].default_value

    # banded diffuse
    dif = N("ShaderNodeBsdfDiffuse")
    if P.inputs["Normal"].is_linked:
        L(_src(nt, P.inputs["Normal"]), dif.inputs["Normal"])
    s2r = N("ShaderNodeShaderToRGB")
    L(dif.outputs[0], s2r.inputs[0])
    ramp = N("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = TOON_RAMP[0][0], (*TOON_RAMP[0][1], 1)
    el[1].position, el[1].color = TOON_RAMP[-1][0], (*TOON_RAMP[-1][1], 1)
    for pos, c in TOON_RAMP[1:-1]:
        e = el.new(pos)
        e.color = (*c, 1)
    L(s2r.outputs["Color"], ramp.inputs["Fac"])
    col = mix_color_op(nt, "MULTIPLY", ramp.outputs["Color"], base)

    # hard specular highlight + rim for glossy stuff (paint, glass, chrome)
    if coat > 0.3 or metallic > 0.3 or rough < 0.2:
        gl = N("ShaderNodeBsdfGlossy")
        gl.inputs["Roughness"].default_value = 0.18
        s2 = N("ShaderNodeShaderToRGB")
        L(gl.outputs[0], s2.inputs[0])
        r2 = N("ShaderNodeValToRGB")
        r2.color_ramp.interpolation = "CONSTANT"
        r2.color_ramp.elements[0].position = 0.0
        r2.color_ramp.elements[0].color = (0, 0, 0, 1)
        r2.color_ramp.elements[1].position = 0.6
        r2.color_ramp.elements[1].color = (0.75, 0.75, 0.75, 1)
        L(s2.outputs["Color"], r2.inputs["Fac"])
        col = mix_color_op(nt, "ADD", col, r2.outputs["Color"])
        lw = N("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.35
        r3 = N("ShaderNodeValToRGB")
        r3.color_ramp.interpolation = "CONSTANT"
        r3.color_ramp.elements[0].color = (0, 0, 0, 1)
        r3.color_ramp.elements[1].position = 0.72
        r3.color_ramp.elements[1].color = (0.22, 0.24, 0.3, 1)
        L(lw.outputs["Facing"], r3.inputs["Fac"])
        col = mix_color_op(nt, "ADD", col, r3.outputs["Color"])

    em = N("ShaderNodeEmission")
    L(col, em.inputs["Color"])
    shader = em.outputs[0]
    # keep original glow (tail lights, lamps, lit windows)
    es = P.inputs["Emission Strength"]
    if es.is_linked or es.default_value > 0:
        glow = N("ShaderNodeEmission")
        ec = _src(nt, P.inputs["Emission Color"])
        if ec:
            L(ec, glow.inputs["Color"])
        else:
            glow.inputs["Color"].default_value = P.inputs["Emission Color"].default_value
        if es.is_linked:
            L(_src(nt, es), glow.inputs["Strength"])
        else:
            glow.inputs["Strength"].default_value = es.default_value
        add = N("ShaderNodeAddShader")
        L(shader, add.inputs[0])
        L(glow.outputs[0], add.inputs[1])
        shader = add.outputs[0]
    L(shader, out.inputs["Surface"])


def mix_color_op(nt, op, a, b):
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = op
    mx.inputs["Factor"].default_value = 1.0
    A = [x for x in mx.inputs if x.name == "A" and x.type == "RGBA"][0]
    B = [x for x in mx.inputs if x.name == "B" and x.type == "RGBA"][0]
    nt.links.new(a, A)
    nt.links.new(b, B)
    return [x for x in mx.outputs if x.name == "Result" and x.type == "RGBA"][0]


def ink_material():
    m = bpy.data.materials.get("Ink")
    if m:
        return m
    m = bpy.data.materials.new("Ink")
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.012, 0.012, 0.02, 1)
    # outline shells must not shadow the object they wrap
    lp = nt.nodes.new("ShaderNodeLightPath")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Shadow Ray"], mx.inputs["Fac"])
    nt.links.new(em.outputs[0], mx.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    try:
        m.surface_render_method = "DITHERED"
        m.use_transparent_shadow = True
    except Exception:
        pass
    m.use_backface_culling = True
    try:
        m.use_backface_culling_shadow = True
    except Exception:
        pass
    m["no_toon"] = True
    return m


def toonify_scene():
    if STYLE != "toon":
        return
    sc = bpy.context.scene
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    try:
        sc.eevee.use_raytracing = False
    except Exception:
        pass
    # bands only read well when the key light lands around 1.0: one sun, low ambient
    if not sc.get("toon_lit"):
        sc["toon_lit"] = True
        lights = [o for o in sc.objects if o.type == "LIGHT"]
        has_sun = any(o.data.type == "SUN" for o in lights)
        for o in lights:
            if o.data.type == "SUN":
                o.data.energy = 3.1 if o.data.energy > 1 else o.data.energy
                o.data.angle = rad(0.5)
            elif has_sun:
                o.data.energy *= 0.04
            else:
                o.data.energy *= 0.5
        if sc.world and sc.world.node_tree:
            for n in sc.world.node_tree.nodes:
                if n.type == "BACKGROUND":
                    n.inputs["Strength"].default_value *= 0.3
    for m in bpy.data.materials:
        toonify_material(m)
    ink = ink_material()
    for ob in sc.objects:
        if ob.type != "MESH" or ob.get("no_ink"):
            continue
        md = ob.modifiers.get("ink")
        if md is None:
            if ink.name not in ob.data.materials:
                ob.data.materials.append(ink)
            md = ob.modifiers.new("ink", "SOLIDIFY")
            md.offset = 1.0
            md.use_flip_normals = True
            md.use_rim = False
            md.material_offset = list(ob.data.materials).index(ink)
            md.material_offset_rim = md.material_offset
        md.thickness = INK["m"]


def render_to(path, w, h):
    sc = bpy.context.scene
    toonify_scene()
    sc.render.resolution_x = int(w)
    sc.render.resolution_y = int(h)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ───────────────────────────────────────────────────────────── materials
def _bsdf(m):
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m.node_tree.nodes.get("Principled BSDF")


def _set(node, name, val):
    if name in node.inputs:
        node.inputs[name].default_value = val


def mat(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, estr=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    b = _bsdf(m)
    _set(b, "Base Color", (*color, 1))
    _set(b, "Metallic", metallic)
    _set(b, "Roughness", rough)
    _set(b, "Coat Weight", coat)
    _set(b, "Coat Roughness", 0.03)
    _set(b, "Specular IOR Level", spec)
    if emit:
        _set(b, "Emission Color", (*emit, 1))
        _set(b, "Emission Strength", estr)
    return m


def link_out(nt, a, an, b, bn):
    nt.links.new(a.outputs[an], b.inputs[bn])


def mat_noise(name, c1, c2, scale=4.0, rough=0.8, detail=4.0, coord="Object", bump=0.0):
    m = bpy.data.materials.new(name)
    b = _bsdf(m)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*c1, 1)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (*c2, 1)
    link_out(nt, tc, coord, nz, "Vector")
    link_out(nt, nz, "Fac", ramp, "Fac")
    link_out(nt, ramp, "Color", b, "Base Color")
    _set(b, "Roughness", rough)
    if bump > 0:
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        link_out(nt, nz, "Fac", bp, "Height")
        link_out(nt, bp, "Normal", b, "Normal")
    return m, nt, ramp, b


def mix_color(nt, fac_socket, a_socket, b_color_or_socket):
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    ins = [s for s in mx.inputs]
    fac = [s for s in ins if s.name == "Factor"][0]
    A = [s for s in ins if s.name == "A" and s.type == "RGBA"][0]
    B = [s for s in ins if s.name == "B" and s.type == "RGBA"][0]
    out = [s for s in mx.outputs if s.name == "Result" and s.type == "RGBA"][0]
    nt.links.new(fac_socket, fac)
    nt.links.new(a_socket, A)
    if isinstance(b_color_or_socket, tuple):
        B.default_value = (*b_color_or_socket, 1)
    else:
        nt.links.new(b_color_or_socket, B)
    return out


def add_snow_cover(m, nt, ramp, bsdf, lo=0.45, hi=0.7, snow=(0.92, 0.95, 1.0)):
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = hi
    link_out(nt, geo, "Normal", sep, 0)
    out = mix_color(nt, sep.outputs["Z"] if False else mr.outputs[0], ramp.outputs["Color"], snow)
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(out, bsdf.inputs["Base Color"])


# ───────────────────────────────────────────────────────────── mesh helpers
def new_obj(name, bm, material=None, parent=None, smooth_angle=None):
    if smooth_angle is not None:
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if e.is_manifold:
                try:
                    if e.calc_face_angle() > rad(smooth_angle):
                        e.smooth = False
                except ValueError:
                    pass
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material:
        me.materials.append(material)
    if parent:
        ob.parent = parent
    return ob


def loft(sections, cap=True):
    bm = bmesh.new()
    rings = [[bm.verts.new(v) for v in sec] for sec in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1][::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box(bm, cx, cy, cz, sx, sy, sz, rot=None):
    m = Matrix.Translation((cx, cy, cz))
    if rot is not None:
        m = m @ rot
    m = m @ Matrix.Diagonal((sx, sy, sz, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def cyl(bm, loc, r1, r2, depth, segs=16, rot=None):
    m = Matrix.Translation(loc)
    if rot is not None:
        m = m @ rot
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth, matrix=m)


def ico(bm, loc, r, subd=2, scale=(1, 1, 1)):
    m = Matrix.Translation(loc) @ Matrix.Diagonal((r * scale[0], r * scale[1], r * scale[2], 1))
    return bmesh.ops.create_icosphere(bm, subdivisions=subd, radius=1.0, matrix=m)["verts"]


def jitter(verts, amp, freq, seed=0.0):
    for v in verts:
        p = v.co * freq + Vector((seed, seed * 1.7, seed * 0.3))
        v.co += v.co.normalized() * 0 + Vector(noise.noise_vector(p)) * amp


def add_bevel(ob, width=0.01, segs=2, angle=30):
    md = ob.modifiers.new("bev", "BEVEL")
    md.width = width
    md.segments = segs
    md.limit_method = "ANGLE"
    md.angle_limit = rad(angle)
    return md


def text_obj(body, size, mat_, loc, rot, extrude=0.005, font=True, parent=None, spacing=1.0):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_character = spacing
    if font:
        for fp in FONT_PATHS:
            if os.path.exists(fp):
                try:
                    cu.font = bpy.data.fonts.load(fp, check_existing=True)
                    break
                except Exception:
                    pass
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    cu.materials.append(mat_)
    if parent:
        ob.parent = parent
    return ob


def empty(name="root"):
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    return ob


def bounds_of(root):
    """world-space bbox of all mesh/curve descendants"""
    bpy.context.view_layer.update()
    pts = []
    for ob in bpy.context.scene.objects:
        p = ob
        ok = False
        while p:
            if p == root:
                ok = True
                break
            p = p.parent
        if not ok or ob.type not in ("MESH", "CURVE", "FONT"):
            continue
        for c in ob.bound_box:
            pts.append(ob.matrix_world @ Vector(c))
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


# ───────────────────────────────────────────────────────────── the car
CAR_COLOURS = {
    "red": (0.62, 0.012, 0.012),
    "white": (0.80, 0.80, 0.78),
    "blue": (0.02, 0.10, 0.55),
    "yellow": (0.90, 0.62, 0.02),
    "green": (0.01, 0.22, 0.06),
    "silver": (0.42, 0.44, 0.46),
    "black": (0.015, 0.015, 0.018),
    "orange": (0.85, 0.20, 0.01),
    "purple": (0.22, 0.03, 0.40),
    "teal": (0.01, 0.38, 0.38),
}


def build_esprit():
    root = empty("car")
    paint = mat("paint", CAR_COLOURS["red"], metallic=0.35, rough=0.32, coat=1.0)
    glass = mat("glass", (0.012, 0.016, 0.022), rough=0.04, coat=1.0, spec=0.9)
    black = mat("black", (0.02, 0.02, 0.022), rough=0.55)
    satin = mat("satin", (0.035, 0.035, 0.04), rough=0.3, coat=0.4)
    rubber = mat("rubber", (0.025, 0.025, 0.025), rough=0.85)
    chrome = mat("chrome", (0.9, 0.9, 0.92), metallic=1.0, rough=0.12)
    rim = mat("rim", (0.80, 0.81, 0.83), metallic=0.6, rough=0.35)
    tail = mat("tail", (0.35, 0.0, 0.0), rough=0.15, emit=(1.0, 0.0, 0.0), estr=1.6, coat=1)
    amber = mat("amber", (0.6, 0.22, 0.0), rough=0.15, emit=(1.0, 0.3, 0.0), estr=0.6, coat=1)
    revw = mat("rev", (0.7, 0.7, 0.7), rough=0.1, emit=(1, 1, 1), estr=0.3, coat=1)
    plate = mat("plate", (0.85, 0.65, 0.02), rough=0.35)
    platew = mat("platew", (0.85, 0.85, 0.82), rough=0.35)
    head = mat("head", (0.9, 0.9, 0.85), rough=0.1, emit=(1, 1, 0.9), estr=0.4, coat=1)

    # body: (y, half-width, bottom z, top z)
    secs = [
        (-2.17, 0.85, 0.36, 0.80),
        (-2.09, 0.92, 0.30, 0.87),
        (-1.82, 0.93, 0.24, 0.87),
        (-1.73, 0.93, 0.50, 0.87),
        (-1.35, 0.935, 0.58, 0.87),
        (-0.98, 0.93, 0.50, 0.86),
        (-0.90, 0.93, 0.15, 0.85),
        (0.82, 0.93, 0.14, 0.73),
        (0.90, 0.93, 0.48, 0.72),
        (1.25, 0.92, 0.55, 0.68),
        (1.60, 0.90, 0.47, 0.64),
        (1.68, 0.90, 0.17, 0.63),
        (2.05, 0.85, 0.21, 0.55),
        (2.19, 0.77, 0.31, 0.48),
    ]
    rings = []
    for y, hw, bot, top in secs:
        belt = top - 0.13
        p2z = min(bot + 0.08, belt - 0.04)
        half = [(hw * 0.86, bot), (hw, p2z), (hw, belt), (hw * 0.94, top - 0.03)]
        ring = [(0, y, bot)] + [(x, y, z) for x, z in half] + [(0, y, top)] + [(-x, y, z) for x, z in reversed(half)]
        rings.append(ring)
    body = new_obj("body", loft(rings), paint, root, smooth_angle=28)
    add_bevel(body, 0.012, 2, 28)

    # cabin: (y, hw bottom, hw top, z bottom, z top)
    csecs = [
        (0.84, 0.88, 0.82, 0.715, 0.73),
        (-0.05, 0.88, 0.64, 0.735, 1.13),
        (-0.62, 0.89, 0.64, 0.79, 1.14),
        (-1.08, 0.90, 0.76, 0.84, 0.885),
    ]
    crings = []
    for y, hb, ht, zb, zt in csecs:
        crings.append([(hb, y, zb), (ht, y, zt - 0.035), (ht * 0.86, y, zt), (-ht * 0.86, y, zt), (-ht, y, zt - 0.035), (-hb, y, zb)])
    bm = loft(crings)
    me_c = new_obj("cabin", bm, glass, root, smooth_angle=25)
    me_c.data.materials.append(paint)
    for poly in me_c.data.polygons:
        c = poly.center
        if poly.normal.z > 0.9 and -0.62 <= c.y <= -0.04:
            poly.material_index = 1
        # B-pillar / buttress band on the sides behind the side window
        if abs(poly.normal.x) > 0.5 and c.y < -0.66:
            poly.material_index = 1
    add_bevel(me_c, 0.01, 2, 25)

    # floor filler (dark underside visible through arches)
    bm = bmesh.new()
    box(bm, 0, 0, 0.26, 1.50, 4.0, 0.22)
    new_obj("floor", bm, black, root)

    # ── rear details (rear face sits ~ y = -2.17)
    R = -2.175
    bm = bmesh.new()
    box(bm, 0, R + 0.01, 0.585, 1.56, 0.03, 0.24)  # black tail panel band
    new_obj("tailband", bm, satin, root)
    for s in (1, -1):
        bm = bmesh.new()
        box(bm, s * 0.56, R - 0.008, 0.59, 0.26, 0.02, 0.17)
        new_obj("tail", bm, tail, root)
        bm = bmesh.new()
        box(bm, s * 0.755, R - 0.008, 0.59, 0.11, 0.02, 0.17)
        new_obj("ind", bm, amber, root)
        bm = bmesh.new()
        box(bm, s * 0.36, R - 0.008, 0.59, 0.10, 0.02, 0.10)
        new_obj("rev", bm, revw, root)
    # plate
    bm = bmesh.new()
    box(bm, 0, R - 0.006, 0.41, 0.50, 0.02, 0.10)
    new_obj("plate", bm, plate, root)
    text_obj("LTC 2", 0.085, black, (0, R - 0.02, 0.41), (rad(90), 0, 0), extrude=0.004, parent=root)
    # lower bumper strip + diffuser
    bm = bmesh.new()
    box(bm, 0, R + 0.02, 0.33, 1.66, 0.06, 0.06)
    new_obj("bumper", bm, satin, root)
    # exhausts
    for x in (-0.42, -0.30):
        bm = bmesh.new()
        cyl(bm, (x, R - 0.02, 0.32), 0.035, 0.035, 0.12, 14, Matrix.Rotation(rad(90), 4, "X"))
        new_obj("exh", bm, chrome, root)
    # deck louvres
    bm = bmesh.new()
    for i in range(7):
        y = -1.18 - i * 0.11
        box(bm, 0, y, 0.875, 1.30, 0.05, 0.02, Matrix.Rotation(rad(-20), 4, "X"))
    new_obj("louvres", bm, black, root)
    # rear spoiler (Turbo SE style)
    bm = bmesh.new()
    box(bm, 0, -1.96, 0.985, 1.80, 0.24, 0.035, Matrix.Rotation(rad(-6), 4, "X"))
    for s in (1, -1):
        box(bm, s * 0.62, -1.96, 0.93, 0.05, 0.16, 0.10)
    sp = new_obj("spoiler", bm, paint, root, smooth_angle=40)
    add_bevel(sp, 0.012, 2)
    # side intakes + mirrors + sill strip
    for s in (1, -1):
        bm = bmesh.new()
        box(bm, s * 0.932, -0.80, 0.62, 0.02, 0.48, 0.12)
        new_obj("intake", bm, black, root)
        bm = bmesh.new()
        box(bm, s * 0.99, 0.42, 0.80, 0.10, 0.14, 0.075)
        box(bm, s * 0.925, 0.44, 0.765, 0.08, 0.04, 0.03)
        new_obj("mirror", bm, paint, root)
        bm = bmesh.new()
        box(bm, s * 0.937, 0.0, 0.36, 0.015, 1.66, 0.06)
        new_obj("sill", bm, satin, root)
    # front: bumper bar, indicators, closed pop-up lamp lines, number plate
    bm = bmesh.new()
    box(bm, 0, 2.18, 0.34, 1.50, 0.06, 0.06)
    new_obj("fbumper", bm, satin, root)
    bm = bmesh.new()
    box(bm, 0, 2.20, 0.42, 0.48, 0.02, 0.10)
    new_obj("fplate", bm, platew, root)
    for s in (1, -1):
        bm = bmesh.new()
        box(bm, s * 0.60, 2.19, 0.40, 0.22, 0.02, 0.05)
        new_obj("find", bm, amber, root)
        bm = bmesh.new()
        box(bm, s * 0.42, 1.62, 0.638, 0.40, 0.012, 0.012)
        box(bm, s * 0.42, 1.90, 0.592, 0.40, 0.012, 0.012)
        new_obj("popup", bm, black, root)

    # wheels
    def wheel(x, y, r=0.31, w=0.25):
        rx = Matrix.Rotation(rad(90), 4, "Y")
        bm = bmesh.new()
        cyl(bm, (x, y, r), r, r, w, 28, rx)
        t = new_obj("tyre", bm, rubber, root, smooth_angle=50)
        add_bevel(t, 0.06, 3, 50)
        s = 1 if x > 0 else -1
        bm = bmesh.new()
        cyl(bm, (x + s * 0.01, y, r), 0.21, 0.21, w + 0.005, 28, rx)
        new_obj("rim", bm, rim, root, smooth_angle=50)
        bm = bmesh.new()
        for k in range(5):
            a = k * math.tau / 5
            cyl(bm, (x + s * (w / 2 + 0.006), y + math.cos(a) * 0.12, r + math.sin(a) * 0.12), 0.045, 0.045, 0.01, 10, rx)
        cyl(bm, (x + s * (w / 2 + 0.008), y, r), 0.035, 0.035, 0.012, 12, rx)
        new_obj("holes", bm, black, root)

    for x in (0.80, -0.80):
        wheel(x, -1.35, 0.32, 0.27)
        wheel(x, 1.25, 0.30, 0.23)
    return root, paint, tail


# ───────────────────────────────────────────────────────────── scenery models
def tree_pine(root, seed=1, h=12.0, snow=False):
    random.seed(seed)
    bark = mat_noise("bark", (0.10, 0.05, 0.02), (0.20, 0.11, 0.05), 20, 0.9)[0]
    m, nt, ramp, b = mat_noise("needles", (0.015, 0.07, 0.02), (0.04, 0.16, 0.05), 3.0, 0.85, bump=0.3)
    if snow:
        add_snow_cover(m, nt, ramp, b, 0.35, 0.65)
    bm = bmesh.new()
    cyl(bm, (0, 0, h * 0.2), h * 0.035, h * 0.02, h * 0.4, 10)
    new_obj("trunk", bm, bark, root)
    bm = bmesh.new()
    layers = 6
    for i in range(layers):
        t = i / (layers - 1)
        r = h * (0.30 - 0.22 * t) * random.uniform(0.9, 1.1)
        z = h * (0.18 + 0.66 * t)
        cyl(bm, (random.uniform(-0.1, 0.1), random.uniform(-0.1, 0.1), z + h * 0.11), r, 0, h * (0.30 - 0.08 * t), 14)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    for v in bm.verts:
        n = noise.noise_vector(v.co * 0.9 + Vector((seed, 0, 0)))
        v.co += Vector(n) * h * 0.025
        # droop the skirt edges
    new_obj("leaves", bm, m, root, smooth_angle=60)


def tree_oak(root, seed=2, h=10.0, autumn=False):
    random.seed(seed)
    bark = mat_noise("bark", (0.09, 0.06, 0.04), (0.18, 0.13, 0.08), 18, 0.9)[0]
    if autumn:
        leaf = mat_noise("leaf", (0.35, 0.12, 0.01), (0.55, 0.35, 0.02), 2.5, 0.8, bump=0.4)[0]
    else:
        leaf = mat_noise("leaf", (0.03, 0.12, 0.02), (0.12, 0.30, 0.04), 2.5, 0.8, bump=0.4)[0]
    bm = bmesh.new()
    cyl(bm, (0, 0, h * 0.25), h * 0.05, h * 0.035, h * 0.5, 10)
    for a in (0.6, 2.5, 4.4):
        rot = Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(rad(40), 4, "X")
        cyl(bm, Vector((0, 0, h * 0.42)) + rot @ Vector((0, 0, h * 0.1)), h * 0.025, h * 0.012, h * 0.25, 8, rot)
    new_obj("trunk", bm, bark, root)
    bm = bmesh.new()
    blobs = [(0, 0, 0.66, 0.30)] + [
        (math.cos(a) * 0.22, math.sin(a) * 0.22, random.uniform(0.55, 0.75), random.uniform(0.18, 0.24)) for a in [i * math.tau / 6 + random.random() for i in range(6)]
    ] + [(0, 0, 0.85, 0.2)]
    for x, y, z, r in blobs:
        vs = ico(bm, (x * h, y * h, z * h), r * h, 3)
        for v in vs:
            v.co += Vector(noise.noise_vector(v.co * 0.6 + Vector((seed, 2, 0)))) * h * 0.04
    new_obj("canopy", bm, leaf, root, smooth_angle=70)


def tree_palm(root, seed=3, h=11.0):
    random.seed(seed)
    bark = mat_noise("pbark", (0.22, 0.15, 0.08), (0.38, 0.28, 0.16), 6, 0.9, bump=0.5)[0]
    leaf = mat_noise("pleaf", (0.03, 0.15, 0.02), (0.15, 0.32, 0.05), 3, 0.7)[0]
    bm = bmesh.new()
    segs = 12
    lean = random.uniform(0.08, 0.14) * h
    pts = []
    for i in range(segs + 1):
        t = i / segs
        pts.append(Vector((lean * t * t, 0, h * t)))
    for i in range(segs):
        a, b2 = pts[i], pts[i + 1]
        d = b2 - a
        rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        r = h * 0.03 * (1 - 0.35 * i / segs)
        cyl(bm, (a + b2) / 2, r * 1.08, r * 0.92, d.length * 1.02, 10, rot)
    new_obj("trunk", bm, bark, root)
    top = pts[-1]
    bm = bmesh.new()
    nfr = 9
    for k in range(nfr):
        a = k * math.tau / nfr + random.uniform(-0.15, 0.15)
        L = h * random.uniform(0.38, 0.48)
        n = 10
        prev = None
        for i in range(n + 1):
            t = i / n
            out = L * t
            droop = -(t ** 1.7) * L * 0.55 + t * L * 0.15
            c = top + Vector((math.cos(a) * out, math.sin(a) * out, droop))
            wdt = L * 0.09 * math.sin(math.pi * min(1, t * 1.1 + 0.05))
            side = Vector((-math.sin(a), math.cos(a), 0)) * wdt
            v1 = bm.verts.new(c + side + Vector((0, 0, -wdt * 0.3)))
            v0 = bm.verts.new(c)
            v2 = bm.verts.new(c - side + Vector((0, 0, -wdt * 0.3)))
            if prev:
                bm.faces.new((prev[0], prev[1], v0, v1))
                bm.faces.new((prev[1], prev[2], v2, v0))
            prev = (v1, v0, v2)
    ob = new_obj("fronds", bm, leaf, root, smooth_angle=80)
    sol = ob.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.05
    bm = bmesh.new()
    for k in range(4):
        ico(bm, top + Vector((math.cos(k * 1.6) * 0.25, math.sin(k * 1.6) * 0.25, -0.35)), 0.2, 1)
    new_obj("coconuts", bm, mat("coco", (0.18, 0.12, 0.04), rough=0.6), root)


def tree_dead(root, seed=4, h=8.0):
    random.seed(seed)
    bark = mat_noise("dbark", (0.07, 0.06, 0.05), (0.16, 0.14, 0.12), 12, 0.95)[0]
    bm = bmesh.new()

    def branch(p, d, L, r, depth):
        e = p + d * L
        rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        cyl(bm, (p + e) / 2, r, r * 0.65, L, 8, rot)
        if depth == 0:
            return
        for _ in range(random.choice((2, 2, 3))):
            nd = (d + Vector((random.uniform(-0.9, 0.9), random.uniform(-0.5, 0.5), random.uniform(0.0, 0.6)))).normalized()
            branch(e, nd, L * random.uniform(0.55, 0.75), r * 0.62, depth - 1)

    branch(Vector((0, 0, 0)), Vector((0, 0, 1)), h * 0.42, h * 0.045, 4)
    new_obj("dead", bm, bark, root, smooth_angle=60)


def bush(root, seed=5, s=1.6, flowers=False):
    random.seed(seed)
    leaf = mat_noise("bush", (0.03, 0.10, 0.02), (0.10, 0.24, 0.04), 3, 0.8, bump=0.5)[0]
    bm = bmesh.new()
    blobs = []
    for _ in range(6):
        c = Vector((random.uniform(-0.5, 0.5) * s, random.uniform(-0.3, 0.3) * s, random.uniform(0.25, 0.45) * s))
        r = random.uniform(0.32, 0.45) * s
        blobs.append((c, r))
        vs = ico(bm, c, r, 2, (1.2, 1, 0.8))
        for v in vs:
            v.co += Vector(noise.noise_vector(v.co * 2 + Vector((seed, 0, 0)))) * s * 0.08
    new_obj("bush", bm, leaf, root, smooth_angle=70)
    if flowers:
        fm = mat("flower", (0.9, 0.15, 0.4), rough=0.5)
        bm = bmesh.new()
        for _ in range(45):
            c, r = random.choice(blobs)
            d = Vector((random.uniform(-1, 1), random.uniform(-1, 0.2), random.uniform(-0.1, 1))).normalized()
            ico(bm, c + Vector((d.x * 1.2, d.y, d.z * 0.8)) * r * 1.02, 0.06 * s, 1)
        new_obj("fl", bm, fm, root)


def rock(root, seed=6, s=2.0, snow=False, desert=False):
    c1, c2 = ((0.22, 0.20, 0.18), (0.40, 0.38, 0.35))
    if desert:
        c1, c2 = (0.35, 0.15, 0.06), (0.60, 0.32, 0.15)
    m, nt, ramp, b = mat_noise("rock", c1, c2, 3, 0.9, bump=0.6)
    if snow:
        add_snow_cover(m, nt, ramp, b, 0.55, 0.8)
    bm = bmesh.new()
    vs = ico(bm, (0, 0, s * 0.35), s * 0.5, 3, (1.2, 1, 0.8))
    for v in vs:
        v.co += Vector(noise.noise_vector(v.co * 0.8 / s + Vector((seed, 0, 0)))) * s * 0.18
        v.co.z = max(v.co.z, 0)
    new_obj("rock", bm, m, root, smooth_angle=35)


def cactus(root, seed=7, h=6.0):
    random.seed(seed)
    m = mat_noise("cactus", (0.06, 0.18, 0.05), (0.12, 0.30, 0.08), 12, 0.6, bump=0.3)[0]
    bm = bmesh.new()
    r = h * 0.07
    cyl(bm, (0, 0, h * 0.45), r, r, h * 0.9, 12)
    ico(bm, (0, 0, h * 0.9), r, 2)
    for s, z0, hh in ((1, 0.35, 0.35), (-1, 0.5, 0.28)):
        rr = r * 0.75
        x = s * h * 0.17
        cyl(bm, (s * h * 0.085, 0, h * z0), rr, rr, h * 0.17, 10, Matrix.Rotation(rad(90), 4, "Y"))
        cyl(bm, (x, 0, h * (z0 + hh / 2)), rr, rr, h * hh, 10)
        ico(bm, (x, 0, h * (z0 + hh)), rr, 2)
        ico(bm, (s * h * 0.17, 0, h * z0), rr, 2)
    new_obj("cactus", bm, m, root, smooth_angle=60)


def lamppost(root, h=9.0, side=1):
    pole = mat("pole", (0.30, 0.32, 0.34), metallic=0.8, rough=0.4)
    lamp = mat("lamp", (1, 0.9, 0.6), emit=(1.0, 0.85, 0.5), estr=8)
    bm = bmesh.new()
    cyl(bm, (0, 0, h / 2), 0.12, 0.08, h, 12)
    cyl(bm, (-side * 1.1, 0, h), 0.06, 0.06, 2.2, 8, Matrix.Rotation(rad(90), 4, "Y"))
    box(bm, -side * 2.0, 0, h - 0.05, 0.9, 0.35, 0.18)
    new_obj("pole", bm, pole, root)
    bm = bmesh.new()
    box(bm, -side * 2.0, 0, h - 0.17, 0.75, 0.28, 0.06)
    new_obj("lamp", bm, lamp, root)


def chevron_sign(root, direction=1):
    post = mat("post", (0.5, 0.5, 0.52), metallic=0.7, rough=0.4)
    yel = mat("yel", (0.95, 0.70, 0.02), rough=0.35, emit=(1, 0.7, 0.0), estr=0.15)
    blk = mat("blk", (0.01, 0.01, 0.01), rough=0.5)
    bm = bmesh.new()
    for x in (-0.9, 0.9):
        cyl(bm, (x, 0.05, 0.9), 0.05, 0.05, 1.8, 8)
    new_obj("posts", bm, post, root)
    bm = bmesh.new()
    box(bm, 0, 0, 1.75, 2.6, 0.05, 1.0)
    b = new_obj("board", bm, yel, root)
    add_bevel(b, 0.02, 2)
    bm = bmesh.new()
    for i in range(3):
        cx = (i - 1) * 0.75
        pts = [(-0.25, 0.4), (0.05, 0.4), (0.35, 0.0), (0.05, -0.4), (-0.25, -0.4), (0.05, 0.0)]
        vs = [bm.verts.new((cx + direction * x, -0.035, 1.75 + z)) for x, z in pts]
        if direction < 0:
            vs = vs[::-1]
        bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
    new_obj("chev", bm, blk, root)


def billboard(root, line1, line2, bg, fg, accent):
    post = mat("post", (0.25, 0.25, 0.27), metallic=0.7, rough=0.5)
    bgm = mat("bbbg", bg, rough=0.45)
    fgm = mat("bbfg", fg, rough=0.4, emit=fg, estr=0.2)
    acm = mat("bbac", accent, rough=0.4)
    bm = bmesh.new()
    for x in (-3.0, 3.0):
        box(bm, x, 0.3, 2.5, 0.3, 0.3, 5.0)
    new_obj("posts", bm, post, root)
    bm = bmesh.new()
    box(bm, 0, 0, 6.5, 10.0, 0.25, 4.6)
    b = new_obj("board", bm, bgm, root)
    add_bevel(b, 0.04, 2)
    bm = bmesh.new()
    box(bm, 0, -0.14, 4.55, 10.0, 0.02, 0.5)
    new_obj("stripe", bm, acm, root)
    text_obj(line1, 2.6, fgm, (0, -0.16, 7.0), (rad(90), 0, 0), extrude=0.03, spacing=1.05, parent=root)
    if line2:
        text_obj(line2, 0.85, fgm, (0, -0.16, 5.15), (rad(90), 0, 0), extrude=0.02, spacing=1.15, parent=root)


def gantry(root, label, span=22.0, checker=False):
    red = mat("gred", (0.75, 0.02, 0.02), rough=0.4)
    white = mat("gwhite", (0.85, 0.85, 0.85), rough=0.4)
    dark = mat("gdark", (0.03, 0.03, 0.05), rough=0.4)
    yellow = mat("gyel", (1.0, 0.85, 0.05), rough=0.3, emit=(1, 0.8, 0.1), estr=1.5)
    h = 7.0
    for s in (-1, 1):
        for k in range(7):
            bm = bmesh.new()
            box(bm, s * span / 2, 0, h * (k + 0.5) / 7, 0.7, 0.7, h / 7)
            new_obj("p", bm, red if k % 2 == 0 else white, root)
    bm = bmesh.new()
    box(bm, 0, 0, h + 1.1, span + 0.7, 0.4, 2.4)
    b = new_obj("banner", bm, dark, root)
    if checker:
        m = bpy.data.materials.new("chk")
        bsdf = _bsdf(m)
        nt = m.node_tree
        ch = nt.nodes.new("ShaderNodeTexChecker")
        ch.inputs["Scale"].default_value = 1.0
        ch.inputs["Color1"].default_value = (0.9, 0.9, 0.9, 1)
        ch.inputs["Color2"].default_value = (0.01, 0.01, 0.01, 1)
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1.6, 1.6, 1.6)
        nt.links.new(geo.outputs["Position"], mp.inputs["Vector"])
        nt.links.new(mp.outputs[0], ch.inputs["Vector"])
        nt.links.new(ch.outputs["Color"], bsdf.inputs["Base Color"])
        b.data.materials[0] = m
        text_obj(label, 1.9, yellow, (0, -0.25, h + 1.1), (rad(90), 0, 0), extrude=0.05, spacing=1.2, parent=root)
        bm = bmesh.new()
        box(bm, 0, -0.22, h + 1.1, 9.5, 0.02, 2.1)
        new_obj("lbg", bm, dark, root)
    else:
        text_obj(label, 1.9, yellow, (0, -0.25, h + 1.1), (rad(90), 0, 0), extrude=0.05, spacing=1.2, parent=root)
    bm = bmesh.new()
    for i in range(12):
        x = -span / 2 + (i + 0.5) * span / 12
        if abs(x) > 5:
            cyl(bm, (x, -0.25, h + 0.05), 0.18, 0.18, 0.1, 12, Matrix.Rotation(rad(90), 4, "X"))
    new_obj("lights", bm, mat("glow", (1, 0.3, 0.1), emit=(1, 0.3, 0.05), estr=6), root)


def log_obstacle(root):
    bark = mat_noise("lbark", (0.10, 0.06, 0.03), (0.22, 0.14, 0.07), 10, 0.9, bump=0.5)[0]
    ring = mat("ring", (0.55, 0.40, 0.22), rough=0.8)
    bm = bmesh.new()
    cyl(bm, (0, 0, 0.32), 0.32, 0.30, 4.0, 18, Matrix.Rotation(rad(90), 4, "Y") @ Matrix.Rotation(rad(6), 4, "X"))
    new_obj("log", bm, bark, root, smooth_angle=50)
    bm = bmesh.new()
    cyl(bm, (2.005, 0, 0.32), 0.29, 0.29, 0.01, 18, Matrix.Rotation(rad(90), 4, "Y"))
    cyl(bm, (-2.005, 0, 0.32), 0.31, 0.31, 0.01, 18, Matrix.Rotation(rad(90), 4, "Y"))
    new_obj("ends", bm, ring, root)


def cottage(root, seed=8):
    wall = mat_noise("wall", (0.75, 0.72, 0.62), (0.85, 0.82, 0.74), 6, 0.9)[0]
    roof = mat_noise("roof", (0.18, 0.06, 0.04), (0.30, 0.10, 0.06), 8, 0.8, bump=0.3)[0]
    win = mat("win", (0.05, 0.08, 0.12), rough=0.1, emit=(1, 0.7, 0.3), estr=0.6)
    door = mat("door", (0.20, 0.06, 0.04), rough=0.6)
    stone = mat("stone", (0.3, 0.29, 0.27), rough=0.9)
    bm = bmesh.new()
    box(bm, 0, 0, 1.6, 8, 5, 3.2)
    new_obj("walls", bm, wall, root)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in [(-4.4, -2.9, 3.0), (4.4, -2.9, 3.0), (4.4, 0, 5.6), (-4.4, 0, 5.6), (-4.4, 2.9, 3.0), (4.4, 2.9, 3.0)]]
    bm.faces.new((vs[0], vs[1], vs[2], vs[3]))
    bm.faces.new((vs[3], vs[2], vs[5], vs[4]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.2)
    new_obj("roof", bm, roof, root)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in [(-4, -2.5, 3.2), (-4, 2.5, 3.2), (-4, 0, 5.5)]]
    bm.faces.new(vs)
    vs = [bm.verts.new(p) for p in [(4, 2.5, 3.2), (4, -2.5, 3.2), (4, 0, 5.5)]]
    bm.faces.new(vs)
    new_obj("gable", bm, wall, root)
    bm = bmesh.new()
    box(bm, 2.6, 1.2, 5.6, 0.8, 0.8, 1.6)
    new_obj("chimney", bm, stone, root)
    bm = bmesh.new()
    for x in (-2.6, 2.6):
        box(bm, x, -2.52, 1.8, 1.2, 0.05, 1.0)
    new_obj("win", bm, win, root)
    bm = bmesh.new()
    box(bm, 0, -2.52, 1.05, 1.1, 0.05, 2.1)
    new_obj("door", bm, door, root)


def snow_pole(root):
    red = mat("spr", (0.8, 0.02, 0.02), rough=0.4)
    wht = mat("spw", (0.9, 0.9, 0.9), rough=0.4)
    for k in range(6):
        bm = bmesh.new()
        cyl(bm, (0, 0, 0.25 + k * 0.5), 0.05, 0.05, 0.5, 8)
        new_obj("p", bm, red if k % 2 else wht, root)


def barrier(root):
    """motorway crash-barrier section"""
    steel = mat("steel", (0.6, 0.62, 0.65), metallic=0.9, rough=0.3)
    refl = mat("refl", (1, 0.6, 0), emit=(1, 0.5, 0), estr=1.0)
    bm = bmesh.new()
    box(bm, 0, 0, 0.62, 6.0, 0.12, 0.34)
    for x in (-2.5, 0, 2.5):
        box(bm, x, 0.12, 0.38, 0.12, 0.12, 0.76)
    new_obj("barrier", bm, steel, root)
    bm = bmesh.new()
    box(bm, 0, -0.07, 0.62, 0.15, 0.02, 0.1)
    new_obj("r", bm, refl, root)


def window_material(name, cell=(1.6, 2.2), lit=0.45, strength=3.0):
    m = bpy.data.materials.new(name)
    b = _bsdf(m)
    nt = m.node_tree
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])

    def math_node(op, a, bval=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        if isinstance(a, float):
            n.inputs[0].default_value = a
        else:
            nt.links.new(a, n.inputs[0])
        if bval is not None:
            if isinstance(bval, float):
                n.inputs[1].default_value = bval
            else:
                nt.links.new(bval, n.inputs[1])
        return n.outputs[0]

    # horizontal coordinate = x + y so side faces get windows too
    hx = math_node("ADD", sep.outputs["X"], sep.outputs["Y"])
    u = math_node("MULTIPLY", hx, 1.0 / cell[0])
    v = math_node("MULTIPLY", sep.outputs["Z"], 1.0 / cell[1])
    fu = math_node("FRACT", u)
    fv = math_node("FRACT", v)
    wu = math_node("LESS_THAN", fu, 0.62)
    wv = math_node("LESS_THAN", fv, 0.55)
    win = math_node("MULTIPLY", wu, wv)
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(math_node("FLOOR", u), comb.inputs["X"])
    nt.links.new(math_node("FLOOR", v), comb.inputs["Y"])
    wn = nt.nodes.new("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = "3D"
    nt.links.new(comb.outputs[0], wn.inputs["Vector"])
    on = math_node("GREATER_THAN", wn.outputs["Value"], 1.0 - lit)
    mask = math_node("MULTIPLY", win, on)
    stren = math_node("MULTIPLY", mask, strength)
    nt.links.new(stren, b.inputs["Emission Strength"])
    _set(b, "Emission Color", (1.0, 0.72, 0.32, 1))
    _set(b, "Base Color", (0.02, 0.022, 0.035, 1))
    _set(b, "Roughness", 0.4)
    return m


def tower_building(root, seed=9, h=40.0):
    m = window_material("tower", (1.8, 2.6), 0.5, 2.5)
    bm = bmesh.new()
    box(bm, 0, 0, h / 2, 14, 10, h)
    new_obj("tower", bm, m, root)
    bm = bmesh.new()
    box(bm, 0, 0, h + 0.4, 14.4, 10.4, 0.8)
    new_obj("cap", bm, mat("cap", (0.1, 0.1, 0.12), rough=0.5), root)


# ───────────────────────────────────────────────────────────── renderers
def render_sprite(name, root, ppm, elev, yaw=0, samples=48, extra_meta=None):
    sc = bpy.context.scene
    # ~2px of ink once the atlas is packed (cars are downscaled to 62%)
    INK["m"] = (3.4 if root.name == "car" else 2.4) / ppm
    try:
        sc.eevee.taa_render_samples = samples
    except Exception:
        pass
    root.rotation_euler = (0, 0, -rad(yaw))
    mn, mx = bounds_of(root)
    cz = (mn.z + mx.z) / 2
    corners = [Vector((x, y, z)) for x in (mn.x, mx.x) for y in (mn.y, mx.y) for z in (mn.z, mx.z)]
    r = max((c - Vector((0, 0, cz))).length for c in corners) * 1.04
    cam = sc.camera
    cam.data.ortho_scale = 2 * r
    aim_camera(cam, (0, 0, cz), elev, 0, dist=r * 4 + 10)
    cam.data.clip_end = r * 10 + 50
    px = int(math.ceil(2 * r * ppm))
    path = os.path.join(RAW, name + ".png")
    render_to(path, px, px)
    META[name] = {"ppm": ppm, "file": name + ".png", **(extra_meta or {})}
    print("rendered", name, px)


def setup_daylight():
    world_gradient((0.25, 0.42, 0.75), (0.8, 0.82, 0.85), (0.20, 0.17, 0.12), 0.9)
    add_sun(52, -30, 5.0)
    add_area((6, -6, 7), (0, 0, 0.6), 400, 6, (1.0, 0.95, 0.9))
    add_area((-5, 4, 6), (0, 0, 0.8), 250, 6, (0.7, 0.8, 1.0))


def do_cars():
    reset_scene()
    setup_daylight()
    ortho_camera()
    root, paint, tail = build_esprit()
    b = _bsdf(paint)
    yaws = [-30, -20, -12, -6, 0, 6, 12, 20, 30]
    for cname, col in CAR_COLOURS.items():
        _set(b, "Base Color", (*col, 1))
        tb = paint.node_tree.nodes.get("toon_base")
        if tb:
            tb.outputs[0].default_value = (*col, 1)
        if cname == "black":
            _set(b, "Metallic", 0.2)
        else:
            _set(b, "Metallic", 0.35)
        for i, y in enumerate(yaws):
            render_sprite(f"car_{cname}_{i}", root, 210, 11, y, 32, {"group": "cars", "yaw": y})
    # three-quarter "hero" angles for menus (front view)
    _set(b, "Base Color", (*CAR_COLOURS["red"], 1))
    root.rotation_euler = (0, 0, 0)


SCENERY = [
    # name, builder, kwargs, ppm, elev
    ("pine1", tree_pine, dict(seed=1, h=13), 38),
    ("pine2", tree_pine, dict(seed=11, h=10), 38),
    ("snowpine", tree_pine, dict(seed=5, h=12, snow=True), 38),
    ("oak", tree_oak, dict(seed=2, h=10), 42),
    ("oak2", tree_oak, dict(seed=22, h=8.5), 42),
    ("autumn", tree_oak, dict(seed=12, h=9, autumn=True), 42),
    ("palm", tree_palm, dict(seed=3, h=11), 40),
    ("palm2", tree_palm, dict(seed=33, h=9), 40),
    ("deadtree", tree_dead, dict(seed=4, h=8), 45),
    ("bush", bush, dict(seed=5, s=1.8), 90),
    ("bushflower", bush, dict(seed=15, s=1.6, flowers=True), 90),
    ("rock", rock, dict(seed=6, s=2.4), 80),
    ("boulder", rock, dict(seed=16, s=4.5), 50),
    ("snowrock", rock, dict(seed=26, s=3.0, snow=True), 70),
    ("redrock", rock, dict(seed=36, s=4.0, desert=True), 55),
    ("cactus", cactus, dict(seed=7, h=6), 60),
    ("lampL", lamppost, dict(side=-1), 45),
    ("lampR", lamppost, dict(side=1), 45),
    ("chevL", chevron_sign, dict(direction=-1), 110),
    ("chevR", chevron_sign, dict(direction=1), 110),
    ("bb_lotus", billboard, dict(line1="LOTUS", line2="ESPRIT TURBO SE", bg=(0.01, 0.20, 0.06), fg=(0.95, 0.80, 0.05), accent=(0.95, 0.80, 0.05)), 45),
    ("bb_turbo", billboard, dict(line1="TURBO", line2="CHALLENGE", bg=(0.70, 0.02, 0.02), fg=(0.95, 0.95, 0.95), accent=(0.05, 0.05, 0.05)), 45),
    ("bb_gremlin", billboard, dict(line1="MAGNETIC", line2="FIELDS RACING OIL", bg=(0.02, 0.05, 0.30), fg=(0.95, 0.95, 0.95), accent=(0.9, 0.5, 0.0)), 45),
    ("gantry_start", gantry, dict(label="START"), 40),
    ("gantry_check", gantry, dict(label="CHECKPOINT"), 40),
    ("gantry_finish", gantry, dict(label="FINISH", checker=True), 40),
    ("log", log_obstacle, dict(), 110),
    ("cottage", cottage, dict(), 45),
    ("snowpole", snow_pole, dict(), 120),
    ("barrier", barrier, dict(), 90),
    ("tower", tower_building, dict(h=40), 16),
]


def do_scenery():
    for name, fn, kw, ppm in SCENERY:
        reset_scene()
        setup_daylight()
        ortho_camera()
        root = empty(name)
        fn(root, **kw)
        render_sprite(name, root, ppm, 3, 0, 32, {"group": "scenery"})


# ───────────────────────────────────────────────────────────── panoramas
PANO_W = 400.0  # metres across one seamless tile
PANO_PX = 4096


def periodic_noise(x, y, R, freq_y, kind="ridged", octaves=6):
    a = x / PANO_W * math.tau
    p = Vector((math.cos(a) * R, math.sin(a) * R, y * freq_y))
    if kind == "ridged":
        return noise.ridged_multi_fractal(p, 1.0, 2.0, octaves, 1.0, 2.0)
    return noise.fractal(p, 1.0, 2.0, octaves)


def mountains(x, y, amp, r1, r2, ridge_w=0.45):
    base = periodic_noise(x, y, r1, 0.012, "fbm", 5) + 0.55
    ridge = periodic_noise(x, y, r2, 0.012, "ridged", 5) - 0.3
    return max(0.0, ((1 - ridge_w) * base + ridge_w * ridge * 0.7) * amp)


def terrain_mesh(name, height_fn, depth=120.0, nx=900, ny=36, y0=0.0):
    bm = bmesh.new()
    margin = 12.0
    grid = []
    for j in range(ny + 1):
        y = y0 + depth * j / ny
        row = []
        for i in range(nx + 1):
            x = -margin + (PANO_W + 2 * margin) * i / nx
            t = min(1.0, (j / ny) / 0.3)
            taper = t * t * (3 - 2 * t)
            row.append(bm.verts.new((x, y, height_fn(x % PANO_W, y) * taper)))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    for f in bm.faces:
        f.smooth = True
    return new_obj(name, bm)


def height_material(name, stops, haze_col=None, snow=None, haze_depth=(0, 150)):
    """stops: list of (z, color). z in metres."""
    m = bpy.data.materials.new(name)
    b = _bsdf(m)
    nt = m.node_tree
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    zmax = max(z for z, _ in stops)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0
    mr.inputs["From Max"].default_value = zmax
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.08
    nz.inputs["Detail"].default_value = 6
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY_ADD"
    nt.links.new(nz.outputs["Fac"], add.inputs[0])
    add.inputs[1].default_value = zmax * 0.25
    nt.links.new(sep.outputs["Z"], add.inputs[2])
    nt.links.new(add.outputs[0], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position = stops[0][0] / zmax
    els[0].color = (*stops[0][1], 1)
    els[1].position = stops[-1][0] / zmax
    els[1].color = (*stops[-1][1], 1)
    for z, c in stops[1:-1]:
        e = els.new(z / zmax)
        e.color = (*c, 1)
    nt.links.new(mr.outputs[0], ramp.inputs[0])
    col = ramp.outputs["Color"]
    if snow:
        sep2 = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Normal"], sep2.inputs[0])
        mrn = nt.nodes.new("ShaderNodeMapRange")
        mrn.inputs["From Min"].default_value = snow[0]
        mrn.inputs["From Max"].default_value = snow[1]
        nt.links.new(sep2.outputs["Z"], mrn.inputs["Value"])
        mrz = nt.nodes.new("ShaderNodeMapRange")
        mrz.inputs["From Min"].default_value = snow[2]
        mrz.inputs["From Max"].default_value = snow[2] + 8
        nt.links.new(sep.outputs["Z"], mrz.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(mrn.outputs[0], mul.inputs[0])
        nt.links.new(mrz.outputs[0], mul.inputs[1])
        col = mix_color(nt, mul.outputs[0], col, (0.9, 0.93, 1.0))
    if haze_col:
        mrh = nt.nodes.new("ShaderNodeMapRange")
        mrh.inputs["From Min"].default_value = haze_depth[0]
        mrh.inputs["From Max"].default_value = haze_depth[1]
        mrh.inputs["To Max"].default_value = 0.85
        nt.links.new(sep.outputs["Y"], mrh.inputs["Value"])
        col = mix_color(nt, mrh.outputs[0], col, haze_col)
    nt.links.new(col, b.inputs["Base Color"])
    _set(b, "Roughness", 0.95)
    return m


def scatter_trees(name, height_fn, count, ymin, ymax, h, mat_, seed=1, kind="cone"):
    random.seed(seed)
    bm = bmesh.new()
    for _ in range(count):
        x = random.uniform(0, PANO_W)
        y = random.uniform(ymin, ymax)
        z = height_fn(x, y)
        hh = h * random.uniform(0.7, 1.3)
        for dx in (0, PANO_W) if x < 6 else ((0, -PANO_W) if x > PANO_W - 6 else (0,)):
            if kind == "cone":
                cyl(bm, (x + dx, y, z + hh / 2 - 0.5), hh * 0.22, 0, hh, 7)
            elif kind == "cactus":
                cyl(bm, (x + dx, y, z + hh / 2), hh * 0.06, hh * 0.06, hh, 6)
            else:
                ico(bm, (x + dx, y, z + hh * 0.45), hh * 0.4, 1)
    ob = new_obj(name, bm, mat_)
    return ob


def render_pano(name, sky_world=None, elev=1.5, height_m=60.0, z_center=None, sun=(40, -20, 3.5)):
    sc = bpy.context.scene
    INK["m"] = 2.0 * PANO_W / PANO_PX
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
    cam = sc.camera
    cam.data.ortho_scale = PANO_W
    px_h = int(PANO_PX * height_m / PANO_W)
    zc = z_center if z_center is not None else height_m / 2 - 2
    e = rad(elev)
    t = Vector((PANO_W / 2, 0, zc))
    d = Vector((0, -math.cos(e), math.sin(e)))
    cam.location = t + d * 600
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = 2000
    path = os.path.join(RAW, name + ".png")
    render_to(path, PANO_PX, px_h)
    META[name] = {"file": name + ".png", "group": "bg", "w": PANO_PX, "h": px_h}
    print("pano", name)


def pano_scene(world=((0.3, 0.45, 0.8), (0.8, 0.82, 0.85), (0.2, 0.18, 0.15), 1.0), sun=(35, -25, 3.5), sun_col=(1, 0.96, 0.9)):
    reset_scene()
    world_gradient(*world)
    add_sun(sun[0], sun[1], sun[2], sun_col, 2)
    ortho_camera()


def do_backgrounds():
    # ---------- forest
    pano_scene()
    far = lambda x, y: mountains(x, y, 30, 1.3, 2.2)
    o = terrain_mesh("far", far, depth=160, y0=60)
    o.data.materials.append(height_material("m", [(0, (0.12, 0.18, 0.12)), (14, (0.22, 0.24, 0.22)), (30, (0.45, 0.47, 0.5))], (0.55, 0.62, 0.72), snow=(0.6, 0.85, 26), haze_depth=(60, 220)))
    render_pano("bg_forest_far", height_m=60)
    pano_scene()
    near = lambda x, y: max(0.0, periodic_noise(x, y, 5.0, 0.03, "fbm", 4) * 9 + 6 - y * 0.02)
    o = terrain_mesh("near", near, depth=60, y0=0)
    o.data.materials.append(height_material("m", [(0, (0.04, 0.12, 0.03)), (12, (0.10, 0.22, 0.05))]))
    tm = mat_noise("t", (0.01, 0.05, 0.015), (0.03, 0.10, 0.03), 0.5, 0.9)[0]
    scatter_trees("trees", near, 2600, 2, 45, 7, tm, 3)
    render_pano("bg_forest_near", height_m=36, z_center=14)

    # ---------- snow
    pano_scene(((0.35, 0.5, 0.85), (0.85, 0.88, 0.92), (0.4, 0.4, 0.45), 1.1))
    far = lambda x, y: mountains(x, y, 44, 1.5, 2.6, 0.7)
    o = terrain_mesh("far", far, depth=160, y0=60)
    o.data.materials.append(height_material("m", [(0, (0.35, 0.38, 0.45)), (20, (0.5, 0.52, 0.58)), (40, (0.8, 0.82, 0.88))], (0.7, 0.76, 0.86), snow=(0.45, 0.75, 6), haze_depth=(60, 220)))
    render_pano("bg_snow_far", height_m=70)
    pano_scene(((0.35, 0.5, 0.85), (0.85, 0.88, 0.92), (0.4, 0.4, 0.45), 1.1))
    near = lambda x, y: max(0.0, periodic_noise(x, y, 5.0, 0.03, "fbm", 4) * 10 + 6)
    o = terrain_mesh("near", near, depth=60, y0=0)
    o.data.materials.append(height_material("m", [(0, (0.8, 0.83, 0.9)), (14, (0.92, 0.94, 1.0))]))
    tm = mat_noise("t", (0.02, 0.06, 0.04), (0.05, 0.10, 0.06), 0.5, 0.9)
    add_snow_cover(*tm, 0.3, 0.7)
    scatter_trees("trees", near, 1600, 2, 45, 7, tm[0], 4)
    render_pano("bg_snow_near", height_m=36, z_center=14)

    # ---------- desert (mesas via quantised heights)
    pano_scene(((0.25, 0.45, 0.85), (0.95, 0.85, 0.7), (0.4, 0.3, 0.2), 1.0), (25, -40, 4.0), (1, 0.9, 0.75))

    def mesa(x, y):
        h = periodic_noise(x, y, 1.4, 0.015, "fbm", 4)
        h = max(0.0, (h + 0.1) * 48)
        step = 9.0
        q = math.floor(h / step) * step
        frac = (h - q) / step
        return q + step * max(0.0, (frac - 0.75) / 0.25)

    o = terrain_mesh("far", mesa, depth=160, y0=60, nx=1200)
    o.data.materials.append(height_material("m", [(0, (0.45, 0.18, 0.07)), (10, (0.60, 0.28, 0.12)), (20, (0.50, 0.20, 0.09)), (35, (0.70, 0.40, 0.20))], (0.85, 0.65, 0.55), haze_depth=(60, 240)))
    render_pano("bg_desert_far", height_m=60)
    pano_scene(((0.25, 0.45, 0.85), (0.95, 0.85, 0.7), (0.4, 0.3, 0.2), 1.0), (25, -40, 4.0), (1, 0.9, 0.75))
    near = lambda x, y: max(0.0, periodic_noise(x, y, 6.0, 0.04, "fbm", 3) * 6 + 3)
    o = terrain_mesh("near", near, depth=60, y0=0)
    o.data.materials.append(height_material("m", [(0, (0.60, 0.40, 0.20)), (8, (0.80, 0.58, 0.32))]))
    cm = mat("c", (0.08, 0.22, 0.06), rough=0.7)
    scatter_trees("cacti", near, 260, 2, 40, 5, cm, 5, "cactus")
    render_pano("bg_desert_near", height_m=30, z_center=10)

    # ---------- city skyline (lit windows) + dark mountains
    pano_scene(((0.02, 0.02, 0.06), (0.08, 0.06, 0.14), (0.02, 0.02, 0.03), 0.6), (20, 150, 0.4), (0.6, 0.7, 1.0))
    far = lambda x, y: mountains(x, y, 26, 1.2, 2.0)
    o = terrain_mesh("far", far, depth=160, y0=60)
    o.data.materials.append(height_material("m", [(0, (0.03, 0.03, 0.06)), (25, (0.07, 0.07, 0.12))], (0.08, 0.07, 0.16), haze_depth=(60, 220)))
    render_pano("bg_city_far", height_m=55)
    pano_scene(((0.02, 0.02, 0.06), (0.08, 0.06, 0.14), (0.02, 0.02, 0.03), 0.6), (20, 150, 0.4), (0.6, 0.7, 1.0))
    random.seed(9)
    tw = window_material("city", (1.4, 2.0), 0.42, 3.5)
    bm = bmesh.new()
    x = 0.0
    while x < PANO_W:
        w = random.uniform(5, 14)
        h = random.choice([random.uniform(6, 16), random.uniform(10, 30), random.uniform(20, 45)])
        y = random.uniform(0, 30)
        xs = [x + w / 2]
        if x + w > PANO_W - 1:
            xs.append(x + w / 2 - PANO_W)
        for cx in xs:
            box(bm, cx, y, h / 2, w, 8, h)
            if random.random() < 0.15:
                cyl(bm, (cx, y, h + 4), 0.15, 0.08, 8, 6)
        x += w * random.uniform(0.6, 1.1)
    new_obj("city", bm, tw)
    render_pano("bg_city_near", height_m=50, z_center=22)

    # ---------- coast: low islands
    pano_scene(((0.35, 0.25, 0.55), (1.0, 0.6, 0.35), (0.3, 0.2, 0.2), 1.0), (8, 0, 3.0), (1, 0.6, 0.3))
    isl = lambda x, y: max(0.0, periodic_noise(x, y, 1.5, 0.02, "fbm", 5) * 34 - 4)
    o = terrain_mesh("far", isl, depth=120, y0=80)
    o.data.materials.append(height_material("m", [(0, (0.25, 0.15, 0.25)), (20, (0.35, 0.22, 0.32))], (0.85, 0.5, 0.45), haze_depth=(80, 200)))
    render_pano("bg_coast_far", height_m=40, z_center=12)


# ───────────────────────────────────────────────────────────── hero shot
def do_hero():
    reset_scene()
    sc = bpy.context.scene
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 128
    except Exception:
        pass
    world_gradient((0.01, 0.01, 0.03), (0.10, 0.06, 0.10), (0.0, 0.0, 0.0), 0.6)
    root, paint, tail = build_esprit()
    # glossy floor fading to black
    fm = bpy.data.materials.new("floor")
    fm["no_toon"] = True
    INK["m"] = 0.012
    b = _bsdf(fm)
    _set(b, "Base Color", (0.01, 0.01, 0.012, 1))
    _set(b, "Roughness", 0.12)
    _set(b, "Coat Weight", 0.5)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    new_obj("floor", bm, fm)["no_ink"] = True
    add_area((-5, 5, 6), (0, 0, 0.5), 900, 3, (1.0, 0.35, 0.15))
    add_area((5, 6, 4), (0, 0, 0.5), 900, 3, (0.2, 0.45, 1.0))
    add_area((3, -3, 7), (0, 0, 0.5), 700, 5, (1, 1, 1))
    add_area((0, 0, 8), (0, 0, 0), 600, 4, (1, 0.95, 0.9))
    add_area((0, 12, 1.5), (0, 0, 1), 500, 10, (1.0, 0.2, 0.4))
    cd = bpy.data.cameras.new("cam")
    cd.lens = 55
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.lens = 42
    cam.location = (6.6, 7.4, 1.7)
    cam.rotation_euler = (Vector((1.3, -1.2, 0.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    render_to(os.path.join(RAW, "hero.png"), 1920, 1080)
    META["hero"] = {"file": "hero.png", "group": "hero"}


if "cartest" in GROUPS:
    reset_scene(); setup_daylight(); ortho_camera()
    root, paint, tail = build_esprit()
    for i, y in ((4, 0), (8, 30), (6, 12)):
        render_sprite(f"car_red_{i}", root, 210, 11, y, 32, {"group": "cars", "yaw": y})
def save_meta():
    with open(META_PATH, "w") as f:
        json.dump(META, f, indent=1)


for g, fn in (("cars", do_cars), ("scenery", do_scenery), ("bg", do_backgrounds), ("hero", do_hero)):
    if g in GROUPS:
        try:
            fn()
        except Exception:
            import traceback
            traceback.print_exc()
            print("GROUP FAILED", g)
        save_meta()
print("DONE", len(META))
