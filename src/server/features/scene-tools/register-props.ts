// Props: scn.placeProp / updateProp / setPropHidden / duplicateProp / deleteProp (DM), filled by
// build/scene-tools-props. Commands in `props.ts`.
import type { Registrar } from "../../services";
import { deleteProp, duplicateProp, placeProp, setPropHidden, updateProp } from "./props";

export function registerProps(r: Registrar): void {
  r.command(placeProp, { intent: true });
  r.command(updateProp, { intent: true });
  r.command(setPropHidden, { intent: true });
  r.command(duplicateProp, { intent: true });
  r.command(deleteProp, { intent: true });
}
