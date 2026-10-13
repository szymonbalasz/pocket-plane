# Demo — Combat (character-sheet, dice-roll-log, notifications, combat-tracker)

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). ~20 minutes. **DM** (normal browser) + **Player 1 / Mira** (incognito) + optionally **Player 2 / Thorn** (another browser).

## Setup

```powershell
bun install
bun run build
$env:PP_TEST_MODE='1'      # test-only windows (Probes) for "drop connection"
bun run fixtures:reset-load combat --profile verify
bun run start --profile verify
```

The load prints the DM URL, DM secret and player links. Fixed dice in fixtures; real play is random.

## A. Prep and start

| # | You do | Expect |
|---|---|---|
| 1 | DM: view Goblin Ambush → "Show to players". Open **Encounters** → "Ambush at the Ford" | Goblin ×2, Wolf, Elite; party Mira, Thorn; **Deadly**, 250 / 625 XP, total CR 1.25 |
| 2 | Add a Wolf in the picker, remove it again; Creatures → Derive Goblin → "Goblin Boss", AC 17, HP 21 | Rating updates live; Goblin Boss listed as Custom; players see nothing of it |
| 3 | **Start** → preview → confirm | Initiative window: 6 rows, Wolf + Elite hidden (eye-off). Players see 4 combatants |
| 4 | Roll monsters. Mira: sheet **Shift+Initiative** (advantage). Start round 1 | Order sorted; players never see Wolf / Elite rolls |

## B. Attacks, damage cards, undo

| # | You do | Expect |
|---|---|---|
| 5 | Mira: sheet **Attack** | Public roll line in the game log; Mira's card "Waiting for DM"; DM gets a sticky toast |
| 6 | DM: open the card → target Goblin → Apply (try Double) | Outcome line for everyone; Mira sees "Hit Goblin: N damage"; players see Goblin only as Bloodied / Down |
| 7 | DM: Elite row → Attack → target Mira → Hit → Apply | Mira's sheet HP drops; players don't see the hidden Elite's line |
| 8 | DM: **Undo**, Undo | Mira's HP back, Goblin's band back; the cards are pending again; log lines struck |
| 9 | DM: Reveal Wolf; try to delete Goblin 2's token; Remove Goblin 2 from combat | Wolf appears in initiative for players; delete refused ("Token is in a running encounter") |

## C. Game log and resilience

| # | You do | Expect |
|---|---|---|
| 10 | DM: game-log gear → tick "Attack" public; roll a DM attack; untick | Players see the public one, nothing of the hidden one |
| 11 | Mira: Probes → "drop connection" while DM clicks Next | Mira: banner, then the current turn without reload |
| 12 | Server terminal: Ctrl+C, `bun run start --profile verify` | Everyone back in ~2 s; round, turn, HP, pending cards, log intact |
| 13 | DM: **End** | Ended in the list; players' Initiative window goes away |

## Known, not bugs

- When the DM attacks *for* a PC from the sheet, the popup doesn't open by itself; open the card from Pending or the toast.
- While the server is down the console logs one `ERR_CONNECTION_REFUSED` per reconnect probe.
- Party loot isn't built yet (Phase 4).

Teardown: Ctrl+C the server, `bun run fixtures:reset --profile verify`.
