import { createClient, type Session } from "@supabase/supabase-js";
import { CLOUD_READY, SUPABASE_KEY, SUPABASE_URL } from "./config";
export { CLOUD_READY };

const LAST = "ventory.lastUser";

/** "Keep me signed in" ("Mantener sesión abierta"): on (default) = the session lives on this device until you sign out;
 *  off = it lives only while the app is open (sessionStorage), so you sign in each time. The switch routes the
 *  session TOKEN only — the identity memory (ventory.lastUser) always lives in localStorage, so no past or
 *  future position of this switch can strand it in storage that dies with the app. */
const KEEP = "ventory.keep";
export function keepSignedIn(): boolean {
  try { return localStorage.getItem(KEEP) !== "0"; } catch { return true; }
}
export function setKeepSignedIn(on: boolean) {
  try { localStorage.setItem(KEEP, on ? "1" : "0"); } catch { /* ignore */ }
}
function box(): Storage {
  return keepSignedIn() ? localStorage : sessionStorage;
}
const authStorage = {
  getItem: (k: string) => { try { return box().getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => {
    try {
      box().setItem(k, v);
      (keepSignedIn() ? sessionStorage : localStorage).removeItem(k);
    } catch { /* ignore */ }
  },
  removeItem: (k: string) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

export const supabase = createClient(CLOUD_READY ? SUPABASE_URL : "https://placeholder.supabase.co", CLOUD_READY ? SUPABASE_KEY : "placeholder", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "ventory-auth", storage: authStorage },
});

export type VentoryUser = { id: string; email: string; name: string };

export function rememberUser(s: Session | null): VentoryUser | null {
  if (!s?.user) return null;
  const u: VentoryUser = {
    id: s.user.id,
    email: s.user.email ?? "",
    name: (s.user.user_metadata?.name as string | undefined) || (s.user.user_metadata?.full_name as string | undefined) || s.user.email || "",
  };
  // Always localStorage (see the KEEP note): an identity hint is not a credential, and it must survive
  // exactly as long as the floor on this device does.
  try { localStorage.setItem(LAST, JSON.stringify(u)); } catch { /* ignore */ }
  return u;
}

/** The last signed-in user on this device. Lets Ventory open the floor on this device with no network. */
export function lastUser(): VentoryUser | null {
  // localStorage first; sessionStorage is checked too, to rescue a copy written there by an older build
  // (when the identity memory followed the "Keep me signed in" switch) so no one is stranded by the move.
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(LAST);
      if (!raw) continue;
      const u = JSON.parse(raw) as VentoryUser;
      if (u && typeof u.id === "string") return u;
    } catch { /* try the other box */ }
  }
  return null;
}

export function forgetUser() {
  try { localStorage.removeItem(LAST); sessionStorage.removeItem(LAST); } catch { /* ignore */ }
}

let listeners: ((u: VentoryUser | null) => void)[] = [];
export function onUser(fn: (u: VentoryUser | null) => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}
export function emitUser(u: VentoryUser | null) {
  listeners.forEach((f) => f(u));
}

export async function signOutEverywhereLocal() {
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* offline: still clear locally */ }
  try { localStorage.removeItem("ventory-auth"); sessionStorage.removeItem("ventory-auth"); } catch { /* ignore */ }
  forgetUser();
  emitUser(null);
}

/** True while a cloud session token sits in storage. The "Keep me signed in" switch routes the token
 *  between localStorage and sessionStorage, so both boxes are checked. */
export function hasStoredSession(): boolean {
  try { return !!(localStorage.getItem("ventory-auth") || sessionStorage.getItem("ventory-auth")); } catch { return false; }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The session for this launch, recovered patiently. A single cold getSession() used to decide
 * "signed in or not" for the whole launch: a refresh that hiccuped at that exact moment — the radio
 * still waking, a slow first connection — returned "no session" even when the stored sign-in was
 * sound, and the launch ended on the sign-in form. Recovery now retries while there is anything
 * left to recover: it stops as soon as a session appears, when the device is offline (nothing can
 * refresh until the radio returns), or when storage provably holds no session at all. A definitive
 * refresh rejection removes the stored session (the auth client's own doing), so the loop then
 * concludes at once instead of spinning.
 */
export async function recoverSession(): Promise<Session | null> {
  const waits = [0, 900, 2200, 4500];
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await sleep(waits[i]);
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session;
    } catch { /* a failed read is a reason to wait, never a reason to conclude */ }
    if (!hasStoredSession()) return null;
    if (!navigator.onLine) return null;
  }
  return null;
}

/**
 * Ask the browser to keep this origin's storage — the sign-in and the floor — instead of treating
 * it as evictable "best effort" storage that can be purged when the device runs low on space.
 * Granted silently when granted at all; a no-op where the API is missing.
 */
export function requestPersistentStorage() {
  try {
    const store = navigator.storage;
    if (!store || typeof store.persist !== "function" || typeof store.persisted !== "function") return;
    void store
      .persisted()
      .then((already) => (already ? undefined : store.persist()))
      .catch(() => undefined);
  } catch { /* ignore */ }
}

/** Kept signed in but the cloud session ended (password changed, token revoked…): Ventory stays open with
 *  the floor on this device; Settings offers "Sign in again" to resume syncing. */
let gone = false;
export function sessionGone() { return gone; }
export function setSessionGone(v: boolean) {
  if (gone === v) return;
  gone = v;
  try { window.dispatchEvent(new Event("ventory-session")); } catch { /* ignore */ }
}
export function askSignInAgain() {
  try { window.dispatchEvent(new Event("ventory-relogin")); } catch { /* ignore */ }
}
