// Image attach control (ASSET §13 unit): queue, paste, drop, refusals over a fake uploader; the
// rendered contract as a static server render over a fake sync store. Real paste / drop events,
// the picker's Select and the Dialog portal: e2e/image-attach.e2e.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../../sync/store";
import type { UploadHandlers, UploadOptions, UploadOutcome } from "../upload";
import { type AttachUploader, AttachUploaderProvider } from "../uploader";
import { handleDragOver, handleDrop, handlePaste } from "./handlers";
import { ImageAttach, type ImageAttachProps } from "./ImageAttach";
import { pasteAction, pastedName, type TransferLike } from "./paste";
import { AttachQueue, type AttachStatus, IDLE_STATUS, progressText } from "./queue";

const PNG = "image/png";
const file = (name: string, type = PNG, size = 1000) => ({ name, type, size }) as File;

const assetOf = (id: string) => ({ id, name: id }) as AssetRecord;

interface Sent {
  file: File;
  opts: UploadOptions;
  h: UploadHandlers;
  resolved: boolean;
  resolve(o: UploadOutcome): void;
}

/** Uploads wait until the test resolves them; `sent` lists every request in order. */
function harness(max = 10) {
  const sent: Sent[] = [];
  const added: string[] = [];
  let status: AttachStatus = IDLE_STATUS;
  const inFlight = () => sent.filter((s) => !s.resolved).length;
  const queue = new AttachQueue({
    upload: (f, opts, h) =>
      new Promise<UploadOutcome>((resolve) => {
        const s: Sent = {
          file: f,
          opts,
          h,
          resolved: false,
          resolve: (o: UploadOutcome) => {
            s.resolved = true;
            resolve(o);
          },
        };
        sent.push(s);
      }),
    onAdd: (id) => added.push(id),
    onChange: (s) => {
      status = s;
    },
  });
  let count = 0;
  const gate = (disabled = false) => ({
    queue,
    free: max - count,
    max,
    disabled,
    now: () => new Date(2026, 9, 19, 14, 5),
  });
  /** Resolve the oldest open request and let the queue move on. */
  const finish = async (o: UploadOutcome) => {
    const s = sent.find((x) => !x.resolved);
    if (!s) throw new Error("nothing in flight");
    s.resolve(o);
    await Bun.sleep(0);
  };
  return {
    queue,
    sent,
    added,
    gate,
    finish,
    inFlight,
    status: () => status,
    setCount: (n: number) => {
      count = n;
    },
  };
}

const ok = (id: string, outcome: "created" | "existing" = "created"): UploadOutcome => ({
  kind: "ok",
  outcome,
  asset: assetOf(id),
});

/** A DataTransfer stand-in: plain text + files (clipboard files come through `items`). */
function transfer(text: string, files: File[], types?: string[]): TransferLike {
  return {
    types: types ?? [...(text ? ["text/plain"] : []), ...(files.length ? ["Files"] : [])],
    files,
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    getData: (fmt) => (fmt === "text/plain" ? text : ""),
  };
}

function pasteEvent(text: string, files: File[]) {
  const e = { clipboardData: transfer(text, files), prevented: false, preventDefault() {} };
  e.preventDefault = () => {
    e.prevented = true;
  };
  return e;
}

function dropEvent(files: File[], types?: string[]) {
  const e = { dataTransfer: transfer("", files, types), prevented: false, preventDefault() {} };
  e.preventDefault = () => {
    e.prevented = true;
  };
  return e;
}

