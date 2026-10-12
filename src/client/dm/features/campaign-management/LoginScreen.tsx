// FR-CAMP-02: DM login. Wrong secret → error; throttled → CAMP §7 wording.
import { ApiError, call, createApi } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@ui/components/ui/primitives";
import { useState } from "react";
import { useDmSession } from "./session";

export function LoginScreen() {
  const setSecret = useDmSession((s) => s.setSecret);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call(createApi(() => value).api.dm.login.$post());
      setSecret(value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Try again in a minute.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Wrong DM secret.");
      } else {
        setError("Could not reach the server.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Pocket Plane — DM login</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Label htmlFor="dm-secret">DM secret</Label>
            <Input
              id="dm-secret"
              data-testid="camp-login-secret"
              type="password"
              autoComplete="current-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error !== null}
              autoFocus
            />
            {error && (
              <Alert variant="destructive" data-testid="camp-login-error">
                {error}
              </Alert>
            )}
            <Button data-testid="camp-login-submit" type="submit" disabled={busy || value === ""}>
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
