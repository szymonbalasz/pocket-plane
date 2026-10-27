// FR-CMP-19 entry views: monster stat block (core from the definition + reference sections),
// spell, item, condition, feature; footer "SRD 5.1 · CC BY 4.0" + About (full attribution and
// the token art credits, `credits.tsx`), or
// "Homebrew" (+ "Shared" / "DM only" for the DM). Text through `MarkdownLite` (FR-CMP-26).
// Actions row: **Add to sheet** on spells / items / features (both clients, FR-CMP-28), the DM's
// extras from the caller (Derive…, Clone / Edit / Delete; FR-CMP-25, -27); "Preset: ‹name›"
// when FR-CMP-29 resolves a trigger preset. Homebrew images (FR-CMP-51): the gallery under the
// header, the same for every kind (`gallery.tsx`).
import { isSheetable } from "@shared/compendium/homebrew";
import { resolvePreset } from "@shared/compendium/presets";
import type { EntryDefinition, EntryResponse, SourceAttribution } from "@shared/compendium/rest";
import {
  type BodyOf,
  type CompendiumEntry,
  type FacetsOf,
  ordinal,
  type StatBlockSection,
} from "@shared/compendium/schemas";
import {
  DEFINITION_DRAG_MIME,
  type DefinitionDragData,
  type MonsterStatBlock,
  saveBonus,
} from "@shared/entities/schemas";
import { GripVerticalIcon, InfoIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/primitives";
import { AddToSheet } from "./AddToSheet";
import { AboutDialog } from "./credits";
import { EntryGallery } from "./gallery";
import { crText, footerLabel, type Role, signed } from "./logic";
import { MarkdownLite, type TextContext } from "./MarkdownLite";
import { OpenInRules } from "./rules/OpenInRules";
import {
  ABILITY_SHORT,
  StatBlockAbilities,
  StatBlockCard,
  StatBlockCore,
  StatBlockEntry,
  StatBlockTypeLine,
  StatLabel,
} from "./statblock-card";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="font-semibold">{label}</span> {children}
    </div>
  );
}

/** A monster fact ("Saving Throws …"): its label is a stat block label (FR-KIT-77). */
function StatFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <StatLabel>{label}</StatLabel> {children}
    </div>
  );
}

function Rule() {
  return <hr className="my-2 border-primary/40" />;
}

