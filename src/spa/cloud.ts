import { createClient, type Session } from "@supabase/supabase-js";
import { CLOUD_READY, SUPABASE_KEY, SUPABASE_URL } from "./config";
export { CLOUD_READY };

const LAST = "ventory.lastUser";

/** "Keep me signed in" ("Mantener sesión abierta"): on (default) = the session lives on this device until you sign out;
 *  off = it lives only while the app is open (sessionStorage), so you sign in each time. */
const KEEP = "ventory.keep";
export function keepSignedIn(): boolean {
  try { return localStorage.getItem(KEEP) !== "0"; } catch { return true; }
}
export function setKeepSignedIn(on: boolean) {
  try {
    localStorage.setItem(KEEP, on ? "1" : "0");
    if (!on) localStorage.removeItem(LAST);
  } catch { /* ignore */ }
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
  try { box().setItem(LAST, JSON.stringify(u)); } catch { /* ignore */ }
  return u;
}

/** The last signed-in user on this device. Lets Ventory open the floor on this device with no network. */
export function lastUser(): VentoryUser | null {
  try {
    const raw = box().getItem(LAST);
    if (!raw) return null;
    const u = JSON.parse(raw) as VentoryUser;
    return u && typeof u.id === "string" ? u : null;
  } catch {
    return null;
  }
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
