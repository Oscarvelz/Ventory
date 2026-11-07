// Replaces @/lib/auth/gates for the static app: the same identity chip + "Sign out" at the foot of Settings, with the
// sync state on one quiet line and "Sign in again" when a kept session has ended.
import { useEffect, useState } from "react";
import { askSignInAgain, lastUser, onUser, sessionGone, signOutEverywhereLocal, type VentoryUser } from "./cloud";
import { forgetDevice, lastSynced, lastSyncError, pendingCount, syncNow } from "./store";

export function useVentoryUser(): VentoryUser | null {
  const [u, setU] = useState<VentoryUser | null>(() => lastUser());
  useEffect(() => onUser(setU), []);
  return u;
}

function clock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function useSyncLine() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    for (const ev of ["ventory-sync", "ventory-session", "online", "offline"]) window.addEventListener(ev, on);
    return () => {
      for (const ev of ["ventory-sync", "ventory-session", "online", "offline"]) window.removeEventListener(ev, on);
    };
  }, []);
  const waiting = pendingCount();
  if (sessionGone()) return "Sync is paused: your session ended. Everything stays on this device.";
  if (!navigator.onLine) return waiting ? `Offline. ${waiting} ${waiting === 1 ? "change waits" : "changes wait"} on this device.` : "Offline. Everything is on this device.";
  if (lastSyncError()) return waiting ? `${waiting} ${waiting === 1 ? "change waits" : "changes wait"} to sync.` : "Could not sync just now.";
  if (waiting) return "Syncing";
  const at = lastSynced();
  return at ? `Synced ${clock(at)}` : "Syncing";
}

export function UserButton() {
  const user = useVentoryUser();
  const line = useSyncLine();
  const [gone, setGone] = useState(sessionGone);
  const [signingOut, setSigningOut] = useState(false);
  const [warn, setWarn] = useState("");
  useEffect(() => {
    const on = () => setGone(sessionGone());
    window.addEventListener("ventory-session", on);
    return () => window.removeEventListener("ventory-session", on);
  }, []);
  if (!user) return null;
  const label = user.name || user.email || "Account";

  async function out() {
    if (!user) return;
    setSigningOut(true);
    try {
      if (pendingCount() && navigator.onLine && !sessionGone()) await syncNow();
      const left = pendingCount();
      if (left && !warn) {
        setWarn(`${left} ${left === 1 ? "change has" : "changes have"} not synced yet. Connect to the internet first, or tap Sign out again to discard ${left === 1 ? "it" : "them"}.`);
        setSigningOut(false);
        return;
      }
      await forgetDevice(user.id);
      await signOutEverywhereLocal();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20">{label.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 text-sm font-medium">{label}</span>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void out()}
          className="cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <p className="text-xs text-muted">{line}</p>
      {gone ? (
        <button type="button" className="press h-11 justify-self-start rounded-full border border-line px-4 text-sm" onClick={askSignInAgain}>
          Sign in again
        </button>
      ) : null}
      {warn ? <p className="text-xs text-danger">{warn}</p> : null}
    </div>
  );
}
