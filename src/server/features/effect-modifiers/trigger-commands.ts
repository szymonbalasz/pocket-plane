// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Rule-trigger authoring (FR-MOD-32–35, -45, -46): `mod.putTrigger` / `mod.deleteTrigger` and
// the compendium's `addTriggerFromPreset`. Character triggers: DM, or the owner while the sheet
// is unlocked; definition triggers: DM. One transaction per command; the `rule-trigger` change
// rides on `RuleTriggerSaved` / `RuleTriggerDeleted` (lazy type: live events as any type).

import { BUILTIN_PRESET_KEYS } from "@shared/effect-modifiers/schemas";
import { formulaOwnerOf } from "@shared/effect-modifiers/trigger-fire";
import {
  DeleteTriggerInput,
  PutTriggerInput,
  type PutTriggerResult,
  TRIGGER_INTENTS,
} from "@shared/effect-modifiers/trigger-intents";
import { getTriggerPreset } from "@shared/effect-modifiers/trigger-presets";
import {
  CAMPAIGN_TRIGGERS_MAX,
  CHARACTER_TRIGGERS_MAX,
  DEFINITION_TRIGGERS_MAX,
  RULE_TRIGGER_TYPE,
} from "@shared/effect-modifiers/trigger-records";
import { checkRuleForOwner, TriggerRule } from "@shared/effect-modifiers/triggers";
import type { StatBlock } from "@shared/entities/schemas";
import { RuleTriggerDeleted, RuleTriggerSaved } from "@shared/events/effect-modifiers";
import type { Issue } from "@shared/protocol/codes";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound, zodIssues } from "../../commands/errors";
import { effectPreset, entity, ruleTrigger, ruleTriggerSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { editableCreature } from "../character-sheet/access";
import { getSheet } from "../character-sheet/sheet-rows";
import { resolveDefinition } from "../entities/commands";
import { campaignOf } from "./rows";
import { type RuleTriggerRow, toRuleTriggerRecord } from "./trigger-records";

type Env = CommandEnv;
type Read = Pick<Env["tx"], "select">;

export const TRIGGER_NOT_FOUND = "Trigger not found";

export function readTrigger(tx: Read, id: string): RuleTriggerRow {
  const row = tx.select().from(ruleTrigger).where(eq(ruleTrigger.id, id)).get();
  if (!row) throw new Error(`rule trigger ${id} missing`);
  return toRuleTriggerRecord(tx, row);
}

export const triggerChange = (
  before: RuleTriggerRow | null,
  after: RuleTriggerRow | null,
): RecordChange => ({
  type: RULE_TRIGGER_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** A trigger of the actor's campaign, or `not_found` (players: their characters' only). */
export function getTrigger(env: Pick<Env, "tx" | "actor">, id: string): RuleTriggerRow {
  const row = env.tx
    .select()
    .from(ruleTrigger)
    .where(and(eq(ruleTrigger.id, id), eq(ruleTrigger.campaignId, campaignOf(env))))
    .get();
  if (!row) throw notFound(TRIGGER_NOT_FOUND);
  if (
    env.actor.role === "player" &&
    (row.definitionId !== null || row.ownerPlayerId !== env.actor.playerId)
  ) {
    throw notFound(TRIGGER_NOT_FOUND);
  }
  return toRuleTriggerRecord(env.tx, row);
}

/** The owner a trigger is validated against (FR-MOD-35, -45). */
interface Owner {
  kind: "character" | "definition";
  id: string;
  ownerPlayerId: string | null;
  stats: StatBlock;
}

/** Character: the DM any of the campaign; a player their own while unlocked (FR-MOD-45). */
function editableOwner(env: Env, characterId: string | null, definitionId: string | null): Owner {
  if (characterId !== null) {
    const { creature } = editableCreature(env, characterId);
    if (creature.kind !== "character") throw invalid("Character triggers need a character");
    return {
      kind: "character",
      id: creature.id,
      ownerPlayerId: creature.ownerPlayerId,
      stats: creature.statBlock,
    };
  }
  if (env.actor.role !== "dm") throw forbidden("Only the DM edits monster triggers");
  return definitionOwner(env, definitionId as string);
}

/** A monster definition used in this campaign: custom (this campaign's) or imported (global). */
function definitionOwner(env: Env, definitionId: string): Owner {
  const cid = campaignOf(env);
  const d = resolveDefinition(env, definitionId);
  if (d.kind !== "monster" || (d.campaignId !== null && d.campaignId !== cid)) {
    throw notFound("Definition not found");
  }
  return { kind: "definition", id: d.id, ownerPlayerId: null, stats: d.statBlock };
}

/** `addTriggerFromPreset`: the caller authorised; the character must be of this campaign. */
function characterOwner(env: Env, characterId: string): Owner {
  const row = env.tx
    .select()
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, campaignOf(env))))
    .get();
  if (row?.kind !== "character") throw notFound("Character not found");
  return {
    kind: "character",
    id: row.id,
    ownerPlayerId: row.ownerPlayerId,
    stats: row.statBlock as StatBlock,
  };
}

