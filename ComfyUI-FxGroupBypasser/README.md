# Fx Group Bypasser (ComfyUI custom node)

A single node that lets you enable/bypass every **group** in your workflow
from one place, instead of right-clicking each group individually.

## What it does

- Lists every group in the current workflow as a row with an
  one-click button showing the group name and its state (✅ Enabled /
  ⛔ Bypassed). Clicking it flips the group, setting `mode` on every node
  inside (0 = enabled, 4 = bypassed).
- **Toggle All (Enable / Bypass)** button: if anything is currently enabled,
  bypasses every group; if everything is already bypassed, re-enables
  everything.
- **Sort Order** dropdown controls how the group rows are listed:
  - **Position (Default)** — top-to-bottom, then left-to-right, matching
    where the groups actually sit in the workflow.
  - **Alphabetical** — by group title.
  - **Custom** — your own order. When selected, two extra controls appear:
    **Group to Move** (pick a group) + **Move Up** / **Move Down** buttons to
    rearrange it. The order is saved with the workflow.
- The node auto-polls every 0.5s and rebuilds itself if you add, rename, or
  delete a group, and keeps each row's toggle in sync if you bypass nodes
  manually.
- **Sizing:** the node measures each group's name and guarantees enough width
  to show it in full (it will grow, and can't be dragged narrower than that).
  Height/width you set beyond that minimum is preserved across saves and
  ComfyUI restarts - the node only grows automatically, it never shrinks or
  resets a size you've already chosen.

## Why it's built this way

Groups and "bypass" are LiteGraph/canvas concepts, not something a backend
Python node can see or change — a group has no real existence once a workflow
is converted into the executed prompt. So this node is a **virtual/frontend
node**: it never appears in what actually gets sent to the backend
(`isVirtualNode = true`), and all its logic lives in JavaScript. That's why
there's no meaningful Python code here beyond registering the `web/` folder.

## Install

1. Copy the whole `ComfyUI-FxGroupBypasser` folder into
   `ComfyUI/custom_nodes/`.
2. Restart ComfyUI (full restart, not just refresh — it needs to pick up the
   new `web/` directory).
3. In the graph, right-click → **Add Node → utils → Fx Group Bypasser**
   (or double-click the canvas and search "Fx Group Bypasser").

## Notes / things you may want to tweak

- **Why a button instead of a switch:** native boolean/toggle widgets
  currently have a widespread ComfyUI frontend bug
  (`TypeError: Cannot delete property 'value' of <BooleanWidget2>`, see
  [ComfyUI#8086](https://github.com/comfyanonymous/ComfyUI/issues/8086),
  often triggered together with ComfyUI-Impact-Pack) that throws during
  `node.configure()` when a saved workflow is reloaded. That aborts the whole
  load and leaves the node stuck showing as "missing," even though it still
  works fine when freshly added. Button widgets hold no value, so using one
  per group avoids that crash entirely.

- "Position" order compares group Y first (rows within 10px are treated as
  the same row, then sorted by X). Adjust the `10` threshold in
  `getOrderedGroups()` in `web/fx_group_bypasser.js` if your groups are
  tightly stacked and sort oddly.
- Bypass state per group is computed as "all nodes inside are in bypass
  mode." If you've manually bypassed only *some* nodes in a group, the
  toggle will show "Enabled" until you flip it (at which point it bypasses
  the rest too).
- Tested against the standard ComfyUI frontend widget API (`addWidget`
  combo/toggle/button types). If your ComfyUI frontend version has changed
  the widget API, the combo/toggle widgets are the most likely spot to need
  a small update.
