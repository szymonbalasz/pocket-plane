// Player page states; this wording is owned by campaign-management §7.
import { Card, CardContent } from "@ui/components/ui/primitives";
import { ColorPopover } from "@ui/features/campaign-management/ColorPopover";
import { useSync } from "@ui/sync/store";

export function InvalidLinkScreen() {
  return (
    <Centered testId="camp-invalid-link">
      This link isn't recognised. Check that you opened the whole link your DM sent.
    </Centered>
  );
}

export function WaitingScreen({ campaignName }: { campaignName: string }) {
  return (
    <Centered testId="camp-waiting">
      <strong data-testid="camp-waiting-campaign-name">{campaignName}</strong> isn't running right
      now. This page joins automatically when the DM starts it.
    </Centered>
  );
}

export function JoinedHeader({
  playerName,
  campaignName,
}: {
  playerName: string;
  campaignName: string;
}) {
  const playerId = useSync((s) => s.store.you?.playerId);
  return (
    <p data-testid="camp-player-joined">
      {/* FR-CAMP-27: the own colour dot opens the picker; its button's padding is the gap. */}
      Playing as{" "}
      {playerId && (
        <ColorPopover target={playerId} testId="camp-my-color" size={12} tip="Your colour" />
      )}
      <strong data-testid="camp-joined-player-name">{playerName}</strong> in{" "}
      <strong data-testid="camp-joined-campaign-name">{campaignName}</strong>
    </p>
  );
}

function Centered({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md" data-testid={testId}>
        <CardContent className="p-6 text-center">{children}</CardContent>
      </Card>
    </main>
  );
}
