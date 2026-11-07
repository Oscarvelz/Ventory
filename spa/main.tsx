import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import { House } from "@/components/ventory/house";
import { CLOUD_READY, emitUser, keepSignedIn, lastUser, rememberUser, setSessionGone, supabase } from "@/spa/cloud";
import { useVentoryUser } from "@/spa/gates";
import { Landing } from "@/spa/login";
import { openFloor, startAutoSync, syncNow } from "@/spa/store";
import { startNative } from "@/spa/native";

// The app's own loading line (landing.tsx BootScreen), shown while the session and the floor on this device open.
function Boot() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <p className="font-display text-2xl text-ink">Opening the floor</p>
    </main>
  );
}

function Floor({ uid }: { uid: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setReady(false);
    void (async () => {
      try {
        await openFloor(uid);
        // A device that has never synced this account waits (briefly) for the floor from the cloud, so it opens full.
        const fresh = !localStorage.getItem(`ventory.synced.${uid}`);
        if (uid !== "local") {
          const first = syncNow().then(() => localStorage.setItem(`ventory.synced.${uid}`, "1"));
          if (fresh && navigator.onLine) await Promise.race([first, new Promise((r) => setTimeout(r, 12000))]);
        }
      } catch {
        /* the floor on this device still opens */
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [uid]);
  if (!ready) return <Boot />;
  return <House key={uid} />;
}

function Gate() {
  const user = useVentoryUser();
  const [booted, setBooted] = useState(!CLOUD_READY);
  const [recovery, setRecovery] = useState(false);
  const [expiredRaw, setExpired] = useState(false);
  const [relogin, setRelogin] = useState(false);
  // "Keep me signed in": an ended cloud session doesn't close the floor; Settings offers "Sign in again".
  const softExpired = expiredRaw && keepSignedIn() && !relogin;
  const expired = expiredRaw && !softExpired;
  useEffect(() => {
    setSessionGone(expiredRaw);
  }, [expiredRaw]);
  useEffect(() => {
    const go = () => setRelogin(true);
    window.addEventListener("ventory-relogin", go);
    return () => window.removeEventListener("ventory-relogin", go);
  }, []);

  useEffect(() => {
    if (!CLOUD_READY) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (session) {
        setExpired(false);
        setRelogin(false);
        emitUser(rememberUser(session));
      }
    });
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (data.session) emitUser(rememberUser(data.session));
        else if (!error && lastUser() && navigator.onLine) setExpired(true);
      } catch {
        /* offline: keep the remembered user */
      }
      setBooted(true);
    })();
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!CLOUD_READY) {
    if (/[?&]gate=(in|reset)/.test(location.search)) return <Landing recovery={/gate=reset/.test(location.search)} />;
    return <Floor uid="local" />;
  }
  if (!booted) return <Boot />;
  if (recovery) return <Landing recovery />;
  if (!user || expired) return <Landing note={expired ? "Your session ended. Sign in again to sync; your floor is still on this device." : undefined} />;
  return <Floor uid={user.id} />;
}

startNative(); // Ventory for Android only; a no-op in the browser and the PWA
startAutoSync();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          nw?.addEventListener("statechange", () => {
            // A new release is in: reload once, unless a sheet is open (then it waits for the next launch).
            if (nw.state === "activated" && navigator.serviceWorker.controller && !document.querySelector(".veil-in")) location.reload();
          });
        });
        setInterval(() => void reg.update(), 60 * 60 * 1000);
      })
      .catch(() => undefined);
  });
}
