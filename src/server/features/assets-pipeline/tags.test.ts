// ASSET §13.1 integration (IM-1): tag spelling and cap (FR-ASSET-39), built-ins (FR-ASSET-40),
// auto-tag on upload (FR-ASSET-41), `assets.setTags` (FR-ASSET-42), rename / merge / delete
// (FR-ASSET-43) and the rename crash (FR-ASSET-43 crash, review #10's restart case).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UploadResponse } from "@shared/assets-pipeline/schemas";
import {
  ASSET_INTENTS as A,
  BUILT_IN_TAG_MESSAGE,
  TAG_NOT_FOUND_MESSAGE,
  TOO_MANY_TAGS_MESSAGE,
} from "@shared/assets-pipeline/tags";
import {
  AssetIngested,
  AssetListed,
  AssetTagDeleted,
  AssetTagRenamed,
  AssetTagsSet,
} from "@shared/events/assets-pipeline";
import type { RejectFrame, ServerFrame } from "@shared/protocol/frames";
import { asc, eq, isNull } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { stateDigest } from "../../db/digest";
import { asset, dbMeta } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { TestClient } from "../../testing/harness";
import { TAGS_BACKFILL_KEY } from "./backfill";
import { INGEST, type IngestResult } from "./commands";
import { processImage } from "./image";
import { type AssetServer, form, startAssetServer, TEST_SECRET, testPng } from "./testing";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  armCrashHook(null);
  await h.stop();
});

const DM = { role: "dm" as const, secret: TEST_SECRET };

function tagForm(bytes: Uint8Array, opts: { tags?: string; listed?: string; name?: string } = {}) {
  const f = form(bytes, "image.png", opts.name);
  if (opts.listed !== undefined) f.append("listed", opts.listed);
  if (opts.tags !== undefined) f.append("tags", opts.tags);
  return f;
}
async function upload(bytes: Uint8Array, opts: Parameters<typeof tagForm>[1] = {}) {
  const res = await h.upload(tagForm(bytes, opts));
  const body = res.status < 300 ? ((await res.json()) as UploadResponse) : null;
  return { status: res.status, body, id: body?.asset.id as string };
}
const row = (id: string) => h.db.select().from(asset).where(eq(asset.id, id)).get();
const tagsOf = (id: string) => row(id)?.tags;
const logOf = (type: string) => readEventLog(h.db).filter((e) => e.type === type);
const allTags = () =>
  h.db.select({ id: asset.id, tags: asset.tags }).from(asset).orderBy(asc(asset.seq)).all();

/** Ingest a fresh image in-process (no HTTP); `seed` picks distinct bytes. */
async function ingest(
  seed: number,
  opts: { tags?: string[]; listed?: boolean; campaignId?: string } = {},
) {
  const image = await processImage(await testPng(seed));
  const r = h.s.commands.run(
    INGEST,
    {
      image,
      filename: `img-${seed}.png`,
      ...(opts.tags ? { tags: opts.tags } : {}),
      ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
    },
    { actor: { ...h.dmActor, campaignId: opts.campaignId ?? h.campaignId } },
  ) as IngestResult;
  return r.asset.id;
}

