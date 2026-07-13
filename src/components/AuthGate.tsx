import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, KeyRound, LogIn, Mail, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import { requestPasswordReset, resetPassword, signIn, signUp } from "@/lib/sync";

type Mode = "signin" | "signup" | "forgot" | "reset";

// Full-screen login page shown on launch until the user signs in or picks
// guest mode. Sign-in/up success is broadcast via AUTH_CHANGED_EVENT (from
// sync.ts), which the Home route listens to.
export function AuthGate() {
  const { t } = useTranslation();
  const { setGuestMode } = useI18nStore();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, failMsg: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      console.error("[AuthGate]", e);
      setError(failMsg);
    } finally {
      setBusy(false);
    }
  };

  const submitAuth = () =>
    run(async () => {
      if (mode === "signin") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
      setGuestMode(false);
    }, mode === "signin" ? t("auth_signin_failed") : t("auth_signup_failed"));

  const submitForgot = () =>
    run(async () => {
      await requestPasswordReset(email.trim());
      setMode("reset");
      setInfo(t("reset_code_sent"));
    }, t("reset_email_failed"));

  const submitReset = () =>
    run(async () => {
      await resetPassword(email.trim(), otp.trim(), password);
      await signIn(email.trim(), password);
      setGuestMode(false);
    }, t("reset_failed"));

  const canSubmit = email.trim().length > 3 && (mode === "forgot" || password.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-mint shadow-glow">
            <Brain className="size-7 text-background/90" strokeWidth={2.25} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("app_name")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot" || mode === "reset" ? t("reset_password") : t("auth_gate_subtitle")}
          </p>
        </div>

        <div className="space-y-3 rounded-2xl border bg-card/50 p-5 backdrop-blur">
          <Input
            type="email"
            autoComplete="email"
            placeholder={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || mode === "reset"}
          />

          {mode === "reset" && (
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t("reset_code")}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={busy}
            />
          )}

          {mode !== "forgot" && (
            <Input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder={mode === "reset" ? t("new_password") : t("password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          )}

          {info && <p className="text-xs text-mint">{info}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}

          {(mode === "signin" || mode === "signup") && (
            <>
              <Button className="w-full" onClick={() => void submitAuth()} disabled={busy || !canSubmit}>
                {mode === "signin" ? <LogIn className="mr-2 size-4" /> : <UserPlus className="mr-2 size-4" />}
                {busy ? "…" : mode === "signin" ? t("sign_in") : t("sign_up")}
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
                  disabled={busy}
                >
                  {mode === "signin" ? t("auth_no_account") : t("auth_have_account")}
                </button>
                {mode === "signin" && (
                  <button
                    className="text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => { setMode("forgot"); setError(null); }}
                    disabled={busy}
                  >
                    {t("forgot_password")}
                  </button>
                )}
              </div>
            </>
          )}

          {mode === "forgot" && (
            <>
              <Button className="w-full" onClick={() => void submitForgot()} disabled={busy || !canSubmit}>
                <Mail className="mr-2 size-4" /> {busy ? "…" : t("send_reset_code")}
              </Button>
              <button
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                disabled={busy}
              >
                {t("back_to_signin")}
              </button>
            </>
          )}

          {mode === "reset" && (
            <>
              <Button
                className="w-full"
                onClick={() => void submitReset()}
                disabled={busy || !canSubmit || otp.trim().length === 0}
              >
                <KeyRound className="mr-2 size-4" /> {busy ? "…" : t("reset_password")}
              </Button>
              <button
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                disabled={busy}
              >
                {t("back_to_signin")}
              </button>
            </>
          )}
        </div>

        <div className="mt-6 text-center">
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setGuestMode(true)} disabled={busy}>
            <UserRound className="mr-2 size-4" /> {t("continue_guest")}
          </Button>
          <p className="mx-auto mt-2 max-w-xs text-[11px] leading-relaxed text-muted-foreground/80">
            {t("guest_note")}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
