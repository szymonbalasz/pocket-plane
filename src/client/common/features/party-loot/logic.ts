// Pure client rules of `loot.log` (FR-LOOT-14–19, FR-PARTY-25/27): display order, wallet rows,
// form drafts → intent payloads (FR-LOOT-02/06/07, FR-PARTY-26 mirrored with the shared zod
// schemas), Move form options, item-row text, the Split… dialog. No React.
import type { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { itemRowText, splitPreview } from "@shared/party-board/format";
import { LootSplitIntent } from "@shared/party-board/schemas";
import { splitCoins } from "@shared/party-board/split";
import {
  COINS,
  type CoinKey,
  type Coins,
  type Endpoint,
  LootAddIntent,
  type LootEntryRecord,
  type LootInput,
  LootMoveIntent,
  type WalletRecord,
  ZERO_COINS,
} from "@shared/party-loot/schemas";
import { IntentRejected } from "../../sync/connection";

export const LOOT_LOG_KIND = "loot.log";

/** The coin Inputs' raw text, per coin. */
export type CoinDraft = Record<CoinKey, string>;
export const EMPTY_DRAFT: CoinDraft = { cp: "", sp: "", ep: "", gp: "", pp: "" };

/** A character as the window needs it (full or redacted `entity` record). */
export interface CharacterRef {
  id: string;
  name: string;
  ownerPlayerId: string;
}

/** FR-LOOT-15: newest first (row `seq`). */
export function newestFirst(entries: readonly LootEntryRecord[]): LootEntryRecord[] {
  return [...entries].sort((a, b) => b.seq - a.seq);
}

/** Characters by name; the viewer's own first (FR-LOOT-15). */
export function sortCharacters(
  chars: readonly CharacterRef[],
  playerId: string | null,
): CharacterRef[] {
  const byName = (a: CharacterRef, b: CharacterRef) =>
    a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);
  const own = chars.filter((c) => playerId !== null && c.ownerPlayerId === playerId).sort(byName);
  const rest = chars.filter((c) => !own.includes(c)).sort(byName);
  return [...own, ...rest];
}

export interface WalletRow {
  character: CharacterRef;
  own: boolean;
  coins: Coins;
}

/** FR-LOOT-15: one row per character; a missing wallet is all zeros (FR-LOOT-09). */
export function walletRows(
  chars: readonly CharacterRef[],
  wallets: readonly WalletRecord[],
  playerId: string | null,
): WalletRow[] {
  const byId = new Map(wallets.map((w) => [w.characterId, w]));
  return sortCharacters(chars, playerId).map((c) => {
    const w = byId.get(c.id);
    return {
      character: c,
      own: playerId !== null && c.ownerPlayerId === playerId,
      coins: w ? { cp: w.cp, sp: w.sp, ep: w.ep, gp: w.gp, pp: w.pp } : { ...ZERO_COINS },
    };
  });
}

/** Coin draft → number; "" → 0; anything but an integer → null. `-` only when signed. */
export function parseCoin(raw: string, signed: boolean): number | null {
  const s = raw.trim();
  if (s === "") return 0;
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(s)) return null;
  return Number(s);
}

