import { useEffect, useState } from "react";
import { CloudOff, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import {
  AUTH_CHANGED_EVENT,
  getSyncStatus,
  getSyncUser,
  signOut,
  SYNC_STATUS_EVENT,
  type SyncUser,
} from "@/lib/sync";

function useSyncUser() {
  const [user, setUser] = useState<SyncUser | null>(null);

  useEffect(() => {
    setUser(getSyncUser());
    const onAuthChanged = () => setUser(getSyncUser());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  return [user, setUser] as const;
}

function useSyncStatus() {
  const [status, setStatus] = useState(getSyncStatus);
  useEffect(() => {
    const update = () => setStatus(getSyncStatus());
    update();
    window.addEventListener(SYNC_STATUS_EVENT, update);
    return () => window.removeEventListener(SYNC_STATUS_EVENT, update);
  }, []);
  return status;
}

export function SignedInAs() {
  const { t } = useTranslation();
  const [user] = useSyncUser();
  const status = useSyncStatus();

  if (!user) return null;

  // The account email plus whether sync is actually getting through: a device
  // that silently can't reach the server looks exactly like one that synced.
  return (
    <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <UserRound className="size-3.5 shrink-0" />
        <span className="truncate">
          {t("signed_in_as")} <span className="font-medium text-foreground">{user.email}</span>
        </span>
      </div>
      {status.failing ? (
        <div className="flex items-start gap-2 text-destructive">
          <CloudOff className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("sync_failing")}</span>
        </div>
      ) : status.lastOkAt ? (
        <div className="flex items-center gap-2">
          <RefreshCw className="size-3.5 shrink-0" />
          <span>
            {t("sync_last_ok").replace(
              "{time}",
              new Date(status.lastOkAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AccountSync() {
  const { t } = useTranslation();
  const { setGuestMode } = useI18nStore();
  const [user, setUser] = useSyncUser();

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
  };

  if (user) {
    return (
      <Button size="sm" variant="outline" className="w-full" onClick={handleSignOut}>
        <LogOut className="mr-1.5 size-3.5" />
        {t("sign_out")}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("guest_signin_prompt")}</p>
      <Button size="sm" className="w-full" onClick={() => setGuestMode(false)}>
        <LogIn className="mr-1.5 size-3.5" /> {t("sign_in_or_create")}
      </Button>
    </div>
  );
}
