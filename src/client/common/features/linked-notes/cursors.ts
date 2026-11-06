// FR-NOTES-15: other people's carets and selections, in their colour. The name tag shows for 2 s
// after its person moves or types, and on hover (walkthrough r1, Google Docs style); otherwise the
// coloured caret alone, so the tag never hides the line above for long. The window computes them
// (session `mapCursor`, `showTag`) and hands them to the editor as one effect.
import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface DrawnCursor {
  clientId: string;
  /** `data-player-id`: the player's id, "dm" for the DM. */
  playerKey: string;
  label: string;
  color: string;
  /** Show the name tag now (moved or typed in the last 2 s). */
  tag: boolean;
  ranges: { anchor: number; head: number }[];
}

export const setCursors = StateEffect.define<DrawnCursor[]>();

class Caret extends WidgetType {
  constructor(readonly c: DrawnCursor) {
    super();
  }
  override eq(other: Caret): boolean {
    return (
      other.c.clientId === this.c.clientId &&
      other.c.label === this.c.label &&
      other.c.color === this.c.color &&
      other.c.tag === this.c.tag
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-remote-caret";
    wrap.dataset.testid = "notes-cursor";
    wrap.dataset.playerId = this.c.playerKey;
    wrap.dataset.clientId = this.c.clientId;
    wrap.dataset.tag = this.c.tag ? "shown" : "hover";
    wrap.style.borderLeftColor = this.c.color;
    const tag = document.createElement("span");
    tag.className = "cm-remote-tag";
    tag.dataset.testid = "notes-cursor-tag";
    tag.textContent = this.c.label;
    tag.style.backgroundColor = this.c.color;
    wrap.appendChild(tag);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function build(cursors: readonly DrawnCursor[], docLength: number): DecorationSet {
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  for (const c of cursors)
    for (const r of c.ranges) {
      const head = Math.min(r.head, docLength);
      const from = Math.min(r.anchor, r.head, docLength);
      const to = Math.min(Math.max(r.anchor, r.head), docLength);
      if (from < to)
        marks.push({
          from,
          to,
          deco: Decoration.mark({
            attributes: {
              style: `background-color: color-mix(in srgb, ${c.color} 28%, transparent)`,
            },
          }),
        });
      marks.push({
        from: head,
        to: head,
        deco: Decoration.widget({ widget: new Caret(c), side: 1 }),
      });
    }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  const b = new RangeSetBuilder<Decoration>();
  for (const m of marks) b.add(m.from, m.to, m.deco);
  return b.finish();
}

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) if (e.is(setCursors)) next = build(e.value, tr.state.doc.length);
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  // r1: above the text and the line above it in every theme, never clipped.
  ".cm-remote-caret": {
    position: "relative",
    zIndex: "5",
    borderLeft: "2px solid",
    marginLeft: "-1px",
    marginRight: "-1px",
  },
  ".cm-remote-tag": {
    position: "absolute",
    zIndex: "6",
    bottom: "100%",
    left: "-2px",
    padding: "0 4px",
    borderRadius: "3px 3px 3px 0",
    fontSize: "0.75rem", // r2: the kit's smallest text (`text-xs`, 12 px)
    lineHeight: "1rem",
    whiteSpace: "nowrap",
    // A list line's hanging indent (negative `text-indent`) would pull the name out of its own
    // background on the left (the tag narrower than its name): none here.
    textIndent: "0",
    color: "var(--background)",
    pointerEvents: "none",
    userSelect: "none",
    opacity: "0",
    transition: "opacity 120ms",
  },
  // A wider invisible strip to hover, so the tag can be read on demand.
  ".cm-remote-caret::after": {
    content: '""',
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "-4px",
    width: "8px",
  },
  ".cm-remote-caret[data-tag=shown] .cm-remote-tag, .cm-remote-caret:hover .cm-remote-tag": {
    opacity: "1",
  },
});

export const remoteCursors: Extension = [field, theme];
