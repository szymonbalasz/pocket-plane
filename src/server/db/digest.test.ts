import { expect, test } from "bun:test";
import { stateDigest } from "./digest";
import { openTestDb } from "./testing";

test("#163 state digest: per-table counts + hashes; changes with data, not with db_meta or event_log.at", () => {
  const db = openTestDb();
  const sqlite = db.$client;
  const d0 = stateDigest(sqlite);
  expect(d0.tables.some((t) => t.table === "db_meta")).toBe(false);
  expect(d0.tables.find((t) => t.table === "campaign")).toMatchObject({ rows: 0 });

  sqlite.run("INSERT INTO db_meta (key, value) VALUES ('db-id', 'x')");
  expect(stateDigest(sqlite).sha256).toBe(d0.sha256);

  const at = "2026-01-01T00:00:00.000Z";
  sqlite.run(
    `INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, '${at}', '${at}')`,
  );
  sqlite.run(
    `INSERT INTO event_log (id, campaign_id, type, at, payload, actor_role) VALUES ('e1', 'c1', 'T', '${at}', '{}', 'dm')`,
  );
  const d1 = stateDigest(sqlite);
  expect(d1.sha256).not.toBe(d0.sha256);
  expect(d1.tables.find((t) => t.table === "campaign")?.rows).toBe(1);
  sqlite.run("UPDATE event_log SET at = '2027-01-01T00:00:00.000Z'");
  expect(stateDigest(sqlite).sha256).toBe(d1.sha256);
  sqlite.run("UPDATE campaign SET name = 'D'");
  expect(stateDigest(sqlite).sha256).not.toBe(d1.sha256);
});
