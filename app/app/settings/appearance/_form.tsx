"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateOrganizationAppearance } from "@/app/actions/settings/updateAppearance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPEARANCE_OPTIONS,
  type AppearancePalette,
  type PalettePreference,
} from "@/lib/appearance";
import { type Theme, useTheme } from "@/lib/theme";
import { Check, MonitorPlay, Moon, Sun } from "@/lib/ui/icons";

const THEME_OPTIONS: Array<{ id: Theme; label: string; description: string }> = [
  { id: "light", label: "Claro", description: "Sempre usa fundo claro." },
  { id: "dark", label: "Escuro", description: "Sempre usa fundo grafite." },
  { id: "system", label: "Sistema", description: "Acompanha o dispositivo." },
];

export function AppearanceSettings({
  initialOrganizationPalette,
  canChangeOrganization,
}: {
  initialOrganizationPalette: AppearancePalette;
  canChangeOrganization: boolean;
}) {
  const {
    theme,
    setTheme,
    palettePreference,
    setPalettePreference,
    organizationPalette,
    setOrganizationPalette,
    resolvedPalette,
  } = useTheme();
  const [organizationDraft, setOrganizationDraft] = useState(initialOrganizationPalette);
  const [pending, startTransition] = useTransition();

  function saveOrganizationPalette() {
    startTransition(async () => {
      const result = await updateOrganizationAppearance({ palette: organizationDraft });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOrganizationPalette(organizationDraft);
      toast.success("Padrão visual da empresa atualizado.");
    });
  }

  function restorePersonalDefault() {
    setTheme("system");
    setPalettePreference("organization");
    toast.success("Sua aparência voltou a seguir o padrão da empresa.");
  }

  return (
    <div className="max-w-6xl space-y-6">
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="font-semibold">Tema da sua conta</h2>
          <p className="text-sm text-muted-foreground">
            Esta escolha vale somente para você neste navegador.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.id === "light" ? Sun : option.id === "dark" ? Moon : MonitorPlay;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-border-strong ${theme === option.id ? "ring-primary/20 border-primary ring-2" : ""}`}
              >
                <Icon size={20} aria-hidden />
                <span className="flex-1">
                  <span className="block font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </span>
                {theme === option.id ? <Check size={18} aria-label="Selecionado" /> : null}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Estilo visual da sua conta</h2>
            <p className="text-sm text-muted-foreground">
              Siga o padrão da empresa ou escolha uma identidade somente para você.
            </p>
          </div>
          <div className="min-w-64 space-y-1">
            <Label htmlFor="personal-palette">Preferência</Label>
            <Select
              value={palettePreference}
              onValueChange={(value) => setPalettePreference(value as PalettePreference)}
            >
              <SelectTrigger id="personal-palette">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">Seguir padrão da empresa</SelectItem>
                {APPEARANCE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <PaletteGrid
          selected={resolvedPalette}
          onSelect={(palette) => setPalettePreference(palette)}
        />
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={restorePersonalDefault}>
            Restaurar meu padrão
          </Button>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <div>
          <h2 className="font-semibold">Padrão visual da empresa</h2>
          <p className="text-sm text-muted-foreground">
            É aplicado a quem escolher “Seguir padrão da empresa”. Somente administradores podem
            alterar.
          </p>
        </div>
        {canChangeOrganization ? (
          <>
            <PaletteGrid selected={organizationDraft} onSelect={setOrganizationDraft} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Padrão atual:{" "}
                {APPEARANCE_OPTIONS.find((item) => item.id === organizationPalette)?.name}
              </p>
              <Button
                type="button"
                onClick={saveOrganizationPalette}
                disabled={pending || organizationDraft === organizationPalette}
              >
                {pending ? "Salvando…" : "Aplicar para toda a empresa"}
              </Button>
            </div>
          </>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Você pode personalizar sua conta acima. O padrão da empresa é administrado por um
            responsável.
          </p>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold">Pré-visualização rápida</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Os componentes abaixo usam a escolha atual. Verde continua reservado para sucesso.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <p className="font-medium">Contato em atendimento</p>
            <p className="text-sm text-muted-foreground">Conversa atualizada há 2 minutos.</p>
            <Button className="mt-4" size="sm">
              Abrir conversa
            </Button>
          </div>
          <div className="rounded-lg border bg-muted p-4">
            <p className="font-medium">Aguardando documento</p>
            <p className="text-sm text-muted-foreground">Lembrete programado para amanhã.</p>
          </div>
          <div className="rounded-lg border p-4">
            <span className="inline-flex rounded-full bg-success-bg px-2 py-1 text-xs text-success-fg">
              WhatsApp conectado
            </span>
            <p className="mt-3 text-sm text-muted-foreground">
              Estados de sucesso não usam a cor principal da marca.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PaletteGrid({
  selected,
  onSelect,
}: {
  selected: AppearancePalette;
  onSelect: (palette: AppearancePalette) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {APPEARANCE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onSelect(option.id)}
          className={`rounded-lg border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${selected === option.id ? "ring-primary/20 border-primary ring-2" : ""}`}
        >
          <span className="mb-3 flex gap-1" aria-hidden>
            <span className="h-7 flex-1 rounded-l" style={{ background: option.light.bg }} />
            <span className="h-7 flex-1" style={{ background: option.accent }} />
            <span className="h-7 flex-1 rounded-r" style={{ background: option.dark.bg }} />
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">{option.name}</span>
            {selected === option.id ? <Check size={17} aria-label="Selecionado" /> : null}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
        </button>
      ))}
    </div>
  );
}
