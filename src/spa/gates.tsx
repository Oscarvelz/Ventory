// Replaces @/lib/auth/gates for the static app. Settings' account furniture (1.0.11, Oscar's layout):
// the account is its own card (identity + the sync state on one quiet line, "Sign in again" when a kept
// session has ended), the fingerprint control lives inside the Security fold, and Sign out is its own
// card at the very bottom — nothing loose under the folds.
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { askSignInAgain, lastUser, onUser, sessionGone, signOutEverywhereLocal, type VentoryUser } from "./cloud";
import { disableLock, enableLock, lockCredential, lockSupported } from "./lock";
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

/** The account card: who is signed in on this device, and whether the floor is synced. */
export function AccountCard() {
  const user = useVentoryUser();
  const line = useSyncLine();
  const [gone, setGone] = useState(sessionGone);
  useEffect(() => {
    const on = () => setGone(sessionGone());
    window.addEventListener("ventory-session", on);
    return () => window.removeEventListener("ventory-session", on);
  }, []);
  if (!user) return null;
  const label = user.name || user.email || "Account";
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-semibold text-accent">{label.charAt(0).toUpperCase()}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block truncate text-xs text-muted">{user.email}</span>
        </span>
      </div>
      <p className="mt-2.5 text-xs text-muted">{line}</p>
      {gone ? (
        <button type="button" className="press mt-2.5 h-11 rounded-full border border-line px-4 text-sm" onClick={askSignInAgain}>
          Sign in again
        </button>
      ) : null}
    </section>
  );
}

/** The fingerprint control, for the Security fold: on/off for this account on this device;
 *  turning it on first asks the phone to prove the fingerprint works. */
export function FingerprintControl() {
  const user = useVentoryUser();
  const [canLock, setCanLock] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockMsg, setLockMsg] = useState("");
  useEffect(() => {
    void lockSupported().then(setCanLock);
    if (user) setLocked(Boolean(lockCredential(user.id)));
  }, [user]);
  // Never an empty fold: without an account, say what the fold is waiting for (button audit V-7).
  if (!user) return <p className="text-sm leading-relaxed text-muted">Sign in to use fingerprint unlock on this device.</p>;
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium">Fingerprint unlock</span>
      <span className="text-xs leading-relaxed text-muted">
        {canLock
          ? "Asks for your fingerprint or face when Ventory opens on this device. Coming back within a few minutes while you work won't ask again. Works offline; nothing leaves the phone."
          : "This device has no fingerprint or screen lock available."}
      </span>
      {canLock ? (
        <button
          type="button"
          className="press mt-1.5 h-11 justify-self-start rounded-full border border-line px-4 text-sm"
          onClick={async () => {
            setLockMsg("");
            if (locked) {
              disableLock(user.id);
              setLocked(false);
              return;
            }
            try {
              setLocked(await enableLock(user.id, user.email));
            } catch {
              setLockMsg("Could not turn it on.");
            }
          }}
        >
          {locked ? "Turn off fingerprint unlock" : "Turn on fingerprint unlock"}
        </button>
      ) : null}
      {lockMsg ? <span className="text-xs text-danger">{lockMsg}</span> : null}
    </div>
  );
}

/** Sign out, in its own card at the very bottom of Settings. Unsynced changes still get their
 *  honest warning: the first tap says what would be left behind, the second confirms. */
export function SignOutCard() {
  const user = useVentoryUser();
  const [signingOut, setSigningOut] = useState(false);
  const [warn, setWarn] = useState("");
  if (!user) return null;

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
    <section className="rounded-2xl border border-line bg-panel">
      <button type="button" disabled={signingOut} onClick={() => void out()} className="press flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:cursor-wait">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger">
          <LogOut className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="text-sm font-medium text-danger">{signingOut ? "Signing out…" : "Sign out"}</span>
      </button>
      {warn ? <p className="px-4 pb-3.5 text-xs text-danger">{warn}</p> : null}
    </section>
  );
}
