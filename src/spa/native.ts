/**
 * Ventory for Android: the WebView app (package com.oscarvelz.ventory, source in android/) puts `window.VentoryNative`
 * on the page. Everything here is feature-detected: in a browser or the installed PWA there is no VentoryNative,
 * startNative() returns at once and the web app behaves exactly as before.
 *
 * - Back: the phone's Back asks VentoryBack(). An open sheet (settings, editor, a question) closes the way a tap on its
 *   shade closes it; with nothing open the app hears atRoot() and shows "Press back again to close Ventory".
 * - Status/navigation bar colours follow the theme (meta theme-color at the top, the page colour at the bottom).
 * - Downloads (the backup JSON): the blob is handed to the app and saved in Downloads/Ventory.
 * - nativeAuth(): the phone's BiometricPrompt — since 1.0.10 it powers the fingerprint lock (spa/lock.ts,
 *   the fleet's pattern from Faro and Brizna): Settings turns it on per account, the gate in spa/main.tsx asks.
 */

export type VentoryNativeBridge = {
  version(): string;
  setBars(top: string, bottom: string, darkTop: boolean, darkBottom: boolean): void;
  atRoot(msg: string): void;
  canAuth(): string;
  authenticate(id: string, title: string, subtitle: string): void;
  saveBegin(name: string, mime: string): string;
  saveChunk(id: string, b64: string): string;
  saveEnd(id: string, msgTemplate: string): string;
};

type W = Window & { VentoryNative?: VentoryNativeBridge; VentoryBack?: () => string; __ventoryNativeOn?: boolean };

export function native(): VentoryNativeBridge | null {
  if (typeof window === "undefined") return null;
  const n = (window as W).VentoryNative;
  return n && typeof n.version === "function" ? n : null;
}

export const inAndroidApp = (): boolean => native() !== null;
export const APK_URL = "https://github.com/Oscarvelz/Ventory/releases/latest/download/Ventory.apk";

/* ---------- fingerprint (bridge only) ---------- */

export function nativeCanAuth(): boolean {
  const n = native();
  try {
    return !!n && n.canAuth() === "yes";
  } catch {
    return false;
  }
}

export function nativeAuth(): Promise<boolean> {
  const n = native();
  if (!n) return Promise.resolve(false);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; ok: boolean }>).detail;
      if (!d || d.id !== id) return;
      window.removeEventListener("ventorynative-auth", on);
      resolve(!!d.ok);
    };
    window.addEventListener("ventorynative-auth", on);
    try {
      n.authenticate(id, "Unlock Ventory", "Use your fingerprint or your screen lock");
    } catch {
      window.removeEventListener("ventorynative-auth", on);
      resolve(false);
    }
  });
}

/* ---------- back ---------- */

function installBack(n: VentoryNativeBridge) {
  (window as W).VentoryBack = () => {
    // The top-most sheet: its shade (the .veil-in layer) closes it on a tap, exactly like a finger would.
    const veils = [...document.querySelectorAll<HTMLElement>(".veil-in")];
    const top = veils[veils.length - 1];
    if (top) {
      top.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return "ok";
    }
    try {
      n.atRoot("Press back again to close Ventory");
    } catch {
      /* ignore */
    }
    return "root";
  };
}

/* ---------- system bar colours ---------- */

function rgb(c: string): [number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0];
  }
  const h = c.trim().match(/^#([0-9a-f]{6})$/i);
  return h ? [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)] : null;
}
const isDark = (v: [number, number, number]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] < 140;

function bottomColor(): string | null {
  let el = document.elementFromPoint(Math.round(innerWidth / 2), innerHeight - 2) as HTMLElement | null;
  while (el) {
    if (el.getBoundingClientRect().width >= innerWidth * 0.92) {
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        if ((p.length > 3 ? p[3] : 1) >= 0.5) return `rgb(${p[0] | 0}, ${p[1] | 0}, ${p[2] | 0})`;
      }
    }
    el = el.parentElement;
  }
  const b = getComputedStyle(document.body).backgroundColor;
  return rgb(b) ? b : null;
}

