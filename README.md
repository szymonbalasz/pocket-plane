# Pocket Plane

A self-hosted virtual tabletop for one DM and a handful of remote players. D&D 5e (2014 SRD 5.1). It runs on the DM's machine at game time; players join from a browser through a link, with no accounts.

Built for a single table, not as a product: no signup, no multi-tenant hosting, no support promises. Issues and ideas are welcome, but expect it to follow one group's needs.

## What it does

- **Scenes and map**: battlemaps, tokens, grid, walls, fog of war and per-token vision, ruler, ping, AoE templates, props.
- **Combat**: encounters, initiative, damage cards (players roll, the DM applies with hit / miss and half / double), conditions and effects, undo.
- **Character sheets**: full 5e sheets for PCs and NPCs, rolls straight from the sheet.
- **Dice**: game log, 3D dice, physical-dice entry, DM-hidden rolls.
- **Compendium**: SRD 5.1 monsters, spells and items, imported once and searchable.
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

## Running a real game

### 1. One-time setup

```bash
bun install
bun run env:init
```

Then edit `.env`:

```ini
# Keep your campaign apart from demo and test data
PP_DATA_DIR=data/live
# Must be empty for real data: "1" lets the fixture tools wipe the folder
PP_DATA_DISPOSABLE=
# Pick your own, at least 12 characters. Env only, never stored
PP_DM_SECRET=choose-a-long-secret
```

### 2. Each game night

```bash
bun run build
bun run start
```

- The server prints the DM URL. Open it, enter the DM secret.
- First run: create a campaign, then add your players. Each player gets a private link; use **Copy link** in the player list and send it to them.
- The database is created and upgraded automatically on start.
- `Ctrl+C` stops the server. State is saved as you play, so a crash or restart loses nothing; everyone reconnects on their own.

### 3. Let remote players in

Players reach your machine through a [cloudflared](https://developers.cloudflare.com/cloudflare-one/) tunnel. Quick tunnel, no Cloudflare account needed:

```bash
cloudflared tunnel --url http://127.0.0.1:<port>
```

- Use the port the server printed.
- Put the `https://….trycloudflare.com` URL it shows into `.env` as `PP_PUBLIC_BASE_URL`, then restart the server.
- Copy the player links again: quick-tunnel URLs change each time, but the links' tokens stay valid, so only the host part changes. A named Cloudflare tunnel keeps one URL.
- Unset `PP_PUBLIC_BASE_URL` → player links use the address the DM opened, which only works on your own machine.

### Your data

Everything lives in `PP_DATA_DIR`: the SQLite database (`pocket-plane.db`) and uploaded images (`assets/`). Back up that folder. `data/` is git-ignored.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)). The ones you're likely to touch:

| Variable | Default | Meaning |
|---|---|---|
| `PP_DM_SECRET` | required | DM password, min 12 characters |
| `PP_DATA_DIR` | `data/<profile>` | Where the database and assets live |
| `PP_DATA_DISPOSABLE` | empty | `1` only for test data that may be wiped |
| `PP_PUBLIC_BASE_URL` | empty | Base for player links, e.g. your tunnel URL |
| `PP_SLOT` | set by `env:init` | Port slot: ports start at `4100 + 10 × slot` |
| `PP_PORT` | from slot | Fixed server port instead of the slot |
| `PP_HOST` | `127.0.0.1` | Bind address |
| `PP_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Development

| Command | Does |
|---|---|
| `bun run dev` | Server with watch + Vite with hot reload; DM URL is the Vite port |
| `bun run check` | Typecheck, lint and tests; run before every commit |
| `bun run check:full` | `check` plus the slow test set |
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

Pocket Plane is unofficial fan content and is not affiliated with or endorsed by Wizards of the Coast.
