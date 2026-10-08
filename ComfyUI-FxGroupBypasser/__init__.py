"""
Fx Group Bypasser
-----------------
This node lives entirely on the frontend (it toggles LiteGraph node "mode"
values for nodes inside groups, which is a canvas/UI concept, not something
that runs on the backend). Because of that there is no real Python execution
logic - this file only needs to tell ComfyUI where to find the JS extension.
"""

# No backend node classes are needed - this is a pure frontend/virtual node.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Tells ComfyUI to serve everything in ./web and load fx_group_bypasser.js
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
