"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useCredentialsList, type Provider } from "@/hooks/ai/useCredentials";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { ModelPicker } from "./ModelPicker";
import { CredentialPicker } from "./CredentialPicker";
import { upgradeLegacyAgentAction } from "../_actions";

export function LegacyAgentUpgrade({ agent, readOnly }: { agent: AgentRow; readOnly?: boolean }) {
  const router = useRouter();
  const credentials = useCredentialsList();
  const channels = useChannelSessions();
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const workingChannels = useMemo(
    () => (channels.data ?? []).filter((channel) => channel.status === "WORKING"),
    [channels.data],
  );

  function changeProvider(next: Provider) {
    setProvider(next);
    setModel("");
    setCredentialId("");
  }

  async function upgrade() {
    setSaving(true);
    try {
      const result = await upgradeLegacyAgentAction(agent.id, {
        provider,
        model,
        credential_id: credentialId,
        channel_session_id: channelId,
        system_prompt: agent.system_prompt,
        tool_ids: [],
        contact_field_access: {
          name: "write", email: "write", phone_number: "write", company: "write", city: "write",
          state: "write", tags: "write", custom_fields: "write", notes: "write",
        },
        trigger_config: { events: ["message"], filters: { ignore_groups: true, ignore_self: true, keyword_regex: null, business_hours: null }, concurrency: "one_per_conversation" },
        max_steps: 10,
        token_budget: 50000,
        cost_budget_cents: 50,
        history_message_window: 20,
        history_token_window: 8000,
        handoff_keywords: ["falar com humano", "atendente", "pessoa real"],
        handoff_tool_enabled: true,
        cases_enabled: false,
        followup: { enabled: false, flow_pointer_ids: [] },
      });
      if (!result.ok) throw new Error(result.message || result.error);
      toast.success("Agente atualizado. Revise e publique a versão antes de ativá-lo.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o agente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-3xl space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">Atualizar agente para o editor atual</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este agente foi criado no modelo antigo. Escolha a credencial e o modelo para usar a configuração atual. Ele ficará em rascunho e não responderá até você revisar e publicar.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Provedor</Label>
          <Select value={provider} onValueChange={(value) => changeProvider(value as Provider)} disabled={readOnly || saving}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="google">Google</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CredentialPicker provider={provider} credentials={credentials.data ?? []} value={credentialId} onChange={setCredentialId} disabled={readOnly || saving} />
        <ModelPicker provider={provider} value={model} onChange={setModel} disabled={readOnly || saving} />
        <div className="space-y-1">
          <Label>Conexão WhatsApp</Label>
          <Select value={channelId} onValueChange={setChannelId} disabled={readOnly || saving}>
            <SelectTrigger><SelectValue placeholder="Selecione uma conexão ativa" /></SelectTrigger>
            <SelectContent>
              {workingChannels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  {channel.display_name || channel.external_session_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={() => void upgrade()} disabled={readOnly || saving || !credentialId || !model || !channelId}>
        {saving ? "Atualizando…" : "Atualizar e configurar modelo"}
      </Button>
    </Card>
  );
}
