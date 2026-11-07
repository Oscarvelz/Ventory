import { type ButtonHTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

function paint(host: HTMLElement, x: number, y: number) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const well = host.querySelector<HTMLElement>("[data-ripple-well]") ?? host;
  const rect = well.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const size = Math.hypot(rect.width, rect.height);
  const ink = document.createElement("span");
  ink.className = "ventory-ripple";
  ink.setAttribute("aria-hidden", "true");
  ink.style.width = `${size}px`;
  ink.style.height = `${size}px`;
  ink.style.left = `${x - size / 2}px`;
  ink.style.top = `${y - size / 2}px`;
  ink.style.background = `color-mix(in srgb, ${host.dataset.ripple || "var(--v-ink)"} 36%, transparent)`;
  well.appendChild(ink);
  window.setTimeout(() => ink.remove(), 640);
}

export function pressRipple(event: ReactPointerEvent<HTMLElement>) {
  const host = event.currentTarget;
  const well = host.querySelector<HTMLElement>("[data-ripple-well]") ?? host;
  const rect = well.getBoundingClientRect();
  paint(host, event.clientX - rect.left, event.clientY - rect.top);
}

export function rippleNav(id: string) {
  const host = document.querySelector<HTMLElement>(`[data-nav="${id}"]`);
  if (!host) return;
  const well = host.querySelector<HTMLElement>("[data-ripple-well]") ?? host;
  const rect = well.getBoundingClientRect();
  paint(host, rect.width / 2, rect.height / 2);
}

export function RippleButton({
  ink,
  nav,
  className = "",
  onPointerDown,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { ink?: string; nav?: string; children?: ReactNode }) {
  return (
    <button
      type={type}
      data-nav={nav}
      data-ripple={ink}
      onPointerDown={(event) => {
        pressRipple(event);
        onPointerDown?.(event);
      }}
      className={`relative isolate ${className}`}
      {...rest}
    >
      <span data-ripple-well className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" />
      {children}
    </button>
  );
}
