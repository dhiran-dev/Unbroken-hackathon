"""Validate the saved PulseRank source scene when opened by Blender."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
report_path = Path(argv[0]).resolve() if argv else Path("pulse-energy-source-validation.json").resolve()
scene = bpy.context.scene
objects = {object_.name: object_ for object_ in scene.objects}
expected = {
    "PulseCan",
    "PulseCanLabel",
    "PulseCanLightning",
    "PulseCanTopRim",
    "PulseCanBottomRim",
    "PulsePedestal",
    "PulsePedestalRings",
    "PulseStudioCamera",
    "PulseKeyLight",
    "PulseVioletSpot",
    "PulseBlueRim",
    "PulseMagentaFill",
}
external_paths = sorted(
    str(path)
    for path in bpy.utils.blend_paths(absolute=False, packed=False, local=False)
)
checks = {
    "scene_name": scene.name == "PulseRank Studio Stage",
    "eevee": scene.render.engine == "BLENDER_EEVEE",
    "resolution": [scene.render.resolution_x, scene.render.resolution_y] == [1440, 900],
    "expected_stage_nodes": expected.issubset(objects),
    "no_external_paths": not external_paths,
    "metric_units": scene.unit_settings.system == "METRIC" and scene.unit_settings.scale_length == 1.0,
}
result = {
    "result": "pass" if all(checks.values()) else "fail",
    "checks": checks,
    "blend_path": bpy.data.filepath,
    "scene": scene.name,
    "object_count": len(objects),
    "objects": sorted(objects),
    "external_paths": external_paths,
    "render_engine": scene.render.engine,
    "resolution": [scene.render.resolution_x, scene.render.resolution_y],
}
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print("PULSE_BLEND_VALIDATION=" + json.dumps(result, sort_keys=True))
if result["result"] != "pass":
    raise SystemExit(1)
