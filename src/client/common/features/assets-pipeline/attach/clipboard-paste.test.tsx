// FR-ASSET-71 (unit): the Paste button's clipboard read and queue rules over plain stand-ins, and
// where the button renders (static renders; the clipboard stubbed on `navigator`). Real Ctrl+V in
// the picker and the Paste button in a browser: e2e/image-attach.e2e.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { sampleLibrary } from "@shared/assets-pipeline/sample-library";
import { AssetPicker } from "../AssetPicker";
import { fakeUploader, renderInSync, stubImageForFile, tagOf } from "../picker-test-kit";
import type { UploadOutcome } from "../upload";
import {
  CLIPBOARD_DENIED,
  type ClipboardItemLike,
  type ClipboardLike,
  NO_CLIPBOARD_IMAGE,
  readClipboardImages,
} from "./clipboard-read";
import { pasteFromClipboard } from "./handlers";
import { ImageAttach } from "./ImageAttach";
import { AttachQueue, type AttachStatus, IDLE_STATUS } from "./queue";

stubImageForFile();

const item = (...types: string[]): ClipboardItemLike => ({
  types,
  getType: async (t) => new Blob(["x"], { type: t }),
});
const clip = (items: ClipboardItemLike[]): ClipboardLike => ({ read: async () => items });
const refused: ClipboardLike = {
  read: async () => {
    throw new DOMException("denied", "NotAllowedError");
  },
};

describe("FR-ASSET-71 clipboard read", () => {
  test("FR-ASSET-71 reads one image per item in a supported format", async () => {
    const r = await readClipboardImages(
      clip([item("text/html", "image/png"), item("image/jpeg"), item("text/plain")]),
    );
    expect(r.kind).toBe("images");
    if (r.kind !== "images") return;
    expect(r.files.map((f) => [f.name, f.type])).toEqual([
      ["pasted.png", "image/png"],
      ["pasted.jpg", "image/jpeg"],
    ]);
  });

  test("FR-ASSET-71 text only or unsupported image format → empty", async () => {
    expect((await readClipboardImages(clip([item("text/plain")]))).kind).toBe("empty");
    expect((await readClipboardImages(clip([item("image/gif")]))).kind).toBe("empty");
    expect((await readClipboardImages(clip([]))).kind).toBe("empty");
  });

  test("FR-ASSET-71 permission refused → denied", async () => {
    expect((await readClipboardImages(refused)).kind).toBe("denied");
  });
});

describe("FR-ASSET-71 Paste button queue", () => {
  function harness(free = 4) {
    const sent: { name: string; opts: unknown }[] = [];
    let status: AttachStatus = IDLE_STATUS;
    const queue = new AttachQueue({
      upload: async (file, opts) => {
        sent.push({ name: file.name, opts });
        return { kind: "ok", outcome: "created", asset: { id: "A" } } as UploadOutcome;
      },
      onAdd: () => {},
      onChange: (s) => {
        status = s;
      },
    });
    const gate = (disabled = false) => ({
      queue,
      free,
      max: 4,
      disabled,
      now: () => new Date(2026, 10, 7, 9, 30),
    });
    return { sent, gate, status: () => status };
  }

  test("FR-ASSET-71 clipboard images upload as attachments named like a Ctrl+V paste", async () => {
    const h = harness();
    await pasteFromClipboard(clip([item("image/png")]), h.gate());
    await Bun.sleep(0);
    expect(h.sent).toEqual([
      { name: "pasted.png", opts: { listed: false, name: "Pasted image 2026-11-07 09:30" } },
    ]);
  });

  test("FR-ASSET-71 no image / refused / full → one error line, nothing sent", async () => {
    const empty = harness();
    await pasteFromClipboard(clip([item("text/plain")]), empty.gate());
    expect(empty.status().errors).toEqual([NO_CLIPBOARD_IMAGE]);

    const denied = harness();
    await pasteFromClipboard(refused, denied.gate());
    expect(denied.status().errors).toEqual([CLIPBOARD_DENIED]);

    const full = harness(0);
    await pasteFromClipboard(clip([item("image/png")]), full.gate());
    expect(full.status().errors).toEqual(["No more images (4)"]);

    const off = harness();
    await pasteFromClipboard(clip([item("image/png")]), off.gate(true));
    expect([...empty.sent, ...denied.sent, ...full.sent, ...off.sent]).toEqual([]);
  });
});

describe("FR-ASSET-71 Paste button placement", () => {
  const lib = sampleLibrary();
  const nav = globalThis.navigator as { clipboard?: unknown };
  const had = Object.getOwnPropertyDescriptor(nav, "clipboard");
  const withClipboard = (c: unknown) =>
    Object.defineProperty(nav, "clipboard", { value: c, configurable: true });
  afterEach(() => {
    if (had) Object.defineProperty(nav, "clipboard", had);
    else delete nav.clipboard;
  });
  const { uploader } = fakeUploader(lib[0] as (typeof lib)[number]);
  const attach = () =>
    renderInSync(<ImageAttach max={4} count={0} owner="t" onAdd={() => {}} />, lib, { uploader });
  const picker = (state?: "live" | "reconnecting") =>
    renderInSync(<AssetPicker onSelect={() => {}} />, lib, {
      uploader,
      ...(state ? { state } : {}),
    });

  test("FR-ASSET-71 readable clipboard → Paste in the attach control and the picker", () => {
    withClipboard(clip([]));
    expect(tagOf(attach(), "asset-attach-paste")).not.toBe("");
    expect(tagOf(picker(), "asset-picker-paste")).not.toBe("");
    expect(picker()).toContain("or drop / paste an image");
  });

  test("FR-ASSET-71 picker Paste disabled while not live (as Upload)", () => {
    withClipboard(clip([]));
    expect(tagOf(picker("reconnecting"), "asset-picker-paste")).toContain('disabled=""');
  });

  test("FR-ASSET-71 no async clipboard (plain http) → no Paste button; Ctrl+V still works", () => {
    withClipboard(undefined);
    expect(attach()).not.toContain("asset-attach-paste");
    expect(picker()).not.toContain("asset-picker-paste");
  });
});
