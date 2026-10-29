// Sheet roll route (FR-CBT-30, #135): while the character is an active, non-removed combatant of
// the started encounter in this client's store, the sheet's Initiative sends
// `cbt.rollInitiative` and the attack buttons send combat intents (no `public`). FR-CBT-74 (N7,
// §6.1), per attack row and per attack or save spell, with the row's `ref`: Attack (`toHit` /
// `spellToHit`, a spell only with damage) → `cbt.attack {rolls: "toHit"}`; Damage (`damage` /
// `spellDamage`) → `cbt.rollDamage`; Attack + damage (`attack` / `spellAttack`) → `cbt.attack`.
// FR-CBT-169, -170 (#385): the sheet asks for Attack and Damage only (Attack + damage stays
// claimed for an old caller); the tray's staged `parts` ride along on both.
// Healing, checks, saves and skills are never claimed: they stay `char.roll` (FR-CBT-45). A PC
// hidden from its owner isn't in the player's store, so the sheet falls back to `char.roll`
// (OQ-CBT-28).
import { attackRollSpecs, type RollSheet, resolveSheetAttack } from "@shared/character-sheet/logic";
import type { SheetRollKind } from "@shared/character-sheet/schemas";
import { CREATURE_SHEET_TYPE, type SpellRow } from "@shared/character-sheet/sheet";
import { critExpression } from "@shared/combat-tracker/rules";
import {
  COMBATANT_TYPE,
  type CombatantView,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import type { StagedPart } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { RollRoute, RollRouteClaim, RollRouteRef } from "../character-sheet/routing";
import { startedIn } from "./store";
import { useUseRollRequest } from "./use-roll-action";

function combatantOf(store: RecordStore, characterId: string): CombatantView | null {
  const enc = startedIn(store);
  if (!enc) return null;
  const all = Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantView[];
  return (
    all.find(
      (c) =>
        c.encounterId === enc.id &&
        c.kind === "pc" &&
        c.entityId === characterId &&
        c.active !== false &&
        !c.removed,
    ) ?? null
  );
}

/** FR-CBT-46: roll-initiative controls only while round 0 or the combatant has none. */
export function initiativeLocked(store: RecordStore, c: CombatantView): boolean {
  return (startedIn(store)?.round ?? 0) >= 1 && c.initiative != null;
}

type StatBlockLike = Parameters<typeof resolveSheetAttack>[0];

function statBlockOf(store: RecordStore, characterId: string): StatBlockLike | null {
  const e = store.records.entity?.[characterId] as { statBlock?: StatBlockLike } | undefined;
  return e?.statBlock?.attacks ? e.statBlock : null;
}

const sheetOf = (store: RecordStore, characterId: string) =>
  (store.records[CREATURE_SHEET_TYPE]?.[characterId] ?? null) as RollSheet;

/**
 * The row's damage expressions from this client's store (full entity + `creature-sheet`, DM and
 * owner): the base part (with the weapon's `bonus`), then each extra part (FR-CBT-81); null:
 * unknown row, no damage, or not in the store.
 */
function attackDamagesOf(
  store: RecordStore,
  characterId: string,
  ref?: RollRouteRef,
): string[] | null {
  const stats = statBlockOf(store, characterId);
  if (!stats) return null;
  const r = resolveSheetAttack(stats, sheetOf(store, characterId), ref ?? {});
  return r.ok
    ? attackRollSpecs(r.attack)
        .slice(1)
        .map((s) => s.expression)
    : null;
}

/**
 * FR-CBT-81 (sprint 4): the roll control's physical entries in spec order ([to-hit,] base,
 * extra parts…) as the combat intents take them: `manual` (+ `manualParts`) for the first `n`,
 * `manualExtra` for the extra parts. Also the DM Initiative row's Attack ▸ (BL-19).
 */
export function manualFields(input: { manual?: unknown[]; manualParts?: unknown[] }, n: number) {
  const extra = input.manual?.slice(n) ?? [];
  return {
    ...(input.manual ? { manual: n === 1 ? input.manual[0] : input.manual.slice(0, n) } : {}),
    ...(input.manualParts
      ? { manualParts: n === 1 ? input.manualParts[0] : input.manualParts.slice(0, n) }
      : {}),
    ...(extra.length ? { manualExtra: extra } : {}),
  };
}

function spellOf(store: RecordStore, characterId: string, spellId: string): SpellRow | null {
  return sheetOf(store, characterId)?.spells.find((s) => s.id === spellId) ?? null;
}

/** The ref a card names (FR-CBT-71): no ref = the first attack, by its id when it has one. */
function cardRef(store: RecordStore, characterId: string, ref?: RollRouteRef) {
  if (ref?.spellId !== undefined) return { spellId: ref.spellId };
  const attackId = ref?.attackId ?? statBlockOf(store, characterId)?.attacks[0]?.id;
  return attackId === undefined ? {} : { attackId };
}

/**
 * FR-CBT-74: the latest pending to-hit-only card of this attacker's row among `notes` (what
 * `cbt.rollDamage` completes), or null. Used by the sheet route, the DM's Initiative row and the
 * tray route. FR-CBT-171 (#385): a card without a row matches any row; `row` null (a rowless
 * damage roll) matches any card.
 */
export function pendingToHitCard(
  notes: readonly NotificationRecord[],
  attackerId: string,
  row: { attackId?: string; spellId?: string } | null,
): DamageCardPayload | null {
  let best: { seq: number; p: DamageCardPayload } | null = null;
  for (const n of notes) {
    if (n.kind !== DAMAGE_CARD_KIND || n.state !== "pending") continue;
    const parsed = DamageCardPayload.safeParse(n.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    if (p.attackerId !== attackerId || p.toHit === null || p.damage !== null) continue;
    const rowless = p.attackId === undefined && p.spellId === undefined;
    if (row && !rowless && (p.attackId !== row.attackId || p.spellId !== row.spellId)) continue;
    if (!best || n.seq > best.seq) best = { seq: n.seq, p };
  }
  return best?.p ?? null;
}

export const notesOf = (store: RecordStore) =>
  Object.values(store.records.notification ?? {}) as NotificationRecord[];

const refFields = (ref?: RollRouteRef) => ({
  ...(ref?.attackId !== undefined ? { attackId: ref.attackId } : {}),
  ...(ref?.spellId !== undefined ? { spellId: ref.spellId } : {}),
});

/**
 * FR-CBT-170 (#385): the tray's staged parts, when the roll was staged (`RollRequest.parts` /
 * `RollRouteInput.parts`; absent on Alt+click and request answers).
 */
export const partsOf = (input: { parts?: StagedPart[] }): { parts?: StagedPart[] } =>
  input.parts ? { parts: input.parts } : {};

/**
 * FR-CBT-169 (#385): a roll from the Dice tray (staged `parts`) that made or completed a card:
 * the DM's popup opens on it (it stepped aside when the roll was staged, `popup-store.ts`), as
 * Initiative's Attack ▸ does. Only the DM client listens; an Alt+click roll (no `parts`) keeps
 * today's toast.
 */
export function showStagedCard<T>(input: { parts?: StagedPart[] }, sent: Promise<T>): Promise<T> {
  return sent.then((res) => {
    const cardId = (res as { cardId?: unknown } | null | undefined)?.cardId;
    if (input.parts && typeof cardId === "string") useUseRollRequest.getState().request({ cardId });
    return res;
  });
}

/** Kinds this route claims; per kind, a weapon row (`attackId` / none) or a spell row. */
const ATTACK_KINDS: Partial<Record<SheetRollKind, "weapon" | "spell">> = {
  toHit: "weapon",
  damage: "weapon",
  attack: "weapon",
  spellToHit: "spell",
  spellDamage: "spell",
  spellAttack: "spell",
};

export const combatRollRoute: RollRoute = {
  name: "combat-tracker",
  claim(store, characterId, kind, ref) {
    const row = ATTACK_KINDS[kind];
    if (kind !== "initiative" && !row) return null;
    // A spell kind needs its row; a weapon kind never names a spell.
    if (row === "spell" && ref?.spellId === undefined) return null;
    if (row === "weapon" && ref?.spellId !== undefined) return null;
    const c = combatantOf(store, characterId);
    if (!c) return null;
    if (kind === "initiative") {
      return {
        badge: "In combat",
        // FR-CHAR-24, FR-CBT-46 (#172): from round 1 nobody re-rolls; a PC without initiative
        // (restored, later a mid-fight joiner) keeps the button and rolls once.
        hidden: initiativeLocked(store, c),
        send: (sendIntent, input) =>
          sendIntent("cbt.rollInitiative", {
            combatantIds: [c.id],
            mode: input.mode,
            ...(input.manual?.[0] ? { manual: input.manual[0] } : {}),
            ...(input.manualParts?.[0] ? { manualParts: input.manualParts[0] } : {}),
            ...(input.public !== undefined ? { public: input.public } : {}),
          }),
      };
    }
    const spell = ref?.spellId !== undefined ? spellOf(store, characterId, ref.spellId) : null;
    // Spells: healing never routes; Attack / Attack + damage only for an attack spell with
    // damage; Damage for any spell with damage (save spells get a damage-only card).
    if (row === "spell") {
      if (!spell?.damage || spell.effect === "healing") return null;
      if (kind !== "spellDamage" && spell.roll !== "attack") return null;
    }
    const damages = spell
      ? spell.damage
        ? [spell.damage]
        : null
      : attackDamagesOf(store, characterId, ref);
    // FR-CBT-83: a crit doubles every part's dice, one crit expression per damage slot.
    const critExpressions = damages?.map(critExpression);
    if (kind === "damage" || kind === "spellDamage") {
      // FR-CBT-74: after a natural 20 on the row's pending to-hit card the Damage is critical:
      // the roll control shows the extra critical dice from the start.
      const card = pendingToHitCard(notesOf(store), c.id, cardRef(store, characterId, ref));
      const crit = card?.toHit?.natural === 20 && critExpressions !== undefined;
      const claim: RollRouteClaim = {
        badge: "In combat",
        ...(crit && critExpressions ? { critExpressions, crit: true } : {}),
        // FR-MOD-27: the damage completes this card (its to-hit mode) or makes a damage-only one.
        card: card ? { toHitMode: card.mode } : {},
        send: (sendIntent, input) =>
          showStagedCard(
            input,
            sendIntent("cbt.rollDamage", {
              attackerId: c.id,
              ...manualFields(input, 1),
              ...refFields(ref),
              ...partsOf(input),
            }),
          ),
      };
      return claim;
    }
    const toHitOnly = kind === "toHit" || kind === "spellToHit";
    return {
      badge: "In combat",
      ...(critExpressions && !toHitOnly ? { critExpressions } : {}),
      card: {},
      send: (sendIntent, input) =>
        showStagedCard(
          input,
          sendIntent("cbt.attack", {
            attackerId: c.id,
            mode: input.mode,
            ...(toHitOnly ? { rolls: "toHit" } : {}),
            ...(toHitOnly
              ? {
                  ...(input.manual ? { manual: input.manual } : {}),
                  ...(input.manualParts ? { manualParts: input.manualParts } : {}),
                }
              : manualFields(input, 2)),
            ...refFields(ref),
            ...(toHitOnly ? partsOf(input) : {}),
          }),
        ),
    };
  },
};
