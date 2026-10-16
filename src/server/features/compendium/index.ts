// Compendium (CMP, ADR-0046): import kinds for the pipeline, `cmp.import` /
// `cmp.importRecorded`, homebrew `cmp.putEntry` / `cmp.deleteEntry`, `cmp.deriveMonster` (REST,
// routes mounted in app.ts) and the WS intent `cmp.addToSheet` (FR-CMP-28).
import type { Feature } from "../../services";
import { addToSheet } from "./add-to-sheet";
import { deriveMonster } from "./derive";
import { registerEntryImport } from "./entries";
import { deleteEntry, putEntry } from "./homebrew";
import { importCommand, importRecordedCommand } from "./import";

export const compendium: Feature = {
  name: "compendium",
  register(r) {
    const s = r.services;
    registerEntryImport(s.imports);
    r.command(importCommand(s.imports));
    r.command(importRecordedCommand(s.imports));
    r.command(putEntry);
    r.command(deleteEntry);
    r.command(deriveMonster);
    r.command(addToSheet, { intent: true });
  },
};