describe("FR-ASSET-21 queue", () => {
  test("FR-ASSET-21 queue: one request at a time, listed=false, onAdd in order", async () => {
    const h = harness();
    h.queue.add(
      [{ file: file("a.png") }, { file: file("b.png") }, { file: file("c.png") }],
      10,
      10,
    );
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.opts).toEqual({ listed: false });
    expect(h.queue.pending).toBe(3);
    await h.finish(ok("A"));
    expect(h.sent).toHaveLength(2);
    expect(h.inFlight()).toBe(1);
    await h.finish(ok("B"));
    await h.finish(ok("C", "existing"));
    expect(h.added).toEqual(["A", "B", "C"]);
    expect(h.queue.pending).toBe(0);
    expect(h.status().phase).toBe("idle");
  });

  test("FR-ASSET-21 queue: 3 files with 2 slots → 2 sent + Only 2 more images", async () => {
    const h = harness(5);
    h.setCount(3);
    const g = h.gate();
    h.queue.add(
      [{ file: file("a.png") }, { file: file("b.png") }, { file: file("c.png") }],
      g.free,
      5,
    );
    expect(h.status().errors).toEqual(["Only 2 more images"]);
    await h.finish(ok("A"));
    await h.finish(ok("B"));
    expect(h.sent.map((s) => s.file.name)).toEqual(["a.png", "b.png"]);
    expect(h.added).toEqual(["A", "B"]);
  });

  test("FR-ASSET-21 queue: two quick pastes with 1 slot left → one upload, the second refused", () => {
    const h = harness(4);
    h.setCount(3);
    const first = pasteEvent("", [file("image.png")]);
    handlePaste(first, h.gate());
    const second = pasteEvent("", [file("image.png")]);
    handlePaste(second, h.gate());
    expect(first.prevented && second.prevented).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.status().errors).toEqual(["No more images (4)"]);
    // Queued (not yet sent) files count too.
    const q = harness(3);
    q.queue.add([{ file: file("a.png") }, { file: file("b.png") }], 3, 3);
    q.queue.add([{ file: file("c.png") }, { file: file("d.png") }], 3, 3);
    expect(q.queue.pending).toBe(3);
    expect(q.status().errors).toEqual(["Only 1 more image"]);
  });

  test("FR-ASSET-21 queue: progress text, then Processing…", () => {
    const h = harness();
    h.queue.add(
      [{ file: file("a.png") }, { file: file("b.png") }, { file: file("c.png") }],
      10,
      10,
    );
    h.sent[0]?.h.onProgress(45);
    expect(progressText(h.status())).toBe("Uploading 1 of 3 · 45 %");
    h.sent[0]?.h.onProcessing();
    expect(progressText(h.status())).toBe("Processing…");
    expect(progressText(IDLE_STATUS)).toBeNull();
  });

  test("FR-ASSET-21 queue: a failed middle file doesn't stop the third; network error message", async () => {
    const h = harness();
    h.queue.add(
      [{ file: file("a.png") }, { file: file("b.png") }, { file: file("c.png") }],
      10,
      10,
    );
    await h.finish(ok("A"));
    expect(progressText(h.status())).toBe("Uploading 2 of 3 · 0 %");
    await h.finish({ kind: "error", message: "Upload failed, try again" });
    await h.finish(ok("C"));
    expect(h.added).toEqual(["A", "C"]);
    expect(h.status().errors).toEqual(["b.png: Upload failed, try again"]);
    // The next add clears the errors.
    h.queue.add([{ file: file("d.png") }], 10, 10);
    expect(h.status().errors).toEqual([]);
  });

  test("FR-ASSET-21 queue: 401 drops the rest (the uploader resets the secret)", async () => {
    const h = harness();
    h.queue.add([{ file: file("a.png") }, { file: file("b.png") }], 10, 10);
    await h.finish({ kind: "unauthorized" });
    expect(h.sent).toHaveLength(1);
    expect(h.queue.pending).toBe(0);
    expect(h.added).toEqual([]);
  });
});

