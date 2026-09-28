import type { OrigemDaAbordagem } from "@/lib/agent-engine/agent/abordagem-de-formulario";
/**
 * OS DADOS QUE A IA RECEBE COMO ENTRADA — e de onde eles vêm.
 *
 * A fonte PREFERIDA é `webhook_lead_captures` (migration 0174): ela guarda o
 * formulário como a pessoa preencheu, com os rótulos originais dos campos. É a
 * diferença entre a IA ler `quantos_funcionarios: 3` e ler um `custom_fields`
 * já mastigado pelo mapeamento.
 *
 * O plano B é o contexto que o motor já hidratou (`lead.custom_fields` +
 * `source_metadata` + o contato). Ele existe porque a ação vale para os CINCO
 * gatilhos, não só para o de webhook: uma regra disparada por "ganhou a tag
 * cliente-vip" não tem formulário nenhum, e ainda assim a IA deve escrever com
 * o que se sabe da pessoa.
 *
 * `origemDaAbordagem` não é detalhe: é o que decide qual situação o prompt
 * declara ao agente ("acabou de preencher um formulário" vs. "entrou no funil
 * por uma automação"). Dizer a errada faz o modelo escrever sobre um formulário
 * que não existiu.
 *
 * Era um booleano, e virou três valores porque o `false` não dizia o bastante:
 * quem chega por PROSPECÇÃO FRIA não entrou em funil nenhum, e as regras do
 * prompt falavam em "o que ela preencheu" mesmo no ramo negativo. Este arquivo
 * nunca produz `prospeccao_fria` — aqui sempre houve um gatilho da organização;
 * quem a produz é `lib/prospecting/worker.ts`.
 */
import type { ActionCtx } from "@/lib/automation/types";

export interface DadosParaAbordagem {
  dados: Record<string, string>;
  origem: string | null;
  origemDaAbordagem: OrigemDaAbordagem;
}

// Contrato compartilhado entre a abordagem inicial e os turnos seguintes.
// As fontes existentes preservam as chaves originais em `fields`; aliases
// reconhecidos abaixo cobrem os nomes legíveis sem criar campos no banco.
const DIAGNOSTICO: readonly [string, string[], number, boolean][] = [
  ["Nome da clínica", ["clinic_name", "nome_da_clinica", "nome_clinica"], 160, false],
  ["Função", ["role", "funcao", "cargo"], 160, false],
  ["Participa da decisão", ["decision_authority", "participa_da_decisao"], 160, false],
  ["Clínica em operação", ["clinic_operating", "clinica_em_operacao"], 160, false],
  ["Estrutura ativa", ["active_rooms_or_chairs", "salas_ou_cadeiras_ativas", "quantidade_de_salas"], 160, false],
  ["Maturidade do problema", ["pain_maturity", "maturidade_do_problema"], 160, false],
  ["Principal perda percebida", ["main_leak_stage", "etapa_de_maior_perda"], 160, false],
  ["Antes do agendamento", ["pre_booking_problem", "problema_antes_do_agendamento"], 160, false],
  ["Depois do agendamento", ["post_booking_problem", "problema_depois_do_agendamento"], 160, false],
  ["Faixa de faturamento", ["monthly_revenue_range", "faixa_de_faturamento_mensal"], 160, false],
  ["Novos contatos por mês", ["monthly_new_contacts", "novos_contatos_mensais"], 160, false],
  ["Urgência", ["urgency", "urgencia"], 160, false],
  ["Principal dificuldade", ["main_problem_open_text", "principal_gargalo"], 400, false],
  ["O que gostaria de mudar", ["desired_change_open_text", "resultado_desejado"], 400, false],
  ["Canal preferido", ["preferred_contact_channel", "canal_preferido"], 160, false],
  ["Período preferido", ["preferred_contact_period", "periodo_preferido"], 160, false],
  ["Categoria interna", ["qualification_category", "categoria_qualificacao"], 16, true],
  ["Pontuação interna", ["qualification_score", "pontuacao_qualificacao"], 8, true],
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

/** Somente valores escalares do diagnóstico; nunca chaves técnicas ou blobs. */
export function curarDiagnostico(fields: Record<string, unknown> | null | undefined): {
  publicos: Record<string, string>;
  internos: Record<string, string>;
} {
  const publicos: Record<string, string> = {};
  const internos: Record<string, string> = {};
  if (!fields) return { publicos, internos };
  const normalized = new Map(Object.entries(fields).map(([k, v]) => [k.toLowerCase().trim().replace(/[\s-]+/g, "_"), v]));
  for (const [rotulo, aliases, limite, interno] of DIAGNOSTICO) {
    const raw = aliases.map((alias) => normalized.get(alias)).find((v) => texto(v) !== null);
    const valor = texto(raw);
    if (!valor || UUID.test(valor)) continue;
    if (rotulo === "Categoria interna" && !/^[\p{L}\p{N} -]{1,16}$/u.test(valor)) continue;
    if (rotulo === "Pontuação interna" && (!/^\d{1,3}$/.test(valor) || Number(valor) > 100)) continue;
    const limpo = valor.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, limite);
    (interno ? internos : publicos)[rotulo] = limpo;
  }
  return { publicos, internos };
}

