# Demo — Scenes (play-shell, assets-pipeline, entities, scenes-map)

Run from the repo root on `main` (PowerShell). Takes ~15 minutes. Three browser windows: **DM** (normal), **Player 1** (incognito), **Player 2** (another browser).

## Setup

```powershell
bun install
bun run build
$env:PP_TEST_MODE='1'      # shows the test-only Probes / Images windows; needed for "drop connection"
bun run fixtures:reset-load scenes --profile verify
bun run start --profile verify
```

The load prints the DM URL, DM secret and player links.

## A. Town → battlemap, tokens, hidden reveal (`scenes` bundle)

| # | You do | Expect |
|---|---|---|
| 1 | DM logs in; Player 1 and Player 2 open their links | DM: Scenes window ("Act 1": Town *Live*, Goblin Ambush; Cellar). Everyone sees Town with Mira and Thorn |
| 2 | Player 1 drags Mira 3 cells right; Player 2 tries to drag Mira | Player 1 sees "15 ft" while dragging; others see Mira move. Player 2's drag only pans |
| 3 | DM: click Goblin Ambush in the Scenes window | DM sees the battlemap with "Not shown to players"; Wolf and Elite Goblin are greyed (hidden). Players still on Town |
| 4 | DM: "Show to players" | Players switch to the battlemap: Mira, Thorn, Goblin, Cave Ogre — no Wolf, no Elite, no scene name |
| 5 | DM: right-click Wolf → Reveal | Wolf appears for players within a second. Hide it again → gone |
| 6 | DM: select Goblin, Ctrl+D; right-click the copy → rename "Goblin Chief", pick another image | "Goblin 2" appears next to it, then renamed with new art for everyone |
| 7 | DM: Ping tool, Shift+click a far corner | Players' views recentre with a pulse. Player 1 pings: you see it |
| 8 | DM: Creatures window → drag Goblin onto the map | A new Goblin token (numbered) — players see it unless you hide it |
| 9 | DM: Images (test) window → upload a PNG; use it as a new scene map ("New scene") | Upload shows in the picker; new scene at the root of the Scenes window; players see nothing of it |
| 10 | Player 1: Probes window → "drop connection"; DM moves Mira meanwhile | Player 1 shows "Reconnecting…", then Mira jumps to the new spot, no reload |
| 11 | Server terminal: Ctrl+C, then `bun run start --profile verify` | Everyone reconnects within ~2 s; everything from steps 2–9 is still there |

## B. Window layout (play-shell)

| # | You do | Expect |
|---|---|---|
| 1 | Player 1: move and resize a window, reload | Same place and size |
| 2 | Player 1: "Reset layout" | Default windows back |

## Known, not bugs

- While the server is down, the console logs one `ERR_CONNECTION_REFUSED` per reconnect probe (about 40 a minute). Expected.

Teardown: Ctrl+C the server, `bun run fixtures:reset --profile verify`.
