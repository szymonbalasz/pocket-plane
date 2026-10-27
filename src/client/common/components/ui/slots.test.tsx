// ADR-0069 / theme-system T0: every exported part of `components/ui/` renders a `data-slot`, the
// hook a theme stylesheet keys on (names: theme-system §8, T0 note). A new export fails here until
// it gets a slot, or a listed reason why it renders no element of its own. Static server render;
// portal contents are rendered in place (`Unportal`), since a portal renders nothing on the server.
import { describe, expect, test } from "bun:test";
import {
  Dialog as RD,
  DropdownMenu as RDM,
  Popover as RP,
  Select as RS,
  Tooltip as RT,
} from "radix-ui";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as button from "./button";
import * as controls from "./controls";
import * as menus from "./menus";
import * as overlays from "./overlays";
import * as primitives from "./primitives";
import * as progress from "./progress";
import * as roving from "./roving";
import * as scrollArea from "./scroll-area";
import * as tabs from "./tabs";
import * as toggleTip from "./toggle-tip";

const PORTALS = new Set<unknown>([RD.Portal, RDM.Portal, RP.Portal, RS.Portal, RT.Portal]);

/** `node` with every Radix portal replaced by its children. */
function strip(node: React.ReactNode): React.ReactNode {
  if (Array.isArray(node)) return node.map(strip);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (PORTALS.has(node.type)) return strip(node.props.children);
  if (node.props.children === undefined) return node;
  const kids = strip(node.props.children);
  // Spread, so static children stay static (no key warnings).
  return Array.isArray(kids)
    ? React.cloneElement(node, undefined, ...kids)
    : React.cloneElement(node, undefined, kids);
}

/** Renders part `C` with its own portal opened in place (hooks run as this component's). */
function Unportal<P>({ C, p }: { C: (p: P) => React.ReactNode; p: P }) {
  const out = strip(C(p));
  return Array.isArray(out) ? React.createElement(React.Fragment, null, ...out) : out;
}

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const slots = (markup: string) => [...markup.matchAll(/data-slot="([^"]*)"/g)].map((m) => m[1]);

function menuTree(m: typeof menus) {
  return (
    <m.DropdownMenu open>
      <m.DropdownMenuTrigger>t</m.DropdownMenuTrigger>
      <Unportal
        C={m.DropdownMenuContent}
        p={{
          children: (
            <>
              <m.DropdownMenuLabel>l</m.DropdownMenuLabel>
              <m.DropdownMenuItem>i</m.DropdownMenuItem>
              <m.DropdownMenuSeparator />
              <m.DropdownMenuRadioGroup value="a">
                <m.DropdownMenuRadioItem value="a">a</m.DropdownMenuRadioItem>
              </m.DropdownMenuRadioGroup>
              <m.DropdownMenuSub open>
                <m.DropdownMenuSubTrigger>s</m.DropdownMenuSubTrigger>
                <Unportal C={m.DropdownMenuSubContent} p={{ children: "sub" }} />
              </m.DropdownMenuSub>
            </>
          ),
        }}
      />
    </m.DropdownMenu>
  );
}

function dialogTree() {
  const o = overlays;
  return (
    <o.Dialog open>
      <o.DialogTrigger>t</o.DialogTrigger>
      <Unportal
        C={o.DialogContent}
        p={{
          children: (
            <>
              <o.DialogHeader>
                <o.DialogTitle>title</o.DialogTitle>
                <o.DialogDescription>d</o.DialogDescription>
              </o.DialogHeader>
              <o.DialogFooter>
                <o.DialogClose>c</o.DialogClose>
              </o.DialogFooter>
            </>
          ),
        }}
      />
    </o.Dialog>
  );
}

function selectTree() {
  const o = overlays;
  return (
    <o.Select open value="a">
      <o.SelectTrigger>
        <o.SelectValue />
      </o.SelectTrigger>
      <Unportal
        C={o.SelectContent}
        p={{
          children: (
            <>
              <o.SelectItem value="a">A</o.SelectItem>
              <o.SelectGroup>
                <o.SelectLabel>G</o.SelectLabel>
              </o.SelectGroup>
            </>
          ),
        }}
      />
    </o.Select>
  );
}

function popoverTree(m: typeof controls | typeof menus) {
  return (
    <m.Popover open>
      <m.PopoverAnchor />
      <m.PopoverTrigger>t</m.PopoverTrigger>
      <Unportal
        C={m.PopoverContent}
        p={{ children: m === controls ? <controls.PopoverClose>x</controls.PopoverClose> : "x" }}
      />
    </m.Popover>
  );
}

