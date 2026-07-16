import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brain, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useI18nStore } from "@/lib/i18n";
import { deleteAccount } from "@/lib/sync";

// Public account-deletion page. Google Play requires a URL where users can
// request deletion of their account and associated data, reachable without
// installing the app — so this route lives outside the AuthGate and is
// intentionally bilingual (the store listing is Polish, reviewers use both).
export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "Delete your account — Focus Flow" },
      {
        name: "description",
        content: "Request deletion of your Focus Flow account and all associated data.",
      },
    ],
  }),
  component: DeleteAccountPage,
});

type Status = "idle" | "busy" | "done" | "partial" | "error";

function DeleteAccountPage() {
  const { theme } = useI18nStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Standalone route: apply the stored theme ourselves (Home normally does this)
    const root = window.document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme !== "dark");
  }, [theme]);

  const submit = async () => {
    setStatus("busy");
    setError(null);
    try {
      const { accountDeleted } = await deleteAccount(email.trim(), password);
      setStatus(accountDeleted ? "done" : "partial");
    } catch (e) {
      console.error("[DeleteAccount]", e);
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  };

  const canSubmit = confirmed && email.trim().length > 3 && password.length > 0;
  const mailto =
    "mailto:khalim163@gmail.com?subject=Delete%20my%20Focus%20Flow%20account";

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-mint shadow-glow">
            <Brain className="size-7 text-background/90" strokeWidth={2.25} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Delete your Focus Flow account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Usuwanie konta Focus Flow</p>
        </div>

        <div className="space-y-4 text-sm leading-relaxed">
          <p>
            Deleting your account permanently removes your login (e-mail address and password)
            and all data synced to our servers: tasks, to-do items, nudges and streak history.
            This happens immediately and cannot be undone. Data stored only on your phone is
            removed by uninstalling the app.
          </p>
          <p className="text-muted-foreground">
            Usunięcie konta trwale kasuje Twój login (adres e-mail i hasło) oraz wszystkie dane
            zsynchronizowane z naszymi serwerami: zadania, listę do zrobienia, przypominajki i
            historię serii. Operacja jest natychmiastowa i nieodwracalna. Dane zapisane wyłącznie
            w telefonie usuniesz, odinstalowując aplikację.
          </p>
        </div>

        {(status === "idle" || status === "busy" || status === "error") && (
          <div className="mt-8 space-y-3 rounded-2xl border bg-card/50 p-5 backdrop-blur">
            <Input
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "busy"}
            />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Password / Hasło"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={status === "busy"}
            />
            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="confirm-delete"
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                disabled={status === "busy"}
              />
              <Label htmlFor="confirm-delete" className="text-xs font-normal leading-snug text-muted-foreground">
                I understand this permanently deletes my account and data. / Rozumiem, że moje
                konto i dane zostaną trwale usunięte.
              </Label>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              variant="destructive"
              className="w-full"
              onClick={() => void submit()}
              disabled={status === "busy" || !canSubmit}
            >
              <Trash2 className="mr-2 size-4" />
              {status === "busy" ? "…" : "Delete my account / Usuń moje konto"}
            </Button>
          </div>
        )}

        {status === "done" && (
          <div className="mt-8 rounded-2xl border bg-card/50 p-5 text-sm leading-relaxed backdrop-blur">
            <p className="font-medium">Your account and synced data have been deleted.</p>
            <p className="mt-1 text-muted-foreground">Twoje konto i zsynchronizowane dane zostały usunięte.</p>
          </div>
        )}

        {status === "partial" && (
          <div className="mt-8 rounded-2xl border bg-card/50 p-5 text-sm leading-relaxed backdrop-blur">
            <p className="font-medium">
              Your synced data has been deleted. Removing the login itself needs a manual step —
              please email us using the link below and we&apos;ll finish within 30 days.
            </p>
            <p className="mt-1 text-muted-foreground">
              Twoje dane zostały usunięte. Skasowanie samego loginu wymaga ręcznego kroku — napisz
              do nas przez poniższy link, a dokończymy usuwanie w ciągu 30 dni.
            </p>
          </div>
        )}

        <div className="mt-6 text-xs leading-relaxed text-muted-foreground">
          <p>
            Can&apos;t sign in, or prefer e-mail? Send a deletion request from your registered
            address to{" "}
            <a className="underline underline-offset-2" href={mailto}>
              khalim163@gmail.com
            </a>{" "}
            and we&apos;ll process it within 30 days.
          </p>
          <p className="mt-1">
            Nie możesz się zalogować lub wolisz e-mail? Wyślij prośbę o usunięcie konta z adresu,
            na który je założono, na{" "}
            <a className="underline underline-offset-2" href={mailto}>
              khalim163@gmail.com
            </a>{" "}
            — zrealizujemy ją w ciągu 30 dni.
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link to="/" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            ← Focus Flow
          </Link>
        </div>
      </div>
    </div>
  );
}