describe("FR-ASSET-22 paste", () => {
  test("FR-ASSET-22 paste creates an asset: PNG with no text → one POST listed=false named Pasted image …, onAdd", async () => {
    const h = harness();
    const e = pasteEvent("", [file("image.png")]);
    handlePaste(e, h.gate());
    expect(e.prevented).toBe(true); // the Textarea's value never changes
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.opts).toEqual({ listed: false, name: "Pasted image 2026-10-19 14:05" });
    await h.finish(ok("P"));
    expect(h.added).toEqual(["P"]);
  });

  test("FR-ASSET-22 paste creates an asset: plain text + image → text pasted, no POST", () => {
    const h = harness();
    for (const text of [
      "Meet at the docks",
      "https://a.example/x.png https://b.example/y.png",
      "see https://a.example/x.png",
    ]) {
      const e = pasteEvent(text, [file("image.png")]);
      handlePaste(e, h.gate());
      expect(e.prevented).toBe(false);
    }
    expect(h.sent).toHaveLength(0);
  });

  test("FR-ASSET-22 paste creates an asset: a single URL as plain text + image → POST, URL not pasted", () => {
    const h = harness();
    const e = pasteEvent("  https://cdn.example/img/poster.png\n", [file("image.png")]);
    handlePaste(e, h.gate());
    expect(e.prevented).toBe(true);
    expect(h.sent).toHaveLength(1);
  });

  test("FR-ASSET-22 paste creates an asset: empty clipboard / text only / non-image file → nothing", () => {
    const h = harness();
    for (const e of [
      pasteEvent("", []),
      pasteEvent("hello", []),
      pasteEvent("", [file("notes.txt", "text/plain")]),
    ]) {
      handlePaste(e, h.gate());
      expect(e.prevented).toBe(false);
    }
    expect(h.sent).toHaveLength(0);
    expect(h.status().errors).toEqual([]);
    expect(pasteAction("", 0)).toBe("none");
    expect(pasteAction("http://x.example/a", 1)).toBe("upload");
    expect(pasteAction("ftp://x.example/a", 1)).toBe("text");
  });

  test("FR-ASSET-22 paste with no slot left or while disabled → No more images, text untouched", () => {
    const full = harness(2);
    full.setCount(2);
    const e = pasteEvent("", [file("image.png")]);
    handlePaste(e, full.gate());
    expect(e.prevented).toBe(true);
    expect(full.status().errors).toEqual(["No more images (2)"]);
    const busy = harness();
    const e2 = pasteEvent("", [file("image.png")]);
    handlePaste(e2, busy.gate(true));
    expect(busy.sent).toHaveLength(0);
    expect(busy.status().errors).toEqual(["No more images (10)"]);
  });

  test("FR-ASSET-22 several images queue in order; a GIF → Unsupported file type", () => {
    const h = harness();
    handlePaste(
      pasteEvent("", [file("a.png"), file("b.gif", "image/gif"), file("c.webp", "image/webp")]),
      h.gate(),
    );
    expect(h.status().errors).toEqual(["Pasted image 2026-10-19 14:05: Unsupported file type"]);
    expect(h.queue.pending).toBe(2);
    expect(pastedName(new Date(2026, 0, 2, 3, 4))).toBe("Pasted image 2026-01-02 03:04");
  });
});

describe("FR-ASSET-23 drop + refusals", () => {
  test("FR-ASSET-23 drop + library: drop 2 files → queued; non-file drag ignored", async () => {
    const h = harness();
    const over = dropEvent([file("a.png"), file("b.png")]);
    expect(handleDragOver(over)).toBe(true);
    expect(over.prevented).toBe(true);
    const drop = dropEvent([file("a.png"), file("b.png")]);
    handleDrop(drop, h.gate());
    expect(drop.prevented).toBe(true);
    expect(h.queue.pending).toBe(2);
    await h.finish(ok("A"));
    await h.finish(ok("B"));
    expect(h.added).toEqual(["A", "B"]);

    const textDrag = dropEvent([], ["text/plain"]);
    expect(handleDragOver(textDrag)).toBe(false);
    expect(textDrag.prevented).toBe(false);
    handleDrop(textDrag, h.gate());
    expect(textDrag.prevented).toBe(false);
    expect(h.sent).toHaveLength(2);
  });

  test("FR-ASSET-23 refusals: .txt → Unsupported file type, 26 MB → File over 25 MB, nothing sent", () => {
    const h = harness();
    handleDrop(
      dropEvent([file("notes.txt", "text/plain"), file("huge.png", PNG, 26 * 1024 * 1024)]),
      h.gate(),
    );
    expect(h.status().errors).toEqual([
      "notes.txt: Unsupported file type",
      "huge.png: File over 25 MB",
    ]);
    expect(h.sent).toHaveLength(0);
    expect(h.queue.pending).toBe(0);
  });
});