const issue = (path: (string | number)[], message: string): never => {
  const issues: Issue[] = [{ path, message }];
  throw invalid(message, issues);
};

/** Campaign presets (`characterId` null) and the owner character's presets among `ids`. */
function presetsOf(env: Env, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return env.tx
    .select({ id: effectPreset.id, characterId: effectPreset.characterId })
    .from(effectPreset)
    .where(and(eq(effectPreset.campaignId, campaignOf(env)), inArray(effectPreset.id, [...ids])))
    .all();
}

/**
 * FR-MOD-33–35, -45 against the owner: preset refs (`requires`: a built-in key, a campaign preset
 * or the character's own; `targetMarked`: `hunters-mark` or a campaign preset), `every.feature`
 * (the character's feature row with uses), the formula (≤ 25 dice, die sizes) for this owner.
 */
function validateRule(env: Env, owner: Owner, rule: TriggerRule, at: (string | number)[]): void {
  const refs = [
    ...(rule.requires ? [rule.requires.preset] : []),
    ...rule.when.flatMap((f) => (f.if === "targetMarked" ? [f.preset] : [])),
  ];
  const presets = presetsOf(env, refs);
  const builtin = (k: string) => (BUILTIN_PRESET_KEYS as readonly string[]).includes(k);
  const campaign = (k: string) => presets.some((p) => p.id === k && p.characterId === null);
  const own = (k: string) =>
    owner.kind === "character" && presets.some((p) => p.id === k && p.characterId === owner.id);
  if (rule.requires) {
    const k = rule.requires.preset;
    if (!builtin(k) && !campaign(k) && !own(k)) {
      issue([...at, "requires", "preset"], "Requires: no such preset");
    }
  }
  rule.when.forEach((f, i) => {
    if (f.if === "targetMarked" && f.preset !== "hunters-mark" && !campaign(f.preset)) {
      issue([...at, "when", i, "preset"], "Target marked: Hunter's Mark or a campaign preset");
    }
  });
  if (typeof rule.every === "object") {
    const featureId = rule.every.feature;
    const f =
      owner.kind === "character"
        ? getSheet(env.tx, owner.id)?.features.find((r) => r.id === featureId)
        : undefined;
    if (owner.kind === "character" && !f?.usesMax) {
      issue([...at, "every", "feature"], "Uses: a feature row with uses");
    }
  }
  const bad = checkRuleForOwner(rule, { kind: owner.kind, values: formulaOwnerOf(owner.stats) });
  if (bad) issue([...at, ...bad.path], bad.message);
}

function countTriggers(env: Env, where: ReturnType<typeof eq> | undefined): number {
  return env.tx.select({ n: count() }).from(ruleTrigger).where(where).get()?.n ?? 0;
}

/** FR-MOD-32 caps on a create (`conflict`). */
function checkCaps(env: Env, owner: Owner): void {
  const cid = campaignOf(env);
  if (owner.kind === "character") {
    const n = countTriggers(
      env,
      and(eq(ruleTrigger.campaignId, cid), eq(ruleTrigger.characterId, owner.id)),
    );
    if (n >= CHARACTER_TRIGGERS_MAX) {
      throw conflict(`At most ${CHARACTER_TRIGGERS_MAX} triggers per character`);
    }
  } else {
    const n = countTriggers(
      env,
      and(eq(ruleTrigger.campaignId, cid), eq(ruleTrigger.definitionId, owner.id)),
    );
    if (n >= DEFINITION_TRIGGERS_MAX) {
      throw conflict(`At most ${DEFINITION_TRIGGERS_MAX} triggers per monster`);
    }
  }
  if (countTriggers(env, eq(ruleTrigger.campaignId, cid)) >= CAMPAIGN_TRIGGERS_MAX) {
    throw conflict(`At most ${CAMPAIGN_TRIGGERS_MAX} triggers per campaign`);
  }
}

interface WriteTrigger {
  id?: string;
  name: string;
  enabled: boolean;
  public?: boolean;
  rule: TriggerRule;
}

