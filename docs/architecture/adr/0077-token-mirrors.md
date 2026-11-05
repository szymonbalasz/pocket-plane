# 0077 — Several floors on one map, with token mirrors

- Status: accepted (DM, 2026-11-01)
- Date: 2026-11-01
- Consistent with: [ADR-0021](0021-sync-protocol-conventions.md) (visibility reads record + viewer), [ADR-0042](0042-dynamic-vision.md) (a fog subject's `seenBy`), [ADR-0041](0041-active-scene-window.md), [ADR-0016](0016-domain-events-pending-actions.md)
- Affects: [token-mirrors](../../specs/token-mirrors.md), [assets-pipeline](../../specs/assets-pipeline.md), [scenes-map](../../specs/scenes-map.md); protocol, data model

## Context

- A fight in an inn has a cellar, two floors and a roof: too close together for separate scenes, and a player on the roof must still see the yard.
- On Owlbear the DM used four images on one map, and players had to remember what they could see from where.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. Levels with see-through openings: floor outlines, sight between levels, a camera per level | Looks right, sight is physical | Sight, drawing and the single active scene all change; many edge cases; the DM foresaw many problems |
| B. Linked scenes, players on different scenes at once | Each floor stays a normal scene | Every player sees one active scene today; combat starts from one scene |
| **C. One map holding every floor, walls between them, Teleport to change floor, mirrors to show a token elsewhere** | Walls, fog, Teleport and combat already work; the server learns nothing about floors; the DM decides what shows | Looking up isn't automatic; rulers and templates ignore height; the DM assembles the image |

## Decision

**C.** A mirror is its own record, not a token.

- **Own table, not a linked token.** Combat binds the next unbound token of a creature, and caps, menus and selection all read tokens. A separate table keeps every one of them out by construction.
- **Modes decide sight.** Visible is an ordinary fog subject at the mirror's own cells, so the common case (a yard goblin seen from the roof) needs nothing new. Transparent and Shadow ignore walls: that is how looking up works, since a mirror drawn over the inn's interior sits behind its walls. *(Amended 2026-11-05, [#443](../../decisions-log.md): every shown mode is a fog subject like Visible; the DM places the mirror where the watchers' sight reaches.)*
- **Copies on the record.** Name, art and size are copied so visibility reads only the record, and a Shadow's are removed from the player's copy.
- **Fail safe.** A hidden or Invisible token holds its mirrors back; a teleport sets them to Hidden, because the old distance would put them somewhere wrong.
- **Image limits rise** to 100 MB, 100 MP and 8192 px shown: players get the `display` copy, so 4096 px would blur a sheet of floors.

## Consequences

- Fog's scene re-derive gains one subject type; a token-changed hook keeps mirrors with their token; scene copy copies them.
- ~~Transparent and Shadow reach every player, including one who pans to that part of the map (accepted by the DM).~~ Amended (#443): only players with sight to the mirror.
- An 8192 px map may take around 270 MB in each browser. Not measured on a weak device.
- Teleport leaves no trail (FR-MAP-123): it is a stealth option, and fog decides who sees its smoke.
