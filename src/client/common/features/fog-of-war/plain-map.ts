// FR-FOG-20 (sprint 4, #243 [7], OQ-FOG-54): the DM sees the plain battlemap unless the Fog tool
// is selected or the Layers popover's "Fog" switch (`scn-layer-toggle-fog`, off by default) is on.
// Token badges (Fog, Invisible) are token overlays, so they stay. DOM-free.
import { type LayerToggle, toggleOn } from "../scenes-map/layers";

/** The fog entry's Layers switch: a `show` switch, off by default (FR-SCN-05). */
export const FOG_LAYER_SWITCH: LayerToggle = {
  key: "fog",
  label: "Fog",
  layer: "fog",
  kind: "show",
};

/** Whether the fog layer draws on this client (`fog-layer` attr `visible`); players: always. */
export function fogLayerShown(
  client: "dm" | "player",
  fogToolOn: boolean,
  off: Readonly<Record<string, boolean>>,
): boolean {
  return client === "player" || fogToolOn || toggleOn(FOG_LAYER_SWITCH, off);
}

/**
 * What the fog layer draws (`fog-layer` attr `mode`): `full` as `fogLayerShown`; else, #383
 * (FR-FOG-20), `view-as` = the DM's View-as render only over the plain map while a player or
 * Party is loaded (no DM fog, explored or darkness); else `hidden`.
 */
export type FogLayerMode = "full" | "view-as" | "hidden";

export function fogLayerMode(
  client: "dm" | "player",
  fogToolOn: boolean,
  off: Readonly<Record<string, boolean>>,
  viewAsLoaded: boolean,
): FogLayerMode {
  if (fogLayerShown(client, fogToolOn, off)) return "full";
  return viewAsLoaded ? "view-as" : "hidden";
}
