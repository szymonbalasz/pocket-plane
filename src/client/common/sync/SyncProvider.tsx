import type { Credential } from "@shared/protocol/frames";
import { useEffect, useState } from "react";
import { createSyncStore, SyncContext } from "./store";

/** Owns one sync connection for its lifetime. Re-mount (key) to change the credential. */
export function SyncProvider({
  credential,
  children,
}: {
  credential: Credential;
  children: React.ReactNode;
}) {
  const [store] = useState(() => createSyncStore(credential));
  useEffect(() => {
    const c = store.getState().connection;
    c.start();
    return () => c.stop();
  }, [store]);
  return <SyncContext.Provider value={store}>{children}</SyncContext.Provider>;
}
