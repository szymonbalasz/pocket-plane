// Source descriptor for SRD reference fixtures (FIX §8: fixtures use key `fixture`; ADR-0018).
import type { SourceDescriptor } from "@server/features/fixtures-adapters/import-pipeline";

export const SRD_ATTRIBUTION =
  "This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by " +
  "Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. " +
  "The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License " +
  "available at https://creativecommons.org/licenses/by/4.0/legalcode.";

export const fixtureSource: SourceDescriptor = {
  key: "fixture",
  name: "Fixtures (SRD 5.1)",
  licence: "CC BY 4.0",
  attribution: SRD_ATTRIBUTION,
};
