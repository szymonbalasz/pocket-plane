// A menu opened by right-click opens on the press on Linux / macOS (contextmenu fires on
// mousedown there); the same button's release must not pick the item under the cursor (found by
// CI on Linux: the prop menu's release opened "Change prop image", e2e scene-tools-props).
import { expect, test } from "bun:test";
import type * as React from "react";
import { DropdownMenuContent } from "./menus";

type Capture = (e: { button: number; preventDefault(): void }) => void;

function captureHandler(own?: Capture): Capture {
  const portal = DropdownMenuContent({
    onPointerUpCapture: own as unknown as React.PointerEventHandler<HTMLDivElement>,
  });
  const content = (portal as React.ReactElement<{ children: React.ReactElement }>).props.children;
  return (content.props as { onPointerUpCapture: Capture }).onPointerUpCapture;
}

test("menus: a right-button release never selects a menu item; other releases pass through", () => {
  const calls: number[] = [];
  const handler = captureHandler((e) => calls.push(e.button));
  let prevented = 0;
  const ev = (button: number) => ({ button, preventDefault: () => prevented++ });
  handler(ev(2));
  expect(prevented).toBe(1);
  handler(ev(0));
  handler(ev(1));
  expect(prevented).toBe(1);
  expect(calls).toEqual([2, 0, 1]); // the caller's own capture handler still runs
});
