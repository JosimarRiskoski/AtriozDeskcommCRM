"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChannelBadge } from "@/components/channels/ChannelBadge";

type Stage = { id: string; name: string; position: number };
type Pipeline = { id: string; name: string; crm_stages: Stage[] };
type Session = {
  id: string;
  display_name: string | null;
  display_color: string;
  phone_number: string | null;
  status: string;
  daily_message_limit: number;
  is_default: boolean;
};
type Campaign = {
  id: string;
  name: string;
  status: string;
  interval_seconds: number;
  ai_mode: string;
  outreach_campaign_recipients?: Array<{ count: number }>;
};
type Preview = {
  row: number;
  phone_raw: string;
  phone_normalized: string | null;
  name: string | null;
  status: string;
  reason: string | null;
  whatsapp_status?: "confirmed" | "not_found" | "unverified" | null;
};
type PreviewSummary = {
  eligible: number;
  excluded_by_capacity: number;
  connection_counts: Record<string, number>;
  projected_start: string;
  projected_end: string;
  duration_seconds: number;
  business_window: string;
};

const field = "rounded-md border border-border bg-background px-3 py-2 text-sm";

export function CampaignsClient({
  pipelines,
  sessions,
}: {
  pipelines: Pipeline[];
  sessions: Session[];
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<"csv" | "google_sheets">("csv");
  const [spreadsheet, setSpreadsheet] = useState("");
  const [sheetRange, setSheetRange] = useState("A:Z");
  const [audio, setAudio] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview[]>([]);
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const firstWorkingSession =
    sessions.find((item) => item.status === "WORKING" && item.is_default)?.id ??
    sessions.find((item) => item.status === "WORKING")?.id ??
    "";
  const [sessionIds, setSessionIds] = useState<string[]>(
    firstWorkingSession ? [firstWorkingSession] : [],
  );
  const [divideConnections, setDivideConnections] = useState(false);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [businessStart, setBusinessStart] = useState("08:00");
  const [businessEnd, setBusinessEnd] = useState("18:00");
  const stages = useMemo(
    () =>
      pipelines
        .find((p) => p.id === pipelineId)
        ?.crm_stages?.sort((a, b) => a.position - b.position) ?? [],
    [pipelines, pipelineId],
  );
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  useEffect(() => {
    if (!stages.some((s) => s.id === stageId)) setStageId(stages[0]?.id ?? "");
  }, [stages, stageId]);
  const load = async () => {
    const res = await fetch("/api/v1/campaigns", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setCampaigns(json.data ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  async function previewList() {
    if (source === "csv" && !file) return toast.error("Escolha um arquivo CSV.");
    if (source === "google_sheets" && !spreadsheet.trim())
      return toast.error("Informe o link da planilha.");
    const body = new FormData();
    body.set("source", source);
    if (file) body.set("file", file);
    if (source === "google_sheets") {
      body.set("spreadsheet", spreadsheet);
      body.set("range", sheetRange);
    }
    body.set("channel_session_ids", JSON.stringify(sessionIds));
    body.set("distribution_mode", divideConnections ? "balanced" : "single");
    body.set("interval_seconds", String(intervalSeconds));
    body.set("business_hour_start", businessStart);
    body.set("business_hour_end", businessEnd);
    const res = await fetch("/api/v1/campaigns/preview", { method: "POST", body });
    const json = await res.json();
    if (!res.ok) return toast.error(json?.error?.message ?? "Não foi possível validar o CSV.");
    setPreview(json.data?.rows ?? []);
    setPreviewSummary(json.data?.summary ?? null);
  }

  async function create(form: FormData) {
    if (
      (source === "csv" && !file) ||
      (source === "google_sheets" && !spreadsheet.trim()) ||
      sessionIds.length === 0 ||
      (divideConnections && sessionIds.length < 2) ||
      (createOpportunity && (!pipelineId || !stageId))
    ) {
      toast.error(
        divideConnections && sessionIds.length < 2
          ? "Para dividir os contatos, selecione ao menos duas conexões ativas."
          : "Informe a lista, uma conexão e, se criar oportunidade, o pipeline e a etapa.",
      );
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("source", source);
      if (file) body.set("file", file);
      if (source === "google_sheets") {
        body.set("spreadsheet", spreadsheet);
        body.set("range", sheetRange);
      }
      body.set(
        "config",
        JSON.stringify({
          name: form.get("name"),
          channel_session_id: sessionIds[0],
          channel_session_ids: sessionIds,
          distribution_mode: divideConnections ? "balanced" : "single",
          pipeline_id: createOpportunity ? pipelineId : null,
          stage_id: createOpportunity ? stageId : null,
          text_template: form.get("text"),
          interval_seconds: intervalSeconds,
          business_hour_start: businessStart,
          business_hour_end: businessEnd,
          delay_before_audio_seconds: 2,
          create_lead_before_send: createOpportunity,
          ai_mode: form.get("ai_mode"),
        }),
      );
      const res = await fetch("/api/v1/campaigns", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Falha ao criar campanha.");
      const id = json.data.id as string;
      if (audio) {
        const media = new FormData();
        media.set("file", audio);
        const up = await fetch(`/api/v1/campaigns/${id}/audio`, { method: "POST", body: media });
        if (!up.ok) throw new Error("Campanha criada, mas o áudio não foi anexado.");
      }
      toast.success("Rascunho criado. Revise e clique em Iniciar.");
      setPreview([]);
      setPreviewSummary(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function action(id: string, action: string) {
    const res = await fetch(`/api/v1/campaigns/${id}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (!res.ok) toast.error(json?.error?.message ?? "Ação recusada.");
    else {
      toast.success("Campanha atualizada.");
      await load();
      if (action === "start") router.push(`/app/campaigns/${id}`);
    }
  }

  const confirmed = preview.filter(
    (row) => row.status === "eligible" && row.whatsapp_status === "confirmed",
  ).length;
  const eligible = previewSummary?.eligible ?? confirmed;
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">Campanhas</h1>
        <p className="text-sm text-muted-foreground">
          Crie os contatos e negócios antes do envio; texto, áudio e próximo contato seguem uma fila
          segura.
        </p>
      </header>
      <form action={create} className="grid gap-4 rounded-lg border bg-card p-5 lg:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Nome da campanha
          <input name="name" required maxLength={120} className={field} />
        </label>
        <fieldset className="grid gap-2 rounded-md border p-3 text-sm">
          <legend className="px-1 font-medium">Conexões WhatsApp autorizadas</legend>
          {sessions.map((session) => {
            const healthy = session.status === "WORKING";
            return (
              <label key={session.id} className="flex items-start gap-2">
                <input
                  type={divideConnections ? "checkbox" : "radio"}
                  name="campaign-session"
                  checked={sessionIds.includes(session.id)}
                  disabled={!healthy}
                  onChange={(event) => {
                    setSessionIds((current) =>
                      divideConnections
                        ? event.target.checked
                          ? [...new Set([...current, session.id])]
                          : current.filter((id) => id !== session.id)
                        : [session.id],
                    );
                    setPreview([]);
                    setPreviewSummary(null);
                  }}
                />
                <span>
                  <ChannelBadge channel={session} compact />
                  <small className="block text-muted-foreground">
                    {session.phone_number || "Número não informado"} ·{" "}
                    {healthy ? "Ativa" : session.status} · limite {session.daily_message_limit}/dia
                  </small>
                </span>
              </label>
            );
          })}
          <label className="flex items-center gap-2 border-t pt-2">
            <input
              type="checkbox"
              checked={divideConnections}
              onChange={(event) => {
                setDivideConnections(event.target.checked);
                setSessionIds((current) => (event.target.checked ? current : current.slice(0, 1)));
                setPreview([]);
                setPreviewSummary(null);
              }}
            />
            Dividir os contatos entre os números selecionados
          </label>
        </fieldset>
        <div className="grid gap-3 rounded-md border p-3 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={createOpportunity}
              onChange={(event) => setCreateOpportunity(event.target.checked)}
            />
            Criar oportunidade no Kanban
          </label>
          {createOpportunity && (
            <>
              <label className="grid gap-1 text-sm">
                Pipeline
                <select
                  value={pipelineId}
                  onChange={(e) => setPipelineId(e.target.value)}
                  className={field}
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Etapa inicial
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  className={field}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 rounded-md border p-3 text-sm lg:col-span-2">
          <label className="grid gap-1">
            Intervalo (segundos)
            <input
              type="number"
              min={60}
              max={86400}
              value={intervalSeconds}
              onChange={(event) => {
                setIntervalSeconds(Number(event.target.value));
                setPreviewSummary(null);
              }}
              className={field}
            />
          </label>
          <label className="grid gap-1">
            Início dos envios
            <input
              type="time"
              value={businessStart}
              onChange={(event) => {
                setBusinessStart(event.target.value);
                setPreviewSummary(null);
              }}
              className={field}
            />
          </label>
          <label className="grid gap-1">
            Fim dos envios
            <input
              type="time"
              value={businessEnd}
              onChange={(event) => {
                setBusinessEnd(event.target.value);
                setPreviewSummary(null);
              }}
              className={field}
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm lg:col-span-2">
          Mensagem
          <textarea
            name="text"
            required
            maxLength={4096}
            rows={4}
            defaultValue="Olá {{primeiro_nome}}, boa tarde!"
            className={field}
          />
          <span className="text-xs text-muted-foreground">
            Variáveis: {"{{primeiro_nome}}"}, {"{{nome}}"} e {"{{telefone}}"}
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          Origem da lista
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value as "csv" | "google_sheets");
              setPreview([]);
            }}
            className={field}
          >
            <option value="csv">Arquivo CSV</option>
            <option value="google_sheets">Google Sheets autorizado</option>
          </select>
        </label>
        {source === "csv" ? (
          <label className="grid gap-1 text-sm">
            CSV autorizado
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview([]);
              }}
              className={field}
            />
          </label>
        ) : (
          <div className="grid gap-3 rounded-md border p-3 text-sm">
            <label className="grid gap-1">
              Link ou ID da planilha
              <input
                value={spreadsheet}
                onChange={(e) => {
                  setSpreadsheet(e.target.value);
                  setPreview([]);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className={field}
              />
            </label>
            <label className="grid gap-1">
              Aba e intervalo
              <input
                value={sheetRange}
                onChange={(e) => {
                  setSheetRange(e.target.value);
                  setPreview([]);
                }}
                placeholder="Leads!A:Z"
                className={field}
              />
            </label>
            <span className="text-xs text-muted-foreground">
              A planilha deve ser compartilhada como leitora com a conta de serviço configurada no
              servidor.
            </span>
          </div>
        )}
        <label className="grid gap-1 text-sm">
          Áudio opcional
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-sm">
          IA após resposta
          <select name="ai_mode" defaultValue="paused" className={field}>
            <option value="paused">Pausada (recomendado)</option>
            <option value="inherit">Seguir configuração geral</option>
            <option value="active">Ativa neste contato</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={previewList}
            className="rounded-md border px-4 py-2 text-sm"
          >
            Validar e visualizar
          </button>
          <button
            disabled={busy || eligible === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Criar rascunho
          </button>
        </div>
        {preview.length > 0 && (
          <div className="rounded-md border p-3 text-sm lg:col-span-2">
            {previewSummary && (
              <div className="mb-3 grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-2 lg:grid-cols-4">
                <span>
                  <b>{previewSummary.eligible}</b> elegíveis após capacidade
                </span>
                <span>
                  <b>{Math.ceil(previewSummary.duration_seconds / 60)} min</b> de duração prevista
                </span>
                <span>
                  Início: <b>{new Date(previewSummary.projected_start).toLocaleString("pt-BR")}</b>
                </span>
                <span>
                  Conclusão: <b>{new Date(previewSummary.projected_end).toLocaleString("pt-BR")}</b>
                </span>
                {Object.entries(previewSummary.connection_counts).map(([id, count]) => (
                  <span key={id}>
                    <b>{count}</b> por{" "}
                    {sessions.find((session) => session.id === id)?.display_name || id}
                  </span>
                ))}
                <span>
                  Janela: <b>{previewSummary.business_window}</b>
                </span>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <span>
                <b>{preview.length}</b> contatos importados
              </span>
              <span>
                <b>{eligible}</b> elegíveis
              </span>
              <span>
                <b>{preview.filter((row) => row.status === "duplicate").length}</b> duplicados
              </span>
              <span>
                <b>{preview.filter((row) => row.status === "missing_consent").length}</b> sem
                consentimento
              </span>
              <span>
                <b>{preview.filter((row) => row.status === "invalid_phone").length}</b> telefones
                inválidos
              </span>
              <span>
                <b>{preview.filter((row) => row.status === "blocked").length}</b> excluídos
              </span>
              <span>
                <b>{preview.filter((row) => row.whatsapp_status === "confirmed").length}</b>{" "}
                WhatsApp confirmado
              </span>
              <span>
                <b>{preview.filter((row) => row.whatsapp_status === "not_found").length}</b> não
                encontrados
              </span>
              <span>
                <b>{preview.filter((row) => row.whatsapp_status === "unverified").length}</b> não
                foi possível verificar
              </span>
            </div>
            <div className="mt-2 max-h-40 overflow-auto text-xs">
              {preview.slice(0, 100).map((r) => (
                <div key={r.row} className="grid grid-cols-4 gap-2 border-t py-1">
                  <span>{r.row}</span>
                  <span>{r.name || "—"}</span>
                  <span>{r.phone_normalized || r.phone_raw}</span>
                  <span>
                    {
                      {
                        eligible: "Elegível",
                        duplicate: "Duplicado",
                        missing_consent: "Sem consentimento",
                        invalid_phone: "Telefone inválido",
                        blocked: "Excluído — bloqueio total",
                      }[r.status]
                    }
                    {r.whatsapp_status
                      ? ` · ${
                          {
                            confirmed: "Confirmado",
                            not_found: "Não encontrado",
                            unverified: "Não foi possível verificar",
                          }[r.whatsapp_status]
                        }`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
      <section className="grid gap-3">
        <h2 className="font-semibold">Campanhas criadas</h2>
        {campaigns.map((c) => (
          <article
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
          >
            <div>
              <b>{c.name}</b>
              <p className="text-xs text-muted-foreground">
                {c.status} · {c.outreach_campaign_recipients?.[0]?.count ?? 0} contatos · intervalo{" "}
                {Math.round(c.interval_seconds / 60)} min
              </p>
            </div>
            <div className="flex gap-2">
              <Link href={`/app/campaigns/${c.id}`} className="rounded-md border px-3 py-2 text-sm">
                Acompanhar
              </Link>
              {c.status === "draft" && (
                <button
                  onClick={() => action(c.id, "start")}
                  className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  Iniciar
                </button>
              )}
              {["scheduled", "running"].includes(c.status) && (
                <button
                  onClick={() => action(c.id, "pause")}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  Pausar
                </button>
              )}
              {c.status === "paused" && (
                <button
                  onClick={() => action(c.id, "resume")}
                  className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  Retomar
                </button>
              )}
              {!["completed", "cancelled"].includes(c.status) && (
                <button
                  onClick={() => action(c.id, "cancel")}
                  className="rounded-md border px-3 py-2 text-sm text-destructive"
                >
                  Cancelar
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
