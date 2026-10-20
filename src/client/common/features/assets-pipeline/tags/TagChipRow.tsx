// Tag filter chips (FR-ASSET-46, ASSET §7 row 3): All · built-ins in FR-ASSET-40 order · DM tags
// A–Z, each with its count · Untagged (only if ≥ 1). Badges as toggle buttons, one on at a time.
import type { TagChips, TagFilter } from "@shared/assets-pipeline/search";
import { Badge } from "@ui/components/ui/primitives";

interface Chip {
  id: string;
  label: string;
  count?: number;
  filter: TagFilter;
}

export function chipsOf(chips: TagChips): Chip[] {
  return [
    { id: "all", label: "All", filter: { kind: "all" } },
    ...chips.tags.map((c) => ({
      id: c.key,
      label: c.label,
      count: c.count,
      filter: { kind: "tag", key: c.key } as const,
    })),
    ...(chips.untagged > 0
      ? [
          {
            id: "untagged",
            label: "Untagged",
            count: chips.untagged,
            filter: { kind: "untagged" } as const,
          },
        ]
      : []),
  ];
}

const same = (a: TagFilter, b: TagFilter) =>
  a.kind === b.kind && (a.kind !== "tag" || (b.kind === "tag" && a.key === b.key));

export function TagChipRow({
  chips,
  filter,
  onFilter,
}: {
  chips: TagChips;
  filter: TagFilter;
  onFilter(f: TagFilter): void;
}) {
  return (
    <div role="toolbar" aria-label="Filter by tag" className="flex flex-wrap gap-1">
      {chipsOf(chips).map((c) => {
        const on = same(c.filter, filter);
        return (
          <button
            key={`${c.filter.kind}:${c.id}`}
            type="button"
            aria-pressed={on}
            data-testid="asset-picker-tag-chip"
            data-tag={c.id}
            data-state={on ? "on" : "off"}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onFilter(c.filter)}
          >
            <Badge variant={on ? "default" : "secondary"}>
              {c.label}
              {c.count !== undefined && <span className="opacity-70">{c.count}</span>}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
