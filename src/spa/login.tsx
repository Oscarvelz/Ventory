// Ventory's own landing (src/components/ventory/landing.tsx), same look, signed in through Supabase instead of the
// Grok server. Adds what a cloud account needs: "Forgot password" and the new-password step from the email link.
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Wordmark } from "@/components/ventory/mark";
import { emitUser, keepSignedIn, rememberUser, setKeepSignedIn, supabase } from "./cloud";

export function Landing({ note, recovery }: { note?: string; recovery?: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">Floor book</p>
      <h1 className="mt-8">
        <Wordmark className="text-5xl" />
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Every boot, watch, and listing. Where it came from, what size it is, who bought it, and how long it sat with you.
      </p>
      <AccountForm note={note} recovery={recovery} />
    </main>
  );
}

function friendly(message: string, mode: string) {
  if (/invalid login credentials/i.test(message)) return "Those details did not match.";
  if (/already registered/i.test(message)) return "That email already has an account. Sign in instead.";
  if (/fetch|network/i.test(message)) return navigator.onLine ? "Could not reach Ventory. Try again in a moment." : "You're offline. Connect to sign in the first time.";
  return message || (mode === "up" ? "Could not create the account." : "Could not sign in.");
}

function AccountForm({ note, recovery }: { note?: string; recovery?: boolean }) {
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
        setInfo("Check your email for a link to make a new password.");
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
          options: { data: { name: name.trim() || email.split("@")[0] || "Seller" }, emailRedirectTo: here },
        });
        if (err) throw err;
        if (!data.session) {
          setInfo("Check your email to confirm the account, then sign in.");
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
      setError(friendly(err instanceof Error ? err.message : "", mode));
    } finally {
      setBusy(false);
    }
  }

  const needsPassword = mode !== "forgot";
  return (
    <div className="mt-8 w-full max-w-sm">
      {mode === "forgot" || mode === "reset" ? (
        <p className="mb-3 text-sm text-muted">{mode === "forgot" ? "Enter your email and we'll send a link to make a new password." : "Choose a new password."}</p>
      ) : null}
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        {mode === "up" ? (
          <label className="block text-sm">
            <span className="text-muted">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-1 h-12 w-full rounded-md border border-line bg-panel px-3" />
          </label>
        ) : null}
        {mode !== "reset" ? (
          <label className="block text-sm">
            <span className="text-muted">Email</span>
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-1 h-12 w-full rounded-md border border-line bg-panel px-3" />
          </label>
        ) : null}
        {needsPassword ? (
          <label className="block text-sm">
            <span className="text-muted">{mode === "reset" ? "New password" : "Password"}</span>
            <span className="relative mt-1 block">
              <input
                required
                minLength={8}
                type={show ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                className="h-12 w-full rounded-md border border-line bg-panel px-3 pr-12"
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
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
            Keep me signed in
          </label>
        ) : null}
        {info ? <p className="text-sm text-muted">{info}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" disabled={busy} className="h-12 w-full rounded-md bg-accent text-sm font-medium text-accent-ink disabled:opacity-50">
          {busy ? "Working" : mode === "up" ? "Create account" : mode === "forgot" ? "Send link" : mode === "reset" ? "Save password" : "Sign in"}
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
          {mode === "up" ? "Already have an account? Sign in" : "New here? Create an account"}
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
          {mode === "in" ? "Forgot your password?" : "Back to sign in"}
        </button>
      ) : null}
    </div>
  );
}
