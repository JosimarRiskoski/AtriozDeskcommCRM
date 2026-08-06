/**
 * Cliente mínimo da Evolution API v2.
 *
 * A Evolution é o transporte de WhatsApp; as regras comerciais continuam no
 * CRM. Este módulo não acessa Supabase e não expõe a API key ao navegador.
 * Endpoints conferidos no repositório oficial Evolution API v2:
 * instance/create, instance/connect, instance/connectionState, message/send*
 * e webhook/set.
 */

export const EVOLUTION_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_SET",
  "SEND_MESSAGE",
  "SEND_MESSAGE_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "CONTACTS_UPSERT",
  "CHATS_UPSERT",
  "GROUPS_UPSERT",
] as const;

type Json = Record<string, unknown>;

export type EvolutionConnection = {
  state: string;
  instanceName?: string;
  profileName?: string;
  ownerJid?: string;
  number?: string;
  qrcode?: string;
  raw: Json;
};

export type EvolutionCreateInstanceInput = {
  instanceName: string;
  webhookUrl: string;
  webhookHeaders?: Record<string, string>;
};

export type EvolutionSendMediaInput = {
  number: string;
  mediaType: "image" | "document" | "video" | "audio" | "ptv";
  media: string;
  mimeType?: string;
  caption?: string | null;
  fileName?: string;
};

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function firstObject(value: unknown): Json {
  const obj = asObject(value);
  return asObject(obj.instance ?? obj.data ?? obj);
}

function instanceListFrom(value: unknown): Json[] {
  if (Array.isArray(value)) return value.map(asObject).filter((item) => Object.keys(item).length > 0);
  const root = asObject(value);
  for (const candidate of [root.instances, root.data, root.instance]) {
    if (Array.isArray(candidate))
      return candidate.map(asObject).filter((item) => Object.keys(item).length > 0);
  }
  return Object.keys(root).length > 0 ? [root] : [];
}

