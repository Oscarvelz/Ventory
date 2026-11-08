// Fingerprint / face unlock, the fleet's way (Faro's lock.ts, Brizna's device-lock.ts, same pattern):
// the check is the phone's own — inside the Android app, the shell's BiometricPrompt through window.VentoryNative
// (the bridge shipped in the shell from the start, waiting for this); in a browser or the installed PWA, a WebAuthn
// platform credential. Works offline: nothing is sent anywhere, and the only thing stored is a per-account flag on
// this device ("native", or the WebAuthn credential id). The flag survives signing out, so signing back in on this
// device never asks to set it up again; sign out from the lock screen with the password if biometrics ever fail.
import { inAndroidApp, nativeAuth, nativeCanAuth } from "./native";

const NATIVE = "native";
const KEY = (uid: string) => `ventory.lock.${uid}`;
const SEEN = (uid: string) => `ventory.lockSeen.${uid}`;

function b64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function rand(n: number) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export async function lockSupported(): Promise<boolean> {
  if (inAndroidApp()) return nativeCanAuth();
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function lockCredential(uid: string): string | null {
  try {
    return localStorage.getItem(KEY(uid));
  } catch {
    return null;
  }
}

export async function enableLock(uid: string, email: string): Promise<boolean> {
  markInternal(); // the prompt itself hides the page for a moment: coming back from it is not a trip away
  if (inAndroidApp()) {
    if (!(await nativeAuth())) return false;
    try {
      localStorage.setItem(KEY(uid), NATIVE);
    } catch {
      return false;
    }
    return true;
  }
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: "Ventory" },
      user: { id: new TextEncoder().encode(uid.slice(0, 64)), name: email || "Ventory", displayName: email || "Ventory" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  try {
    localStorage.setItem(KEY(uid), b64(cred.rawId));
  } catch {
    return false;
  }
  return true;
}

export function disableLock(uid: string) {
  try {
    localStorage.removeItem(KEY(uid));
  } catch {
    /* ignore */
  }
}

export async function unlock(uid: string): Promise<boolean> {
  const id = lockCredential(uid);
  if (!id) return true;
  markInternal(); // the prompt itself can hide the page: coming back from it never counts as leaving
  if (inAndroidApp()) return nativeAuth();
  if (id === NATIVE) return true; // set inside the app; a browser never shares its storage, so this is only a safety net
  const got = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: "public-key", id: unb64(id), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return Boolean(got);
}

/* ---------- when it asks again (Faro's timings, Oscar, Nov 1 2026) ----------
 * A fresh open always asks. Coming back asks only after a real trip away: a short grace absorbs flickers
 * (the notification shade, a system dialog), and if he was actively working in Ventory in the last 2 minutes
 * before leaving, a trip of up to 5 minutes comes back open — switching back and forth while working
 * shouldn't ask. Ventory's own trips out (the fingerprint prompt, the photo/file picker, a backup download)
 * hide the page too and NEVER count as leaving: no prompt loops. */

export const LEAVE_GRACE_MS = 10_000;
export const ACTIVE_WINDOW_MS = 2 * 60_000;
export const WORK_GRACE_MS = 5 * 60_000;

let touchedAt = 0;
if (typeof document !== "undefined") {
  const touch = () => {
    touchedAt = Date.now();
  };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(ev, touch, { capture: true, passive: true });
}
/** The grace a trip away that starts now has earned, from how recently Ventory was being used. */
export function graceForThisTrip(): number {
  return Date.now() - touchedAt < ACTIVE_WINDOW_MS ? WORK_GRACE_MS : LEAVE_GRACE_MS;
}

let internalAt = 0;
let hiddenAt = 0;
export function markInternal() {
  internalAt = Date.now();
}
/** Call when the page becomes visible again: true (once) if the trip away was one of Ventory's own. */
export function awayWasInternal(): boolean {
  const ok = internalAt > 0 && hiddenAt >= internalAt - 500 && hiddenAt - internalAt < 5000;
  internalAt = 0; // one mark covers one trip out
  return ok;
}
if (typeof document !== "undefined") {
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
    },
    true,
  );
  // a file input opens the system picker (piece photos, restoring a backup)
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as Element | null;
      try {
        if (t && t.closest && t.closest('input[type="file"], label:has(input[type="file"])')) markInternal();
      } catch {
        /* old engine */
      }
    },
    true,
  );
}

/* ---------- stamps the gate lives by ---------- */

/** Ventory was open and unlocked just now. */
export function markSeen(uid: string) {
  try {
    localStorage.setItem(SEEN(uid), String(Date.now()));
  } catch {
    /* ignore */
  }
}
export function lastSeen(uid: string): number {
  try {
    return Number(localStorage.getItem(SEEN(uid)) || 0);
  } catch {
    return 0;
  }
}

/* The service worker reloads the page to install an update; that reload is not a fresh open and must not
 * ask for the fingerprint mid-work. main.tsx stamps this in sessionStorage right before reloading. */
const UPDATE_FLAG = "ventory.updateReload";
export function stampUpdateReload() {
  try {
    sessionStorage.setItem(UPDATE_FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
}
/** True once, shortly after an update reload, if the floor was open within the working grace before it. */
export function quietResume(uid: string): boolean {
  try {
    const at = Number(sessionStorage.getItem(UPDATE_FLAG) || 0);
    sessionStorage.removeItem(UPDATE_FLAG);
    return at > 0 && Date.now() - at < 120_000 && Date.now() - lastSeen(uid) < WORK_GRACE_MS;
  } catch {
    return false;
  }
}
