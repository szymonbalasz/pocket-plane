# Demo — Skeleton (Foundation build)

Run from the repo root after the skeleton merges (PowerShell). Takes ~10 minutes.

## Setup (once)

```powershell
bun install
bun x playwright install chromium   # only needed for bun run e2e
bun run env:init                    # writes .env: slot, dev DM secret, disposable data flag
bun run build
```

## A. Campaigns, players, switching (`campaign-switch` bundle)

```powershell
bun run fixtures:reset-load campaign-switch --profile verify
bun run start --profile verify
```

The load prints the **DM URL**, **DM secret** and **player links**.

| # | You do | Expect |
|---|---|---|
| 1 | Normal browser: open the DM URL, enter a wrong secret, then the real one | "Wrong DM secret."; then **Fixture Campaign** with Player 1 and Player 2 |
| 2 | Incognito window: open Player 1's link | "Playing as Player 1 in Fixture Campaign"; DM sees Player 1 online |
| 3 | DM: add a player "Thorn", copy its link, open it in a second browser (e.g. Edge) | Thorn joins; rename Thorn → Thorin on the DM side shows up for Thorn live |
| 4 | Reload every window | Everyone stays logged in / joined |
| 5 | DM: switch the active campaign to **Second Campaign** | Players see a waiting screen naming Fixture Campaign |
| 6 | DM: switch back | Players rejoin within a few seconds, no reload |
| 7 | Mangle a player link (change a few characters) | "This link isn't recognised…" |
| 8 | In the server terminal press Ctrl+C, then `bun run start --profile verify` again | All windows show "Reconnecting…", then come back with the same state |

## B. Live sync and the visibility filter (`sync-probe` bundle, test mode)

```powershell
# stop the server first (Ctrl+C)
$env:PP_TEST_MODE='1'
bun run fixtures:reset-load sync-probe --profile verify
bun run start --profile verify
```

| # | You do | Expect |
|---|---|---|
| 1 | DM + Player 1 (incognito) + Player 2 (other browser); open the **sync probes** panel in each | DM sees `public`, `secret`, `mine`; Player 1 sees `public` + `mine`; Player 2 sees only `public` |
| 2 | DM: reveal `secret`, then hide it | It appears for both players, then disappears, live |
| 3 | Player 1 edits `mine` | DM sees the edit; Player 2 never sees `mine` |
| 4 | Player 1: press "drop connection" | Banner "Reconnecting…", then back with the latest state |

Afterwards: `Remove-Item Env:PP_TEST_MODE`.

## C. Fixture rebuild

```powershell
# server stopped
bun run fixtures:reset-load session-sim --profile verify   # < 3 s; same player link every time
```

## What's not there yet

No map, tokens, windows or dice: that's the Scenes and Combat phases. The skeleton UI is deliberately plain.

## Teardown

Ctrl+C the server; `bun run fixtures:reset --profile verify`.
