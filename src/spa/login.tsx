// Ventory's own landing (src/components/ventory/landing.tsx), same look, signed in through Supabase instead of the
// Grok server. Adds what a cloud account needs: "Forgot password" and the new-password step from the email link.
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Fingerprint } from "lucide-react";
import { Wordmark } from "@/components/ventory/mark";
import { emitUser, keepSignedIn, rememberUser, setKeepSignedIn, supabase } from "./cloud";
import { mirroredLang, tx } from "@/lib/ventory/i18n";

export function Landing({ note, recovery }: { note?: string; recovery?: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10 lg:max-w-none lg:px-10">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{tx(mirroredLang(), "door.floorBook")}</p>
      <h1 className="mt-8">
        <Wordmark className="text-5xl" />
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        {tx(mirroredLang(), "door.tagline")}
      </p>
      <AccountForm note={note} recovery={recovery} />
    </main>
  );
}

/**
 * Every refusal is reported as what it actually is. Only a genuine invalid-credentials answer from
 * the server may say the details did not match — a connection failure, a rate limit, an unconfirmed
 * account or a server hiccup each say their own thing, never the password's fault. (Mapped on the
 * error's code first, its message second: the server's wording has changed before, its codes are
 * the contract.)
 */
function friendly(err: unknown, mode: string) {
  const lang = mirroredLang();
  const e = (err ?? {}) as { message?: string; code?: string; status?: number };
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return tx(lang, "door.errNoMatch");
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) return tx(lang, "door.errNotConfirmed");
  if (code === "over_request_rate_limit" || /rate.?limit|too many/i.test(code) || /rate.?limit|too many (requests|attempts)/i.test(message)) return tx(lang, "door.errRate");
  if (/fetch|network|load failed/i.test(message)) return navigator.onLine ? tx(lang, "door.errReach") : tx(lang, "door.errOffline");
  if ((typeof e.status === "number" && e.status >= 500) || /internal server|unexpected|service unavailable/i.test(message)) return tx(lang, "door.errHiccup");
  if (/already registered/i.test(message)) return tx(lang, "door.errAlready");
  return message || (mode === "up" ? tx(lang, "door.errCreate") : tx(lang, "door.errSignIn"));
}

function AccountForm({ note, recovery }: { note?: string; recovery?: boolean }) {
  const lang = mirroredLang();
  const t = (key: Parameters<typeof tx>[1], vars?: Record<string, string | number>) => tx(lang, key, vars);
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "reset">(recovery ? "reset" : "in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(keepSignedIn);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const here = window.location.origin + window.location.pathname;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (!navigator.onLine) throw new Error("network");
      if (mode === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: here });
        if (err) throw err;
        setInfo(t("door.checkEmailReset"));
        setMode("in");
        return;
      }
      if (mode === "reset") {
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw err;
        window.history.replaceState(null, "", here);
        const { data } = await supabase.auth.getSession();
        emitUser(rememberUser(data.session));
        return;
      }
      setKeepSignedIn(keep);
      if (mode === "up") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() || email.split("@")[0] || t("door.seller") }, emailRedirectTo: here },
        });
        if (err) throw err;
        if (!data.session) {
          setInfo(t("door.checkEmailConfirm"));
          setMode("in");
          return;
        }
        emitUser(rememberUser(data.session));
        return;
      }
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
      emitUser(rememberUser(data.session));
    } catch (err) {
      setError(friendly(err, mode));
    } finally {
      setBusy(false);
    }
  }

  const needsPassword = mode !== "forgot";
  return (
    <div className="mx-auto mt-8 w-full max-w-sm">
      {mode === "forgot" || mode === "reset" ? (
        <p className="mb-3 text-sm text-muted">{mode === "forgot" ? t("door.forgotIntro") : t("door.resetIntro")}</p>
      ) : null}
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        {mode === "up" ? (
          <label className="block text-sm">
            <span className="text-muted">{t("door.name")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-1 h-12 w-full rounded-md border border-line bg-panel px-3" />
          </label>
        ) : null}
        {mode !== "reset" ? (
          <label className="block text-sm">
            <span className="text-muted">{t("door.email")}</span>
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" className="mt-1 h-12 w-full rounded-md border border-line bg-panel px-3" />
          </label>
        ) : null}
        {needsPassword ? (
          <label className="block text-sm">
            <span className="text-muted">{mode === "reset" ? t("door.newPassword") : t("door.password")}</span>
            <span className="relative mt-1 block">
              <input
                required
                minLength={8}
                type={show ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                autoCapitalize="none"
                spellCheck={false}
                className="h-12 w-full rounded-md border border-line bg-panel px-3 pr-12"
              />
              <button
                type="button"
                aria-label={show ? t("door.hidePw") : t("door.showPw")}
                aria-pressed={show}
                onClick={() => setShow((value) => !value)}
                className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center text-muted"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </span>
          </label>
        ) : null}
        {mode === "in" || mode === "up" ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
            {t("door.keepIn")}
          </label>
        ) : null}
        {info ? <p className="text-sm text-muted">{info}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" disabled={busy} className="h-12 w-full rounded-md bg-accent text-sm font-medium text-accent-ink disabled:opacity-50">
          {busy ? t("door.working") : mode === "up" ? t("door.createAccount") : mode === "forgot" ? t("door.sendLink") : mode === "reset" ? t("door.savePassword") : t("door.signIn")}
        </button>
      </form>
      {mode === "in" || mode === "up" ? (
        <button
          type="button"
          className="mt-3 text-sm text-muted"
          onClick={() => {
            setMode(mode === "up" ? "in" : "up");
            setError("");
            setInfo("");
          }}
        >
          {mode === "up" ? t("door.haveAccount") : t("door.newHere")}
        </button>
      ) : null}
      {mode === "in" || mode === "forgot" ? (
        <button
          type="button"
          className="mt-2 block text-sm text-muted"
          onClick={() => {
            setMode(mode === "in" ? "forgot" : "in");
            setError("");
            setInfo("");
          }}
        >
          {mode === "in" ? t("door.forgotPw") : t("door.backToSignIn")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The fingerprint gate (1.0.10), in the landing's own clothes: the prompt itself opens on its own
 * (the gate asks once when the screen appears); this button is the way back in after a cancel, and
 * signing out is the escape hatch if the phone's biometrics ever refuse — the floor stays on this
 * device and the lock stays on for the account, exactly like Faro.
 */
export function Locked({ failed, onOpen, onSignOut }: { failed: boolean; onOpen: () => void; onSignOut: () => void }) {
  const lang = mirroredLang();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10 lg:max-w-none lg:px-10">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{tx(lang, "door.floorBook")}</p>
      <h1 className="mt-8">
        <Wordmark className="text-5xl" />
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">{tx(lang, "door.locked")}</p>
      <div className="mx-auto mt-8 w-full max-w-sm">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-ink"
        >
          <Fingerprint className="size-5" aria-hidden />
          {failed ? tx(lang, "door.tryAgain") : tx(lang, "door.unlockFp")}
        </button>
        {failed ? <p className="mt-3 text-sm text-danger">{tx(lang, "door.lockFailed")}</p> : null}
        <button type="button" onClick={onSignOut} className="mt-4 cursor-pointer text-sm text-muted underline-offset-4 hover:underline">
          {tx(lang, "door.signOutPw")}
        </button>
      </div>
    </main>
  );
}
