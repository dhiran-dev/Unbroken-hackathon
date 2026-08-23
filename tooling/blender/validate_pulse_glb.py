"""Clean-factory GLB validation for the PulseRank preview asset."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> tuple[Path, Path]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        raise SystemExit("expected -- <glb-path> <report-path>")
    return Path(argv[0]).resolve(), Path(argv[1]).resolve()


glb_path, report_path = arguments()
raw = glb_path.read_bytes()
if raw[:4] != b"glTF":
    raise SystemExit("not a GLB file")
json_length = struct.unpack_from("<I", raw, 12)[0]
gltf_json = json.loads(raw[20 : 20 + json_length].decode("utf-8").rstrip("\x00 \n\r\t"))
external_uris = sorted(
    [image["uri"] for image in gltf_json.get("images", []) if image.get("uri")]
    + [buffer["uri"] for buffer in gltf_json.get("buffers", []) if buffer.get("uri")]
)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(glb_path))

objects = {object_.name: object_ for object_ in bpy.context.scene.objects}
expected = {
    "PulseCan",
    "PulseCanLabel",
    "PulseCanLightning",
    "PulseCanTopRim",
    "PulseCanBottomRim",
    "PulsePedestal",
    "PulsePedestalRings",
    "PulseStudioCamera",
}
mesh_objects = [object_ for object_ in objects.values() if object_.type == "MESH"]
world_min = Vector((float("inf"), float("inf"), float("inf")))
world_max = Vector((float("-inf"), float("-inf"), float("-inf")))
for object_ in mesh_objects:
    for corner in object_.bound_box:
        point = object_.matrix_world @ Vector(corner)
        world_min.x = min(world_min.x, point.x)
        world_min.y = min(world_min.y, point.y)
        world_min.z = min(world_min.z, point.z)
        world_max.x = max(world_max.x, point.x)
        world_max.y = max(world_max.y, point.y)
        world_max.z = max(world_max.z, point.z)

external_paths = sorted(
    str(path)
    for path in bpy.utils.blend_paths(absolute=False, packed=False, local=False)
)
checks = {
    "expected_named_nodes": expected.issubset(objects),
    "mesh_objects_present": bool(mesh_objects),
    "camera_present": objects.get("PulseStudioCamera", None) is not None,
    "no_lights_exported": not any(object_.type == "LIGHT" for object_ in objects.values()),
    "no_external_images": not gltf_json.get("images"),
    "no_external_paths": not external_uris,
    "positive_stage_height": world_max.y > world_min.y,
}
result = {
    "result": "pass" if all(checks.values()) else "fail",
    "checks": checks,
    "glb_path": str(glb_path),
    "object_count": len(objects),
    "objects": sorted(objects),
    "mesh_objects": sorted(object_.name for object_ in mesh_objects),
    "material_count": len(bpy.data.materials),
    "image_count": len(gltf_json.get("images", [])),
    "external_paths": external_paths,
    "external_uris": external_uris,
    "bounds_min": list(world_min),
    "bounds_max": list(world_max),
}
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print("PULSE_GLB_VALIDATION=" + json.dumps(result, sort_keys=True))
if result["result"] != "pass":
    raise SystemExit(1)
