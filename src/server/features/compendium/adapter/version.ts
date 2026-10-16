// FR-CMP-04: a bundled source's `version` = SHA-256 over its files + `ADAPTER_VERSION`, so a new
// mapping also shows **Update**. Line endings are normalised so a CRLF checkout hashes the same.
import { createHash } from "node:crypto";
import { ADAPTER_VERSION } from "./open5e";

export interface BundledFile {
  name: string;
  text: string;
}

export function sourceVersion(files: readonly BundledFile[], adapterVersion = ADAPTER_VERSION) {
  const h = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const f of sorted) h.update(`${f.name}\0${f.text.replace(/\r\n/g, "\n")}\0`);
  h.update(`adapter\0${adapterVersion}`);
  return h.digest("hex");
}
