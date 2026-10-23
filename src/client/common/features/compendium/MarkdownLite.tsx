// FR-CMP-26 renderer: markdown-lite blocks as React elements with text nodes only (never HTML).
// Text runs go through dice-extras' `DiceText` (the one notation parser): monster text with
// `{creature: definitionId, label: action / trait name, category: attack | damage}` per
// expression (attack when it has a `1d20`); every other kind `{label: entry name}`, no actor.
// An `srd:` reference run (BL-102) is a button when the caller passes `onRef` (the Rules window
// opens that card), else its words; quotes render as a bordered `blockquote`.
import { splitNotation } from "@shared/dice-extras/notation";
import { Fragment, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { DiceText, type DiceTextContext } from "../dice-extras/DiceText";
import { diceCategory } from "./logic";
import { type Block, parseMarkdownLite, type Run } from "./markdown";

/** Monster text: the creature and the block's name; the category follows each expression. */
export type TextContext =
  | { kind: "monster"; definitionId: string; label: string }
  | { kind: "plain"; label: string };

/**
 * The `DiceText` calls of one text run: monster text splits at each notation (the one parser,
 * `splitNotation`) so every expression gets its own category; other kinds pass the run whole.
 */
export function diceParts(
  text: string,
  context: TextContext,
): { text: string; context?: DiceTextContext }[] {
  if (context.kind === "plain") return [{ text, context: { label: context.label } }];
  return splitNotation(text).map((p) =>
    p.expression === undefined
      ? { text: p.text }
      : {
          text: p.text,
          context: {
            label: context.label,
            category: diceCategory(p.expression),
            creature: { entityId: context.definitionId },
          },
        },
  );
}

function Dice({ text, context }: { text: string; context: TextContext }) {
  return (
    <>
      {diceParts(text, context).map((p, i) =>
        p.context === undefined ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional per text
          <Fragment key={i}>{p.text}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional per text
          <DiceText key={i} text={p.text} context={p.context} />
        ),
      )}
    </>
  );
}

/** Open an `srd:` reference (the slug); absent → the reference is plain words. */
export type OnRef = (slug: string) => void;

interface View {
  context: TextContext;
  onRef?: OnRef;
}

function RefLink({ run, onRef }: { run: Run & { ref: string }; onRef: OnRef }) {
  return (
    <button
      type="button"
      className="text-primary underline underline-offset-2 hover:no-underline"
      data-testid="cmp-rules-link"
      data-value={run.ref}
      onClick={() => onRef(run.ref)}
    >
      {run.text}
    </button>
  );
}

function Runs({ runs, context, onRef }: { runs: readonly Run[] } & View) {
  return (
    <>
      {runs.map((r, i) => {
        let el: ReactNode =
          r.ref !== undefined && onRef ? (
            <RefLink run={{ ...r, ref: r.ref }} onRef={onRef} />
          ) : (
            <Dice text={r.text} context={context} />
          );
        if (r.italic) el = <em>{el}</em>;
        if (r.bold) el = <strong className="font-semibold">{el}</strong>;
        // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional per line
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

function BlockView({ block, ...view }: { block: Block } & View) {
  const { context, onRef } = view;
  switch (block.type) {
    case "quote":
      return (
        <blockquote className="space-y-1.5 border-l-2 pl-2 text-muted-foreground">
          {block.blocks.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
            <BlockView key={i} block={b} {...view} />
          ))}
        </blockquote>
      );
    case "p":
      return (
        <p>
          {block.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <Fragment key={i}>
              {i > 0 && <br />}
              <Runs runs={line} context={context} onRef={onRef} />
            </Fragment>
          ))}
        </p>
      );
    case "ul":
      return (
        <ul className="list-disc space-y-0.5 pl-5">
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items are positional
            <li key={i}>
              <Runs runs={item} context={context} onRef={onRef} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            {block.head && (
              <thead>
                <tr>
                  {block.head.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                    <th key={i} className="border-b px-1.5 py-1 text-left font-semibold">
                      <Runs runs={c} context={context} onRef={onRef} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <tr key={r} className="even:bg-muted/40">
                  {row.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                    <td key={i} className="px-1.5 py-0.5 align-top">
                      <Runs runs={c} context={context} onRef={onRef} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownLite({
  text,
  context,
  className,
  onRef,
}: {
  text: string;
  context: TextContext;
  className?: string;
  onRef?: OnRef;
}) {
  const blocks = parseMarkdownLite(text);
  return (
    <div className={cn("space-y-1.5 text-sm leading-snug", className)}>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
        <BlockView key={i} block={b} context={context} onRef={onRef} />
      ))}
    </div>
  );
}
