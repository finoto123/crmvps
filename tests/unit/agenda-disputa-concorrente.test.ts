import { describe, expect, it } from "vitest";

import { erroAoInserirAgendamento } from "@/lib/agenda/erro-de-criacao";

describe("recusa atômica de horário ocupado", () => {
  it("expõe conflito conhecido ao agente e à rota", () => {
    const erro = erroAoInserirAgendamento(
      { code: "P0001", message: "appointment_slot_taken" },
      "requisicao-qa",
    );
    expect(erro).toMatchObject({
      status: 409,
      code: "agenda_horario_indisponivel",
      message: "Esse horário acabou de ser ocupado. Vou verificar outras opções para você.",
    });
  });

  it("não disfarça erros desconhecidos como conflito", () => {
    const erro = erroAoInserirAgendamento(
      { code: "23503", message: "erro desconhecido" },
      "requisicao-qa",
    );
    expect(erro).toMatchObject({ status: 500, code: "internal_error" });
  });
});
