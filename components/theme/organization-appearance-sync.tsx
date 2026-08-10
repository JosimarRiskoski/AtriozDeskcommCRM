"use client";

import { useLayoutEffect } from "react";

import { type AppearancePalette } from "@/lib/appearance";
import { useTheme } from "@/lib/theme";

export function OrganizationAppearanceSync({ palette }: { palette: AppearancePalette }) {
  const { setOrganizationPalette } = useTheme();

  useLayoutEffect(() => {
    try {
      window.localStorage.setItem("atrioz-crm-organization-palette", palette);
    } catch {
      // Persistência é apenas uma otimização visual para a próxima navegação.
    }
    setOrganizationPalette(palette);
  }, [palette, setOrganizationPalette]);

  return null;
}
