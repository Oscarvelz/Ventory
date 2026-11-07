const WOMEN: Record<number, string> = {
  34: "4",
  35: "5",
  36: "6",
  37: "6.5",
  38: "7.5",
  39: "8.5",
  40: "9",
  41: "10",
  42: "11",
  43: "12",
};

const MEN: Record<number, string> = {
  39: "6",
  40: "7",
  41: "8",
  42: "8.5",
  43: "9.5",
  44: "10.5",
  45: "11.5",
  46: "12.5",
  47: "13.5",
};

export function convertToUs(system: string, label: string, fit: string): string | null {
  const n = Number(String(label).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  const sys = system.toUpperCase();
  if (sys === "US") return String(label).trim();
  const table = fit === "men" ? MEN : WOMEN;
  if (sys === "UK" && fit !== "men") return table[Math.round(n + 2)] ?? null;
  if (sys === "UK") return table[Math.round(n + 33)] ? WOMEN[Math.round(n + 2)] : table[Math.round(n)] ?? null;
  const key = Math.round(n);
  return table[key] ?? table[key - 1] ?? table[key + 1] ?? null;
}
