import { useEffect, useState } from "react";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import {
  AUTH_CHANGED_EVENT,
  getSyncUser,
  signOut,
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

export function SignedInAs() {
  const { t } = useTranslation();
  const [user] = useSyncUser();

  if (!user) return null;

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <UserRound className="size-3.5" />
      <span className="truncate">
        {t("signed_in_as")} <span className="font-medium text-foreground">{user.email}</span>
      </span>
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
