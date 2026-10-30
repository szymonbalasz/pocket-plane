// FR-CMP-19 (S4) / FR-ENT-29: the About dialog (an imported source's full attribution + the
// "Token art" credits) and the **Credits** footer link that opens it from the Compendium list
// view (both clients, also with nothing imported) and the DM's Creatures window. Credits reads
// the imported sources on open (read on demand, FR-CMP-23): every book, FR-CMPX-18, however many
// there are. With nothing imported only the token art shows.

import { BUNDLED_SOURCE_KEYS, bookAbbr } from "@shared/compendium/match";
import { CreditsResponse, type SourceAttribution } from "@shared/compendium/rest";
import { RULES_CHANGE_NOTE } from "@shared/compendium/rules";
import { CREATURE_TYPES } from "@shared/entities/schemas";
import { InfoIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "../../api";
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
import { type ApiSource, resolveApi } from "./search";

/** The imported sources' attributions, read on demand; none when nothing is imported. */
export async function fetchCredits(source: ApiSource): Promise<CreditsResponse> {
  const api = await resolveApi(source);
  return CreditsResponse.parse(await call<unknown>(api.api.compendium.credits.$get()));
}

const AUTHORS = [...new Set(CREATURE_TYPES.map((t) => TOKEN_ART_CREDITS[t].author))];

/** FR-CMPX-29: shown once any book is imported. */
export const BOOK_ART_CREDIT = "Token art: © Wizards of the Coast, from your own 5etools files";

/** FR-ENT-29: the 14 icons, their authors, CC BY 3.0, game-icons.net. */
export function TokenArtCredits({ books = false }: { books?: boolean }) {
  return (
    <section className="space-y-1.5" data-testid="cmp-about-token-art">
      <h3 className="text-sm font-semibold">Token art</h3>
      {books && (
        <p className="text-xs text-muted-foreground" data-testid="cmpx-about-token-art">
          {BOOK_ART_CREDIT}
        </p>
      )}
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
      {(BUNDLED_SOURCE_KEYS as readonly string[]).includes(source.key) && (
        <p className="text-xs text-muted-foreground" data-testid="cmp-about-rules">
          {RULES_CHANGE_NOTE}
        </p>
      )}
    </section>
  );
}

/**
 * The dialog's body: each source's attribution, then the token art credits. `bookArt`: the credits
 * route's (FR-CMPX-29); an About opened on one entry, without it, goes by that entry's source.
 */
export function AboutBody({
  sources,
  bookArt = sources.some((s) => bookAbbr(s.key) !== null),
}: {
  sources: readonly SourceAttribution[];
  bookArt?: boolean;
}) {
  return (
    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
      {sources.map((s) => (
        <SourceSection key={s.key} source={s} />
      ))}
      <TokenArtCredits books={bookArt} />
    </div>
  );
}

export function AboutDialog({
  open,
  onOpenChange,
  sources,
  bookArt,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  sources: readonly SourceAttribution[];
  bookArt?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="cmp-about-dialog">
        <DialogHeader>
          <DialogTitle>About</DialogTitle>
          <DialogDescription>Content licences and credits</DialogDescription>
        </DialogHeader>
        <AboutBody sources={sources} {...(bookArt !== undefined ? { bookArt } : {})} />
      </DialogContent>
    </Dialog>
  );
}

/** The footer **Credits** link: opens the About dialog with the imported sources read on open. */
export function CreditsLink({ api, testId }: { api: ApiSource; testId: string }) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState<CreditsResponse>({ sources: [], bookArt: false });
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchCredits(api).then(
      (c) => live && setCredits(c),
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
      <AboutDialog
        open={open}
        onOpenChange={setOpen}
        sources={credits.sources}
        bookArt={credits.bookArt}
      />
    </>
  );
}
