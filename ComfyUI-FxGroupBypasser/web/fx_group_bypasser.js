import { app } from "../../scripts/app.js";

// ComfyUI/LiteGraph node "mode" values:
//   0 = always execute (enabled)
//   4 = bypass (pass-through, node is skipped)
const MODE_ENABLED = 0;
const MODE_BYPASS = 4;

const ORDER_POSITION = "Position (Default)";
const ORDER_ALPHA = "Alphabetical";
const ORDER_CUSTOM = "Custom";

app.registerExtension({
	name: "fx.GroupBypasser",

	registerCustomNodes() {
		class FxGroupBypasser extends LGraphNode {
			constructor(title) {
				super(title);
				this.title = "Fx Group Bypasser";
				this.comfyClass = "FxGroupBypasser";

				// Purely a UI helper - it must not show up in the executed prompt.
				this.isVirtualNode = true;
				this.serialize_widgets = false;

				this.properties = this.properties || {};
				if (this.properties.order === undefined) this.properties.order = ORDER_POSITION;
				if (this.properties.customOrder === undefined) this.properties.customOrder = [];

				this._groupTitlesSeen = [];
				this._pollTimer = null;

				this._orderCombo = this.addWidget(
					"combo",
					"Sort Order",
					this.properties.order,
					(value) => {
						this.properties.order = value;
						this.rebuildWidgets();
					},
					{ values: [ORDER_POSITION, ORDER_ALPHA, ORDER_CUSTOM] }
				);

				this.addWidget("button", "Toggle All (Enable / Bypass)", null, () => {
					this.toggleAll();
				});

				this._reorderCombo = null;
				this._moveUpBtn = null;
				this._moveDownBtn = null;
				this._groupToggleWidgets = [];
				this._measureCtx = null;
				this._configured = false;

				this.size = [300, 120];
			}

			onAdded(graph) {
				// If this node is being freshly created (not loaded from a saved
				// workflow), there is no configure() call coming, so build now.
				// If it IS being loaded, onConfigure (below) will do the real
				// build once the saved size/properties are in place.
				if (!this._configured) {
					this.rebuildWidgets();
				}
				// Groups can be renamed/added/removed/moved at any time by the user,
				// so we poll periodically and rebuild only when something changed.
				this._pollTimer = setInterval(() => this.maybeRebuild(), 500);
			}

			onConfigure(info) {
				// Called after ComfyUI/LiteGraph has restored this.size, .pos and
				// .properties from the saved workflow. Rebuilding here (instead of
				// only in onAdded, which fires BEFORE this) means we grow from the
				// correct, already-restored size rather than the constructor default.
				this._configured = true;
				// The "Sort Order" combo's displayed value was set once at
				// construction time (before properties were restored), and we
				// don't serialize widget values, so it needs an explicit resync
				// to match the order that was actually saved.
				if (this._orderCombo) {
					this._orderCombo.value = this.properties.order;
				}
				this.rebuildWidgets();
			}

			onRemoved() {
				if (this._pollTimer) {
					clearInterval(this._pollTimer);
					this._pollTimer = null;
				}
			}

			// Measures how wide a label will actually render, so we can size the
			// node to fit the longest group name in full.
			measureTextWidth(text, font) {
				if (!this._measureCtx) {
					this._measureCtx = document.createElement("canvas").getContext("2d");
				}
				this._measureCtx.font = font || "12px Arial";
				return this._measureCtx.measureText(text || "").width;
			}

			// Minimum node width needed so every group name (plus the
			// Enabled/Bypassed pill next to it) is fully visible, never clipped.
			computeMinWidth(titles) {
				const LEFT_MARGIN = 20; // space before the label text starts
				const GAP = 10; // space between label text and the state text
				const PILL_WIDTH = 110; // room for ":  ⛔ Bypassed" (longest state)
				const RIGHT_MARGIN = 20;
				const SANE_MINIMUM = 260; // keeps combo/buttons from feeling cramped

				let minWidth = SANE_MINIMUM;
				for (const title of titles) {
					const textWidth = this.measureTextWidth(title);
					const needed = LEFT_MARGIN + textWidth + GAP + PILL_WIDTH + RIGHT_MARGIN;
					if (needed > minWidth) minWidth = needed;
				}
				return Math.ceil(minWidth);
			}

			// Clamp interactive resizing so the node can never be dragged
			// narrower than what's needed to show the longest group name in full.
			// Guarded because LiteGraph can invoke onResize very early (e.g. while
			// the base LGraphNode constructor is still running, before our own
			// fields below exist) - without this guard that would throw and
			// silently break node creation entirely.
			onResize(size) {
				if (!this._groupToggleWidgets || !size) return;
				const titles = this._groupToggleWidgets.map((w) => w.name);
				const minWidth = this.computeMinWidth(titles);
				if (size[0] < minWidth) size[0] = minWidth;
			}

			getGroups() {
				if (!this.graph) return [];
				return [...(this.graph._groups || this.graph.groups || [])];
			}

			// Cheap check so we don't rebuild widgets 2x/sec for nothing.
			maybeRebuild() {
				const groups = this.getGroups();
				const titles = groups.map((g) => g.title).sort();
				const prev = this._groupTitlesSeen;
				const changed =
					titles.length !== prev.length || titles.some((t, i) => t !== prev[i]);
				if (changed) {
					this.rebuildWidgets();
				} else {
					// Even if the set of groups hasn't changed, refresh the
					// enabled/bypassed label text in case the user bypassed
					// nodes manually inside a group.
					this.refreshToggleLabels();
				}
			}

			// The button text shows the group name plus its current state.
			updateToggleLabel(w) {
				const bypassed = w.getBypassed();
				if (w._lastBypassed === bypassed) return;
				w._lastBypassed = bypassed;
				w._stateEl.textContent = bypassed ? "⛔ Bypassed" : "✅ Enabled";
				w._stateEl.style.color = bypassed ? "#e57373" : "";
			}

			refreshToggleLabels() {
				for (const w of this._groupToggleWidgets) this.updateToggleLabel(w);
			}

			getOrderedGroups() {
				const groups = this.getGroups();
				for (const g of groups) g.recomputeInsideNodes?.();

				const mode = this.properties.order || ORDER_POSITION;
				let ordered;

				if (mode === ORDER_ALPHA) {
					ordered = groups.sort((a, b) => a.title.localeCompare(b.title));
				} else if (mode === ORDER_CUSTOM) {
					const customOrder = this.properties.customOrder || [];
					ordered = groups.sort((a, b) => {
						let ia = customOrder.indexOf(a.title);
						let ib = customOrder.indexOf(b.title);
						if (ia === -1) ia = Number.MAX_SAFE_INTEGER;
						if (ib === -1) ib = Number.MAX_SAFE_INTEGER;
						if (ia === ib) return a.title.localeCompare(b.title);
						return ia - ib;
					});
					// persist newly-seen groups appended at the end, drop removed ones
					this.properties.customOrder = ordered.map((g) => g.title);
				} else {
					// Position: top-to-bottom, then left-to-right, matching workflow layout.
					ordered = groups.sort((a, b) => {
						const ay = a.pos ? a.pos[1] : 0;
						const by = b.pos ? b.pos[1] : 0;
						if (Math.abs(ay - by) > 10) return ay - by;
						const ax = a.pos ? a.pos[0] : 0;
						const bx = b.pos ? b.pos[0] : 0;
						return ax - bx;
					});
				}
				return ordered;
			}

			rebuildWidgets(force) {
				const ordered = this.getOrderedGroups();
				this._groupTitlesSeen = ordered.map((g) => g.title).sort();

				// Wipe old dynamically-added widgets (keep the first 2: order combo,
				// toggle-all button).
				for (const w of this.widgets.slice(2)) w.onRemove?.();
				this.widgets = this.widgets.slice(0, 2);
				this._reorderCombo = null;
				this._moveUpBtn = null;
				this._moveDownBtn = null;
				this._groupToggleWidgets = [];

				if (ordered.length === 0) {
					const sizeNeeded = this.computeSize();
					sizeNeeded[0] = Math.max(sizeNeeded[0], this.computeMinWidth([]));
					this.size = this.growToFit(sizeNeeded);
					this.graph?.setDirtyCanvas(true, true);
					return;
				}

				// Reorder controls only make sense in Custom mode.
				if (this.properties.order === ORDER_CUSTOM) {
					const titles = ordered.map((g) => g.title);
					if (this._selectedForReorder === undefined || !titles.includes(this._selectedForReorder)) {
						this._selectedForReorder = titles[0];
					}
					this._reorderCombo = this.addWidget(
						"combo",
						"Group to Move",
						this._selectedForReorder,
						(value) => {
							this._selectedForReorder = value;
						},
						{ values: titles }
					);
					this._moveUpBtn = this.addWidget("button", "Move Up", null, () => {
						this.moveSelected(-1);
					});
					this._moveDownBtn = this.addWidget("button", "Move Down", null, () => {
						this.moveSelected(1);
					});
				}

				for (const group of ordered) {
					// One-click button per group: each click flips the group
					// between Enabled and Bypassed. A "button" widget is used
					// (not a native boolean "toggle") because boolean widgets
					// trigger a ComfyUI frontend crash when reloading saved
					// workflows ("Cannot delete property 'value' of
					// <BooleanWidget2>"). Buttons hold no value, so they're immune.
					// Rendered as a DOM row (name left, state right) because the
					// modern ComfyUI frontend draws nodes with Vue/DOM and ignores
					// custom canvas draw() overrides.
					const row = document.createElement("div");
					row.style.cssText =
						"display:flex;justify-content:space-between;align-items:center;box-sizing:border-box;" +
						"width:100%;height:100%;min-height:24px;padding:0 12px;border-radius:12px;cursor:pointer;" +
						"background:var(--comfy-input-bg,#222);border:1px solid var(--border-color,#555);" +
						"font:12px Arial,sans-serif;color:var(--input-text,#ddd);user-select:none;";
					const nameEl = document.createElement("span");
					nameEl.textContent = group.title;
					nameEl.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;";
					const stateEl = document.createElement("span");
					stateEl.style.cssText = "white-space:nowrap;text-align:right;margin-left:10px;";
					row.append(nameEl, stateEl);
					const widget = this.addDOMWidget(group.title, "fxGroupToggle", row, {
						serialize: false,
						hideOnZoom: false,
						getMinHeight: () => 26,
						getMaxHeight: () => 26,
						getValue: () => null,
						setValue: () => {},
					});
					widget.serialize = false;
					widget.getBypassed = () => this.groupIsBypassed(group);
					widget._stateEl = stateEl;
					row.addEventListener("click", () => {
						this.setGroupMode(group, !this.groupIsBypassed(group));
						this.refreshToggleLabels();
					});
					this._groupToggleWidgets.push(widget);
					this.updateToggleLabel(widget);
				}

				const sizeNeeded = this.computeSize();
				sizeNeeded[0] = Math.max(sizeNeeded[0], this.computeMinWidth(ordered.map((g) => g.title)));
				this.size = this.growToFit(sizeNeeded);
				this.graph?.setDirtyCanvas(true, true);
			}

			// Grow the node so widgets always fit, but never shrink or reset a
			// size the user has already dragged/set (or that was restored from
			// a saved workflow). Size only ever grows automatically, never
			// shrinks - the user stays in control once they've resized it.
			growToFit(needed) {
				const current = this.size || [0, 0];
				return [Math.max(current[0], needed[0]), Math.max(current[1], needed[1])];
			}

			moveSelected(direction) {
				const order = this.properties.customOrder || [];
				const idx = order.indexOf(this._selectedForReorder);
				if (idx === -1) return;
				const newIdx = idx + direction;
				if (newIdx < 0 || newIdx >= order.length) return;
				[order[idx], order[newIdx]] = [order[newIdx], order[idx]];
				this.properties.customOrder = order;
				this.rebuildWidgets();
			}

			groupIsBypassed(group) {
				const nodes = group._nodes || [];
				if (!nodes.length) return false;
				return nodes.every((n) => n.mode === MODE_BYPASS);
			}

			setGroupMode(group, bypass) {
				group.recomputeInsideNodes?.();
				const nodes = group._nodes || [];
				for (const n of nodes) {
					n.mode = bypass ? MODE_BYPASS : MODE_ENABLED;
				}
				this.graph?.setDirtyCanvas(true, true);
			}

			toggleAll() {
				const groups = this.getOrderedGroups();
				// If any group is currently enabled, bypass everything.
				// Otherwise (everything already bypassed), enable everything.
				const anyEnabled = groups.some((g) => !this.groupIsBypassed(g));
				const bypass = anyEnabled;
				for (const g of groups) {
					this.setGroupMode(g, bypass);
				}
				this.refreshToggleLabels();
				this.graph?.setDirtyCanvas(true, true);
			}
		}

		LiteGraph.registerNodeType("FxGroupBypasser", FxGroupBypasser);
		FxGroupBypasser.title = "Fx Group Bypasser";
		FxGroupBypasser.category = "utils";
	},
});
