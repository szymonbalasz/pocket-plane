// FR-CMP-19 entry views: monster stat block (core from the definition + reference sections),
// spell, item, condition, feature; footer "SRD 5.1 · CC BY 4.0" + About (full attribution), or
// "Homebrew" (+ "Shared" / "DM only" for the DM). Text through `MarkdownLite` (FR-CMP-26).
import type { EntryDefinition, EntryResponse, SourceAttribution } from "@shared/compendium/rest";
import {
  type BodyOf,
  type CompendiumEntry,
  type FacetsOf,
  ordinal,
  type StatBlockSection,
} from "@shared/compendium/schemas";
import {
  ABILITIES,
  DEFINITION_DRAG_MIME,
  type DefinitionDragData,
  type MonsterStatBlock,
  saveBonus,
} from "@shared/entities/schemas";
import { GripVerticalIcon, InfoIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { crText, footerLabel, type Role, scoreText, signed } from "./logic";
import { MarkdownLite, type TextContext } from "./MarkdownLite";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ABILITY_SHORT = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="font-semibold">{label}</span> {children}
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
    <section data-testid={testId} className="space-y-1.5">
      <h3 className="border-b border-primary/40 text-sm font-semibold text-primary">{title}</h3>
      {intro && <MarkdownLite text={intro} context={{ kind: "plain", label: title }} />}
      {sections.map((s, i) => {
        const context: TextContext = { kind: "monster", definitionId, label: s.name };
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: sections are positional (names repeat)
          <div key={i} data-testid="cmp-statblock-section" data-value={s.name}>
            <MarkdownLite text={`**${s.name}.** ${s.text}`} context={context} />
          </div>
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
    <div className="space-y-2 text-sm">
      <header data-testid="cmp-statblock-header">
        <h2 className="text-lg font-semibold leading-tight text-primary">{name}</h2>
        <div className="text-xs italic text-muted-foreground">
          {kind}
          {meta.alignment ? `, ${meta.alignment}` : ""}
        </div>
      </header>
      <Rule />
      <div data-testid="cmp-statblock-core" className="space-y-0.5">
        <Fact label="Armor Class">
          {sb.ac}
          {meta.armorNote ? ` (${meta.armorNote})` : ""}
        </Fact>
        <Fact label="Hit Points">
          {sb.hpMax}
          {sb.hpFormula ? ` (${sb.hpFormula})` : ""}
        </Fact>
        <Fact label="Speed">
          {meta.speedText ?? (sb.speed !== undefined ? `${sb.speed} ft.` : "—")}
        </Fact>
      </div>
      {sb.abilities && (
        <>
          <Rule />
          <div data-testid="cmp-statblock-scores" className="grid grid-cols-6 gap-1 text-center">
            {ABILITIES.map((a) => (
              <div key={a} data-testid="cmp-statblock-score" data-value={a}>
                <div className="text-xs font-semibold">{ABILITY_SHORT[a]}</div>
                <div className="text-xs tabular-nums">
                  {sb.abilities && scoreText(sb.abilities[a])}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <Rule />
      <div data-testid="cmp-statblock-facts" className="space-y-0.5">
        {saves && <Fact label="Saving Throws">{saves}</Fact>}
        {meta.skillsText && <Fact label="Skills">{meta.skillsText}</Fact>}
        {meta.vulnerabilities && <Fact label="Damage Vulnerabilities">{meta.vulnerabilities}</Fact>}
        {meta.resistances && <Fact label="Damage Resistances">{meta.resistances}</Fact>}
        {meta.immunities && <Fact label="Damage Immunities">{meta.immunities}</Fact>}
        {meta.conditionImmunities && (
          <Fact label="Condition Immunities">{meta.conditionImmunities}</Fact>
        )}
        {senses && <Fact label="Senses">{senses}</Fact>}
        {meta.languages && <Fact label="Languages">{meta.languages}</Fact>}
        <Fact label="Challenge">{crText(sb.cr)}</Fact>
      </div>
      {body && (
        <>
          <Rule />
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
    </div>
  );
}

// ---------- other kinds ----------

function Heading({ name, line }: { name: string; line: string }) {
  return (
    <header data-testid="cmp-entry-header">
      <h2 className="text-lg font-semibold leading-tight text-primary">{name}</h2>
      <div className="text-xs italic text-muted-foreground">{line}</div>
    </header>
  );
}

function SpellView({ e }: { e: CompendiumEntry }) {
  const f = e.facets as FacetsOf<"spell">;
  const b = e.body as BodyOf<"spell">;
  const ctx: TextContext = { kind: "plain", label: e.name };
  const tags = [f.ritual && "ritual", f.concentration && "concentration"].filter(Boolean);
  return (
    <div className="space-y-2 text-sm">
      <Heading name={e.name} line={`${e.line}${tags.length ? ` (${tags.join(", ")})` : ""}`} />
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
      <Heading name={e.name} line={line} />
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
      <Heading name={e.name} line={line} />
      <Rule />
      <MarkdownLite text={b.text} context={{ kind: "plain", label: e.name }} />
    </div>
  );
}

// ---------- footer ----------

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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="cmp-about-dialog">
          <DialogHeader>
            <DialogTitle>{source.name}</DialogTitle>
            <DialogDescription>{source.licence}</DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm" data-testid="cmp-about-text">
            {source.attribution}
          </p>
          {source.url && <p className="break-all text-xs text-muted-foreground">{source.url}</p>}
        </DialogContent>
      </Dialog>
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

/** One entry (FR-CMP-19): the kind's view, the DM's drag handle on monsters, the footer. */
export function EntryView({ data, viewer }: { data: EntryResponse; viewer: Role }) {
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
  return (
    <article
      data-testid="cmp-entry"
      data-record-id={e.id}
      data-value={e.kind}
      className="space-y-2"
    >
      {viewer === "dm" && e.kind === "monster" && data.definition && (
        <div className="flex items-center justify-end gap-1" data-testid="cmp-entry-actions">
          <DragHandle definitionId={data.definition.id} name={e.name} />
        </div>
      )}
      {view}
      <Attribution source={data.source} entry={e} viewer={viewer} />
    </article>
  );
}