/** Validates, then inserts / replaces; the row's change. No event (callers emit or list it). */
function writeTrigger(
  env: Env,
  owner: Owner,
  t: WriteTrigger,
  at: (string | number)[],
): { triggerId: string; change: RecordChange } {
  const before = t.id === undefined ? null : getTrigger(env, t.id);
  if (before && (before.characterId ?? before.definitionId) !== owner.id) {
    throw invalid("A trigger keeps its owner");
  }
  validateRule(env, owner, t.rule, [...at, "rule"]);
  if (!before) checkCaps(env, owner);
  const values = {
    name: t.name,
    enabled: t.enabled,
    public: t.public ?? before?.public ?? owner.kind === "character",
    rule: t.rule,
    ownerPlayerId: owner.ownerPlayerId,
    updatedAt: env.ctx.clock.iso(),
  };
  let id: string;
  if (before) {
    id = before.id;
    env.tx.update(ruleTrigger).set(values).where(eq(ruleTrigger.id, id)).run();
  } else {
    id = env.ctx.ids.next();
    env.tx
      .insert(ruleTrigger)
      .values({
        ...values,
        id,
        campaignId: campaignOf(env),
        seq: ruleTriggerSeqNext,
        characterId: owner.kind === "character" ? owner.id : null,
        definitionId: owner.kind === "definition" ? owner.id : null,
      })
      .run();
  }
  return { triggerId: id, change: triggerChange(before, readTrigger(env.tx, id)) };
}

export const putTrigger = defineCommand({
  name: TRIGGER_INTENTS.putTrigger,
  input: PutTriggerInput,
  roles: ["dm", "player"],
  execute({ trigger: t }, env): PutTriggerResult {
    const owner = editableOwner(env, t.characterId, t.definitionId);
    const { triggerId, change } = writeTrigger(env, owner, t, ["trigger"]);
    env.emit({
      type: RuleTriggerSaved.type,
      campaignId: campaignOf(env),
      payload: { triggerId },
      changes: [change],
    });
    return { triggerId };
  },
});

export const deleteTrigger = defineCommand({
  name: TRIGGER_INTENTS.deleteTrigger,
  input: DeleteTriggerInput,
  roles: ["dm", "player"],
  execute({ triggerId }, env): void {
    const before = getTrigger(env, triggerId);
    editableOwner(env, before.characterId, before.definitionId);
    // Its `trigger_use` rows cascade (server-only, nothing to send).
    env.tx.delete(ruleTrigger).where(eq(ruleTrigger.id, before.id)).run();
    env.emit({
      type: RuleTriggerDeleted.type,
      campaignId: before.campaignId,
      payload: { triggerId: before.id },
      changes: [triggerChange(before, null)],
    });
  },
});

/**
 * FR-MOD-46 (seams S5, review C2): adds a trigger to a character from a built-in trigger preset
 * (`{presetKey}`) or a compendium entry's rule (`{name, rule}`), inside the **caller's**
 * transaction: writes through `env.tx`, opens no transaction, emits no event (the caller's event
 * lists `changes`). Validates as `mod.putTrigger` (rule, formula, refs, caps) and throws
 * `invalid` / `conflict`, so the caller rolls back. Authorisation is the caller's (as
 * `char.putRow`). `requires` keeps the built-in key (origin match, FR-MOD-36).
 */
export function addTriggerFromPreset(
  env: CommandEnv,
  characterId: string,
  from: { presetKey: string } | { name: string; rule: TriggerRule },
): { triggerId: string; changes: RecordChange[] } {
  const owner = characterOwner(env, characterId);
  let t: WriteTrigger;
  if ("presetKey" in from) {
    const p = getTriggerPreset(from.presetKey);
    if (!p) issue(["presetKey"], "No such trigger preset");
    const preset = p as NonNullable<typeof p>;
    t = { name: preset.name, enabled: true, public: preset.public, rule: preset.rule };
  } else {
    const rule = TriggerRule.safeParse(from.rule);
    if (!rule.success) throw invalid("Invalid trigger rule", zodIssues(rule.error));
    const name = from.name.trim().slice(0, 40);
    if (!name) issue(["name"], "Name is required");
    t = { name, enabled: true, rule: rule.data };
  }
  const { triggerId, change } = writeTrigger(env, owner, t, []);
  return { triggerId, changes: [change] };
}

/** A character's triggers (owner-copy hook, FR-MOD-47). */
export function triggersOfCharacter(tx: Read, characterId: string): RuleTriggerRow[] {
  return tx
    .select()
    .from(ruleTrigger)
    .where(and(eq(ruleTrigger.characterId, characterId), isNull(ruleTrigger.definitionId)))
    .all()
    .map((r) => toRuleTriggerRecord(tx, r));
}
