// Preferences (FR-SHELL-71, -72, -74): window type `shell.prefs` in both clients, opened by the
// identity chip only (no launcher entry). Its body stacks the client's preference sections
// (append-only `src/client/{dm,player}/pref-sections.ts`) in `order`, a heading each. Sections
// keep their settings where they live today (FR-SHELL-76): the window adds no storage.
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { defineWindow, type ShellClient, type WindowDef } from "./registry";
import { useResetLayout } from "./ShellContext";

export const PREFS_KIND = "shell.prefs";

/** One preference section (FR-SHELL-72). Mirrors `SheetSection`; client code, never sent. */
export interface PrefSection {
  /** `<prefix>.<name>`, the prefix a known spec's (FR-SHELL-75), e.g. `shell.sound`. */
  id: string;
  title: string;
  /** Ascending, top to bottom. */
  order: number;
  /** Read from the synced store; false → not rendered. */
  available?: (store: RecordStore) => boolean;
  Component: ComponentType;
}

/** Identity helper so feature files get type checking without importing a registry list. */
export function definePrefSection(section: PrefSection): PrefSection {
  return section;
}

/**
 * FR-SHELL-75: a registry's problems (empty = fine): an id not `<prefix>.<name>` with `prefix` a
 * known spec prefix (lowercased front matter `prefix:`), or an id registered twice.
 */
export function sectionIdProblems(
  sections: readonly PrefSection[],
  specPrefixes: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { id } of sections) {
    const m = /^([a-z]+)\.[a-z][a-z0-9-]*$/.exec(id);
    if (!m?.[1]) out.push(`${id}: not <prefix>.<name>`);
    else if (!specPrefixes.has(m[1])) out.push(`${id}: unknown spec prefix "${m[1]}"`);
    if (seen.has(id)) out.push(`${id}: registered twice`);
    seen.add(id);
  }
  return out;
}

/** The sections this client renders for `store`, in `order` (FR-SHELL-71, -72). */
export function shownSections(
  sections: readonly PrefSection[],
  store: RecordStore,
): readonly PrefSection[] {
  return sections
    .filter((s) => {
      try {
        return s.available ? s.available(store) : true;
      } catch (err) {
        console.warn(`preference section ${s.id}: available() threw`, err);
        return false;
      }
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * The body: every shown section under its heading (the shell's small muted heading, as the Party
 * window's section titles), separated by a rule. The shell's window body scrolls.
 */
export function PreferencesWindow({ sections }: { sections: readonly PrefSection[] }) {
  const store = useSync((s) => s.store);
  return (
    <div data-testid="ui-prefs-window" className="flex flex-col">
      {shownSections(sections, store).map(({ id, title, Component }, i) => (
        <section
          key={id}
          data-testid="ui-prefs-section"
          data-record-id={id}
          aria-label={title}
          className={i > 0 ? "mt-3 flex flex-col gap-2 border-t pt-3" : "flex flex-col gap-2"}
        >
          <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
          <Component />
        </section>
      ))}
    </div>
  );
}

/**
 * The `shell.prefs` window for one client (FR-SHELL-71; S3 numbers): 360 × 560, opens at least
 * 400 high, min 320 × 280, top-right `dx` 12; a reload leaves it closed.
 */
export function prefsWindow(client: ShellClient, sections: readonly PrefSection[]): WindowDef {
  return defineWindow({
    kind: PREFS_KIND,
    title: "Preferences",
    clients: [client],
    defaultSize: { w: 360, h: 560 },
    minOpenH: 400,
    minSize: { w: 320, h: 280 },
    defaultPosition: { anchor: "top-right", dx: 12 },
    restoreOpen: false,
    component: () => <PreferencesWindow sections={sections} />,
  });
}

/** Layout section (FR-SHELL-74): FR-SHELL-153's reset; Preferences closes with it. */
function LayoutSection() {
  const reset = useResetLayout();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        Windows you moved or resized reopen where you left them. Reset puts every window back where
        it starts and forgets those spots.
      </span>
      <Button size="sm" variant="outline" data-testid="ui-prefs-reset-layout" onClick={reset}>
        Reset layout
      </Button>
    </div>
  );
}

export const layoutSection = definePrefSection({
  id: "shell.layout",
  title: "Layout",
  order: 80,
  Component: LayoutSection,
});
