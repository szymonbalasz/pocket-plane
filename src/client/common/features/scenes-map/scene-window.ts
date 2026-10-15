// Active-scene window on the client (ADR-0041): the DM snapshot holds only the active scene's
// tokens (and later SCN rows); any view of another scene loads it first.
import { useEffect } from "react";
import { useSync } from "../../sync/store";
import { toastReject } from "./intents";

/**
 * Whether `sceneId`'s windowed rows are held in full. DM: sends `sync.loadScene` when they
 * aren't (once per scene per snapshot; the connection keeps one load in flight per scene).
 * A reject toasts; the next view (a new `sceneId`, a remount or a reconnect) retries.
 * Players: always true (the scene gate already gives them the active scene in full).
 */
export function useSceneLoaded(sceneId: string | null): boolean {
  const connection = useSync((s) => s.connection);
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const live = useSync((s) => s.state === "live");
  const loaded = useSync((s) => sceneId !== null && s.scenes.loaded.includes(sceneId));
  useEffect(() => {
    if (!isDm || !live || loaded || sceneId === null) return;
    connection.loadScene(sceneId)?.catch(toastReject);
  }, [connection, isDm, live, loaded, sceneId]);
  return !isDm || sceneId === null || loaded;
}
