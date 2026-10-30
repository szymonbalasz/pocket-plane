# Pocket Plane

A self-hosted virtual tabletop for one DM and a handful of remote players. 5E compatible, built on the SRD 5.1 rules. It runs on the DM's machine at game time; players join from a browser through a link, with no accounts.

Built for a single table, not as a product: no signup, no multi-tenant hosting, no support promises. Issues and ideas are welcome, but expect it to follow one group's needs.

## What it does

- **Scenes and map**: battlemaps, tokens, grid, walls, fog of war and per-token vision, ruler, ping, AoE templates, props.
- **Overviews**: a free canvas for the zoomed-out parts of the game, with no grid: map images, place labels with a dot, quest scrolls and party miniatures placed anywhere; hide and reveal them as the party explores.
- **Combat**: encounters, initiative, damage cards (players roll, the DM applies with hit / miss and half / double), conditions and effects, undo.
- **Character sheets**: full 5e sheets for PCs and NPCs, rolls straight from the sheet.
- **Dice**: game log, 3D dice, physical-dice entry, DM-hidden rolls.
- **Compendium**: SRD 5.1 monsters, spells and items, imported once and searchable. Optionally import your own 5etools books (monsters, spells, items); an entry that duplicates an SRD one hides it from search.
- **Party**: shared loot and coin, handouts, notifications, session recap and stats.
- **Live sync**: everything is server-authoritative over one WebSocket; players only ever receive what they're allowed to see. Survives reconnects and server restarts.

## Requirements