const run = (name: string, input: unknown) => h.s.commands.run(name, input, { actor: h.dmActor });
function errOf(f: () => unknown) {
  try {
    f();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a CommandError");
}

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = (await c.next(undefined, 2000)) as ServerFrame;
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

/** The last event frame caused by `name` (an intent's event arrives before its ack). */
function lastEvent(c: TestClient, name: string) {
  const f = c.frames.findLast((x) => x.type === "event" && x.cause.name === name);
  if (f?.type !== "event") throw new Error(`no ${name} frame`);
  return f;
}

/** 44 DM tags on one image each: the campaign is then at the cap (6 built-ins + 44 = 50). */
async function fillToCap(seedBase: number) {
  for (let i = 0; i < 44 / 4; i++) {
    const tags = [0, 1, 2, 3].map((k) => `dm-tag-${i * 4 + k}`);
    await ingest(seedBase + i, { tags });
  }
}

describe("tag rules (FR-ASSET-39, -40)", () => {
  test('FR-ASSET-39 spelling: "tokens" on a new image → stored "Tokens"; a DM tag keeps its first spelling', async () => {
    const a = await upload(await testPng(1), { tags: '["tokens"," act   2 "]' });
    expect(a.status).toBe(201);
    expect(tagsOf(a.id)).toEqual(["Tokens", "act 2"]);
    expect(a.body?.asset.tags).toEqual(["Tokens", "act 2"]);
    const b = await upload(await testPng(2), { tags: '["ACT 2","maps"]' });
    expect(tagsOf(b.id)).toEqual(["act 2", "Maps"]);
    run(A.setTags, { assetId: b.id, tags: ["Act 2", "PORTRAITS"] });
    expect(tagsOf(b.id)).toEqual(["act 2", "Portraits"]);
  });

  test("FR-ASSET-39 cap 50: the 6 built-ins always count; the 45th DM tag via setTags → conflict, nothing written", async () => {
    await fillToCap(100);
    const target = await ingest(150, { tags: ["Maps"] });
    const before = allTags();
    const nLog = readEventLog(h.db).length;
    expect(errOf(() => run(A.setTags, { assetId: target, tags: ["Maps", "dm-tag-45"] }))).toEqual({
      code: "conflict",
      message: TOO_MANY_TAGS_MESSAGE,
    });
    expect(allTags()).toEqual(before);
    expect(readEventLog(h.db)).toHaveLength(nLog);
    // Built-ins and existing DM tags still go on (they don't grow the set).
    run(A.setTags, { assetId: target, tags: ["Maps", "Tokens", "DM-TAG-3"] });
    expect(tagsOf(target)).toEqual(["Maps", "Tokens", "dm-tag-3"]);
    // Replacing the only holder of a DM tag with a new one keeps the count at 50.
    const sole = await ingest(151, { tags: ["Maps"] });
    run(A.setTags, { assetId: target, tags: ["Maps"] });
    const only = allTags().find((r) => r.tags?.includes("dm-tag-0"))?.id as string;
    run(A.setTags, { assetId: only, tags: ["dm-tag-1", "dm-tag-2", "dm-tag-3", "fresh"] });
    expect(tagsOf(only)).toEqual(["dm-tag-1", "dm-tag-2", "dm-tag-3", "fresh"]);
    expect(errOf(() => run(A.setTags, { assetId: sole, tags: ["dm-tag-0"] })).code).toBe(
      "conflict",
    );
  });

  test("FR-ASSET-40 built-ins: rename Tokens → invalid; delete Tokens → removed from all, still a suggestion", async () => {
    const a = await ingest(3, { tags: ["Tokens", "Portraits"] });
    const b = await ingest(4, { tags: ["tokens"], listed: false });
    expect(errOf(() => run(A.renameTag, { from: "tokens", to: "Minis" }))).toEqual({
      code: "invalid",
      message: BUILT_IN_TAG_MESSAGE,
    });
    expect(run(A.deleteTag, { tag: "TOKENS" })).toEqual({ changed: 2 });
    expect([tagsOf(a), tagsOf(b)]).toEqual([["Portraits"], []]);
    expect(logOf(AssetTagDeleted.type).map((e) => e.payload)).toEqual([
      { tag: "Tokens", assetIds: [a, b] },
    ]);
    // Not held any more → not_found; built-ins still spell new uploads.
    expect(errOf(() => run(A.deleteTag, { tag: "Tokens" }))).toEqual({
      code: "not_found",
      message: TAG_NOT_FOUND_MESSAGE,
    });
    const c = await upload(await testPng(5), { tags: '["TOKENS"]' });
    expect(tagsOf(c.id)).toEqual(["Tokens"]);
  });
});

describe("auto-tag on upload (FR-ASSET-41)", () => {
  test("FR-ASSET-41 auto-tag on upload: tags=[Tokens] → row and record; attachment with Handouts → stored, no record; tags=[1] → 400, nothing written; no field → [], never null", async () => {
    const dm = await h.live(DM);
    const a = await upload(await testPng(10), { tags: '["Tokens"]' });
    expect(a.status).toBe(201);
    expect(a.body?.droppedTags).toBeUndefined();
    expect(tagsOf(a.id)).toEqual(["Tokens"]);
    const ev = await dm.next("event");
    expect([ev.cause.name, ev.changes]).toEqual([
      AssetIngested.type,
      [{ type: "asset", id: a.id, op: "upsert", data: a.body?.asset }],
    ]);
    expect(a.body?.asset.tags).toEqual(["Tokens"]);

    const att = await upload(await testPng(11), { tags: '["Handouts"]', listed: "false" });
    expect([att.status, tagsOf(att.id)]).toEqual([201, ["Handouts"]]);
    // An attachment's event changes nothing on the wire (at most an empty-change frame).
    await Bun.sleep(100);
    expect(dm.raw()).not.toContain(att.id);
    expect(logOf(AssetIngested.type).map((e) => (e.payload as { tags: string[] }).tags)).toEqual([
      ["Tokens"],
      ["Handouts"],
    ]);

    for (const bad of [
      "[1]",
      "Tokens",
      '{"t":1}',
      '["!!!"]',
      JSON.stringify(
        Array(9)
          .fill(0)
          .map((_, i) => `t${i}`),
      ),
    ]) {
      expect([bad, (await upload(await testPng(12), { tags: bad })).status]).toEqual([bad, 400]);
    }
    expect(h.db.select().from(asset).all()).toHaveLength(2);

    const plain = await upload(await testPng(13));
    expect([plain.status, tagsOf(plain.id)]).toEqual([201, []]);
    expect(plain.body?.asset.tags).toEqual([]);
    expect(h.db.select().from(asset).where(isNull(asset.tags)).all()).toEqual([]);
  });

  test("FR-ASSET-41 re-upload adds: existing + Portraits → AssetTagsSet, DM upsert; already held → no event; an attachment listed by the same upload carries the tags", async () => {
    const dm = await h.live(DM);
    const png = await testPng(20);
    const first = await upload(png, { tags: '["Tokens"]' });
    await dm.next("event");
    const again = await upload(png, { tags: '["portraits"]' });
    expect([again.status, again.id]).toEqual([200, first.id]);
    expect(tagsOf(first.id)).toEqual(["Tokens", "Portraits"]);
    const ev = await dm.next("event");
    expect(ev.cause.name).toBe(AssetTagsSet.type);
    expect(ev.changes).toEqual([
      {
        type: "asset",
        id: first.id,
        op: "upsert",
        data: { ...first.body?.asset, tags: ["Tokens", "Portraits"] },
      },
    ]);
    expect(again.body?.asset.tags).toEqual(["Tokens", "Portraits"]);
    expect(logOf(AssetTagsSet.type).map((e) => e.payload)).toEqual([
      { assetId: first.id, tags: ["Tokens", "Portraits"] },
    ]);
    // Already held (any spelling), or no tags at all: nothing written, no event.
    for (const tags of ['["TOKENS"]', "[]", undefined]) {
      const r = await upload(png, tags === undefined ? {} : { tags });
      expect([r.status, r.id]).toEqual([200, first.id]);
    }
    await dm.expectNoFrame();
    expect(logOf(AssetTagsSet.type)).toHaveLength(1);

    // A pasted attachment (Handouts), later uploaded in a token picker: listed, both tags.
    const paste = await testPng(21);
    const att = await upload(paste, { tags: '["Handouts"]', listed: "false" });
    const listed = await upload(paste, { tags: '["Tokens"]', listed: "true" });
    expect([listed.status, listed.id, tagsOf(att.id), row(att.id)?.listed]).toEqual([
      200,
      att.id,
      ["Handouts", "Tokens"],
      true,
    ]);
    const names = [(await dm.next("event")).cause.name, (await dm.next("event")).cause.name];
    expect(names).toEqual([AssetTagsSet.type, AssetListed.type]);
    expect(listed.body?.asset.tags).toEqual(["Handouts", "Tokens"]);
  });

  test("FR-ASSET-41 cap on upload: 8 on the image + a context tag → existing, dropped image-full, no event; 44 DM tags + a new one → created with the others, dropped campaign-full", async () => {
    const dm = await h.live(DM);
    const png = await testPng(30);
    const eight = ["Tokens", "Maps", "Props", "Items", "Handouts", "a1", "a2", "a3"];
    const full = await upload(png, { tags: JSON.stringify(eight) });
    expect(tagsOf(full.id)).toEqual(eight);
    await dm.next("event");
    const again = await upload(png, { tags: '["Portraits"]' });
    expect([again.status, again.body?.droppedTags]).toEqual([
      200,
      [{ tag: "Portraits", reason: "image-full" }],
    ]);
    expect(tagsOf(full.id)).toEqual(eight);
    await dm.expectNoFrame();

    await fillToCap(300);
    const nLog = logOf(AssetIngested.type).length;
    const capped = await upload(await testPng(31), { tags: '["Maps","brand-new","a1"]' });
    expect(capped.status).toBe(201);
    expect(capped.body?.droppedTags).toEqual([{ tag: "brand-new", reason: "campaign-full" }]);
    expect(tagsOf(capped.id)).toEqual(["Maps", "a1"]);
    expect(h.hashDirs()).toContain(row(capped.id)?.hash as string);
    expect(logOf(AssetIngested.type)).toHaveLength(nLog + 1);
  });
});

describe("assets.setTags (FR-ASSET-42)", () => {
  test("FR-ASSET-42 set tags: replace; same → ack, no event, no log row; Second Campaign's asset → not_found; a player connection → forbidden", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: h.p1.linkToken });
    const id = await ingest(40, { tags: ["Tokens"] });
    await dm.next("event");
    const set = dm.intent(A.setTags, { assetId: id, tags: ["Act 2", "maps"] });
    const ack = await answer(dm, set);
    expect(ack.type).toBe("ack");
    const ev = lastEvent(dm, AssetTagsSet.type);
    expect([
      ev.cause.name,
      ev.changes.map((c) => [c.type, c.id, (c as { data?: { tags: string[] } }).data?.tags]),
    ]).toEqual([AssetTagsSet.type, [["asset", id, ["Act 2", "Maps"]]]]);
    expect(tagsOf(id)).toEqual(["Act 2", "Maps"]);
    expect(logOf(AssetTagsSet.type)).toHaveLength(1);

    // Same tags by fold and order → ack, nothing else.
    const same = dm.intent(A.setTags, { assetId: id, tags: ["act 2", "MAPS"] });
    expect((await answer(dm, same)).type).toBe("ack");
    await dm.expectNoFrame();
    expect(logOf(AssetTagsSet.type)).toHaveLength(1);
    // Reordering is a change.
    run(A.setTags, { assetId: id, tags: ["Maps", "Act 2"] });
    expect(tagsOf(id)).toEqual(["Maps", "Act 2"]);

    const foreign = await ingest(41, { campaignId: h.secondCampaignId });
    const nf = (await answer(
      dm,
      dm.intent(A.setTags, { assetId: foreign, tags: ["x"] }),
    )) as RejectFrame;
    expect([nf.type, nf.code]).toEqual(["reject", "not_found"]);
    const unknown = (await answer(
      dm,
      dm.intent(A.setTags, { assetId: "nope", tags: [] }),
    )) as RejectFrame;
    expect(unknown.code).toBe("not_found");
    const bad = (await answer(
      dm,
      dm.intent(A.setTags, { assetId: id, tags: ["!!!"] }),
    )) as RejectFrame;
    expect(bad.code).toBe("invalid");

    for (const [name, input] of [
      [A.setTags, { assetId: id, tags: [] }],
      [A.renameTag, { from: "Act 2", to: "Act 3" }],
      [A.deleteTag, { tag: "Act 2" }],
    ] as const) {
      const r = (await answer(p1, p1.intent(name, input))) as RejectFrame;
      expect([name, r.code]).toEqual([name, "forbidden"]);
    }
    expect(tagsOf(id)).toEqual(["Maps", "Act 2"]);
    // Players never got an `asset` change (hidden), nor a tag.
    expect(p1.raw()).not.toContain("Act 2");
    expect(p1.frames.some((f) => f.type === "event" && f.changes.length > 0)).toBe(false);

    // An attachment holds tags too; its event carries no change.
    const att = await ingest(42, { listed: false });
    run(A.setTags, { assetId: att, tags: ["Handouts"] });
    expect(tagsOf(att)).toEqual(["Handouts"]);
    expect(logOf(AssetTagsSet.type).at(-1)?.payload).toEqual({ assetId: att, tags: ["Handouts"] });
    await Bun.sleep(100);
    expect(dm.raw()).not.toContain(att);
  });
});

