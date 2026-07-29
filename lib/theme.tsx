"use client";

import * as React from "react";

import {
  DEFAULT_ORGANIZATION_PALETTE,
  isAppearancePalette,
  paletteTokens,
  type AppearancePalette,
  type PalettePreference,
} from "@/lib/appearance";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "deskcomm-theme";
const PALETTE_STORAGE_KEY = "deskcomm-palette";

type ThemeContextValue = {
  /** User preference: light, dark, or system. */
  theme: Theme;
  /** Effective theme applied to the DOM (system collapsed to light/dark). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  palettePreference: PalettePreference;
  resolvedPalette: AppearancePalette;
  organizationPalette: AppearancePalette;
  setPalettePreference: (palette: PalettePreference) => void;
  setOrganizationPalette: (palette: AppearancePalette) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage indisponível (modo privado, sandbox) — segue com default.
  }
  return "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

function readStoredPalette(): PalettePreference {
  if (typeof window === "undefined") return "organization";
  try {
    const value = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return value === "organization" || isAppearancePalette(value) ? value : "organization";
  } catch {
    return "organization";
  }
}

function colorWithAlpha(hex: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

function applyPalette(paletteId: AppearancePalette, theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const tokens = paletteTokens(paletteId, theme);
  root.dataset.palette = paletteId;

  Object.entries(tokens.palette.accent).forEach(([step, value]) => {
    root.style.setProperty(`--color-accent-${step}`, value);
  });
  Object.entries(tokens.neutrals).forEach(([step, value]) => {
    root.style.setProperty(`--color-neutral-${step}`, value);
  });
  root.style.setProperty("--color-bg", tokens.surfaces.bg);
  root.style.setProperty("--color-surface", tokens.surfaces.surface);
  root.style.setProperty("--color-surface-elevated", tokens.surfaces.surfaceElevated);
  root.style.setProperty("--color-text", tokens.surfaces.text);
  root.style.setProperty("--color-text-muted", tokens.surfaces.textMuted);
  root.style.setProperty("--color-text-subtle", tokens.neutrals[400]);
  root.style.setProperty("--color-border", tokens.surfaces.border);
  root.style.setProperty("--color-border-strong", tokens.neutrals[theme === "dark" ? 500 : 300]);
  root.style.setProperty("--color-accent", tokens.accent);
  root.style.setProperty("--color-accent-hover", tokens.accentHover);
  root.style.setProperty("--color-accent-soft", tokens.accentSoft);
  root.style.setProperty("--color-accent-fg", tokens.accentForeground);

  for (const state of ["success", "warning", "error", "info"] as const) {
    const value = tokens.states[state];
    root.style.setProperty(`--color-${state}`, value);
    root.style.setProperty(
      `--color-${state}-bg`,
      colorWithAlpha(value, theme === "dark" ? "2e" : "1f"),
    );
    root.style.setProperty(`--color-${state}-fg`, value);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lê do storage no primeiro render do client (não causa hydration mismatch
  // porque o inline script no layout já setou o data-theme antes do paint).
  const [theme, setThemeState] = React.useState<Theme>(() => readStoredTheme());
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>(() => getSystemTheme());
  const [palettePreference, setPalettePreferenceState] = React.useState<PalettePreference>(() =>
    readStoredPalette(),
  );
  const [organizationPalette, setOrganizationPalette] = React.useState<AppearancePalette>(
    DEFAULT_ORGANIZATION_PALETTE,
  );

  // Listener pra mudanças do prefers-color-scheme.
  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;
  const resolvedPalette =
    palettePreference === "organization" ? organizationPalette : palettePreference;

  // Aplica no DOM sempre que o tema efetivo muda.
  React.useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  React.useEffect(() => {
    applyPalette(resolvedPalette, resolvedTheme);
  }, [resolvedPalette, resolvedTheme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistência opcional — falha silenciosamente.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setThemeState((current) => {
      const currentResolved = current === "system" ? getSystemTheme() : current;
      const next: Theme = currentResolved === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setPalettePreference = React.useCallback((next: PalettePreference) => {
    setPalettePreferenceState(next);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      // Persistência individual é opcional.
    }
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggle,
      palettePreference,
      resolvedPalette,
      organizationPalette,
      setPalettePreference,
      setOrganizationPalette,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      toggle,
      palettePreference,
      resolvedPalette,
      organizationPalette,
      setPalettePreference,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