const tooltipTree = () => (
  <overlays.TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <RT.Root open>
      <Unportal C={overlays.TooltipContent} p={{ children: "hint" }} />
    </RT.Root>
  </overlays.TooltipProvider>
);

type Case = { render: () => React.ReactElement; slots: string[] };
type Spec = {
  /** Export → how to render it and the slots it must render. */
  parts: Record<string, Case>;
  /** Exports that render no element of their own (context roots), with the reason. */
  noElement?: Record<string, string>;
  /** Exports that are not components. */
  notParts?: string[];
};

const ROOT = "context root: renders no element (Radix)";

const MODULES: Record<string, { mod: Record<string, unknown>; spec: Spec }> = {
  button: {
    mod: button,
    spec: {
      parts: { Button: { render: () => <button.Button>b</button.Button>, slots: ["button"] } },
    },
  },
  controls: {
    mod: controls,
    spec: {
      parts: {
        PopoverTrigger: { render: () => popoverTree(controls), slots: ["popover-trigger"] },
        PopoverAnchor: { render: () => popoverTree(controls), slots: ["popover-anchor"] },
        PopoverClose: { render: () => popoverTree(controls), slots: ["popover-close"] },
        PopoverContent: { render: () => popoverTree(controls), slots: ["popover-content"] },
        Switch: { render: () => <controls.Switch />, slots: ["switch", "switch-thumb"] },
        Checkbox: {
          render: () => <controls.Checkbox checked />,
          slots: ["checkbox", "checkbox-indicator"],
        },
        ToggleGroup: {
          render: () => (
            <controls.ToggleGroup type="single">
              <controls.ToggleGroupItem value="a">a</controls.ToggleGroupItem>
            </controls.ToggleGroup>
          ),
          slots: ["toggle-group"],
        },
        ToggleGroupItem: {
          render: () => (
            <controls.ToggleGroup type="single">
              <controls.ToggleGroupItem value="a">a</controls.ToggleGroupItem>
            </controls.ToggleGroup>
          ),
          slots: ["toggle-group-item"],
        },
      },
      noElement: { Popover: ROOT },
      notParts: ["returnFocusToAnchor"],
    },
  },
  menus: {
    mod: menus,
    spec: {
      parts: {
        DropdownMenuTrigger: { render: () => menuTree(menus), slots: ["dropdown-menu-trigger"] },
        DropdownMenuContent: { render: () => menuTree(menus), slots: ["dropdown-menu-content"] },
        DropdownMenuItem: { render: () => menuTree(menus), slots: ["dropdown-menu-item"] },
        DropdownMenuSeparator: {
          render: () => menuTree(menus),
          slots: ["dropdown-menu-separator"],
        },
        DropdownMenuLabel: { render: () => menuTree(menus), slots: ["dropdown-menu-label"] },
        DropdownMenuRadioGroup: {
          render: () => menuTree(menus),
          slots: ["dropdown-menu-radio-group"],
        },
        DropdownMenuRadioItem: {
          render: () => menuTree(menus),
          slots: ["dropdown-menu-radio-item"],
        },
        DropdownMenuSubTrigger: {
          render: () => menuTree(menus),
          slots: ["dropdown-menu-sub-trigger"],
        },
        DropdownMenuSubContent: {
          render: () => menuTree(menus),
          slots: ["dropdown-menu-sub-content"],
        },
        PopoverAnchor: { render: () => popoverTree(menus), slots: ["popover-anchor"] },
        PopoverTrigger: { render: () => popoverTree(menus), slots: ["popover-trigger"] },
        PopoverContent: { render: () => popoverTree(menus), slots: ["popover-content"] },
        ToggleGroup: {
          render: () => (
            <menus.ToggleGroup type="single">
              <menus.ToggleGroupItem value="a">a</menus.ToggleGroupItem>
            </menus.ToggleGroup>
          ),
          slots: ["toggle-group", "toggle-group-item"],
        },
        ToggleGroupItem: {
          render: () => (
            <menus.ToggleGroup type="single">
              <menus.ToggleGroupItem value="a">a</menus.ToggleGroupItem>
            </menus.ToggleGroup>
          ),
          slots: ["toggle-group-item"],
        },
        Switch: { render: () => <menus.Switch />, slots: ["switch", "switch-thumb"] },
        Slider: {
          render: () => <menus.Slider defaultValue={[50]} />,
          slots: ["slider", "slider-track", "slider-range", "slider-thumb"],
        },
        Collapsible: {
          render: () => (
            <menus.Collapsible open>
              <menus.CollapsibleTrigger>t</menus.CollapsibleTrigger>
              <menus.CollapsibleContent>c</menus.CollapsibleContent>
            </menus.Collapsible>
          ),
          slots: ["collapsible", "collapsible-trigger", "collapsible-content"],
        },
        CollapsibleTrigger: {
          render: () => (
            <menus.Collapsible>
              <menus.CollapsibleTrigger>t</menus.CollapsibleTrigger>
            </menus.Collapsible>
          ),
          slots: ["collapsible-trigger"],
        },
        CollapsibleContent: {
          render: () => (
            <menus.Collapsible open>
              <menus.CollapsibleContent>c</menus.CollapsibleContent>
            </menus.Collapsible>
          ),
          slots: ["collapsible-content"],
        },
      },
      noElement: { DropdownMenu: ROOT, DropdownMenuSub: ROOT, Popover: ROOT },
    },
  },
  overlays: {
    mod: overlays,
    spec: {
      parts: {
        DialogTrigger: { render: dialogTree, slots: ["dialog-trigger"] },
        DialogContent: {
          render: dialogTree,
          slots: ["dialog-overlay", "dialog-content", "dialog-close"],
        },
        DialogHeader: { render: dialogTree, slots: ["dialog-header"] },
        DialogFooter: { render: dialogTree, slots: ["dialog-footer"] },
        DialogTitle: { render: dialogTree, slots: ["dialog-title"] },
        DialogDescription: { render: dialogTree, slots: ["dialog-description"] },
        DialogClose: { render: dialogTree, slots: ["dialog-close"] },
        SelectTrigger: { render: selectTree, slots: ["select-trigger"] },
        SelectValue: { render: selectTree, slots: ["select-value"] },
        SelectContent: { render: selectTree, slots: ["select-content"] },
        SelectItem: { render: selectTree, slots: ["select-item", "select-item-indicator"] },
        SelectGroup: { render: selectTree, slots: ["select-group"] },
        SelectLabel: { render: selectTree, slots: ["select-label"] },
        TooltipContent: { render: tooltipTree, slots: ["tooltip-content"] },
      },
      noElement: {
        Dialog: ROOT,
        Select: ROOT,
        TooltipProvider: ROOT,
        Tooltip:
          "its trigger is the caller's child (asChild); its bubble is TooltipContent (tooltip-content)",
      },
      notParts: [
        "TOOLTIP_DELAY_MS",
        "TOOLTIP_SKIP_DELAY_MS",
        "OVERLAY_OPEN_ATTR",
        "overlayOpenOn",
        "TooltipGroup",
        "TooltipController",
        "splitDialogClasses",
        "focusOnOpen",
      ],
    },
  },
  primitives: {
    mod: primitives,
    spec: {
      parts: Object.fromEntries(
        (
          [
            ["Input", <primitives.Input key="i" />, "input"],
            ["Label", <primitives.Label key="l" />, "label"],
            ["Badge", <primitives.Badge key="b" />, "badge"],
            ["Card", <primitives.Card key="c" />, "card"],
            ["CardHeader", <primitives.CardHeader key="ch" />, "card-header"],
            ["CardTitle", <primitives.CardTitle key="ct" />, "card-title"],
            ["CardContent", <primitives.CardContent key="cc" />, "card-content"],
            ["Alert", <primitives.Alert key="a" />, "alert"],
            ["Skeleton", <primitives.Skeleton key="s" />, "skeleton"],
          ] as const
        )
          .map(([name, el, slot]): [string, Case] => [name, { render: () => el, slots: [slot] }])
          .concat(
            (
              [
                ["Table", "table"],
                ["TableHeader", "table-header"],
                ["TableBody", "table-body"],
                ["TableRow", "table-row"],
                ["TableHead", "table-head"],
                ["TableCell", "table-cell"],
              ] as const
            ).map(([name, slot]): [string, Case] => [
              name,
              {
                render: () => (
                  <primitives.Table>
                    <primitives.TableHeader>
                      <primitives.TableRow>
                        <primitives.TableHead>h</primitives.TableHead>
                      </primitives.TableRow>
                    </primitives.TableHeader>
                    <primitives.TableBody>
                      <primitives.TableRow>
                        <primitives.TableCell>c</primitives.TableCell>
                      </primitives.TableRow>
                    </primitives.TableBody>
                  </primitives.Table>
                ),
                slots: [slot],
              },
            ]),
          ),
      ),
    },
  },
  progress: {
    mod: progress,
    spec: {
      parts: {
        Progress: {
          render: () => <progress.Progress value={40} />,
          slots: ["progress", "progress-indicator"],
        },
      },
    },
  },
  "scroll-area": {
    mod: scrollArea,
    spec: {
      parts: {
        ScrollArea: {
          render: () => <scrollArea.ScrollArea>x</scrollArea.ScrollArea>,
          slots: ["scroll-area", "scroll-area-viewport"],
        },
        ScrollBar: {
          render: () => (
            <scrollArea.ScrollArea type="always">
              <scrollArea.ScrollBar />
            </scrollArea.ScrollArea>
          ),
          slots: ["scroll-area"],
        },
      },
    },
  },
  tabs: {
    mod: tabs,
    spec: {
      parts: Object.fromEntries(
        (
          [
            ["Tabs", "tabs"],
            ["TabsList", "tabs-list"],
            ["TabsTrigger", "tabs-trigger"],
            ["TabsContent", "tabs-content"],
          ] as const
        ).map(([name, slot]): [string, Case] => [
          name,
          {
            render: () => (
              <tabs.Tabs value="a">
                <tabs.TabsList>
                  <tabs.TabsTrigger value="a">a</tabs.TabsTrigger>
                </tabs.TabsList>
                <tabs.TabsContent value="a">c</tabs.TabsContent>
              </tabs.Tabs>
            ),
            slots: [slot],
          },
        ]),
      ),
    },
  },
  "toggle-tip": {
    mod: toggleTip,
    spec: {
      parts: {
        ToggleTip: {
          render: () => (
            <overlays.TooltipProvider delayDuration={0} skipDelayDuration={0}>
              <toggleTip.ToggleTip content="hint">
                <button type="button">b</button>
              </toggleTip.ToggleTip>
            </overlays.TooltipProvider>
          ),
          slots: ["toggle-tip"],
        },
      },
    },
  },
  roving: { mod: roving, spec: { parts: {}, notParts: Object.keys(roving) } },
};