/** DM: drag a monster onto the map (`{definitionId}`, FR-CMP-21 / FR-MAP-13). */
export function DragHandle({ definitionId, name }: { definitionId: string; name: string }) {
  return (
    <button
      type="button"
      draggable
      data-testid="cmp-drag-handle"
      data-record-id={definitionId}
      aria-label={`Drag ${name} onto the map`}
      className="inline-flex cursor-grab items-center rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing"
      onDragStart={(e) => {
        const data: DefinitionDragData = { definitionId };
        e.dataTransfer.setData(DEFINITION_DRAG_MIME, JSON.stringify(data));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  );
}

// ---------- monster ----------

type MonsterBody = BodyOf<"monster">;
type MonsterFacets = FacetsOf<"monster">;

function Sections({
  title,
  testId,
  sections,
  definitionId,
  intro,
}: {
  title: string;
  testId: string;
  sections: readonly StatBlockSection[];
  definitionId: string;
  intro?: string;
}) {
  if (sections.length === 0 && !intro) return null;
  return (
    <section data-testid={testId} className="space-y-1">
      <h3 className="border-b border-primary/40 text-sm font-semibold text-primary">
        <StatLabel>{title}</StatLabel>
      </h3>
      {intro && <MarkdownLite text={intro} context={{ kind: "plain", label: title }} />}
      {sections.map((s, i) => {
        const context: TextContext = { kind: "monster", definitionId, label: s.name };
        return (
          // FR-KIT-77: name + muted line rows (the kit's attack rows, read-only here).
          <StatBlockEntry
            // biome-ignore lint/suspicious/noArrayIndexKey: sections are positional (names repeat)
            key={i}
            data-testid="cmp-statblock-section"
            data-value={s.name}
            name={`${s.name}.`}
          >
            <MarkdownLite text={s.text} context={context} />
          </StatBlockEntry>
        );
      })}
    </section>
  );
}

/** The stat block (CMP §7): header, AC / HP / speed, scores, facts, then the reference sections. */
export function StatBlock({
  name,
  definition,
  facets,
  body,
}: {
  name: string;
  definition: Pick<EntryDefinition, "id" | "statBlock">;
  facets?: MonsterFacets;
  body?: MonsterBody;
}) {
  const sb: MonsterStatBlock = definition.statBlock;
  const meta = body?.meta ?? {};
  const kind = facets
    ? `${cap(facets.size)} ${facets.type}${meta.subtype ? ` (${meta.subtype})` : ""}`
    : cap(sb.size);
  const saves =
    meta.savesText ??
    sb.saveProficiencies
      ?.map((a) => `${ABILITY_SHORT[a]} ${signed(saveBonus(sb, a) ?? 0)}`)
      .join(", ");
  const senses =
    meta.senses ??
    (sb.senses && sb.senses.darkvisionFt > 0
      ? `darkvision ${sb.senses.darkvisionFt} ft.`
      : undefined);
  return (
    <StatBlockCard>
      <header data-testid="cmp-statblock-header">
        <h2 data-slot="statblock-name" className="text-lg font-semibold leading-tight text-primary">
          {name}
        </h2>
        <StatBlockTypeLine>
          {kind}
          {meta.alignment ? `, ${meta.alignment}` : ""}
        </StatBlockTypeLine>
      </header>
      <StatBlockCore
        testId="cmp-statblock-core"
        ac={sb.ac}
        acNote={meta.armorNote}
        hp={
          <span>
            <span className="tabular-nums">{sb.hpMax}</span>
            {sb.hpFormula && <span className="text-muted-foreground"> ({sb.hpFormula})</span>}
          </span>
        }
        speed={meta.speedText ?? (sb.speed !== undefined ? `${sb.speed} ft.` : "—")}
      />
      {sb.abilities && (
        <StatBlockAbilities
          abilities={sb.abilities}
          testId="cmp-statblock-scores"
          cellTestId="cmp-statblock-score"
        />
      )}
      <div data-testid="cmp-statblock-facts" className="space-y-0.5">
        {saves && <StatFact label="Saving Throws">{saves}</StatFact>}
        {meta.skillsText && <StatFact label="Skills">{meta.skillsText}</StatFact>}
        {meta.vulnerabilities && (
          <StatFact label="Damage Vulnerabilities">{meta.vulnerabilities}</StatFact>
        )}
        {meta.resistances && <StatFact label="Damage Resistances">{meta.resistances}</StatFact>}
        {meta.immunities && <StatFact label="Damage Immunities">{meta.immunities}</StatFact>}
        {meta.conditionImmunities && (
          <StatFact label="Condition Immunities">{meta.conditionImmunities}</StatFact>
        )}
        {senses && <StatFact label="Senses">{senses}</StatFact>}
        {meta.languages && <StatFact label="Languages">{meta.languages}</StatFact>}
        <StatFact label="Challenge">{crText(sb.cr)}</StatFact>
      </div>
      {body && (
        <>
          <Sections
            title="Traits"
            testId="cmp-statblock-traits"
            sections={body.traits}
            definitionId={definition.id}
          />
          <Sections
            title="Actions"
            testId="cmp-statblock-actions"
            sections={body.actions}
            definitionId={definition.id}
          />
          <Sections
            title="Bonus Actions"
            testId="cmp-statblock-bonus-actions"
            sections={body.bonusActions}
            definitionId={definition.id}
          />
          <Sections
            title="Reactions"
            testId="cmp-statblock-reactions"
            sections={body.reactions}
            definitionId={definition.id}
          />
          {body.legendary && (
            <Sections
              title="Legendary Actions"
              testId="cmp-statblock-legendary"
              sections={body.legendary.actions}
              intro={body.legendary.intro}
              definitionId={definition.id}
            />
          )}
        </>
      )}
    </StatBlockCard>
  );
}

// ---------- other kinds ----------

function Heading({ e, line }: { e: CompendiumEntry; line: string }) {
  return (
    <>
      <header data-testid="cmp-entry-header">
        <h2 className="text-lg font-semibold leading-tight text-primary">{e.name}</h2>
        <div className="text-xs italic text-muted-foreground">{line}</div>
      </header>
      <EntryGallery ids={e.imageAssetIds} name={e.name} />
    </>
  );
}

function SpellView({ e }: { e: CompendiumEntry }) {
  const f = e.facets as FacetsOf<"spell">;
  const b = e.body as BodyOf<"spell">;
  const ctx: TextContext = { kind: "plain", label: e.name };
  const tags = [f.ritual && "ritual", f.concentration && "concentration"].filter(Boolean);
  return (
    <div className="space-y-2 text-sm">
      <Heading e={e} line={`${e.line}${tags.length ? ` (${tags.join(", ")})` : ""}`} />
      <div className="space-y-0.5">
        <Fact label="Casting Time">{b.castingTime}</Fact>
        <Fact label="Range">{b.range}</Fact>
        <Fact label="Components">
          {b.components}
          {b.material ? ` (${b.material})` : ""}
        </Fact>
        <Fact label="Duration">{b.duration}</Fact>
        {f.classes.length > 0 && <Fact label="Classes">{f.classes.join(", ")}</Fact>}
      </div>
      <Rule />
      <MarkdownLite text={b.text} context={ctx} />
      {b.higherLevel && (
        <MarkdownLite text={`**At Higher Levels.** ${b.higherLevel}`} context={ctx} />
      )}
    </div>
  );
}

function ItemView({ e }: { e: CompendiumEntry }) {
  const f = e.facets as FacetsOf<"item">;
  const b = e.body as BodyOf<"item">;
  const line = [b.typeLine, f.rarity, f.attunement ? "requires attunement" : null]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="space-y-2 text-sm">
      <Heading e={e} line={line} />
      <div className="space-y-0.5">
        {b.cost && <Fact label="Cost">{b.cost}</Fact>}
        {b.weight && <Fact label="Weight">{b.weight}</Fact>}
        {b.damage && <Fact label="Damage">{b.damage}</Fact>}
        {b.properties && <Fact label="Properties">{b.properties}</Fact>}
        {b.ac && <Fact label="Armor Class">{b.ac}</Fact>}
      </div>
      {b.text.trim() !== "" && (
        <>
          <Rule />
          <MarkdownLite text={b.text} context={{ kind: "plain", label: e.name }} />
        </>
      )}
    </div>
  );
}

function TextView({ e }: { e: CompendiumEntry }) {
  const b = e.body as { text: string };
  const f = e.kind === "feature" ? (e.facets as FacetsOf<"feature">) : null;
  const line = f
    ? [f.className, f.subclass, f.level !== undefined ? `${ordinal(f.level)} level` : null]
        .filter(Boolean)
        .join(" · ")
    : e.line;
  return (
    <div className="space-y-2 text-sm">
      <Heading e={e} line={line} />
      <Rule />
      <MarkdownLite text={b.text} context={{ kind: "plain", label: e.name }} />
    </div>
  );
}

// ---------- footer ----------

/** FR-CMP-19: About opens the full attribution, with the token art credits (FR-ENT-29). */
function About({ source }: { source: SourceAttribution }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs"
        data-testid="cmp-about"
        onClick={() => setOpen(true)}
      >
        <InfoIcon className="size-3.5" /> About
      </Button>
      <AboutDialog open={open} onOpenChange={setOpen} sources={[source]} />
    </>
  );
}

