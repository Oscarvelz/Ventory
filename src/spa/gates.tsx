// Replaces @/lib/auth/gates for the static app. Settings' account furniture (1.0.11, Oscar's layout):
// the account is its own card (identity + the sync state on one quiet line, "Sign in again" when a kept
// session has ended), the fingerprint control lives inside the Security fold, and Sign out is its own
// card at the very bottom — nothing loose under the folds.
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { askSignInAgain, lastUser, onUser, sessionGone, signOutEverywhereLocal, type VentoryUser } from "./cloud";
import { disableLock, enableLock, lockCredential, lockSupported } from "./lock";
import { forgetDevice, lastSynced, lastSyncError, pendingCount, syncIncomplete, syncNow } from "./store";
import { mirroredLang, tx, type Lang } from "@/lib/ventory/i18n";

export function useVentoryUser(): VentoryUser | null {
  const [u, setU] = useState<VentoryUser | null>(() => lastUser());
  useEffect(() => onUser(setU), []);
  return u;
}

function clock(iso: string, lang: Lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  const locale = lang === "es" ? "es" : "en-US";
  return today ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
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
  const lang = mirroredLang();
  const waiting = pendingCount();
  if (sessionGone()) return tx(lang, "door.syncPaused");
  if (!navigator.onLine) return waiting ? tx(lang, waiting === 1 ? "door.syncOfflineOne" : "door.syncOfflineOther", { n: waiting }) : tx(lang, "door.syncOfflinePlain");
  if (lastSyncError()) return waiting ? tx(lang, waiting === 1 ? "door.syncWaitOne" : "door.syncWaitOther", { n: waiting }) : tx(lang, "door.syncCouldNot");
  if (waiting && syncIncomplete()) return tx(lang, waiting === 1 ? "door.syncIncOne" : "door.syncIncOther", { n: waiting });
  if (waiting) return tx(lang, "door.syncing");
  const at = lastSynced();
  return at ? tx(lang, "door.syncedAt", { time: clock(at, lang) }) : tx(lang, "door.syncing");
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
  const label = user.name || user.email || tx(mirroredLang(), "door.accountFallback");
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
          {tx(mirroredLang(), "door.signInAgain")}
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
  if (!user) return <p className="text-sm leading-relaxed text-muted">{tx(mirroredLang(), "door.fpSignInFirst")}</p>;
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium">{tx(mirroredLang(), "door.fpTitle")}</span>
      <span className="text-xs leading-relaxed text-muted">
        {canLock
          ? tx(mirroredLang(), "door.fpDesc")
          : tx(mirroredLang(), "door.fpNone")}
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
              setLockMsg(tx(mirroredLang(), "door.fpFail"));
            }
          }}
        >
          {locked ? tx(mirroredLang(), "door.fpOff") : tx(mirroredLang(), "door.fpOn")}
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
        setWarn(tx(mirroredLang(), left === 1 ? "door.warnOne" : "door.warnOther", { n: left }));
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
        <span className="text-sm font-medium text-danger">{signingOut ? tx(mirroredLang(), "door.signingOut") : tx(mirroredLang(), "door.signOut")}</span>
      </button>
      {warn ? <p className="px-4 pb-3.5 text-xs text-danger">{warn}</p> : null}
    </section>
  );
}
