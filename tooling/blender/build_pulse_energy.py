"""Build and export the original PulseRank hero product stage.

This script is intentionally self-contained so the source ``.blend`` and the
web GLB can be rebuilt from a clean Blender scene. It is executed through the
local Blender MCP bridge with ``script_path``; no remote assets or textures are
used.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(
    globals().get("args", {}).get(
        "project_root", "/home/dhiran/Dhiran/brightdata_hackathon"
    )
).resolve()
RENDER_PATH = Path(
    globals().get("args", {}).get(
        "render_path", str(PROJECT_ROOT / "tooling/blender/reviews/pulse-energy-stage.png")
    )
).resolve()
BLEND_PATH = Path(
    globals().get("args", {}).get(
        "blend_path", str(PROJECT_ROOT / "tooling/blender/pulse-energy.blend")
    )
).resolve()
GLB_PATH = Path(
    globals().get("glb_path", str(PROJECT_ROOT / "public/pulse-preview/pulse-energy.glb"))
).resolve()


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def set_input(node: bpy.types.Node, name: str, value: object) -> None:
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.4,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    if tree is None:
        return mat
    bsdf = tree.nodes.get("Principled BSDF")
    if bsdf is None:
        tree.nodes.clear()
        bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        tree.links.new(bsdf.outputs[0], output.inputs[0])
    set_input(bsdf, "Base Color", color)
    set_input(bsdf, "Metallic", metallic)
    set_input(bsdf, "Roughness", roughness)
    if emission is not None:
        set_input(bsdf, "Emission Color", emission)
        set_input(bsdf, "Emission", emission)
        set_input(bsdf, "Emission Strength", emission_strength)
    return mat


def assign(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def finish_mesh(obj: bpy.types.Object, mat: bpy.types.Material | None = None) -> bpy.types.Object:
    if mat is not None:
        assign(obj, mat)
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def bevel(obj: bpy.types.Object, width: float, segments: int = 4) -> bpy.types.Object:
    modifier = obj.modifiers.new(name="Soft bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    bevel_width: float = 0.0,
    vertices: int = 96,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}Mesh"
    finish_mesh(obj, mat)
    if bevel_width:
        bevel(obj, bevel_width, 5)
    return obj


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=96,
        minor_segments=16,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}Mesh"
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish_mesh(obj, mat)
    return obj


def uv_sphere(
    name: str,
    radius: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=24,
        ring_count=12,
        radius=radius,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat)


def make_lightning(
    name: str,
    points: list[tuple[float, float]],
    y: float,
    z_offset: float,
    thickness: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    front_y = y - thickness * 0.5
    back_y = y + thickness * 0.5
    verts = [(x, front_y, z + z_offset) for x, z in points]
    verts += [(x, back_y, z + z_offset) for x, z in points]
    count = len(points)
    faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish_mesh(obj, mat)


def make_label(
    text: str,
    location: tuple[float, float, float],
    size: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.object.text_add(
        location=location,
        rotation=(math.radians(90.0), 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = "PulseCanLabel"
    curve = obj.data
    curve.body = text
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = 0.018
    curve.bevel_depth = 0.004
    curve.bevel_resolution = 2
    curve.space_character = 1.06
    assign(obj, mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = "PulseCanLabel"
    obj.data.name = "PulseCanLabelMesh"
    return finish_mesh(obj)


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name}Mesh"
    return joined


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    size: float,
    target: tuple[float, float, float],
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)
    return obj


def spot_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    target: tuple[float, float, float],
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="SPOT")
    data.energy = energy
    data.color = color
    data.spot_size = math.radians(72.0)
    data.spot_blend = 0.65
    data.shadow_soft_size = 1.5
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)
    return obj


def remove_default_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def build_stage() -> dict[str, object]:
    remove_default_scene()

    scene = bpy.context.scene
    scene.name = "PulseRank Studio Stage"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.frame_start = 1
    scene.frame_end = 120
    scene.frame_current = 1
    scene.world.color = (0.003, 0.002, 0.009)
    scene.render.filepath = str(RENDER_PATH)
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except (TypeError, ValueError):
        pass
    scene.view_settings.exposure = 0.35

    floor_mat = material(
        "PulseStudioFloorMaterial",
        (0.012, 0.009, 0.028, 1.0),
        metallic=0.22,
        roughness=0.24,
    )
    graphite = material(
        "PulseGraphitePurpleMaterial",
        (0.055, 0.024, 0.105, 1.0),
        metallic=0.72,
        roughness=0.25,
    )
    graphite_dark = material(
        "PulsePedestalGraphiteMaterial",
        (0.016, 0.011, 0.035, 1.0),
        metallic=0.78,
        roughness=0.3,
    )
    violet = material(
        "PulseVioletEmissionMaterial",
        (0.15, 0.018, 0.35, 1.0),
        metallic=0.18,
        roughness=0.22,
        emission=(0.55, 0.03, 1.0, 1.0),
        emission_strength=7.0,
    )
    label_mat = material(
        "PulseLabelMaterial",
        (0.78, 0.69, 1.0, 1.0),
        metallic=0.16,
        roughness=0.22,
        emission=(0.25, 0.08, 0.55, 1.0),
        emission_strength=0.7,
    )
    condensation_mat = material(
        "PulseCondensationMaterial",
        (0.34, 0.28, 0.62, 1.0),
        metallic=0.05,
        roughness=0.12,
        emission=(0.13, 0.05, 0.28, 1.0),
        emission_strength=0.35,
    )

    floor = cylinder("PulseStudioFloor", 18.0, 0.08, (0.0, 0.0, -0.04), floor_mat, bevel_width=0.025)
    floor["role"] = "dark studio floor and reflection surface"

    pedestal = cylinder("PulsePedestal", 3.2, 0.34, (0.0, 0.0, 0.17), graphite_dark, bevel_width=0.1)
    pedestal["role"] = "three-tier circular pedestal base"
    cylinder("PulsePedestalTier", 2.62, 0.25, (0.0, 0.0, 0.46), graphite_dark, bevel_width=0.07)
    cylinder("PulsePedestalTop", 2.12, 0.22, (0.0, 0.0, 0.695), graphite_dark, bevel_width=0.055)

    pedestal_ring_parts = [
        torus("PedestalRingLower", 2.88, 0.034, (0.0, 0.0, 0.36), violet),
        torus("PedestalRingMiddle", 2.36, 0.028, (0.0, 0.0, 0.59), violet),
        torus("PedestalRingUpper", 1.96, 0.026, (0.0, 0.0, 0.81), violet),
    ]
    pedestal_rings = join_objects(pedestal_ring_parts, "PulsePedestalRings")
    pedestal_rings["role"] = "purple emissive pedestal rings"

    can_bottom = 0.82
    can_height = 4.82
    can_center = can_bottom + can_height / 2.0
    can_radius = 1.28
    can = cylinder(
        "PulseCan",
        can_radius,
        can_height,
        (0.0, 0.0, can_center),
        graphite,
        bevel_width=0.16,
    )
    can["role"] = "original Pulse Energy can body"
    can["product"] = "Pulse Energy"
    can["material_language"] = "graphite purple aluminium"

    cylinder("PulseCanTopSurface", 1.17, 0.065, (0.0, 0.0, can_bottom + can_height - 0.035), graphite_dark, bevel_width=0.025)
    torus("PulseCanTopRim", 1.22, 0.047, (0.0, 0.0, can_bottom + can_height - 0.005), violet)
    torus("PulseCanBottomRim", 1.22, 0.047, (0.0, 0.0, can_bottom + 0.035), violet)
    pull_tab = torus("PulseCanPullTab", 0.24, 0.042, (0.0, -0.06, can_bottom + can_height + 0.03), graphite, scale=(1.0, 0.58, 1.0))
    pull_tab.rotation_euler[2] = math.radians(90.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    label = make_label(
        "PULSE ENERGY",
        (0.0, -1.292, 3.27),
        0.315,
        label_mat,
    )
    label["role"] = "exportable product label geometry"

    lightning_points = [
        (-0.28, 0.86),
        (0.20, 0.86),
        (-0.08, 0.20),
        (0.40, 0.20),
        (-0.28, -0.92),
        (-0.16, -0.32),
        (-0.46, -0.32),
    ]
    lightning = make_lightning(
        "PulseCanLightning",
        lightning_points,
        -1.31,
        4.38,
        0.07,
        violet,
    )
    lightning["role"] = "original lightning emblem geometry"

    droplets: list[bpy.types.Object] = []
    droplet_specs = [
        (-0.86, -1.01, 4.8, 0.052, (0.85, 0.7, 1.0)),
        (-0.96, -0.86, 4.2, 0.035, (0.76, 0.54, 0.92)),
        (-0.94, -0.9, 3.72, 0.048, (0.92, 0.78, 1.0)),
        (0.82, -1.03, 4.92, 0.038, (0.76, 0.61, 1.0)),
        (0.93, -0.88, 4.5, 0.05, (0.9, 0.75, 1.0)),
        (0.96, -0.84, 3.74, 0.032, (0.75, 0.55, 0.95)),
        (-0.62, -1.13, 2.36, 0.028, (0.8, 0.64, 1.0)),
        (0.68, -1.12, 2.1, 0.034, (0.9, 0.78, 1.0)),
    ]
    for index, (x, y, z, radius, scale) in enumerate(droplet_specs):
        droplets.append(
            uv_sphere(
                f"PulseCondensationDrop{index + 1:02d}",
                radius,
                (x, y, z),
                condensation_mat,
                scale=(scale[0], scale[1], scale[2]),
            )
        )
    condensation = join_objects(droplets, "PulseCanCondensation")
    condensation["role"] = "lightweight condensation geometry"

    # A single camera is kept in the source scene for the approved composition.
    camera_data = bpy.data.cameras.new("PulseStudioCamera")
    camera = bpy.data.objects.new("PulseStudioCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (6.45, -18.4, 6.55)
    camera_data.lens = 61.0
    camera_data.sensor_width = 36.0
    camera_data.dof.use_dof = False
    point_at(camera, (0.0, 0.0, 3.05))
    scene.camera = camera
    camera["role"] = "1440x900 PulseRank hero composition camera"

    area_light("PulseKeyLight", (-5.0, -7.0, 10.5), 920.0, (1.0, 0.96, 0.93), 5.0, (0.0, 0.0, 3.0))
    spot_light("PulseVioletSpot", (0.0, 2.5, 11.5), 1280.0, (0.38, 0.09, 1.0), (0.0, 0.0, 2.7))
    area_light("PulseBlueRim", (7.5, -2.0, 5.4), 1080.0, (0.05, 0.26, 1.0), 4.0, (0.0, 0.0, 3.5))
    area_light("PulseMagentaFill", (-1.0, -6.5, 1.7), 460.0, (1.0, 0.035, 0.29), 3.5, (0.0, 0.0, 2.4))

    # Blender 5.2's compositor API is still evolving. Keep the stage portable
    # if a build exposes a different Glare property surface; the web preview
    # owns its bloom pass in Three.js.
    try:
        scene.use_nodes = True
        compositor = scene.compositing_node_group
        if compositor is None:
            compositor = bpy.data.node_groups.new("PulseCompositor", "CompositorNodeTree")
            scene.compositing_node_group = compositor
        compositor.nodes.clear()
        render_layers = compositor.nodes.new("CompositorNodeRLayers")
        glare = compositor.nodes.new("CompositorNodeGlare")
        if hasattr(glare, "glare_type"):
            glare.glare_type = "FOG_GLOW"
        if hasattr(glare, "quality"):
            glare.quality = "HIGH"
        if hasattr(glare, "threshold"):
            glare.threshold = 0.8
        if hasattr(glare, "size"):
            glare.size = 7
        composite = compositor.nodes.new("CompositorNodeComposite")
        compositor.links.new(render_layers.outputs["Image"], glare.inputs["Image"])
        compositor.links.new(glare.outputs["Image"], composite.inputs["Image"])
    except Exception:
        scene.use_nodes = False

    scene["pulserank_stage"] = "Blender-first PulseRank preview"
    scene["asset_policy"] = "original geometry, local materials, no third-party assets"
    scene["stage_locked_target"] = "graphite-purple Pulse Energy can on purple ring pedestal"

    ensure_parent(RENDER_PATH)
    ensure_parent(BLEND_PATH)
    ensure_parent(GLB_PATH)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_cameras=True,
        export_lights=False,
        export_animations=False,
        export_materials="EXPORT",
    )

    scene.render.filepath = str(RENDER_PATH)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    mesh_names = sorted(obj.name for obj in scene.objects if obj.type == "MESH")
    return {
        "result": "pass",
        "scene": scene.name,
        "blend_path": str(BLEND_PATH),
        "glb_path": str(GLB_PATH),
        "render_path": str(RENDER_PATH),
        "object_count": len(scene.objects),
        "mesh_objects": mesh_names,
        "render_engine": scene.render.engine,
        "resolution": [scene.render.resolution_x, scene.render.resolution_y],
    }


__result__ = build_stage()
