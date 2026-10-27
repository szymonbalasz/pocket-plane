// Player page states; this wording is owned by campaign-management §7.
import { Card, CardContent } from "@ui/components/ui/primitives";

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
  // FR-CAMP-35: no colour dot here; the identity chip shows the colour (FR-SHELL-70).
  // Kit-parity FR-KIT-12: the campaign name as the title, then who you play, small and muted.
  return (
    <p data-testid="camp-player-joined" className="leading-tight">
      <span
        data-testid="camp-joined-campaign-name"
        data-slot="topbar-title"
        className="text-lg font-semibold"
      >
        {campaignName}
      </span>{" "}
      <span data-slot="topbar-sub" className="text-xs text-muted-foreground">
        · playing as <span data-testid="camp-joined-player-name">{playerName}</span>
      </span>
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
