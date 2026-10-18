// FR-CMP-19 (S4) / FR-ENT-29: the About dialog (an imported source's full attribution + the
// "Token art" credits) and the **Credits** footer link that opens it from the Compendium list
// view (both clients, also with nothing imported) and the DM's Creatures window. Credits reads
// the imported sources on open: the first search page of each kind, then one entry per source
// label for its attribution (read on demand, FR-CMP-23); entry-less definitions (GET would 404)
// and homebrew are skipped. With nothing imported only the token art shows.
import {
  HOMEBREW_LABEL,
  type SearchResponse,
  type SourceAttribution,
} from "@shared/compendium/rest";
import { COMPENDIUM_KINDS } from "@shared/compendium/schemas";
import { CREATURE_TYPES } from "@shared/entities/schemas";
import { InfoIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { creatureTypeLabel } from "../entities/art";
import {
  TOKEN_ART_CREDITS,
  TOKEN_ART_LICENCE,
  TOKEN_ART_LICENCE_URL,
  TOKEN_ART_SITE,
  TOKEN_ART_SITE_URL,
} from "../entities/creature-art/credits";
import { fetchEntry } from "./fetch";
import { isEntryless } from "./logic";
import { type ApiSource, resolveApi, searchCompendium } from "./search";

/**
 * One readable entry id per imported source label on search pages: homebrew has no attribution,
 * an entry-less definition (e.g. the `fixture` Goblin) has no entry to read.
 */
export function sourceProbes(pages: readonly SearchResponse[]): string[] {
  const byLabel = new Map<string, string>();
  for (const r of pages.flatMap((p) => p.results)) {
    if (r.sourceLabel !== HOMEBREW_LABEL && !isEntryless(r) && !byLabel.has(r.sourceLabel)) {
      byLabel.set(r.sourceLabel, r.id);
    }
  }
  return [...byLabel.values()];
}

/** The imported sources' attributions, read on demand; [] when nothing is imported. */
export async function fetchCreditSources(source: ApiSource): Promise<SourceAttribution[]> {
  const pages = await Promise.all(
    COMPENDIUM_KINDS.map((kind) => searchCompendium(source, { kind })),
  );
  const api = await resolveApi(source);
  const entries = await Promise.all(sourceProbes(pages).map((id) => fetchEntry(api, id)));
  const out = new Map<string, SourceAttribution>();
  for (const e of entries) if (e.source) out.set(e.source.key, e.source);
  return [...out.values()];
}

const AUTHORS = [...new Set(CREATURE_TYPES.map((t) => TOKEN_ART_CREDITS[t].author))];

/** FR-ENT-29: the 14 icons, their authors, CC BY 3.0, game-icons.net. */
export function TokenArtCredits() {
  return (
    <section className="space-y-1.5" data-testid="cmp-about-token-art">
      <h3 className="text-sm font-semibold">Token art</h3>
      <p className="text-xs text-muted-foreground">
        Creature-type icons by {AUTHORS.join(" and ")} from{" "}
        <a className="underline" href={TOKEN_ART_SITE_URL} target="_blank" rel="noreferrer">
          {TOKEN_ART_SITE}
        </a>
        , licensed under{" "}
        <a className="underline" href={TOKEN_ART_LICENCE_URL} target="_blank" rel="noreferrer">
          {TOKEN_ART_LICENCE}
        </a>
        . Drawn white on a creature-type colour.
      </p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {CREATURE_TYPES.map((t) => {
          const c = TOKEN_ART_CREDITS[t];
          return (
            <li key={t} data-testid="cmp-about-token-art-row" data-value={t}>
              <span className="font-medium">{creatureTypeLabel(t)}:</span>{" "}
              <a className="underline" href={c.url} target="_blank" rel="noreferrer">
                {c.icon}
              </a>{" "}
              <span className="text-muted-foreground">({c.author})</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SourceSection({ source }: { source: SourceAttribution }) {
  return (
    <section className="space-y-1" data-testid="cmp-about-source" data-record-id={source.key}>
      <h3 className="text-sm font-semibold">{source.name}</h3>
      <p className="text-xs text-muted-foreground">{source.licence}</p>
      <p className="whitespace-pre-wrap text-sm" data-testid="cmp-about-text">
        {source.attribution}
      </p>
      {source.url && <p className="break-all text-xs text-muted-foreground">{source.url}</p>}
    </section>
  );
}

/** The dialog's body: each source's attribution, then the token art credits. */
export function AboutBody({ sources }: { sources: readonly SourceAttribution[] }) {
  return (
    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
      {sources.map((s) => (
        <SourceSection key={s.key} source={s} />
      ))}
      <TokenArtCredits />
    </div>
  );
}

export function AboutDialog({
  open,
  onOpenChange,
  sources,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  sources: readonly SourceAttribution[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="cmp-about-dialog">
        <DialogHeader>
          <DialogTitle>About</DialogTitle>
          <DialogDescription>Content licences and credits</DialogDescription>
        </DialogHeader>
        <AboutBody sources={sources} />
      </DialogContent>
    </Dialog>
  );
}

/** The footer **Credits** link: opens the About dialog with the imported sources read on open. */
export function CreditsLink({ api, testId }: { api: ApiSource; testId: string }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceAttribution[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchCreditSources(api).then(
      (s) => live && setSources(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, open]);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1 text-xs text-muted-foreground"
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        <InfoIcon className="size-3.5" /> Credits
      </Button>
      <AboutDialog open={open} onOpenChange={setOpen} sources={sources} />
    </>
  );
}