describe("rename / merge / delete (FR-ASSET-43)", () => {
  test('FR-ASSET-43 rename merges: Dungeon → Crypt renames; Dungeon → Maps merges, no duplicate; "maps" respelled; attachments too; one event, upserts only for changed listed assets; changed counts both', async () => {
    const dm = await h.live(DM);
    const a = await ingest(50, { tags: ["Dungeon", "Tokens"] });
    const b = await ingest(51, { tags: ["Maps", "dungeon"] });
    const att = await ingest(52, { tags: ["Dungeon"], listed: false });
    const other = await ingest(53, { tags: ["Props"] });
    for (let i = 0; i < 3; i++) await dm.next("event");

    expect(run(A.renameTag, { from: "DUNGEON", to: "Crypt" })).toEqual({ changed: 3 });
    expect([tagsOf(a), tagsOf(b), tagsOf(att), tagsOf(other)]).toEqual([
      ["Crypt", "Tokens"],
      ["Maps", "Crypt"],
      ["Crypt"],
      ["Props"],
    ]);
    const ev = await dm.next("event");
    expect(ev.cause.name).toBe(AssetTagRenamed.type);
    expect(ev.changes.map((c) => c.id)).toEqual([a, b]);
    expect(logOf(AssetTagRenamed.type).map((e) => e.payload)).toEqual([
      { from: "Dungeon", to: "Crypt", assetIds: [a, b, att] },
    ]);

    // Merge into a built-in: b already holds Maps → Crypt just goes.
    expect(run(A.renameTag, { from: "crypt", to: "maps" })).toEqual({ changed: 3 });
    expect([tagsOf(a), tagsOf(b), tagsOf(att)]).toEqual([["Maps", "Tokens"], ["Maps"], ["Maps"]]);
    expect(logOf(AssetTagRenamed.type).at(-1)?.payload).toEqual({
      from: "Crypt",
      to: "Maps",
      assetIds: [a, b, att],
    });
    await dm.next("event");

    // Respell a DM tag (fold-equal `to`): every holder gets the new spelling.
    run(A.setTags, { assetId: other, tags: ["Props", "act two"] });
    await dm.next("event");
    expect(run(A.renameTag, { from: "ACT TWO", to: "Act Two" })).toEqual({ changed: 1 });
    expect(tagsOf(other)).toEqual(["Props", "Act Two"]);
    const re = await dm.next("event");
    expect(re.changes.map((c) => c.id)).toEqual([other]);
    // Same spelling again: nothing to change.
    expect(run(A.renameTag, { from: "act two", to: "Act Two" })).toEqual({ changed: 0 });
    await dm.expectNoFrame();

    expect(errOf(() => run(A.renameTag, { from: "Nowhere", to: "x" }))).toEqual({
      code: "not_found",
      message: TAG_NOT_FOUND_MESSAGE,
    });
    expect(errOf(() => run(A.renameTag, { from: "Act Two", to: "!!!" })).code).toBe("invalid");
  });

  test("FR-ASSET-43 delete: from every asset (listed and attachments); one event; unknown → not_found", async () => {
    const dm = await h.live(DM);
    const a = await ingest(60, { tags: ["Act 2", "Maps"] });
    const att = await ingest(61, { tags: ["act 2"], listed: false });
    const keep = await ingest(62, { tags: ["Maps"] });
    for (let i = 0; i < 2; i++) await dm.next("event");
    const dmAnswer = await answer(dm, dm.intent(A.deleteTag, { tag: "ACT 2" }));
    expect(dmAnswer).toMatchObject({ type: "ack", result: { changed: 2 } });
    expect([tagsOf(a), tagsOf(att), tagsOf(keep)]).toEqual([["Maps"], [], ["Maps"]]);
    const ev = lastEvent(dm, AssetTagDeleted.type);
    expect([ev.cause.name, ev.changes.map((c) => c.id)]).toEqual([AssetTagDeleted.type, [a]]);
    expect(logOf(AssetTagDeleted.type).map((e) => e.payload)).toEqual([
      { tag: "Act 2", assetIds: [a, att] },
    ]);
    expect(errOf(() => run(A.deleteTag, { tag: "Act 2" })).code).toBe("not_found");
  });

  test("FR-ASSET-43 crash: assets.renameTag:before-commit → restart, every asset unchanged; review #10: an upload without tags, hard kill, restart → state:digest identical, no null row, no marker", async () => {
    await ingest(70, { tags: ["Dungeon"] });
    await ingest(71, { tags: ["Dungeon", "Maps"], listed: false });
    const before = allTags();
    const digest = stateDigest(h.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: A.renameTag }, (where) => {
      throw new Error(`killed at ${where}`);
    });
    expect(errOf(() => run(A.renameTag, { from: "Dungeon", to: "Crypt" })).code).toBe("internal");
    armCrashHook(null);
    await h.restart();
    expect(allTags()).toEqual(before);
    expect(stateDigest(h.db.$client).sha256).toBe(digest);

    // Review #10: an upload with no tags writes [], so a restart (backfill hook) changes nothing.
    const plain = await upload(await testPng(72));
    expect(tagsOf(plain.id)).toEqual([]);
    const afterUpload = stateDigest(h.db.$client).sha256;
    await h.restart();
    expect(stateDigest(h.db.$client).sha256).toBe(afterUpload);
    expect(h.db.select().from(asset).where(isNull(asset.tags)).all()).toEqual([]);
    expect(
      h.db.select().from(dbMeta).where(eq(dbMeta.key, TAGS_BACKFILL_KEY)).get(),
    ).toBeUndefined();
  });
});
