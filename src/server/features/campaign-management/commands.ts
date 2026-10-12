// campaign-management commands (CAMP §6, §9). All DM-only; REST and fixtures call them.
import {
  AddPlayerBody,
  CreateCampaignBody,
  nameKey,
  RenameCampaignBody,
  RenamePlayerBody,
} from "@shared/campaign-management/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand, IdSchema } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { campaign, player } from "../../db/schema";
import { toCampaignRecord, toPlayerRecord } from "./records";

export function activeCampaign(tx: Pick<Tx, "select">) {
  return tx.select().from(campaign).where(eq(campaign.active, true)).get() ?? null;
}

function assertCampaignNameFree(tx: Tx, name: string, exceptId?: string) {
  const key = nameKey(name);
  const clash = tx
    .select({ id: campaign.id, name: campaign.name })
    .from(campaign)
    .all()
    .some((c) => c.id !== exceptId && nameKey(c.name) === key);
  if (clash) throw conflict("A campaign with that name already exists");
}

function assertPlayerNameFree(tx: Tx, campaignId: string, name: string, exceptId?: string) {
  const key = nameKey(name);
  const clash = tx
    .select({ id: player.id, name: player.name })
    .from(player)
    .where(eq(player.campaignId, campaignId))
    .all()
    .some((p) => p.id !== exceptId && nameKey(p.name) === key);
  if (clash) throw conflict("A player with that name already exists in this campaign");
}

/** FR-CAMP-06; first campaign while none is active becomes active (CON-10). */
export const createCampaign = defineCommand({
  name: "campaign.create",
  input: CreateCampaignBody,
  execute({ name }, { tx, ctx, emit }) {
    assertCampaignNameFree(tx, name);
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    const becomesActive = activeCampaign(tx) === null;
    tx.insert(campaign)
      .values({ id, name, active: becomesActive, createdAt: now, updatedAt: now })
      .run();
    const rec = toCampaignRecord({ id, name });
    emit({
      type: "CampaignCreated",
      campaignId: id,
      payload: { campaignId: id, name },
      changes: [{ type: "campaign", id, before: null, after: rec }],
    });
    if (becomesActive) {
      emit({
        type: "CampaignActivated",
        campaignId: id,
        payload: { campaignId: id, previousCampaignId: null },
        changes: [],
      });
    }
    return { id, name, active: becomesActive };
  },
});

/** FR-CAMP-10 */
export const renameCampaign = defineCommand({
  name: "campaign.rename",
  input: RenameCampaignBody.extend({ id: IdSchema }),
  execute({ id, name }, { tx, ctx, emit }) {
    const row = tx.select().from(campaign).where(eq(campaign.id, id)).get();
    if (!row) throw notFound("Campaign not found");
    assertCampaignNameFree(tx, name, id);
    tx.update(campaign).set({ name, updatedAt: ctx.clock.iso() }).where(eq(campaign.id, id)).run();
    emit({
      type: "CampaignRenamed",
      campaignId: id,
      payload: { campaignId: id, name },
      changes: [
        {
          type: "campaign",
          id,
          before: toCampaignRecord(row),
          after: toCampaignRecord({ id, name }),
        },
      ],
    });
    return { id, name, active: row.active };
  },
});

/** FR-CAMP-09: one transaction flips both flags. */
export const activateCampaign = defineCommand({
  name: "campaign.activate",
  input: z.object({ id: IdSchema }),
  execute({ id }, { tx, ctx, emit }) {
    const row = tx.select().from(campaign).where(eq(campaign.id, id)).get();
    if (!row) throw notFound("Campaign not found");
    if (row.active) return { id, name: row.name, active: true };
    const prev = activeCampaign(tx);
    const now = ctx.clock.iso();
    if (prev) {
      tx.update(campaign)
        .set({ active: false, updatedAt: now })
        .where(eq(campaign.id, prev.id))
        .run();
    }
    tx.update(campaign).set({ active: true, updatedAt: now }).where(eq(campaign.id, id)).run();
    emit({
      type: "CampaignActivated",
      campaignId: id,
      payload: { campaignId: id, previousCampaignId: prev?.id ?? null },
      changes: [],
    });
    return { id, name: row.name, active: true };
  },
});

/** FR-CAMP-12/13: adds to the active campaign; token from ctx.tokens. */
export const addPlayer = defineCommand({
  name: "player.add",
  input: AddPlayerBody,
  execute({ name }, { tx, ctx, emit }) {
    const active = activeCampaign(tx);
    if (!active) throw conflict("No active campaign");
    assertPlayerNameFree(tx, active.id, name);
    const id = ctx.ids.next();
    let linkToken = ctx.tokens.next();
    while (tx.select().from(player).where(eq(player.linkToken, linkToken)).get()) {
      linkToken = ctx.tokens.next();
    }
    const now = ctx.clock.iso();
    tx.insert(player)
      .values({ id, campaignId: active.id, name, linkToken, createdAt: now, updatedAt: now })
      .run();
    emit({
      type: "PlayerAdded",
      campaignId: active.id,
      payload: { playerId: id, campaignId: active.id, name },
      changes: [
        {
          type: "player",
          id,
          before: null,
          after: toPlayerRecord({ id, campaignId: active.id, name }),
        },
      ],
    });
    return { id, name, linkToken };
  },
});

/** FR-CAMP-15: token unchanged. */
export const renamePlayer = defineCommand({
  name: "player.rename",
  input: RenamePlayerBody.extend({ id: IdSchema }),
  execute({ id, name }, { tx, ctx, emit }) {
    const row = tx.select().from(player).where(eq(player.id, id)).get();
    if (!row) throw notFound("Player not found");
    assertPlayerNameFree(tx, row.campaignId, name, id);
    tx.update(player).set({ name, updatedAt: ctx.clock.iso() }).where(eq(player.id, id)).run();
    emit({
      type: "PlayerRenamed",
      campaignId: row.campaignId,
      payload: { playerId: id, campaignId: row.campaignId, name },
      changes: [
        {
          type: "player",
          id,
          before: toPlayerRecord(row),
          after: toPlayerRecord({ ...row, name }),
        },
      ],
    });
    return { id, name, linkToken: row.linkToken };
  },
});
