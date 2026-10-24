import type { CampaignRecord, JoinInfo, PlayerRecord } from "@shared/campaign-management/schemas";
import { ApiError, call, createApi } from "@ui/api";
import { Skeleton } from "@ui/components/ui/primitives";
import { linkTokenFromPath } from "@ui/session";
import { SyncProvider } from "@ui/sync/SyncProvider";
import { useRecords, useSync } from "@ui/sync/store";
import { useEffect, useState } from "react";
import {
  InvalidLinkScreen,
  JoinedHeader,
  WaitingScreen,
} from "./features/campaign-management/screens";
import { PlayerPlayPage } from "./features/play-shell/PlayerPlayPage";

const api = createApi();

const tokenFromPath = () => linkTokenFromPath(window.location.pathname);

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

  // Play shell (FR-SHELL-02/04): these screens replace the whole frame; windows survive them.
  const screen =
    state === "rejected" ? (
      <InvalidLinkScreen />
    ) : state === "waiting" ? (
      <WaitingScreen campaignName={waitingName} />
    ) : !everLive ? (
      <Loading />
    ) : null;

  return (
    <PlayerPlayPage
      screen={screen}
      header={
        <JoinedHeader
          playerName={me?.name ?? join.playerName}
          campaignName={campaign?.name ?? join.campaignName}
        />
      }
    />
  );
}
