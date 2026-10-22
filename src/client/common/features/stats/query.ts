// `useStatsQuery`: one `stats.query` bound to the window (FR-STATS-17, -23): asks on mount and on
// input change, pokes on the live frames `wants` picks, asks after each snapshot, pauses while
// the window is minimised. The ack is parsed with the viewer's role schema (FR-STATS-05). A
// `pending` answer (FR-STATS-46: campaign partials still building) is asked again 1 s later.

import type { EventFrame } from "@shared/protocol/frames";
import { STATS_QUERY_INTENT, type StatsQueryInput } from "@shared/stats/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEventFrame, useSync } from "../../sync/store";
import { useWindowShown } from "../play-shell/ShellWindow";
import { PENDING_RETRY_MS } from "./logic";
import { createStatsQuery, type QueryState, type StatsQuery } from "./refresh";

const INITIAL = {
  input: null,
  status: "loading",
  result: null,
  resultFor: null,
  error: null,
} as const;

export function useStatsQuery<R>(
  input: StatsQueryInput,
  parse: (ack: unknown) => R,
  wants: (frame: EventFrame) => boolean,
  pending?: (result: R) => boolean,
): { state: QueryState<StatsQueryInput, R>; retry(): void } {
  const connection = useSync((s) => s.connection);
  const generation = useSync((s) => s.lazy?.generation);
  const shown = useWindowShown();
  const [state, setState] = useState<QueryState<StatsQueryInput, R>>(INITIAL);
  const q = useRef<StatsQuery<StatsQueryInput, R> | null>(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const inputKey = JSON.stringify(input);
  const now = useRef({ inputKey, shown });
  now.current = { inputKey, shown };

  useEffect(() => {
    const query = createStatsQuery<StatsQueryInput, R>({
      send: (i) =>
        connection.sendIntent(STATS_QUERY_INTENT, i).then((ack) => parseRef.current(ack)),
      onChange: setState,
    });
    q.current = query;
    query.setShown(now.current.shown);
    query.set(JSON.parse(now.current.inputKey) as StatsQueryInput);
    return () => {
      query.dispose();
      if (q.current === query) q.current = null;
    };
  }, [connection]);

  useEffect(() => {
    q.current?.set(JSON.parse(inputKey) as StatsQueryInput);
  }, [inputKey]);

  useEffect(() => q.current?.setShown(shown), [shown]);

  const seen = useRef(generation);
  useEffect(() => {
    if (seen.current === generation) return;
    seen.current = generation;
    q.current?.snapshot();
  }, [generation]);

  useEventFrame((frame) => {
    if (wants(frame)) q.current?.poke();
  });

  // FR-STATS-46: `{pending: true}` → re-query in 1 s (until a full answer).
  const isPending =
    state.status === "ok" && state.result !== null && (pending?.(state.result) ?? false);
  useEffect(() => {
    if (!isPending) return;
    const t = setTimeout(() => q.current?.retry(), PENDING_RETRY_MS);
    return () => clearTimeout(t);
  }, [isPending]);

  const retry = useCallback(() => q.current?.retry(), []);
  return { state, retry };
}