describe("FR-ASSET-20 contract", () => {
  test("FR-ASSET-20 duplicate id: re-pasting the same bytes → onAdd with the same id, no filtering", async () => {
    const h = harness();
    handlePaste(pasteEvent("", [file("image.png")]), h.gate());
    await h.finish(ok("SAME"));
    handlePaste(pasteEvent("", [file("image.png")]), h.gate());
    await h.finish(ok("SAME", "existing"));
    expect(h.added).toEqual(["SAME", "SAME"]);
  });

  const uploader: AttachUploader = { upload: () => new Promise(() => {}) };
  function render(
    props: Partial<ImageAttachProps>,
    opts: { provider?: boolean; assets?: number } = {},
  ) {
    const records =
      (opts.assets ?? 1) > 0
        ? { asset: Object.fromEntries([["A1", { ...assetOf("A1"), createdAt: "x", seq: 1 }]]) }
        : {};
    const sync = createStore<SyncState>()(
      () =>
        ({
          state: "live",
          store: { ...emptyStore(), records },
          everLive: true,
        }) as unknown as SyncState,
    );
    const node = <ImageAttach max={10} count={0} owner="asset-test" onAdd={() => {}} {...props} />;
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          {opts.provider === false ? (
            node
          ) : (
            <AttachUploaderProvider value={uploader}>{node}</AttachUploaderProvider>
          )}
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  }
  const tag = (html: string, id: string) =>
    html.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
  const isDisabled = (html: string, id: string) => /\sdisabled=""/.test(tag(html, id));

  test("FR-ASSET-20 contract: Upload, From library, hint; owner as data-owner", () => {
    const html = render({ owner: "party-editor" });
    expect(tag(html, "asset-attach")).toContain('data-owner="party-editor"');
    expect(tag(html, "asset-attach")).toContain('data-remaining="10"');
    expect(isDisabled(html, "asset-attach-upload")).toBe(false);
    expect(isDisabled(html, "asset-attach-library")).toBe(false);
    expect(tag(html, "asset-attach-file-input")).toContain("multiple");
    expect(html).toContain("or drop / paste an image");
  });

  test("FR-ASSET-20 contract: count = max → adding disabled with No more images (max)", () => {
    const html = render({ max: 4, count: 4 });
    expect(isDisabled(html, "asset-attach-upload")).toBe(true);
    expect(isDisabled(html, "asset-attach-library")).toBe(true);
    expect(html).toContain('data-testid="asset-attach-full"');
    expect(html).toContain("No more images (4)");
  });

  test("FR-ASSET-20 contract: host disabled → Buttons disabled", () => {
    const html = render({ disabled: true });
    expect(isDisabled(html, "asset-attach-upload")).toBe(true);
    expect(isDisabled(html, "asset-attach-library")).toBe(true);
  });

  test("FR-ASSET-20 contract: library false or no asset records hides From library", () => {
    expect(render({ library: false })).not.toContain("asset-attach-library");
    expect(render({}, { assets: 0 })).not.toContain("asset-attach-library");
  });

  test("FR-ASSET-27 no player upload: no uploader provider (player client) → renders nothing", () => {
    expect(render({}, { provider: false })).toBe("");
    // Only the DM client root provides one.
    const root = (client: string) =>
      readFileSync(path.join(import.meta.dir, `../../../../${client}/main.tsx`), "utf8");
    expect(root("dm")).toContain("<DmAttachUploaderProvider>");
    expect(root("player")).not.toContain("Uploader");
  });
});
