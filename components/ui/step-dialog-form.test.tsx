import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StepDialogForm } from "./step-dialog-form";

describe("StepDialogForm", () => {
  it("mantém progresso, conteúdo e ações em regiões separadas", () => {
    render(
      <StepDialogForm
        labels={["Dados", "Detalhes", "Revisão"]}
        currentStep={1}
        footer={<button type="button">Continuar</button>}
      >
        <label htmlFor="title">Título</label>
        <input id="title" />
      </StepDialogForm>,
    );

    expect(screen.getByLabelText("Etapa 2 de 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
  });
});