let barsNow: (() => void) | null = null;

/**
 * Send the bar colours to the shell IMMEDIATELY (1.0.5). applyTheme() calls this
 * synchronously inside the flip: before, the only path to the shell was the
 * 160ms-debounced MutationObserver below, so the content swapped in one frame
 * (1.0.4) while the shell's status strip and bottom background kept the old
 * theme for at least 160ms and caught up late. The shell paints what it is sent
 * the moment setBars lands — the wait was ours, here, not the shell's.
 */
export function syncBarsNow() {
  barsNow?.();
}

function installBars(n: VentoryNativeBridge) {
  let last = "";
  let queued = 0;
  const apply = () => {
    if (queued) {
      window.clearTimeout(queued);
      queued = 0;
    }
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const top = meta?.content || "#121410";
    const bottom = bottomColor() || top;
    const t = rgb(top);
    const b = rgb(bottom);
    if (!t || !b) return;
    const k = `${top}|${bottom}`;
    if (k === last) return;
    last = k;
    try {
      n.setBars(`rgb(${t.join(",")})`, `rgb(${b.join(",")})`, isDark(t), isDark(b));
    } catch {
      /* ignore */
    }
  };
  barsNow = apply;
  const soon = () => {
    if (!queued) queued = window.setTimeout(apply, 160);
  };
  new MutationObserver((muts) => {
    // A data-theme change is a flip: send the new colours in this same turn.
    // Anything else (class/style churn, scrolling content) keeps the debounce,
    // so the bridge is not spammed while the page moves.
    if (muts.some((m) => m.type === "attributes" && m.attributeName === "data-theme" && m.target === document.documentElement)) apply();
    else soon();
  }).observe(document.documentElement, { attributes: true, childList: true, subtree: true, attributeFilter: ["content", "data-theme", "class", "style"] });
  addEventListener("scroll", soon, { passive: true });
  addEventListener("resize", soon);
  document.addEventListener("visibilitychange", soon);
  soon();
}

/* ---------- downloads ---------- */

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function saveBlob(n: VentoryNativeBridge, name: string, blob: Blob) {
  const id = n.saveBegin(name || "Ventory", blob.type || "application/octet-stream");
  if (!id || id.startsWith("error")) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CH = 512 * 1024;
  for (let i = 0; i < bytes.length; i += CH) {
    if (n.saveChunk(id, b64(bytes.subarray(i, i + CH))) !== "ok") return;
  }
  n.saveEnd(id, "Saved in Downloads › Ventory: %s");
}

function installDownloads(n: VentoryNativeBridge) {
  // The backup link revokes its blob URL right after a.click(); keep the Blob itself so the app can still read it.
  const blobs = new Map<string, Blob>();
  const make = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const u = make(obj);
    if (obj instanceof Blob) blobs.set(u, obj);
    return u;
  };
  URL.revokeObjectURL = (u: string) => {
    window.setTimeout(() => {
      blobs.delete(u);
      revoke(u);
    }, 60_000);
  };
  const take = (a: HTMLAnchorElement): boolean => {
    if (!a.hasAttribute("download")) return false;
    const href = a.href || "";
    const name = a.getAttribute("download") || "Ventory";
    if (href.startsWith("blob:")) {
      const blob = blobs.get(href);
      if (blob) {
        void saveBlob(n, name, blob);
        return true;
      }
    }
    if (href.startsWith("blob:") || href.startsWith("data:")) {
      void fetch(href)
        .then((r) => r.blob())
        .then((b) => saveBlob(n, name, b))
        .catch(() => undefined);
      return true;
    }
    return false;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (take(this)) return;
    click.call(this);
  };
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[download]") as HTMLAnchorElement | null;
      if (a && take(a)) e.preventDefault();
    },
    true,
  );
}

export function startNative() {
  const n = native();
  const w = typeof window !== "undefined" ? (window as W) : null;
  if (!n || !w || w.__ventoryNativeOn) return;
  w.__ventoryNativeOn = true;
  document.documentElement.dataset.android = "";
  installBack(n);
  installBars(n);
  installDownloads(n);
}
