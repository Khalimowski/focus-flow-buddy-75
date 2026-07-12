import { useEffect, useState } from "react";
import { CloudUpload, LogOut, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/lib/i18n";
import { fullSync, getSyncUser, signIn, signOut, signUp, type SyncUser } from "@/lib/sync";

export function AccountSync() {
  const { t } = useTranslation();
  const [user, setUser] = useState<SyncUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"in" | "up" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUser(getSyncUser());
  }, []);

  const submit = async (mode: "in" | "up") => {
    if (!email.trim() || !password) return;
    setBusy(mode);
    setError(null);
    try {
      const u = mode === "in" ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
      setUser(u);
      setPassword("");
    } catch (e) {
      console.error("[AccountSync] Auth failed:", e);
      setError(mode === "in" ? t("auth_signin_failed") : t("auth_signup_failed"));
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
  };

  const handleSyncNow = async () => {
    setBusy("sync");
    try {
      await fullSync();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <CloudUpload className="size-4" />
        <div className="flex flex-col">
          <Label className="text-sm font-medium">{t("account_sync")}</Label>
          <span className="text-xs text-muted-foreground">{t("account_sync_desc")}</span>
        </div>
      </div>

      {user ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserRound className="size-3.5" />
            <span className="truncate">{t("signed_in_as")} <span className="font-medium text-foreground">{user.email}</span></span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={handleSyncNow} disabled={busy !== null}>
              <RefreshCw className={`mr-1.5 size-3.5 ${busy === "sync" ? "animate-spin" : ""}`} />
              {t("sync_now")}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={handleSignOut} disabled={busy !== null}>
              <LogOut className="mr-1.5 size-3.5" />
              {t("sign_out")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            type="email"
            autoComplete="email"
            placeholder={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            autoComplete="current-password"
            placeholder={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => void submit("in")}
              disabled={busy !== null || !email.trim() || !password}
            >
              {busy === "in" ? "…" : t("sign_in")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => void submit("up")}
              disabled={busy !== null || !email.trim() || !password}
            >
              {busy === "up" ? "…" : t("sign_up")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
