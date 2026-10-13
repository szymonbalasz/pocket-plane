# Playtest — MVP (Phase 5)

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). ~30–45 minutes. **DM** (normal browser) + **Player 1 / Mira** (incognito) + **Player 2 / Thorn** (another browser). Acceptance run: [verify-mvp report](../../.verify/20261013-222244-mvp-acceptance/report.md) (local, gitignored) — PLAYTEST READY, #169.

## Setup

```powershell
bun install
bun run build
bun run fixtures:reset-load session-sim --profile verify
bun run start --profile verify
```

The load prints the **DM URL**, **DM secret** and **two player links** (`http://127.0.0.1:4112/…`). Open the DM URL, paste the secret; open each player link in its own browser. Optional: `$env:PP_TEST_MODE='1'` before `start` for the Probes window ("drop connection").

**Known before you start** (from the acceptance run):
- Thorn has no token in `session-sim`: drag Thorn from **Creatures** onto Town and the battlemap before play.
- Windows start at the edges, map-first; open the rest from the dock. Window layout is remembered per browser.

## A. Town and joining

| # | You do | Expect |
|---|---|---|
| 1 | Players open their links | Town scene, map + tokens, own sheet; no setup |
| 2 | Mira drags her token | Label "15 / 30 ft" (5/10/5 diagonals); amber beyond speed, red beyond double; never blocked. DM and Thorn see the move |
| 3 | DM: try the ruler, ping, laser; change a token's **Shape** (round / square / none) | Everyone sees the shape change |

## B. Battlemap and encounter

| # | You do | Expect |
|---|---|---|
| 4 | DM: Scenes → Goblin Ambush → **Show to players**; reveal / hide the Wolf | Players switch; hidden tokens never shown to them |
| 5 | Encounters → "Ambush at the Ford" | Goblin ×2, Wolf, Elite; **Deadly**, 250 / 625 XP, CR 1.25 |
| 6 | **Start** → confirm; **Roll monsters**; players roll Initiative from the sheet (Shift = advantage) | Order sorted; players never see hidden rolls |

## C. Combat

| # | You do | Expect |
|---|---|---|
| 7 | Next to a player's turn | That player: flash + ping + "Your turn" toast (sound control in their top bar) |
| 8 | Player moves | Initiative row shows movement used vs speed; resets on Next, not on Prev |
| 9 | Mira: sheet **Attack** | Damage card for the DM. Select targets on the map (click, Ctrl/Shift+click, Ctrl/Shift+drag box) → popup lists them; set Hit / Miss and Normal / Half / None / Double per target → **Apply** |
| 10 | Apply to the wrong target, then **Undo** | One Undo reverts the whole apply; card pending again |
| 11 | DM: a monster attacks Mira until 0 HP | **Down** on Mira's token for everyone (no HP numbers for other players); monsters show only a health band to players |
| 12 | Mira: an ability **Check** and a **Save** from the sheet; DM: Initiative row → Check ▸ / Save ▸ for a monster | Logged with the right bonus; DM rolls hidden unless the category is ticked public in the game log |
| 13 | Turn **Physical dice** on in the game log, roll | Roll buttons show a marker; popover names the roll; "Roll for me" escape; entered rolls tagged physical |
| 14 | Stop the server (`Ctrl+C`) mid-combat, start it again | Everyone reconnects alone; round, turn, HP, cards, log, movement intact |
| 15 | Encounters → **End** | Initiative closes for players |

## D. Loot

| # | You do | Expect |
|---|---|---|
| 16 | DM: Loot → add "Goblin hoard" 25 gp 40 sp | Toast + history for everyone; pot updates |
| 17 | DM: Move 10 gp pot → Mira; Mira: Move 2 gp Mira → pot | Pot and every wallet match on all screens; Mira can't touch Thorn's coin or move coin outside the party |

## Things to watch and note

- Anything that feels slow, confusing or wrong at the table, even if it "works".
- Known glitches still open (#169): downed monsters' turns are skipped with no cue; a previous map selection can pre-fill attack targets; no End button in the Initiative window; the DM's physical rolls aren't tagged; a DM-overridden hit reads "13 — hit! vs AC 15"; a PC at 0 HP has no Down badge in the Initiative row; "2/2 online" stays during an outage; all token art is the same silhouette.

## Teardown

`Ctrl+C` the server, then `bun run fixtures:reset --profile verify`.
