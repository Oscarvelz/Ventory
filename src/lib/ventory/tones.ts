// Fixed tones, lit for the Grid. Ventory's chips, rings and Advisor cards
// carry their own stored hues (a sage for On hand, an amber for Revenue…).
// In every theme those hues stand as they are; under Tron they are mapped
// the way Faro and Weekly map theirs — by MEANING first, by hue second.
//
// 1.0.14 (the redesign after Oscar's rejection of the first Tron): the
// first pass lit every hue at full neon saturation, semantics included —
// the sage that means "ready, well" became radioactive green and flooded
// the Advisor (bar, checks, dots, buttons), the amber second light all but
// vanished, and contrast died. The family's Tron keeps two lights with
// jobs: teal for what is well and coming in, AMBER for what needs
// attention (Clu's side), Ares red rare. So the three semantic tones map
// to those exact lights, and only the categorical hues are lit — softly:
// their hue at a civilised saturation and lightness, distinct, not loud.

export function isTron(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "tron";
}

const TRON_SEMANTIC: Record<string, string> = {
  "#5f8f72": "#3fd6f5", // Ventory's green — ready, well, on hand → the teal light
  "#b08a3e": "#ffb21e", // amber — attention, oldest, missing → Clu's amber
  "#a33b32": "#ff5148", // red — loss, danger → Ares red
};

/** A categorical hue, lit softly: same hue, 78% saturation, banded light. */
export function tronize(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (d < 0.06) return `hsl(${h.toFixed(0)} 14% 66%)`;
  const light = h >= 45 && h < 170 ? 48 : h >= 200 && h < 290 ? 58 : 52;
  return `hsl(${h.toFixed(0)} 78% ${light}%)`;
}

/** A fixed tone as the current theme draws it: itself, or mapped/lit under Tron. */
export function tone(hex: string): string {
  if (!isTron()) return hex;
  return TRON_SEMANTIC[hex.trim().toLowerCase()] ?? tronize(hex);
}

/** Text colour on a lit tone: dark on the Grid's bright lights, the caller's pale elsewhere. */
export function toneInk(pale: string): string {
  return isTron() ? "#06121a" : pale;
}