export function Attribution({
  source,
  entry,
  viewer,
}: {
  source: SourceAttribution | null;
  entry: Pick<CompendiumEntry, "shared">;
  viewer: Role;
}) {
  return (
    <footer className="flex items-center justify-between gap-2 border-t pt-1.5 text-xs text-muted-foreground">
      <span data-testid="cmp-attribution">
        {source ? (
          footerLabel(source, entry.shared, viewer)
        ) : (
          <Badge variant="outline">{footerLabel(null, entry.shared, viewer)}</Badge>
        )}
      </span>
      {source && <About source={source} />}
    </footer>
  );
}

/** FR-CMP-29: the trigger preset Add to sheet also adds. */
function PresetLine({ e }: { e: CompendiumEntry }) {
  const p = resolvePreset(e);
  if (!p) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="cmp-preset">
      <span className="font-semibold">Preset:</span> {p.name}
    </p>
  );
}

/**
 * One entry (FR-CMP-19): the kind's view, the actions row (the DM's drag handle on monsters, Add
 * to sheet, the caller's `actions`), the footer.
 */
export function EntryView({
  data,
  viewer,
  actions,
}: {
  data: EntryResponse;
  viewer: Role;
  actions?: ReactNode;
}) {
  const e = data.entry;
  let view: ReactNode;
  if (e.kind === "monster" && data.definition) {
    view = (
      <StatBlock
        name={e.name}
        definition={data.definition}
        facets={e.facets as MonsterFacets}
        body={e.body as MonsterBody}
      />
    );
  } else if (e.kind === "spell") view = <SpellView e={e} />;
  else if (e.kind === "item") view = <ItemView e={e} />;
  else view = <TextView e={e} />;
  const drag = viewer === "dm" && e.kind === "monster" && data.definition;
  const sheetable = isSheetable(e.kind);
  const rule = e.kind === "rule";
  return (
    <article
      data-testid="cmp-entry"
      data-record-id={e.id}
      data-value={e.kind}
      className="space-y-2"
    >
      {(drag || sheetable || rule || actions) && (
        <div
          className="flex flex-wrap items-center justify-end gap-1"
          data-testid="cmp-entry-actions"
        >
          {actions}
          {rule && <OpenInRules entryId={e.id} />}
          {sheetable && <AddToSheet entryId={e.id} />}
          {drag && data.definition && (
            <DragHandle definitionId={data.definition.id} name={e.name} />
          )}
        </div>
      )}
      {view}
      <PresetLine e={e} />
      <Attribution source={data.source} entry={e} viewer={viewer} />
    </article>
  );
}
