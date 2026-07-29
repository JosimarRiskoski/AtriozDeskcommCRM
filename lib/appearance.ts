import { PALETTES, type PaletteId } from "@/app/design/lib/tokens";

export const APPEARANCE_PALETTES = [
  "graphite-blue",
  "graphite-indigo",
  "sage",
  "clay",
  "mist",
  "plum",
  "olive",
] as const satisfies readonly PaletteId[];

export type AppearancePalette = (typeof APPEARANCE_PALETTES)[number];
export type PalettePreference = "organization" | AppearancePalette;

export const DEFAULT_ORGANIZATION_PALETTE: AppearancePalette = "graphite-blue";

export const APPEARANCE_OPTIONS = APPEARANCE_PALETTES.map((id) => ({
  id,
  name: PALETTES[id].name,
  description: PALETTES[id].description,
  accent: PALETTES[id].accent[600],
  light: PALETTES[id].surfaces.light,
  dark: PALETTES[id].surfaces.dark,
}));

export function isAppearancePalette(value: unknown): value is AppearancePalette {
  return typeof value === "string" && APPEARANCE_PALETTES.includes(value as AppearancePalette);
}

export function readOrganizationPalette(settings: unknown): AppearancePalette {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_ORGANIZATION_PALETTE;
  }
  const appearance = (settings as { appearance?: unknown }).appearance;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
    return DEFAULT_ORGANIZATION_PALETTE;
  }
  const palette = (appearance as { palette?: unknown }).palette;
  return isAppearancePalette(palette) ? palette : DEFAULT_ORGANIZATION_PALETTE;
}

export function paletteTokens(id: AppearancePalette, theme: "light" | "dark") {
  const palette = PALETTES[id];
  return {
    palette,
    surfaces: palette.surfaces[theme],
    states: palette.states[theme],
    neutrals: theme === "dark" ? palette.neutralDark : palette.neutralLight,
    accent: palette.accent[theme === "dark" ? 400 : 600],
    accentHover: palette.accent[theme === "dark" ? 300 : 700],
    accentSoft: palette.accent[theme === "dark" ? 800 : 100],
    accentForeground: theme === "dark" ? palette.neutralDark[950] : "#ffffff",
  };
}
