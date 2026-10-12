import type { CampaignRecord, JoinInfo, PlayerRecord } from "@shared/campaign-management/schemas";
import { ApiError, call, createApi } from "@ui/api";
import { Skeleton } from "@ui/components/ui/primitives";
import { ConnectionIndicator, ReconnectBanner } from "@ui/features/live-sync/ConnectionStatus";
import { ProbePanel } from "@ui/features/live-sync/ProbePanel";
import { SyncProvider } from "@ui/sync/SyncProvider";
import { useRecords, useSync } from "@ui/sync/store";
import { useEffect, useState } from "react";
import {
  InvalidLinkScreen,
  JoinedHeader,
  WaitingScreen,
} from "./features/campaign-management/screens";

const api = createApi();

function tokenFromPath(): string | null {
  const m = /^\/p\/([^/?#]+)/.exec(window.location.pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function Loading() {
  return (
    <div className="flex flex-col gap-3 p-6" data-testid="ui-loading">
      <Skeleton className="h-6 w-80" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function App() {
  const [token] = useState(tokenFromPath);
  const [join, setJoin] = useState<JoinInfo | "invalid" | null>(token ? null : "invalid");

  useEffect(() => {
    if (!token) return;
    call<JoinInfo>(api.api.join[":token"].$get({ param: { token } }))
      .then(setJoin)
      .catch((err) => {
        // 404 = unknown token (FR-CAMP-17). Anything else: try the WS anyway.
        if (err instanceof ApiError && err.status === 404) setJoin("invalid");
        else setJoin({ playerName: "", campaignName: "", campaignActive: true });
      });
  }, [token]);

  if (join === "invalid" || !token) return <InvalidLinkScreen />;
  if (join === null) return <Loading />;
  return (
    <SyncProvider credential={{ role: "player", token }}>
      <PlayerShell join={join} token={token} />
    </SyncProvider>
  );
}

function PlayerShell({ join, token }: { join: JoinInfo; token: string }) {
  const state = useSync((s) => s.state);
  const everLive = useSync((s) => s.everLive);
  const you = useSync((s) => s.store.you);
  const campaign = useRecords<CampaignRecord>("campaign")[0];
  const me = useRecords<PlayerRecord>("player").find((p) => p.id === you?.playerId);
  const [waitingName, setWaitingName] = useState(join.campaignName);

  // Waiting screen names the link's campaign; refresh it in case it was renamed.
  useEffect(() => {
    if (state !== "waiting") return;
    call<JoinInfo>(api.api.join[":token"].$get({ param: { token } }))
      .then((j) => setWaitingName(j.campaignName))
      .catch(() => {});
  }, [state, token]);

  if (state === "rejected") return <InvalidLinkScreen />;
  if (state === "waiting") return <WaitingScreen campaignName={waitingName} />;
  if (!everLive) return <Loading />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <JoinedHeader
          playerName={me?.name ?? join.playerName}
          campaignName={campaign?.name ?? join.campaignName}
        />
        <div className="ml-auto">
          <ConnectionIndicator />
        </div>
      </header>
      <ReconnectBanner />
      <main className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
        <ProbePanel />
      </main>
    </div>
  );
}
