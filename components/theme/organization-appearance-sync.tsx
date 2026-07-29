"use client";

import { useEffect } from "react";

import { type AppearancePalette } from "@/lib/appearance";
import { useTheme } from "@/lib/theme";

export function OrganizationAppearanceSync({ palette }: { palette: AppearancePalette }) {
  const { setOrganizationPalette } = useTheme();

  useEffect(() => {
    setOrganizationPalette(palette);
  }, [palette, setOrganizationPalette]);

  return null;
}
