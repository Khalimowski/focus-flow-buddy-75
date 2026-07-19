import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, KeyRound, LogIn, Mail, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import {
  GoogleTokenSignInUnsupportedError,
  requestPasswordReset,
  requestSignInOtp,
  resetPassword,
  signIn,
  signInWithEmailOtp,
  signInWithGoogle,
  signUp,
} from "@/lib/sync";

type Mode = "signin" | "signup" | "forgot" | "reset" | "code" | "codeverify";

// Google's official multicolor "G" (buttons must not recolor it per brand rules)
const GoogleG = () => (
  <svg className="mr-2 size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
    />
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09L2.18 7.07C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.86-3c-1.01.68-2.3 1.08-3.42 1.08-2.86 0-5.29-1.93-6.16-4.53l-3.66 2.84C3.99 20.53 7.7 23 12 23z"
    />
  </svg>
);

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

  const submitGoogle = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // Web returns null and navigates away to Google; native resolves with
      // the signed-in user once the account picker completes.
      const user = await signInWithGoogle();
      if (user) setGuestMode(false);
    } catch (e) {
      if (e instanceof GoogleTokenSignInUnsupportedError) {
        // Neon Auth can't finish native Google sign-in yet; fall back to a
        // sign-in code emailed to the account the user just picked.
        try {
          if (e.email) {
            setEmail(e.email);
            await requestSignInOtp(e.email);
            setOtp("");
            setMode("codeverify");
            setInfo(t("google_code_fallback"));
          } else {
            setMode("code");
            setInfo(t("google_code_fallback_no_email"));
          }
        } catch (e2) {
          console.error("[AuthGate]", e2);
          setError(t("signin_code_failed"));
        }
      } else {
        console.error("[AuthGate]", e);
        setError(t("google_signin_failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCodeRequest = () =>
    run(async () => {
      await requestSignInOtp(email.trim());
      setOtp("");
      setMode("codeverify");
      setInfo(t("signin_code_sent"));
    }, t("signin_code_failed"));

  const submitCodeVerify = () =>
    run(async () => {
      await signInWithEmailOtp(email.trim(), otp.trim());
      setGuestMode(false);
    }, t("code_signin_failed"));

  const canSubmit =
    email.trim().length > 3 &&
    (mode === "forgot" || mode === "code" || mode === "codeverify" || password.length > 0);

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
            disabled={busy || mode === "reset" || mode === "codeverify"}
          />

          {(mode === "reset" || mode === "codeverify") && (
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t("reset_code")}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={busy}
            />
          )}

          {mode !== "forgot" && mode !== "code" && mode !== "codeverify" && (
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
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("auth_or")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full" onClick={() => void submitGoogle()} disabled={busy}>
                <GoogleG /> {busy ? "…" : t("continue_with_google")}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setMode("code"); setError(null); setInfo(null); }}
                disabled={busy}
              >
                <Mail className="mr-2 size-4" /> {t("signin_with_code")}
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

          {mode === "code" && (
            <>
              <Button className="w-full" onClick={() => void submitCodeRequest()} disabled={busy || !canSubmit}>
                <Mail className="mr-2 size-4" /> {busy ? "…" : t("send_signin_code")}
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

          {mode === "codeverify" && (
            <>
              <Button
                className="w-full"
                onClick={() => void submitCodeVerify()}
                disabled={busy || !canSubmit || otp.trim().length === 0}
              >
                <KeyRound className="mr-2 size-4" /> {busy ? "…" : t("sign_in")}
              </Button>
              <button
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => { setMode("code"); setError(null); setInfo(null); }}
                disabled={busy}
              >
                {t("resend_signin_code")}
              </button>
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
