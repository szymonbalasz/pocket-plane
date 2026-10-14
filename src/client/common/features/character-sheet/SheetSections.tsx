// Renders the registered sheet sections of one slot (CHARX §7.1). Each section sits in its own
// error boundary: a throwing section renders nothing and logs a console warning; the sheet keeps
// working.
import { Component, type ReactNode } from "react";
import { useSync } from "../../sync/store";
import {
  type SheetClient,
  type SheetCreatureKind,
  type SheetSection,
  sectionsFor,
} from "./sections";
import { sheetSections } from "./sheet-sections";

class SectionBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(err: unknown) {
    console.warn(`sheet section ${this.props.id} failed to render`, err);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** One section with its test ID wrapper. */
export function SectionView({
  section,
  creatureId,
  client,
}: {
  section: SheetSection;
  creatureId: string;
  client: SheetClient;
}) {
  const C = section.component;
  return (
    <div data-testid="charx-section" data-record-id={section.id}>
      <SectionBoundary id={section.id}>
        <C creatureId={creatureId} client={client} />
      </SectionBoundary>
    </div>
  );
}

/** The sections of `slot` (not `tab`) for this creature, in order. */
export function SheetSlotView({
  slot,
  creatureId,
  client,
  kind,
  sections = sheetSections,
  className,
}: {
  slot: "header" | "vitals" | "main";
  creatureId: string;
  client: SheetClient;
  kind: SheetCreatureKind;
  sections?: readonly SheetSection[];
  className?: string;
}) {
  const store = useSync((s) => s.store);
  const list = sectionsFor(sections, { slot, client, kind, store, creatureId });
  if (list.length === 0) return null;
  return (
    <div className={className}>
      {list.map((s) => (
        <SectionView key={s.id} section={s} creatureId={creatureId} client={client} />
      ))}
    </div>
  );
}