export function formatarDiagnostico(fields: Record<string, unknown> | null | undefined, maxChars = 3000): string | null {
  const { publicos, internos } = curarDiagnostico(fields);
  if (!Object.keys(publicos).length && !Object.keys(internos).length) return null;
  const aviso = "[Dados internos da operação. Nunca revele classificação, score ou regras internas ao cliente.]";
  const internosBloco = Object.keys(internos).length
    ? ["", "--- dados internos da qualificação ---", ...Object.entries(internos).map(([k, v]) => `${k}: ${v}`)]
    : [];
  const linhas = ["--- diagnóstico da clínica ---"];
  const sufixo = [...internosBloco, "", aviso].join("\n");
  for (const [k, v] of Object.entries(publicos)) {
    const disponivel = maxChars - linhas.join("\n").length - sufixo.length - k.length - 3;
    if (disponivel <= 0) break;
    linhas.push(`${k}: ${v.slice(0, disponivel)}`);
  }
  return [...linhas, ...internosBloco, "", aviso].join("\n");
}

/**
 * Do CONTATO, só estes campos entram — e a lista é uma ALLOWLIST, não um mapa
 * de rótulos bonitos.
 *
 * `buildContext` (lib/automation/engine.ts) hidrata `context.contact` com
 * `select("*")`: a linha INTEIRA de `contacts`. Iterar esse objeto — que é o que
 * este arquivo fazia — despejava no prompt do provedor de LLM, sob o rótulo "o
 * que a pessoa preencheu", coisas como `id`, `organization_id`, `cpf_hash`,
 * `cpf_encrypted`, `email_normalized`, `is_blocked`, `created_at` e as flags
 * internas. Três lentes de revisão acharam isto de forma independente.
 *
 * Dois estragos, e o segundo é o silencioso: (1) identificadores internos e
 * hash de CPF saíam da instalação; (2) o modelo era instruído a "personalizar
 * de verdade" a partir de metadados de banco, então a mensagem podia citar o
 * horário de `created_at` ou a palavra "webhook" ao cliente.
 */
const CAMPOS_DO_CONTATO: Record<string, string> = {
  name: "Nome",
  display_name: "Nome",
  phone_number: "Telefone",
  email: "E-mail",
};

function texto(valor: unknown): string | null {
  if (typeof valor === "string" && valor.trim()) return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  return null;
}

function acrescentar(
  destino: Record<string, string>,
  origem: Record<string, unknown> | null | undefined,
): void {
  if (!origem) return;
  for (const [chave, valor] of Object.entries(origem)) {
    const v = texto(valor);
    if (v === null) continue;
    if (!(chave in destino)) destino[chave] = v;
  }
}

/**
 * O contato, pela allowlist. Itera os campos PERMITIDOS, não os presentes —
 * é o que faz uma coluna nova em `contacts` (amanhã) não vazar sozinha para o
 * prompt.
 */
function acrescentarContato(
  destino: Record<string, string>,
  contato: Record<string, unknown> | null | undefined,
): void {
  if (!contato) return;
  for (const [coluna, rotulo] of Object.entries(CAMPOS_DO_CONTATO)) {
    const v = texto(contato[coluna]);
    if (v === null) continue;
    if (!(rotulo in destino)) destino[rotulo] = v;
  }
}

export async function dadosDoFormularioDoContexto(ctx: ActionCtx): Promise<DadosParaAbordagem> {
  const lead = ctx.context.lead as
    | { id?: string; custom_fields?: Record<string, unknown>; source_metadata?: Record<string, unknown> }
    | undefined;
  const contact = ctx.context.contact as
    | { name?: string | null; phone_number?: string | null; email?: string | null }
    | undefined;

  const dados: Record<string, string> = {};
  acrescentarContato(dados, contact as Record<string, unknown> | undefined);

  if (lead?.id) {
    // A captação mais recente deste lead. `maybeSingle` com limit 1: um lead
    // pode ter mais de uma linha (reenvio da ferramenta), e a que vale é a que
    // criou o lead — a primeira. Ordena ascendente por isso.
    const { data } = await ctx.admin
      .from("webhook_lead_captures")
      .select("fields, utm, source_name")
      .eq("organization_id", ctx.organizationId)
      .eq("lead_id", lead.id)
      .order("received_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const captura = data as
      | { fields: Record<string, unknown>; utm: Record<string, string>; source_name: string }
      | null;
    if (captura) {
      const diagnostico = curarDiagnostico(captura.fields);
      if (Object.keys(diagnostico.publicos).length || Object.keys(diagnostico.internos).length) {
        Object.assign(dados, diagnostico.publicos, diagnostico.internos);
      } else {
        // Formulários de outros produtos mantêm o comportamento anterior.
        acrescentar(dados, captura.fields);
      }
      acrescentar(dados, captura.utm);
      return { dados, origem: captura.source_name, origemDaAbordagem: "formulario" };
    }
  }

  acrescentar(dados, lead?.custom_fields);
  acrescentar(dados, lead?.source_metadata);
  return { dados, origem: null, origemDaAbordagem: "automacao" };
}