describe("ADR-0069 data-slot on every components/ui part (ADR-0069)", () => {
  for (const [file, { mod, spec }] of Object.entries(MODULES)) {
    test(`ADR-0069 ${file}: every export is a slotted part, a context root or not a part`, () => {
      const listed = [
        ...Object.keys(spec.parts),
        ...Object.keys(spec.noElement ?? {}),
        ...(spec.notParts ?? []),
      ].sort();
      expect(listed).toEqual(Object.keys(mod).sort());
    });

    for (const [name, c] of Object.entries(spec.parts)) {
      test(`ADR-0069 ${file}.${name} renders data-slot ${c.slots.join(", ")}`, () => {
        const found = slots(html(c.render()));
        for (const s of c.slots) expect(found).toContain(s);
      });
    }
  }

  test("ADR-0069 slot names are kebab-case", () => {
    const all = Object.values(MODULES).flatMap(({ spec }) =>
      Object.values(spec.parts).flatMap((c) => c.slots),
    );
    for (const s of all) expect(s).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  test("ADR-0069 a Button keeps its slot as an asChild trigger's child", () => {
    const markup = html(
      <menus.DropdownMenu>
        <menus.DropdownMenuTrigger asChild>
          <button.Button>b</button.Button>
        </menus.DropdownMenuTrigger>
      </menus.DropdownMenu>,
    );
    expect(slots(markup)).toEqual(["button"]);
  });

  test("ADR-0069 a caller's data-slot wins on a Button (the sheet's sheet-roll, FR-CHARX-119)", () => {
    expect(slots(html(<button.Button data-slot="sheet-roll">r</button.Button>))).toEqual([
      "sheet-roll",
    ]);
    const asChild = html(
      <overlays.Dialog>
        <overlays.DialogTrigger asChild>
          <span data-slot="sheet-roll">r</span>
        </overlays.DialogTrigger>
      </overlays.Dialog>,
    );
    expect(slots(asChild)).toEqual(["sheet-roll"]);
  });

  test("ADR-0069 a caller's data-slot still wins on an Input (dice tray slots)", () => {
    expect(slots(html(<primitives.Input data-slot="2" />))).toEqual(["2"]);
  });
});
