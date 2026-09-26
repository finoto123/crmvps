import { ApiError } from "@/lib/api/types";

/** Traduz a recusa atômica do banco para rota HTTP e ferramenta do agente. */
export function erroAoInserirAgendamento(
  erro: { code?: string; message: string },
  requestId: string,
): ApiError {
  if (erro.code === "P0001" && erro.message === "appointment_slot_taken") {
    return new ApiError(
      409,
      "agenda_horario_indisponivel",
      undefined,
      requestId,
      "Esse horário acabou de ser ocupado. Vou verificar outras opções para você.",
    );
  }
  return new ApiError(500, "internal_error", undefined, requestId, erro.message);
}
