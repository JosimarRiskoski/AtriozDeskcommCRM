"use client";

import { useTheme, type Theme } from "@/lib/theme";
import { useHotkeys } from "react-hotkeys-hook";
import { Sun, Moon, MonitorPlay, Check } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS: Array<{
  value: Theme;
  label: string;
  description: string;
  Icon: typeof Sun;
}> = [
  { value: "light", label: "Claro", description: "Fundo claro", Icon: Sun },
  { value: "dark", label: "Escuro", description: "Fundo grafite", Icon: Moon },
  { value: "system", label: "Sistema", description: "Segue o dispositivo", Icon: MonitorPlay },
];

const DEFAULT_OPTION = {
  value: "system" as const,
  label: "Sistema",
  description: "Segue o dispositivo",
  Icon: MonitorPlay,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  useHotkeys("mod+shift+l", cycle, { preventDefault: true }, [theme]);

  const selected = OPTIONS.find((option) => option.value === theme) ?? DEFAULT_OPTION;
  const SelectedIcon = selected.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Tema atual: ${selected.label}. Abrir opções de tema.`}
          title={`Tema: ${selected.label}`}
        >
          <SelectedIcon size={17} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">Aparência</span>
          <span className="text-xs font-normal text-muted-foreground">
            Escolha como o CRM deve aparecer
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map(({ value, label, description, Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon size={16} aria-hidden />
            <span className="flex flex-1 flex-col">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </span>
            {theme === value ? <Check size={16} aria-label="Selecionado" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          Atalho: Ctrl/Cmd + Shift + L
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
