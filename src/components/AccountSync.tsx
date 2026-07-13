import { useEffect, useState } from "react";
import { CloudUpload, KeyRound, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import {
  AUTH_CHANGED_EVENT,
  changePassword,
  fullSync,
  getSyncUser,
  signOut,
  type SyncUser,
} from "@/lib/sync";

export function AccountSync() {
  const { t } = useTranslation();
  const { setGuestMode } = useI18nStore();
  const [user, setUser] = useState<SyncUser | null>(null);
  const [busy, setBusy] = useState<"sync" | "password" | null>(null);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    setUser(getSyncUser());
    const onAuthChanged = () => setUser(getSyncUser());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

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

  const handleChangePassword = async () => {
    if (!currentPw || newPw.length < 8) {
      setPwError(t("password_change_failed"));
      return;
    }
    setBusy("password");
    setPwError(null);
    setPwSuccess(false);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw("");
      setNewPw("");
      setShowPasswordForm(false);
    } catch (e) {
      console.error("[AccountSync] Change password failed:", e);
      setPwError(t("password_change_failed"));
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
            <span className="truncate">
              {t("signed_in_as")} <span className="font-medium text-foreground">{user.email}</span>
            </span>
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

          {showPasswordForm ? (
            <div className="space-y-2 rounded-xl border bg-card/40 p-3">
              <Input
                type="password"
                autoComplete="current-password"
                placeholder={t("current_password")}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                disabled={busy !== null}
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={t("new_password")}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                disabled={busy !== null}
              />
              {pwError && <p className="text-xs text-destructive">{pwError}</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => void handleChangePassword()}
                  disabled={busy !== null || !currentPw || newPw.length < 8}
                >
                  {busy === "password" ? "…" : t("save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => { setShowPasswordForm(false); setPwError(null); }}
                  disabled={busy !== null}
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() => { setShowPasswordForm(true); setPwSuccess(false); }}
              disabled={busy !== null}
            >
              <KeyRound className="mr-1.5 size-3.5" /> {t("change_password")}
            </Button>
          )}
          {pwSuccess && <p className="text-xs text-mint">{t("password_changed")}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("guest_signin_prompt")}</p>
          <Button size="sm" className="w-full" onClick={() => setGuestMode(false)}>
            <LogIn className="mr-1.5 size-3.5" /> {t("sign_in_or_create")}
          </Button>
        </div>
      )}
    </div>
  );
}
