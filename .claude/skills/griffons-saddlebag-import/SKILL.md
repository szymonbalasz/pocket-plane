---
name: griffons-saddlebag-import
description: Use when the DM asks to import, refresh or sync Griffon's Saddlebag items (the Ledger+ magic items from the Griffon's Saddlebag exporter) into a Pocket Plane campaign's homebrew compendium.
---

# Griffon's Saddlebag import

The DM's Griffon's Saddlebag exporter writes `data/manifest.json`, `data/items.json` and images. `bun run gsb:import` turns them into **unshared homebrew items** in the active campaign, through the stdio MCP server (one session). You drive the script; you never handle the item content yourself.

## Never

- Write to, delete in, or run any command **with the exporter repo as cwd**. It is read-only; only the script reads it.
- Read `items.json` (or the images) into the conversation, or paste item text anywhere. It is paid content: it stays on the DM's machine. Work from the script's counts and names.
- Share imported entries. They are created DM only; the DM shares in the client.
- Delete anything. Items gone upstream are only reported.
- Run `--apply` before the DM's yes to the dry-run table.
- Use `--play` unless the DM asked for the real campaign. Default is the dev profile; `--profile verify` for a walkthrough.

## 1. Preflight

| Check | If missing |
|---|---|
| `GRIFFONS_SADDLEBAG_EXPORTER_PATH` in `.env` | The script says so. Ask the DM for the exporter repo's absolute path; they add `GRIFFONS_SADDLEBAG_EXPORTER_PATH=<path>` to `.env` (quotes are fine; spaces are fine) |
| `<path>/data/manifest.json` | The DM runs the exporter first (in their own terminal, not you) |
| `schemaVersion` 1 | Refused: the importer needs an update; report it |
| The server for the target is running | `server_not_running`: ask the DM to start it (dev: `bun run dev`; real campaign: `bun run play`) |
| An active campaign | "No active campaign": the DM opens one in the DM client |

## 2. Dry run

`bun run gsb:import [--profile p | --play] --json [filters]` (writes nothing; runs `plan_check` in chunks).

| Filter | Keeps |
|---|---|
| `--name <text>` | names containing the text (case-insensitive) |
| `--type <type>` | `Wondrous item`, `Weapon`, `Armor`, `Potion`, `Ring`, … |
| `--rarity <r>` | items that come in that rarity |
| `--tag <tag>` / `--theme <theme>` | one tag / treasure theme |
| `--uid <a,b>` | those items |
| `--limit <n>` | the first n items to write (after the others) |

A filtered run never reports removals and doesn't move the "last full import" mark.

JSON fields to read: `campaign`, `counts`, `names.<bucket>.shown` / `.more`, `work`, `planIssues`, `warnings`, `nothingChanged`, `datasetChanged`.

| Bucket | Means | On `--apply` |
|---|---|---|
| `new` | not imported yet | created (unshared, with up to 4 images) |
| `changed` | changed upstream, entry as last written | edited |
| `unchanged` | same as last import | nothing |
| `removed` | gone from the dataset (uids) | reported, marked; the entry stays |
| `locallyEdited` | changed upstream, but the DM edited the entry in Pocket Plane | skipped; `--overwrite` replaces it |
| `deleted` | changed upstream, the entry was deleted in Pocket Plane | skipped; `--overwrite` recreates it |
| `adopt` | name taken by an earlier import of the same item (no ledger row, e.g. a new checkout) | linked, edited if needed |
| `clash` | name taken by another homebrew item | fails; the DM renames one |

## 3. Ask

Show the DM **one table**: bucket, count, sample names (from `names`), plus `planIssues`, `warnings` and the locally edited names. `nothingChanged: true` → say "nothing changed" and stop. Ask: apply? overwrite the locally edited ones?

## 4. Apply

- Same command with `--apply` (and `--overwrite` only if the DM said so), without `--json` unless you need it. ~2,000 items take minutes: run it in the background and wait for it to finish; don't poll in the foreground.
- Progress goes to stderr every 25 items; the summary ends with `created, updated, adopted, skipped, failed, removed`.
- Images upload once: the same bytes give the same asset id, so a rerun is cheap. The ledger is saved after every item, so a stop loses at most one.
- Exit 1 = a refusal or failed items: report each `FAILED <name> [<uid>] <code>: <message>`. Rerunning picks up where it stopped.

## 5. Errors

| `code` | Say / do |
|---|---|
| `server_not_running` | Start Pocket Plane (`bun run dev` / `bun run play`), then rerun. |
| `server_busy` | A fixture load or start is running: wait, rerun. |
| `server_stopped` | The run stopped. The last write may or may not be saved: start the server, then **dry-run** again (it reads back what's there). Never retry blind. |
| `auth` | `PP_DM_SECRET` was rejected: the DM fixes `.env`. |
| `throttled` | Too many DM sign-ins: wait a minute. |
| `conflict` | No active campaign, or a name clash (`clash` bucket): the DM renames. |
| `invalid` | An entry or image the server refused: report the item and the message. |
| `mcp_closed` | The MCP server process died: report its stderr. |
| `internal` | Report it; "server too old" → update Pocket Plane. |

## 6. Where data goes

- The script reads the exporter files locally and sends them only to the local Pocket Plane server (over the MCP server on this machine). Its ledger (`data/griffons-saddlebag/<target>-<campaignId>.json`, gitignored) holds ids and hashes, no item content.
- Only the script's counts, names and messages reach the model. Don't ask for more.
