// Launch splash hand-off (1.1.3, Brizna's splash-ready pattern): the splash itself is inline in
// spa/index.html so it paints before any script loads. The app says when its first real screen is
// drawn; the splash then fades over it, so there is never a blank frame and the app's own loading
// view never shows as a second splash.

const w = (typeof window !== "undefined" ? window : undefined) as
  | (Window & { __ventoryShellReady?: boolean })
  | undefined;

/** The first real screen is on: tell the splash (after two frames, so it is really painted). Safe to call often. */
export function markShellReady() {
  if (!w || w.__ventoryShellReady) return;
  w.__ventoryShellReady = true;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      w.dispatchEvent(new Event("ventory:shell-ready"));
    }),
  );
}
