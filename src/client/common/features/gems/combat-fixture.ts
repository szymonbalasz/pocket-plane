// GM2 DOM-test support: an in-code store around one pending Flame Tongue card of Brakka's
// (player-1; level 5 unless set), gems on or off, the card's roll line (dice faces) in the log.
import { COMBATANT_TYPE, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import { CHARACTER_GEMS_TYPE } from "@shared/gems/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";

export const flameCard = (o: Partial<DamageCardPayload> = {}): DamageCardPayload =>
  ({
    encounterId: "e1",
    attackerId: "cb-brakka",
    attackerName: "Brakka",
    attackName: "Flame Tongue greatsword",
    damageType: "slashing",
    mode: "normal",
    crit: false,
    toHit: {
      rollId: "r-hit",
      dice: [[14, true]],
      constant: 8,
      total: 22,
      manual: true,
      natural: 14,
    },
    damage: {
      rollId: "r-base",
      dice: [
        [3, true],
        [5, true],
      ],
      constant: 5,
      total: 15,
      manual: true,
      mods: [{ label: "Rage", value: 2 }],
      extra: [
        {
          type: "fire",
          rollId: "r-fire",
          dice: [
            [2, true],
            [6, true],
          ],
          constant: 0,
          total: 8,
          manual: true,
        },
      ],
    },
    ...o,
  }) as DamageCardPayload;

export const cardNote = (
  payload: DamageCardPayload,
  o: Partial<NotificationRecord> = {},
): NotificationRecord =>
  ({
    id: "n1",
    campaignId: "c1",
    seq: 4,
    kind: "damage-card",
    audience: "player",
    audiencePlayerId: "p1",
    state: "pending",
    text: "Brakka: 22 to hit, 15 slashing + 8 fire",
    payload,
    ...o,
  }) as NotificationRecord;

export function combatStore(o: {
  viewer: "dm" | "p1";
  on?: boolean;
  combat?: number;
  level?: number;
  note: NotificationRecord;
}): RecordStore {
  const dm = o.viewer === "dm";
  const level = o.level ?? 5;
  const brakka = {
    id: "brakka",
    campaignId: "c1",
    kind: "character",
    name: "Brakka",
    ownerPlayerId: "p1",
    ...(dm ? { statBlock: { level, className: "Barbarian" } } : { level }),
  };
  const die = (faces: number, value: number) => ({ faces, value, kept: true });
  return {
    ...emptyStore(),
    you: dm
      ? { campaignId: "c1", role: "dm", playerId: null }
      : { campaignId: "c1", role: "player", playerId: "p1" },
    records: {
      campaign: {
        c1: {
          id: "c1",
          name: "C",
          dmColor: "#e69f00",
          ...(o.on !== false ? { features: ["gems"] } : {}),
        },
      },
      entity: { brakka },
      [COMBATANT_TYPE]: {
        "cb-brakka": {
          id: "cb-brakka",
          encounterId: "e1",
          name: "Brakka",
          kind: "pc",
          entityId: "brakka",
        },
      },
      ...(o.on !== false
        ? {
            [CHARACTER_GEMS_TYPE]: {
              brakka: {
                id: "brakka",
                campaignId: "c1",
                characterId: "brakka",
                inspiration: 0,
                fortune: 0,
                combat: o.combat ?? 2,
                divine: 0,
                action: 0,
              },
            },
          }
        : {}),
      "game-log-entry": {
        e9: {
          id: "e9",
          n: 9,
          kind: "roll",
          rollIds: ["r-hit", "r-base", "r-fire"],
          payload: [
            { rollId: "r-hit", dice: [die(20, 14)] },
            { rollId: "r-base", dice: [die(6, 3), die(6, 5)] },
            { rollId: "r-fire", dice: [die(6, 2), die(6, 6)] },
          ],
        },
      },
      notification: { [o.note.id]: o.note },
    },
  } as unknown as RecordStore;
}
