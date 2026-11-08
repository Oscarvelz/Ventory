// Fixed tones, lit for the Grid. Ventory's chips, rings and Advisor cards
// carry their own stored hues (a sage for On hand, an amber for Revenue…).
// In every theme those hues stand as they are; under Tron they follow Faro's
// tronize(): the hue is kept, the colour is lit like a light line on black —
// full saturation, a lightness tuned per hue band so each one glows evenly,
// and greys stay quiet. Read at render time from <html data-theme>, exactly
// like Faro's isTron(), so a theme flip relights every tone in the same frame.

export function isTron(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "tron";
}

export function tronize(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (d < 0.06) return `hsl(${h.toFixed(0)} 18% 70%)`;
  const light = h >= 45 && h < 170 ? 54 : h >= 200 && h < 290 ? 66 : 60;
  return `hsl(${h.toFixed(0)} 100% ${light}%)`;
}

/** A fixed tone as the current theme draws it: itself, or lit under Tron. */
export function tone(hex: string): string {
  return isTron() ? tronize(hex) : hex;
}