export function draftOf(c: Coins): CoinDraft {
  const out = { ...EMPTY_DRAFT };
  for (const k of COINS) out[k] = c[k] === 0 ? "" : String(c[k]);
  return out;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function coinsOf(draft: CoinDraft, signed: boolean): Coins | null {
  const out = { ...ZERO_COINS };
  for (const k of COINS) {
    const v = parseCoin(draft[k], signed);
    if (v === null) return null;
    out[k] = v;
  }
  return out;
}

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Invalid";

/** FR-LOOT-16: the add form's payload, valid per FR-LOOT-02, or why not. */
export function lootPayload(text: string, draft: CoinDraft): Parsed<LootInput> {
  const coins = coinsOf(draft, true);
  if (!coins) return { ok: false, message: "Coins must be whole numbers" };
  const r = LootAddIntent.safeParse({ text, ...coins });
  return r.success ? { ok: true, value: r.data } : { ok: false, message: firstIssue(r.error) };
}

/** FR-LOOT-17: the edit's payload; `unchanged` when it equals the stored entry. */
export function editPayload(
  entry: LootEntryRecord,
  text: string,
  draft: CoinDraft,
): Parsed<LootInput & { entryId: string }> & { unchanged: boolean } {
  const p = lootPayload(text, draft);
  if (!p.ok) return { ...p, unchanged: false };
  const unchanged = p.value.text === entry.text && COINS.every((k) => p.value[k] === entry[k]);
  return { ok: true, value: { entryId: entry.id, ...p.value }, unchanged };
}

// ---- Move form (FR-LOOT-18) ----

/** Select value of an endpoint: `party`, `world`, `char:<id>`. */
export type EndpointKey = string;

export function endpointKey(e: Endpoint): EndpointKey {
  return e.kind === "character" ? `char:${e.characterId}` : e.kind;
}

export function endpointOf(key: EndpointKey): Endpoint {
  if (key === "party" || key === "world") return { kind: key };
  return { kind: "character", characterId: key.slice("char:".length) };
}

export const PARTY_LABEL = "Party pot";
export const WORLD_LABEL = "Outside the party";

export function endpointLabel(e: Endpoint, nameOf: (id: string) => string | undefined): string {
  if (e.kind === "party") return PARTY_LABEL;
  if (e.kind === "world") return WORLD_LABEL;
  return nameOf(e.characterId) ?? "Unknown character";
}

export interface MoveOption {
  key: EndpointKey;
  label: string;
}

export interface MoveViewer {
  role: "dm" | "player";
  playerId: string | null;
}

const charOption = (c: CharacterRef): MoveOption => ({ key: `char:${c.id}`, label: c.name });
const PARTY: MoveOption = { key: "party", label: PARTY_LABEL };
const WORLD: MoveOption = { key: "world", label: WORLD_LABEL };

/** "From" options: DM = pot, every character, outside; player = own characters + pot. */
export function fromOptions(chars: readonly CharacterRef[], v: MoveViewer): MoveOption[] {
  if (v.role === "dm") return [PARTY, ...sortCharacters(chars, null).map(charOption), WORLD];
  const own = sortCharacters(chars, v.playerId).filter((c) => c.ownerPlayerId === v.playerId);
  return [...own.map(charOption), PARTY];
}

/**
 * "To" options for a "From". DM: every other end, `world` only opposite a character.
 * Player: own character → pot + other characters; pot → own characters only.
 */
export function toOptions(
  chars: readonly CharacterRef[],
  v: MoveViewer,
  from: EndpointKey,
): MoveOption[] {
  const sorted = sortCharacters(chars, v.role === "dm" ? null : v.playerId);
  const fromIsChar = from.startsWith("char:");
  if (v.role === "dm") {
    const all = [PARTY, ...sorted.map(charOption), ...(fromIsChar ? [WORLD] : [])];
    return all.filter((o) => o.key !== from && (from !== "world" || o.key.startsWith("char:")));
  }
  if (from === "party") {
    return sorted.filter((c) => c.ownerPlayerId === v.playerId).map(charOption);
  }
  return [PARTY, ...sorted.map(charOption).filter((o) => o.key !== from)];
}

/** Some From → To pair exists (none in a campaign without characters: every move has one). */
export function canMove(chars: readonly CharacterRef[], v: MoveViewer): boolean {
  return fromOptions(chars, v).some((o) => toOptions(chars, v, o.key).length > 0);
}

export const NO_MOVE_TEXT = "No characters to move coin to/from";

/** FR-LOOT-18: the move's payload, valid per FR-LOOT-06/07, or why not. */
export function movePayload(
  chars: readonly CharacterRef[],
  v: MoveViewer,
  from: EndpointKey,
  to: EndpointKey,
  text: string,
  draft: CoinDraft,
): Parsed<LootMoveIntent> {
  if (!fromOptions(chars, v).some((o) => o.key === from)) {
    return { ok: false, message: "Pick where the coin comes from" };
  }
  if (!toOptions(chars, v, from).some((o) => o.key === to)) {
    return { ok: false, message: "Pick where the coin goes" };
  }
  const coins = coinsOf(draft, false);
  if (!coins) return { ok: false, message: "Coins must be whole numbers ≥ 0" };
  const payload = { from: endpointOf(from), to: endpointOf(to), text, ...coins };
  const r = LootMoveIntent.safeParse(payload);
  return r.success ? { ok: true, value: payload } : { ok: false, message: firstIssue(r.error) };
}

// ---- Intent outcomes (FR-LOOT-16–18) ----

/** Add / Save / Move lock: invalid, unchanged (edit), not `live` or in flight → disabled. */
export function submitEnabled(s: {
  valid: boolean;
  live: boolean;
  busy: boolean;
  unchanged?: boolean;
}): boolean {
  return s.valid && s.live && !s.busy && !s.unchanged;
}

export const LOST_ADD = "Connection lost — check the loot log before adding again";
export const LOST_EDIT = "Connection lost — check the entry before saving again";
export const LOST_MOVE = "Connection lost — check the loot log before moving again";

/** A reject → inline message; an intent lost to a disconnect → the form's toast. */
export function intentFailure(
  err: unknown,
  lost: string,
): { kind: "inline"; message: string } | { kind: "toast"; message: string } {
  if (err instanceof IntentRejected) {
    if (err.code === "disconnected" || err.code === "offline")
      return { kind: "toast", message: lost };
    return { kind: "inline", message: err.message };
  }
  return { kind: "inline", message: "Something went wrong" };
}

/** FR-LOOT-14: " (edited)" when the notification's entry is in the store and edited. */
export function editedSuffix(
  payload: unknown,
  entries: Readonly<Record<string, unknown>> | undefined,
): string {
  const id = (payload as { entryId?: unknown } | null)?.entryId;
  if (typeof id !== "string") return "";
  const e = entries?.[id] as LootEntryRecord | undefined;
  return e?.editedAt ? " (edited)" : "";
}

// ---- Item rows (FR-PARTY-25) ----

/** An item row's line: "‹from› → ‹to›: ‹name› ×‹qty›" ("Party", "Outside the party"). */
export function itemLine(
  entry: LootEntryRecord & { qty: number },
  nameOf: (id: string) => string | undefined,
): string {
  return itemRowText(entry, (id) => nameOf(id) ?? "Unknown character");
}

// ---- Split… dialog (FR-PARTY-27) ----

/** Coin Inputs prefilled with the pot's positive coins. */
export function splitPrefill(pot: Coins): CoinDraft {
  const out = { ...EMPTY_DRAFT };
  for (const k of COINS) out[k] = pot[k] > 0 ? String(pot[k]) : "";
  return out;
}

/** Characters by name with their default tick: approved (sheet not `draft`; no sheet = ready). */
export function splitCharacters(
  chars: readonly CharacterRef[],
  sheetStatus: (id: string) => CreatureSheetRecord["status"] | undefined,
): { character: CharacterRef; ticked: boolean }[] {
  return sortCharacters(chars, null).map((c) => ({
    character: c,
    ticked: sheetStatus(c.id) !== "draft",
  }));
}

/** The split's payload (ticked ids in list order) and its preview, or why not. */
export function splitPayload(
  order: readonly string[],
  ticked: ReadonlySet<string>,
  draft: CoinDraft,
): { ok: true; value: LootSplitIntent; preview: string } | { ok: false; message: string } {
  const coins = coinsOf(draft, false);
  if (!coins) return { ok: false, message: "Coins must be whole numbers ≥ 0" };
  const characterIds = order.filter((id) => ticked.has(id));
  const r = LootSplitIntent.safeParse({ characterIds, ...coins });
  if (!r.success) return { ok: false, message: firstIssue(r.error) };
  const split = splitCoins(coins, characterIds.length);
  if (!split) return { ok: false, message: "Choose at least one character" };
  return { ok: true, value: { characterIds, ...coins }, preview: splitPreview(split) };
}

export const LOST_SPLIT = "Connection lost — check the loot log before splitting again";