function qrCodeFrom(value: unknown): string | undefined {
  const root = asObject(value);
  const payload = asObject(root.instance ?? root.data ?? root);
  const nestedQr = asObject(payload.qrcode);
  for (const candidate of [payload.qrcode, payload.base64, nestedQr.base64, nestedQr.code]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        apikey: this.apiKey,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_${res.status}: ${body.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  async createInstance(input: EvolutionCreateInstanceInput): Promise<EvolutionConnection> {
    const result = await this.request<unknown>("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: input.instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        syncFullHistory: true,
        webhook: {
          enabled: true,
          url: input.webhookUrl,
          byEvents: false,
          // O CRM persiste mídia a partir do payload do webhook. Sem base64,
          // fotos, áudios e documentos recebidos não chegam ao worker.
          base64: true,
          events: EVOLUTION_WEBHOOK_EVENTS,
          headers: input.webhookHeaders ?? {},
        },
      }),
    });
    return this.connectionFrom(result);
  }

  async connect(instanceName: string): Promise<EvolutionConnection> {
    return this.connectionFrom(
      await this.request<unknown>(`/instance/connect/${encodeURIComponent(instanceName)}`),
    );
  }

  async connectionState(instanceName: string): Promise<EvolutionConnection> {
    try {
      return this.connectionFrom(
        await this.request<unknown>(`/instance/connectionState/${encodeURIComponent(instanceName)}`),
      );
    } catch (error) {
      // Algumas imagens 2.x em producao nao expoem `connectionState`, embora
      // `fetchInstances` continue sendo suportado e informe `connectionStatus`.
      // Sem este fallback o CRM grava "Caiu" para uma sessao que esta aberta.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("evolution_404")) throw error;

      const instances = instanceListFrom(await this.request<unknown>("/instance/fetchInstances"));
      const compatibleNames = new Set([instanceName, `evo_${instanceName}`]);
      const match = instances.find((item) => {
        const name = item.name ?? item.instanceName;
        return typeof name === "string" && compatibleNames.has(name);
      });
      if (!match) throw error;
      return this.connectionFrom(match);
    }
  }

  async restart(instanceName: string): Promise<EvolutionConnection> {
    return this.connectionFrom(
      await this.request<unknown>(`/instance/restart/${encodeURIComponent(instanceName)}`, {
        method: "POST",
      }),
    );
  }

  async logout(instanceName: string): Promise<void> {
    await this.request<unknown>(`/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
    });
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.request<unknown>(`/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
    });
  }

  async setWebhook(
    instanceName: string,
    input: Pick<EvolutionCreateInstanceInput, "webhookUrl" | "webhookHeaders">,
  ): Promise<void> {
    await this.request<unknown>(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        // A Evolution 2.3.x valida `webhook/set` com o mesmo objeto aninhado
        // usado na criação da instância. O formato plano é ignorado/rejeitado
        // e deixa a URL anterior da instância ativa.
        webhook: {
          enabled: true,
          url: input.webhookUrl,
          byEvents: false,
          base64: true,
          events: EVOLUTION_WEBHOOK_EVENTS,
          headers: input.webhookHeaders ?? {},
        },
      }),
    });
  }

  async sendText(instanceName: string, number: string, text: string): Promise<unknown> {
    return this.request(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({ number, text }),
    });
  }

  async sendPoll(
    instanceName: string,
    number: string,
    name: string,
    values: string[],
    multipleAnswers = false,
  ): Promise<unknown> {
    return this.request(`/message/sendPoll/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number,
        name,
        values,
        selectableCount: multipleAnswers ? values.length : 1,
      }),
    });
  }

  async sendMedia(instanceName: string, input: EvolutionSendMediaInput): Promise<unknown> {
    return this.request(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number: input.number,
        mediatype: input.mediaType,
        media: input.media,
        mimetype: input.mimeType,
        caption: input.caption ?? undefined,
        fileName: input.fileName,
      }),
    });
  }

  async checkNumbers(instanceName: string, numbers: string[]): Promise<unknown> {
    return this.request(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({ numbers }),
    });
  }

  private connectionFrom(value: unknown): EvolutionConnection {
    const raw = firstObject(value);
    const stateValue = raw.state ?? raw.connectionStatus ?? raw.status ?? "STARTING";
    return {
      state: typeof stateValue === "string" ? stateValue : "STARTING",
      instanceName: typeof raw.instanceName === "string" ? raw.instanceName : undefined,
      profileName: typeof raw.profileName === "string" ? raw.profileName : undefined,
      ownerJid: typeof raw.ownerJid === "string" ? raw.ownerJid : undefined,
      number: typeof raw.number === "string" ? raw.number : undefined,
      // A Evolution retorna o QR de conexao como `base64` no endpoint
      // instance/connect. Algumas versoes e proxies usam `qrcode`, por isso
      // aceitamos os dois formatos antes de a rota do CRM transformar o valor
      // em uma imagem PNG segura para o navegador.
      qrcode: qrCodeFrom(value),
      raw,
    };
  }
}

export function evolutionFriendlyError(message: string): string {
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network|timeout|socket|EAI_AGAIN/i.test(message)) {
    return "O serviço do WhatsApp (Evolution) não está respondendo. Confirme que a Evolution está no ar e tente novamente.";
  }
  return `Falha na comunicação com o WhatsApp (Evolution): ${message}`;
}

export function getEvolutionClient(): EvolutionClient | null {
  const url = process.env.EVOLUTION_API_BASE_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!url || !apiKey || apiKey === "change_me") return null;
  return new EvolutionClient(url, apiKey);
}

/** O id de mensagem da Evolution pode vir em `key.id`, `id` ou `messageId`. */
export function parseEvolutionMessageId(value: unknown): string | null {
  const root = asObject(value);
  const key = asObject(root.key);
  for (const candidate of [key.id, root.id, root.messageId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

/** A Evolution recebe telefone limpo; grupos preservam o JID `@g.us`. */
export function evolutionRecipient(chatId: string): string {
  return chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net")
    ? chatId.replace(/@.*/, "")
    : chatId;
}
