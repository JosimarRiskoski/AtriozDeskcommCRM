import {
  APPEARANCE_PALETTES,
  paletteTokens,
  type AppearancePalette,
} from "@/lib/appearance";

/**
 * Aplica a paleta antes da primeira pintura da área autenticada. Todas as
 * paletas seguem no script porque a preferência pessoal fica no localStorage
 * e só existe no navegador.
 */
export function OrganizationAppearanceScript({ palette }: { palette: AppearancePalette }) {
  const payload = Object.fromEntries(
    APPEARANCE_PALETTES.map((paletteId) => [
      paletteId,
      Object.fromEntries(
        (["light", "dark"] as const).map((theme) => [theme, paletteTokens(paletteId, theme)]),
      ),
    ]),
  );

  const source = `(function(){try{var palettes=${JSON.stringify(payload)};var saved=localStorage.getItem("deskcomm-palette");var id=saved&&palettes[saved]?saved:${JSON.stringify(palette)};var theme=document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light";var t=palettes[id][theme];var r=document.documentElement;Object.keys(t.palette.accent).forEach(function(k){r.style.setProperty("--color-accent-"+k,t.palette.accent[k]);});Object.keys(t.neutrals).forEach(function(k){r.style.setProperty("--color-neutral-"+k,t.neutrals[k]);});r.style.setProperty("--color-bg",t.surfaces.bg);r.style.setProperty("--color-surface",t.surfaces.surface);r.style.setProperty("--color-surface-elevated",t.surfaces.surfaceElevated);r.style.setProperty("--color-text",t.surfaces.text);r.style.setProperty("--color-text-muted",t.surfaces.textMuted);r.style.setProperty("--color-text-subtle",t.neutrals[400]);r.style.setProperty("--color-border",t.surfaces.border);r.style.setProperty("--color-border-strong",t.neutrals[theme==="dark"?500:300]);r.style.setProperty("--color-accent",t.accent);r.style.setProperty("--color-accent-hover",t.accentHover);r.style.setProperty("--color-accent-soft",t.accentSoft);r.style.setProperty("--color-accent-fg",t.accentForeground);["success","warning","error","info"].forEach(function(s){var v=t.states[s];r.style.setProperty("--color-"+s,v);r.style.setProperty("--color-"+s+"-bg",v+(theme==="dark"?"2e":"1f"));r.style.setProperty("--color-"+s+"-fg",v);});r.dataset.palette=id;}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
