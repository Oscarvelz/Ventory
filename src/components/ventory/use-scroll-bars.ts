import { useEffect } from "react";

type Bars = {
  scroller: HTMLElement | Window | null;
  header: HTMLElement | null;
  dock: HTMLElement | null;
  /** true while a sheet covers the page: the top bar stays visible */
  pinned?: boolean;
};

export function useScrollBars({ scroller, header, dock, pinned = false }: Bars) {
  useEffect(() => {
    if (!scroller) return;
    const read = () => (scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop);
    let last = read();
    let headerTarget = 0;
    let dockTarget = 0;
    let headerVisual = 0;
    let dockVisual = 0;
    let headerH = 0;
    let dockTravel = 0;
    let raf = 0;
    let lastTs = 0;

    // Don't remeasure while hiding. A mid-height measure shortens the travel.
    const measureHeader = () => {
      if (!header) return 0;
      if (headerTarget > 1 && headerH > 0) return headerH;
      headerH = header.offsetHeight || 0;
      return headerH;
    };
    const measureDock = () => {
      if (!dock) return 0;
      if (dockTarget > 1 && dockTravel > 0) return dockTravel;
      const bottom = parseFloat(getComputedStyle(dock).bottom);
      const extra = Number.isFinite(bottom) ? Math.max(0, bottom) : 0;
      dockTravel = dock.offsetHeight + extra;
      return dockTravel;
    };

    const step = (ts = 0) => {
      const dt = lastTs ? Math.min(34, ts - lastTs) : 16;
      lastTs = ts;
      const y = read();
      if (y <= 0 || pinned) headerTarget = 0;
      if (y <= 0) dockTarget = 0;
      const H = measureHeader();
      const T = measureDock();
      headerTarget = Math.max(0, Math.min(H, headerTarget));
      dockTarget = Math.max(0, Math.min(T, dockTarget));
      const glide = 1 - Math.exp(-dt / 52);
      headerVisual += (headerTarget - headerVisual) * glide;
      dockVisual += (dockTarget - dockVisual) * glide;
      if (Math.abs(headerTarget - headerVisual) < 0.2) headerVisual = headerTarget;
      if (Math.abs(dockTarget - dockVisual) < 0.2) dockVisual = dockTarget;
      if (header) {
        header.style.transform = headerVisual > 0.2 ? `translate3d(0,${(-headerVisual).toFixed(2)}px,0)` : "";
        header.classList.toggle("is-away", H > 0 && headerVisual >= H - 0.5);
      }
      if (dock) {
        dock.style.transform = dockVisual > 0.2 ? `translate3d(0,${dockVisual.toFixed(2)}px,0)` : "";
        dock.classList.toggle("is-away", T > 0 && dockVisual >= T - 0.5);
      }
      if (Math.abs(headerTarget - headerVisual) > 0.2 || Math.abs(dockTarget - dockVisual) > 0.2) {
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
        lastTs = 0;
      }
    };

    const onScroll = () => {
      const y = read();
      let dy = y - last;
      last = y;
      dy *= 0.8;
      if (pinned || y <= 0) headerTarget = 0;
      else headerTarget += dy;
      if (y <= 0) dockTarget = 0;
      else dockTarget += dy;
      if (!raf) raf = requestAnimationFrame(step);
    };

    step();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const forget = () => {
      headerH = 0;
      dockTravel = 0;
    };
    window.visualViewport?.addEventListener("resize", forget);
    window.addEventListener("orientationchange", forget);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.visualViewport?.removeEventListener("resize", forget);
      window.removeEventListener("orientationchange", forget);
      if (raf) cancelAnimationFrame(raf);
      header?.style.removeProperty("transform");
      header?.classList.remove("is-away");
      dock?.style.removeProperty("transform");
      dock?.classList.remove("is-away");
    };
  }, [scroller, header, dock, pinned]);
}
