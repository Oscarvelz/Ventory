export const THEMES = [
  { id: "night", label: "Night", color: "#121410", ink: "#f3f0e8", accent: "#6f947c" },
  { id: "day", label: "Day", color: "#f4f1ea", ink: "#1a1c17", accent: "#3f6b50" },
  { id: "dusk", label: "Dusk", color: "#1c1612", ink: "#f6efe6", accent: "#c4846a" },
  { id: "pine", label: "Pine", color: "#0e1a14", ink: "#e7f0e4", accent: "#8fb89a" },
  { id: "ink", label: "Ink", color: "#0c0e12", ink: "#e8eaee", accent: "#8aa0b8" },
  { id: "bone", label: "Bone", color: "#f6f0e6", ink: "#241c16", accent: "#8a5a3b" },
  { id: "harbor", label: "Harbor", color: "#101820", ink: "#e6eef1", accent: "#6f9aa8" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function asTheme(value: unknown): ThemeId {
  const id = String(value ?? "");
  return THEMES.some((theme) => theme.id === id) ? (id as ThemeId) : "night";
}