- [Bun](https://bun.sh) 1.3 or newer
- Git
- A modern desktop browser (Chrome, Edge, Firefox)
- Optional, for remote players: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

Developed and tested on Windows 11; the scripts are written to also run on macOS and Linux.

## Quick start: try it with demo data

```bash
git clone https://github.com/szymonbalasz/pocket-plane.git
cd pocket-plane
bun install
bun run env:init
bun run build
bun run fixtures:reset-load session-sim-13 --profile verify
bun run start --profile verify
```

- `env:init` writes a `.env` with a free port slot and a random DM secret.
- The fixture load prints the **DM URL**, the **DM secret** and **player links**, all on `http://127.0.0.1:<port>`.
- Open the DM URL and paste the secret. Open each player link in a separate browser or a private window.
- Stop with `Ctrl+C`. Reset the demo any time by re-running the `fixtures:reset-load` line.
- Demo data is for trying things locally: its player links are predictable, so never expose a demo profile through a tunnel.

## Running a real game

### 1. One-time setup

```bash
bun install
bun run env:init
```

- Keep the random `PP_DM_SECRET` that `env:init` wrote to `.env`; it's your DM password. To choose your own, use at least 12 characters and never one copied from a guide.
- Optional, in `.env`: `PP_PLAY_BACKUP_DIR` to send backups somewhere else (a synced folder such as OneDrive is fine for backups), `PP_PLAY_DATA_DIR` to keep the live data somewhere other than the default, `PP_PLAY_PORT` for another port. See [Configuration](#configuration).

### 2. Each game night

```bash
bun run play
```

- `play` keeps your campaign **outside the repo**, in your per-user data folder (Windows `%LOCALAPPDATA%\PocketPlane`, macOS `~/Library/Application Support/PocketPlane`, Linux `~/.local/share/pocket-plane`), apart from demo and test data. The fixture tools can never wipe it.
- On each start it backs up the database and images first (newest 10 kept), builds the client, then starts the server on port 4090. If the backup fails, it doesn't start and says why.
- Open the DM URL it prints and enter the DM secret.
- First run: create a campaign, then add your players. Each player gets a private link; use **Copy link** in the player list and send it to them.
- The database is created and upgraded automatically on start (with a `.pre-push-….bak` copy before any upgrade).
- `Ctrl+C` stops the server. State is saved as you play, so a crash or restart loses nothing; everyone reconnects on their own.
- Don't put the live data folder in OneDrive, Dropbox or similar: syncing the database while the server writes to it can lock or damage it. Point `PP_PLAY_BACKUP_DIR` there instead.

### 3. Let remote players in

Players reach your machine through a [cloudflared](https://developers.cloudflare.com/cloudflare-one/) tunnel. Quick tunnel, no Cloudflare account needed:

```bash
cloudflared tunnel --url http://127.0.0.1:<port>
```

- Use the port the server printed.
- Put the `https://….trycloudflare.com` URL it shows into `.env` as `PP_PUBLIC_BASE_URL`, then restart the server.
- Copy the player links again: quick-tunnel URLs change each time, but the links' tokens stay valid, so only the host part changes. A named Cloudflare tunnel keeps one URL.
- Unset `PP_PUBLIC_BASE_URL` → player links use the address the DM opened, which only works on your own machine.

### 4. Optional: import your 5etools books

Pocket Plane can read the books you pick from your own copy of 5etools. Nothing is downloaded for you or copied into the repo.

1. Download the **2014** build with images from [get.5e.tools](https://get.5e.tools): `5etools-2014-w-img-<version>.tar.xz`. The `2.x` builds are 2024 rules and won't work.
2. Extract it once, **outside the repo** (use 7-Zip if Windows `tar` complains). The folder must contain `data/` and `img/`:

   ```bash
   mkdir D:/5etools-2014
   tar -xf 5etools-2014-w-img-<version>.tar.xz -C D:/5etools-2014
   ```

3. Point `.env` at it and restart `play`:

   ```bash
   PP_5ETOOLS_DIR=D:/5etools-2014
   ```

4. Open **Compendium**. In the import panel's **Books** list, tick the books you want (**Select all** / **Select none** act on what the search shows) and click **Import selected**. Players pause for a few seconds per book; it's refused during combat. Once a book is imported the list stays folded: click **Books** to open it.

- "goblin" now finds one Goblin: an imported entry that is also in the SRD, or reprinted in another book you imported, hides the other from search. Old tokens and sheets keep working.
- New release: extract it over the same folder, reopen the Compendium, then click **Update all**.
- Token art is copied into a campaign the first time a monster is placed.
- Not yet: classes, races and feats; removing an imported book.

### Your data

Everything lives in the play data folder: the SQLite database (`pocket-plane.db`) and uploaded images (`assets/`). `play` backs both up on every start into `PP_PLAY_BACKUP_DIR` (default `<play folder>/backups`). To restore, stop the server and copy a backup `.db` over `pocket-plane.db`. Demo and test data live in the repo's git-ignored `data/` folder instead.

### 5. Optional: edit content with Claude Code (MCP)

Pocket Plane ships an MCP server so Claude Code can create creatures, homebrew and character sheets in your running game ([agent-api](docs/specs/agent-api.md)). It goes through the server's normal commands (checked, logged, live for players) and only works while the server runs. Register it once, from this folder:

```bash
claude mcp add --scope local pocket-plane -- bun run mcp:play
```

Restart Claude Code (or `/mcp` → reconnect) after pulling a new version. For testing on demo data, add a second one: `claude mcp add --scope local pocket-plane-test -- bun run mcp --profile verify`.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)). The ones you're likely to touch:

| Variable | Default | Meaning |
|---|---|---|
| `PP_DM_SECRET` | required | DM password, min 12 characters |
| `PP_PLAY_DATA_DIR` | per-user data folder | Live data for `bun run play`; refused inside the repo or the temp folder |
| `PP_PLAY_BACKUP_DIR` | `<play folder>/backups` | Where `play` writes its start-up backups |
| `PP_PLAY_PORT` | `4090` | Port for `bun run play` |
| `PP_DATA_DIR` | `data/<profile>` | Demo / test data folder for `start`, `dev` and the fixture tools |
| `PP_DATA_DISPOSABLE` | `1` from `env:init` | `1` lets the fixture tools wipe the demo / test folder; `play` always turns it off |
| `PP_PUBLIC_BASE_URL` | empty | Base for player links, e.g. your tunnel URL |
| `PP_5ETOOLS_DIR` | empty | Your extracted 5etools folder (read-only), for importing books; absolute or relative to the repo |
| `PP_SLOT` | set by `env:init` | Port slot: ports start at `4100 + 10 × slot` |
| `PP_PORT` | from slot | Fixed server port instead of the slot |
| `PP_HOST` | `127.0.0.1` | Bind address |
| `PP_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Development

| Command | Does |
|---|---|
| `bun run dev` | Server with watch + Vite with hot reload; DM URL is the Vite port |
| `bun run check` | Typecheck, lint and the tests near your changes; run before every commit (CI runs everything on each push) |
| `bun run check:full` | Every test incl. the slow set (CI runs it; locally only to chase a CI failure) |
| `bun run e2e` | Builds, then Playwright end-to-end flows |
| `bun run fixtures:reset-load <bundle>` | Reset the dev data and load a fixture bundle (bundles: `fixtures/bundles/`) |
| `bun run lint:fix` | Apply Biome formatting and safe fixes |

Stack: Bun, Hono, SQLite with Drizzle, React, Konva, Tailwind with shadcn/ui, zod. One package; server in `src/server/`, shared schemas in `src/shared/`, DM and player clients in `src/client/`.

### How this project is built

Most of the code is written by AI coding agents working in parallel git worktrees, each against a written spec, with a human DM making the calls. The process documents are part of the repo:

| If you want to… | Read |
|---|---|
| Know the rules every agent follows | [AGENTS.md](AGENTS.md) |
| Know what we're building and why | [docs/vision.md](docs/vision.md) |
| Read a feature's spec | [spec index](docs/specs/README.md) |
| Know what's already decided | [ADRs](docs/architecture/adr/README.md), [decisions log](docs/decisions-log.md) |
| See the system shape | [architecture overview](docs/architecture/overview.md) |
| Look up a term | [glossary](docs/glossary.md) |
| See the wire protocol and data model | [protocol](docs/protocol/README.md), [data model](docs/data-model/) |

## Licence

Code: [MIT](LICENSE).

Third-party content, each with its own licence and attribution:

- **SRD 5.1** rules content by Wizards of the Coast, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): [attribution](src/server/features/compendium/sources/srd-5.1/ATTRIBUTION.md)
- **Creature icons** from [game-icons.net](https://game-icons.net), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/): [attribution](src/client/common/features/entities/creature-art/ATTRIBUTION.md)
- **Theme fonts** from Google Fonts, [SIL OFL 1.1](https://openfontlicense.org): [attribution](src/client/common/themes/fonts/ATTRIBUTION.md)
- **UI components** adapted from [shadcn/ui](https://ui.shadcn.com), MIT: [notice](THIRD_PARTY_NOTICES.md)

5etools content is never bundled or committed: it is read from your own files, for private use at your table.

Pocket Plane is unofficial fan content and is not affiliated with or endorsed by Wizards of the Coast.
