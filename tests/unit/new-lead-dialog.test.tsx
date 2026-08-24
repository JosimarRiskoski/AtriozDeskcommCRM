import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const pushMock = vi.fn();
const successMock = vi.fn();

vi.mock("@/hooks/kanban/useCreateLead", () => ({
  useCreateLead: () => ({ mutateAsync: createMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: [], isLoading: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => successMock(...args), error: vi.fn() },
}));

import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";

const PIPELINE_ID = "11111111-1111-4111-8111-111111111111";
const STAGE_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";

describe("NewLeadDialog no Inbox", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ data: { id: "lead-1" } });
    successMock.mockReset();
    pushMock.mockReset();
  });

  it("exibe o contexto do contato e vincula contato e conversa ao criar", async () => {
    render(
      <NewLeadDialog
        open
        onOpenChange={vi.fn()}
        pipelineId={PIPELINE_ID}
        stages={[
          {
            id: STAGE_ID,
            organization_id: "org-1",
            pipeline_id: PIPELINE_ID,
            name: "Interesse",
            slug: "interesse",
            position: 1,
            color: null,
            is_won: false,
            is_lost: false,
            is_archived: false,
            expected_duration_hours: null,
          },
        ]}
        contactId={CONTACT_ID}
        conversationId={CONVERSATION_ID}
        contactName="Maria Silva"
        contactPhone="+55 11 99999-0000"
        primaryOrigin="WhatsApp"
        originHistory={["Campanha", "WhatsApp"]}
        initialTitle="Maria Silva"
        source="inbox"
        pipelineOptions={[{ id: PIPELINE_ID, name: "Oportunidades" }]}
      />,
    );

    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("+55 11 99999-0000")).toBeInTheDocument();
    expect(screen.getByText(/Origem principal:/).parentElement).toHaveTextContent(
      "Origem principal: WhatsApp",
    );
    expect(screen.getByText(/Histórico:/).parentElement).toHaveTextContent(
      "Histórico: Campanha · WhatsApp",
    );

    fireEvent.change(screen.getByLabelText("Próxima ação"), {
      target: { value: "Solicitar fatura" },
    });
    fireEvent.change(screen.getByLabelText("Observação interna"), {
      target: { value: "Cliente pediu retorno amanhã" },
    });
    fireEvent.change(screen.getByLabelText(/Valor previsto/), { target: { value: "1.234,56" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("list", { name: "Etapa 2 de 3" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("list", { name: "Etapa 3 de 3" });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e criar" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_id: PIPELINE_ID,
        stage_id: STAGE_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONVERSATION_ID,
        source: "inbox",
        next_action: "Solicitar fatura",
        internal_note: "Cliente pediu retorno amanhã",
        value_cents: 123456,
      }),
    );
    expect(successMock).toHaveBeenCalled();
  });

  it("não cria ao pressionar Enter antes da confirmação final", async () => {
    render(
      <NewLeadDialog
        open
        onOpenChange={vi.fn()}
        pipelineId={PIPELINE_ID}
        stages={[
          {
            id: STAGE_ID,
            organization_id: "org-1",
            pipeline_id: PIPELINE_ID,
            name: "Interesse",
            slug: "interesse",
            position: 1,
            color: null,
            is_won: false,
            is_lost: false,
            is_archived: false,
            expected_duration_hours: null,
          },
        ]}
        contactId={CONTACT_ID}
        initialTitle="Emerson Hegen"
      />,
    );

    fireEvent.submit(screen.getByRole("list", { name: "Etapa 1 de 3" }).closest("form")!);
    await screen.findByRole("list", { name: "Etapa 2 de 3" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
