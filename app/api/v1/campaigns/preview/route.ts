import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { previewCampaignCsv } from "@/lib/campaigns/csv";
import { fetchGoogleSheetCsv, googleSheetErrorMessage } from "@/lib/campaigns/google-sheets";
import { createClient } from "@/lib/supabase/server";
import { getEvolutionClient } from "@/lib/evolution/client";
import {
  distributeCampaignRecipients,
  estimateCampaignSchedule,
} from "@/lib/campaigns/distribution";

export const dynamic = "force-dynamic";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "outreach_campaigns" });
  if (!authz.ok) return authz.response;
  const form = await req.formData();
  const source = form.get("source") === "google_sheets" ? "google_sheets" : "csv";
  const file = form.get("file");
  if (source === "csv" && (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv"))) {
    return fail("validation_failed", "Envie um arquivo CSV.", 422, { requestId });
  }
  if (source === "csv" && file instanceof File && file.size > MAX_FILE_BYTES) {
    return fail("validation_failed", "O CSV deve ter no máximo 2 MB.", 422, { requestId });
  }
  try {
    const text =
      source === "google_sheets"
        ? (
            await fetchGoogleSheetCsv(
              String(form.get("spreadsheet") ?? ""),
              String(form.get("range") ?? "A:Z"),
            )
          ).csv
        : await (file as File).text();
    const rows = previewCampaignCsv(text);
    let sessionIds: string[] = [];
    try {
      sessionIds = JSON.parse(String(form.get("channel_session_ids") ?? "[]"));
    } catch {
      sessionIds = [];
    }
    sessionIds = [...new Set(sessionIds.filter((id): id is string => typeof id === "string"))];
    if (!sessionIds.length) {
      return fail("validation_failed", "Selecione ao menos uma conexão ativa.", 422, { requestId });
    }
    if (form.get("distribution_mode") === "balanced" && sessionIds.length < 2) {
      return fail(
        "validation_failed",
        "Para dividir os contatos, selecione ao menos duas conexões ativas.",
        422,
        { requestId },
      );
    }
    const supabase = await createClient();
    const phones = rows
      .filter((row) => row.status === "eligible" && row.phone_normalized)
      .map((row) => row.phone_normalized!);
    const { data: blockedContacts } = phones.length
      ? await supabase
          .from("contacts")
          .select("phone_number")
          .eq("organization_id", authz.org.orgId)
          .or("is_blocked.eq.true,is_anonymized.eq.true")
          .in("phone_number", phones)
      : { data: [] as Array<{ phone_number: string | null }> };
    const blockedPhones = new Set(
      (blockedContacts ?? []).map((contact) => contact.phone_number).filter(Boolean),
    );
    const { data: selectedSessions } = await supabase
      .from("channel_sessions")
      .select(
        "id,provider,external_session_name,display_name,phone_number,status,daily_message_limit",
      )
      .eq("organization_id", authz.org.orgId)
      .in("id", sessionIds);
    const healthySessions = (selectedSessions ?? []).filter(
      (session) =>
        session.status === "WORKING" &&
        session.provider === "evolution" &&
        Boolean(session.external_session_name),
    );
    if (!healthySessions.length) {
      return fail("validation_failed", "Nenhuma das conexões selecionadas está ativa.", 422, {
        requestId,
      });
    }
    const verificationSession = healthySessions[0];
    const today = new Date().toISOString().slice(0, 10);
    const { data: dailyUsage } = await supabase
      .from("channel_session_warmup")
      .select("channel_session_id,messages_sent")
      .eq("organization_id", authz.org.orgId)
      .eq("day", today)
      .in(
        "channel_session_id",
        healthySessions.map((session) => session.id),
      );
    const sentToday = new Map(
      (dailyUsage ?? []).map((row) => [row.channel_session_id, row.messages_sent]),
    );
    const evolution = getEvolutionClient();
    const verification = new Map<string, "confirmed" | "not_found" | "unverified">();
    const toVerify = phones.filter((phone) => !blockedPhones.has(phone)).slice(0, 500);
    if (evolution && verificationSession?.external_session_name) {
      for (let index = 0; index < toVerify.length; index += 12) {
        const chunk = toVerify.slice(index, index + 12);
        await Promise.all(
          chunk.map(async (phone) => {
            try {
              const result = await evolution.checkNumbers(
                verificationSession.external_session_name,
                [phone],
              );
              const row = (
                Array.isArray(result) ? result[0] : (result as { data?: unknown[] }).data?.[0]
              ) as { exists?: boolean; numberExists?: boolean } | undefined;
              verification.set(
                phone,
                (row?.exists ?? row?.numberExists) ? "confirmed" : "not_found",
              );
            } catch {
              verification.set(phone, "unverified");
            }
          }),
        );
      }
    }
    const checkedRows = rows.map((row) => {
      if (row.status !== "eligible" || !row.phone_normalized)
        return { ...row, whatsapp_status: null };
      if (blockedPhones.has(row.phone_normalized))
        return { ...row, status: "blocked" as const, whatsapp_status: null };
      return {
        ...row,
        whatsapp_status: verification.get(row.phone_normalized) ?? ("unverified" as const),
      };
    });
    const counts = checkedRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      if (row.whatsapp_status) acc[row.whatsapp_status] = (acc[row.whatsapp_status] ?? 0) + 1;
      return acc;
    }, {});
    const validRecipients = checkedRows
      .filter(
        (row) =>
          row.status === "eligible" && row.whatsapp_status === "confirmed" && row.phone_normalized,
      )
      .map((row) => ({ key: row.phone_normalized!, row }));
    const distribution = distributeCampaignRecipients(
      validRecipients,
      healthySessions.map((session) => ({
        id: session.id,
        label: session.display_name || session.phone_number || session.id,
        remainingCapacity: Math.max(
          0,
          (session.daily_message_limit ?? 0) - (sentToday.get(session.id) ?? 0),
        ),
      })),
      `${authz.org.orgId}:${validRecipients.map((recipient) => recipient.key).join(",")}`,
    );
    const intervalSeconds = Math.max(60, Number(form.get("interval_seconds") ?? 300));
    const businessStart = String(form.get("business_hour_start") ?? "08:00");
    const businessEnd = String(form.get("business_hour_end") ?? "18:00");
    if (
      !/^\d{2}:\d{2}$/.test(businessStart) ||
      !/^\d{2}:\d{2}$/.test(businessEnd) ||
      businessStart >= businessEnd
    ) {
      return fail("validation_failed", "Informe uma janela de envio válida.", 422, { requestId });
    }
    const forecast = estimateCampaignSchedule({
      now: new Date(),
      timezone: "America/Sao_Paulo",
      businessStart,
      businessEnd,
      intervalSeconds,
      counts: distribution.counts,
    });
    return ok(
      {
        rows: checkedRows,
        counts,
        total: rows.length,
        truncated: rows.length === 2_000,
        summary: {
          eligible: distribution.assignments.length,
          excluded_by_capacity: distribution.excludedByCapacity.length,
          connection_counts: distribution.counts,
          projected_start: forecast.projectedStart,
          projected_end: forecast.projectedEnd,
          duration_seconds: forecast.durationSeconds,
          business_window: forecast.businessWindow,
        },
      },
      { requestId },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "missing_phone_column") {
      return fail(
        "validation_failed",
        "A lista precisa ter uma coluna telefone, celular ou WhatsApp.",
        422,
        { requestId },
      );
    }
    return fail(
      "validation_failed",
      source === "google_sheets"
        ? googleSheetErrorMessage(error)
        : "Não foi possível interpretar o CSV.",
      422,
      { requestId },
    );
  }
}
