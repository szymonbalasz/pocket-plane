// Test support for assets-pipeline: a real server (port 0, :memory: DB) with its own temp
// asset dir, seed campaigns, upload helpers and generated images.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Db } from "../../db/client";
import { openTestDb } from "../../db/testing";
import { type Logger, silentLogger } from "../../log";
import { type RunningServer, startServer } from "../../server";
import { connectClient, type TestClient } from "../../testing/harness";
import { createTestServices, DM_ACTOR, TEST_SECRET } from "../../testing/services";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { DB_MARKER } from "./store";

export { TEST_SECRET };

/** Solid-colour PNG; `seed` picks a colour so images differ by hash. */
export function testPng(seed = 0, w = 64, h = 48): Promise<Buffer> {
  const r = (seed * 53) % 256;
  const g = (seed * 97 + 40) % 256;
  const b = (seed * 151 + 80) % 256;
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

export const svgBytes = (attrs: string, body = '<rect width="100%" height="100%" fill="#363"/>') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);

export function form(bytes: Uint8Array, filename: string, name?: string): FormData {
  const f = new FormData();
  f.append("file", new File([new Uint8Array(bytes)], filename));
  if (name !== undefined) f.append("name", name);
  return f;
}

export interface AssetServerOptions {
  testMode?: boolean;
  log?: Logger;
}

export async function startAssetServer(opts: AssetServerOptions = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-assets-"));
  const assetDir = path.join(dir, "assets");
  const db: Db = openTestDb();
  const config = createTestServices({
    testMode: opts.testMode ?? false,
    db,
    env: { PP_ASSET_DIR: assetDir },
  }).config;
  const boot = () => startServer({ config, log: opts.log ?? silentLogger, db, lock: false });
  let running: RunningServer = await boot();
  const clients: TestClient[] = [];

  const run = running.services.commands.run.bind(running.services.commands);
  const campaign = run(createCampaign, { name: "Fixture Campaign" }, { actor: DM_ACTOR });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: DM_ACTOR });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: DM_ACTOR });
  const second = run(createCampaign, { name: "Second Campaign" }, { actor: DM_ACTOR });

  const h = {
    db,
    dir,
    assetDir,
    config,
    campaignId: campaign.id,
    secondCampaignId: second.id,
    p1,
    p2,
    dmActor: { ...DM_ACTOR, campaignId: campaign.id },
    get s() {
      return running.services;
    },
    get http() {
      return `http://127.0.0.1:${running.port}`;
    },
    get ws() {
      return `ws://127.0.0.1:${running.port}/ws`;
    },
    activate(id: string) {
      running.services.commands.run(activateCampaign, { id }, { actor: DM_ACTOR });
    },
    upload(body: FormData, auth: string | null = TEST_SECRET) {
      return fetch(`${h.http}/api/assets`, {
        method: "POST",
        headers: auth === null ? {} : { Authorization: `Bearer ${auth}` },
        body,
      });
    },
    get(id: string, file: string, headers: Record<string, string> = {}) {
      return fetch(`${h.http}/api/assets/${id}/${file}`, { headers });
    },
    async live(credential: Parameters<typeof connectClient>[1]) {
      const c = await connectClient(h.ws, credential);
      clients.push(c);
      await c.next("snapshot");
      return c;
    },
    /** Hash dirs on disk (ignores `.tmp`). */
    hashDirs: () => {
      try {
        return readdirSync(assetDir).filter((n) => /^[0-9a-f]{64}$/.test(n));
      } catch {
        return [];
      }
    },
    /** Everything on disk except the DB marker (#163). */
    entries: () => {
      try {
        return readdirSync(assetDir).filter((n) => n !== DB_MARKER);
      } catch {
        return [];
      }
    },
    async restart() {
      for (const c of clients) c.close();
      await running.stop();
      running = await boot();
    },
    async stop() {
      for (const c of clients) c.close();
      await running.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

export type AssetServer = Awaited<ReturnType<typeof startAssetServer>>;
