// BL-58 / OQ-CBTX-22: with Create tokens off, "Add hidden" shows unchecked + disabled and the
// intent carries `hidden: false`; back on, the DM's earlier choice returns. Static server render.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { addOptionsState } from "../combat-tracker/join-preview";
import { AddTokenOptions, addFlags } from "./add-dialog";

/** The opening tag of the button with `data-testid=id`. */
function tagOf(html: string, id: string): string {
  return html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
}

function render(createTokens: boolean, hidden: boolean) {
  const opts = addOptionsState({ createTokens, hasScene: true });
  const html = renderToStaticMarkup(
    <AddTokenOptions opts={opts} hidden={hidden} onCreateTokens={() => {}} onHidden={() => {}} />,
  );
  return { opts, tag: tagOf(html, "cbtx-add-hidden") };
}

describe("FR-CBTX-44 Add hidden follows Create tokens", () => {
  test("FR-CBTX-44 Create tokens off → Add hidden unchecked + disabled; intent hidden false", () => {
    const { opts, tag } = render(false, true);
    expect(tag).toContain('data-state="unchecked"');
    expect(tag).toMatch(/\sdisabled=""/);
    expect(addFlags(opts, true)).toEqual({ createTokens: false, hidden: false });
  });

  test("FR-CBTX-44 Create tokens back on → the DM's earlier choice is restored", () => {
    const on = render(true, true);
    expect(on.tag).toContain('data-state="checked"');
    expect(on.tag).not.toMatch(/\sdisabled=""/);
    expect(addFlags(on.opts, true)).toEqual({ createTokens: true, hidden: true });
    const off = render(true, false);
    expect(off.tag).toContain('data-state="unchecked"');
    expect(addFlags(off.opts, false)).toEqual({ createTokens: true, hidden: false });
  });

  test("FR-CBTX-44 no scene → nothing created, intent hidden false", () => {
    const opts = addOptionsState({ createTokens: true, hasScene: false });
    expect(addFlags(opts, true)).toEqual({ createTokens: false, hidden: false });
  });
});
