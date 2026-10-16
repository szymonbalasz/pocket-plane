// Bundled source `srd-5.1` (FR-CMP-04 / -06, ADR-0018): SRD 5.1 as recorded from Open5e v1,
// filtered to `document__slug = wotc-srd`. We rely on CC BY 4.0, not Open5e's OGL label.

/** The exact SRD 5.1 CC BY 4.0 statement (same text as `fixtures/srd/source.ts`). */
export const SRD_51_ATTRIBUTION =
  "This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by " +
  "Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. " +
  "The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, " +
  "available at https://creativecommons.org/licenses/by/4.0/legalcode.";

/** Provenance only: where the text was transcribed from. */
export const OPEN5E_V1_URL = "https://api.open5e.com/v1/";
export const SRD_DOCUMENT_SLUG = "wotc-srd";

export const SRD_51_SOURCE = {
  key: "srd-5.1",
  name: "SRD 5.1",
  licence: "CC BY 4.0",
  attribution: SRD_51_ATTRIBUTION,
  url: "https://dnd.wizards.com/resources/systems-reference-document",
} as const;

/** Open5e v1 endpoints recorded, in file order; file = `<endpoint>.json`. */
export const OPEN5E_ENDPOINTS = [
  "monsters",
  "spells",
  "magicitems",
  "weapons",
  "armor",
  "conditions",
  "classes",
] as const;
export type Open5eEndpoint = (typeof OPEN5E_ENDPOINTS)[number];

export const ATTRIBUTION_FILE = "ATTRIBUTION.md";
