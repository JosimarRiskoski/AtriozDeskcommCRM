"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle, Info, Warning, WarningOctagon } from "@/lib/ui/icons";

type NotificationItem = {
  id: string;
  category: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  action_url: string | null;
  created_at: string;
  read_at: string | null;
};

function SeverityIcon({ severity }: { severity: NotificationItem["severity"] }) {
  if (severity === "critical") return <WarningOctagon className="text-destructive" size={20} />;
  if (severity === "warning") return <Warning className="text-amber-500" size={20} />;
  return <Info className="text-blue-500" size={20} />;
}

export function NotificationsInbox() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load(nextFilter = filter) {
    setLoading(true);
    try {
      const query = nextFilter === "unread" ? "?status=unread&limit=100" : "?limit=100";
      const res = await fetch(`/api/v1/notifications${query}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Falha ao carregar notificações.");
      setItems(json.data);
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar notificações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mark(item: NotificationItem, read: boolean, open = false) {
    const res = await fetch(`/api/v1/notifications/${item.id}/read`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read }),
    });
    if (!res.ok) return toast.error("Não foi possível atualizar a notificação.");
    window.dispatchEvent(new Event("notifications:refresh"));
    if (open && item.action_url) router.push(item.action_url);
    else void load();
  }

  async function markSelectedAsRead() {
    const targets = items.filter((item) => selected.has(item.id) && !item.read_at);
    if (targets.length === 0) return;
    const results = await Promise.all(
      targets.map((item) =>
        fetch(`/api/v1/notifications/${item.id}/read`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ read: true }),
        }),
      ),
    );
    if (results.some((result) => !result.ok)) {
      toast.error("Algumas notificações não puderam ser atualizadas.");
    } else {
      toast.success(`${targets.length} notificação(ões) marcada(s) como lida(s).`);
    }
    window.dispatchEvent(new Event("notifications:refresh"));
    void load();
  }

  function toggleAll() {
    setSelected((current) => {
      if (items.length > 0 && current.size === items.length) return new Set();
      return new Set(items.map((item) => item.id));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={filter === "unread" ? "default" : "outline"} onClick={() => setFilter("unread")}>Não lidas</Button>
        <Button variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Todas</Button>
        <Button variant="outline" disabled={items.length === 0} onClick={toggleAll}>
          {selected.size === items.length && items.length > 0 ? "Limpar seleção" : "Selecionar todas"}
        </Button>
        <Button
          variant="outline"
          disabled={selected.size === 0}
          onClick={() => void markSelectedAsRead()}
        >
          Marcar selecionadas como lidas ({selected.size})
        </Button>
      </div>
      {loading ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : null}
      {!loading && items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <CheckCircle size={28} className="text-emerald-500" />
          <p className="font-medium">Nada exige sua atenção agora.</p>
          <p className="text-sm text-muted-foreground">Novos alertas aparecerão aqui com um caminho direto para resolver.</p>
        </Card>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <Card key={item.id} className={`flex gap-3 p-4 ${item.read_at ? "opacity-70" : "border-l-4 border-l-primary"}`}>
            <input
              type="checkbox"
              aria-label={`Selecionar ${item.title}`}
              checked={selected.has(item.id)}
              onChange={(event) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                })
              }
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
            <SeverityIcon severity={item.severity} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-medium">{item.title}</p><p className="mt-1 text-sm text-muted-foreground">{item.body}</p></div>
                <time className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("pt-BR")}</time>
              </div>
              <div className="mt-3 flex gap-2">
                {item.action_url ? <Button size="sm" onClick={() => void mark(item, true, true)}>Abrir e marcar como lida</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => void mark(item, !item.read_at)}>{item.read_at ? "Marcar como não lida" : "Marcar como lida"}</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
