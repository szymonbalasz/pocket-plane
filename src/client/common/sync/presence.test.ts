import { expect, test } from "bun:test";
import { CloseCode } from "@shared/protocol/codes";
import { emptyStore } from "@shared/protocol/store";
import { type Clock, SyncConnection } from "./connection";
import { onlineDot, presenceBadge, presenceOf } from "./presence";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  send() {}
  close(code = 1000) {
    this.onclose?.({ code });
  }
}

const clock: Clock = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
};

function setup(role: "dm" | "player") {
  const sockets: FakeSocket[] = [];
  const conn = new SyncConnection({
    credential: role === "dm" ? { role: "dm", secret: "s" } : { role: "player", token: "t" },
    url: "ws://x/ws",
    clock,
    probe: () => true,
    onWake: () => () => {},
    onChange() {},
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  });
  conn.start();
  const view = () => presenceOf(conn.snapshot.state, conn.snapshot.store);
  return { conn, sockets, view };
}

const players = [
  { id: "p1", name: "Player 1" },
  { id: "p2", name: "Player 2" },
];

const snapshot = (online: string[]) =>
  JSON.stringify({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c", role: "dm", playerId: null },
    records: {
      presence: players.map((p) => ({
        id: p.id,
        playerId: p.id,
        campaignId: "c",
        online: online.includes(p.id),
      })),
    },
  });

test("FR-SYNC-29 presence unknown: leaving live marks it unknown; the next snapshot restores it", () => {
  const { sockets, view } = setup("dm");
  expect(view().known).toBe(false); // connecting
  sockets[0]?.onmessage?.({ data: snapshot(["p1", "p2"]) });
  expect(view()).toEqual({ known: true, online: new Set(["p1", "p2"]) });
  sockets[0]?.close(1006); // server outage
  expect(view()).toEqual({ known: false }); // not the stale "2 online"
  expect(presenceBadge(view(), players).text).toBe("– / 2 online");
});

test("FR-SYNC-29 presence unknown in `waiting`", () => {
  const { conn, sockets, view } = setup("player");
  sockets[0]?.onmessage?.({ data: snapshot(["p1"]) });
  sockets[0]?.close(CloseCode.campaignInactive);
  expect(conn.snapshot.state).toBe("waiting");
  expect(view().known).toBe(false);
});

test("FR-SHELL-33 badge '– / 2' with data-state unknown while reconnecting, '1/2' after the snapshot", () => {
  const unknown = presenceBadge(presenceOf("reconnecting", emptyStore()), players);
  expect(unknown).toEqual({
    state: "unknown",
    text: "– / 2 online",
    tooltip: "Unknown while reconnecting",
    online: null,
  });
  const { sockets, view } = setup("dm");
  sockets[0]?.onmessage?.({ data: snapshot(["p1"]) });
  expect(presenceBadge(view(), players)).toEqual({
    state: "known",
    text: "1/2 online",
    tooltip: "Player 1",
    online: 1,
  });
});

test("FR-SYNC-29 CAMP §7 players-panel dots muted while not live", () => {
  const { sockets, view } = setup("dm");
  sockets[0]?.onmessage?.({ data: snapshot(["p1"]) });
  expect([onlineDot(view(), "p1"), onlineDot(view(), "p2")]).toEqual(["online", "offline"]);
  sockets[0]?.close(1006);
  expect([onlineDot(view(), "p1"), onlineDot(view(), "p2")]).toEqual(["unknown", "unknown"]);
});
