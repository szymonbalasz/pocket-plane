// `useRecapQuery`: one `recap.query` bound to the Recap window (FR-RECAP-06, -07): asks on mount
// and on input change, pokes on the live frames `wants` picks (asks at once on `urgent`'s), asks
// after each snapshot, pauses while the window is minimised. The ack is parsed with the viewer's role schema (FR-RECAP-08).
import type { EventFrame } from "@shared/protocol/frames";
import { RECAP_QUERY_INTENT, type RecapQueryInput } from "@shared/session-recap/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEventFrame, useSync } from "../../sync/store";
import { useWindowShown } from "../play-shell/ShellWindow";
import { createRecapQuery, type QueryState, type RecapQuery } from "./query";

const INITIAL = {
  input: null,
  status: "loading",
  result: null,
  resultFor: null,
  error: null,
} as const;

export function useRecapQuery<R>(
  input: RecapQueryInput,
  parse: (ack: unknown) => R,
  wants: (frame: EventFrame) => boolean,
  /** Frames that ask at once (a new share of this session: its note and omit, FR-RECAP-22). */
  urgent: (frame: EventFrame) => boolean = () => false,
): { state: QueryState<RecapQueryInput, R>; retry(): void } {
  const connection = useSync((s) => s.connection);
  const generation = useSync((s) => s.lazy?.generation);
  const shown = useWindowShown();
  const [state, setState] = useState<QueryState<RecapQueryInput, R>>(INITIAL);
  const q = useRef<RecapQuery<RecapQueryInput, R> | null>(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const wantsRef = useRef({ wants, urgent });
  wantsRef.current = { wants, urgent };
  const inputKey = JSON.stringify(input);
  const now = useRef({ inputKey, shown });
  now.current = { inputKey, shown };

  useEffect(() => {
    const query = createRecapQuery<RecapQueryInput, R>({
      send: (i) =>
        connection.sendIntent(RECAP_QUERY_INTENT, i).then((ack) => parseRef.current(ack)),
      onChange: setState,
    });
    q.current = query;
    query.setShown(now.current.shown);
    query.set(JSON.parse(now.current.inputKey) as RecapQueryInput);
    return () => {
      query.dispose();
      if (q.current === query) q.current = null;
    };
  }, [connection]);

  useEffect(() => {
    q.current?.set(JSON.parse(inputKey) as RecapQueryInput);
  }, [inputKey]);

  useEffect(() => q.current?.setShown(shown), [shown]);

  const seen = useRef(generation);
  useEffect(() => {
    if (seen.current === generation) return;
    seen.current = generation;
    q.current?.snapshot();
  }, [generation]);

  useEventFrame((frame) => {
    if (wantsRef.current.urgent(frame)) q.current?.snapshot();
    else if (wantsRef.current.wants(frame)) q.current?.poke();
  });

  const retry = useCallback(() => q.current?.retry(), []);
  return { state, retry };
}
