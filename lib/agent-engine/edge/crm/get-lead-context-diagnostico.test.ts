import { describe, expect, it, vi } from 'vitest';
import { getLeadContext } from './get-lead-context';

function banco(fields: Record<string, unknown> | null, captureOrg = 'org-a',
  businesses = [{ id: 'negocio-a', custom_fields: null, responsible_agent_id: null }] as Array<{
    id: string; custom_fields: Record<string, unknown> | null; responsible_agent_id: string | null;
  }>) {
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes('from contacts where')) return { rows: [{ name: 'Pessoa', display_name: null,
      email: null, phone_number: null, tags: [], is_blocked: false, source: null, consent: null,
      is_anonymized: false }] };
    if (sql.includes('from conversations')) return { rows: [] };
    if (sql.includes('from crm_lead_activities')) return { rows: [] };
    if (sql.includes('select distinct d.desfecho')) return { rows: [] };
    if (sql.includes('from crm_leads l')) return { rows: businesses };
    if (sql.includes('from webhook_lead_captures')) return { rows: args[0] === captureOrg && fields ? [{ fields }] : [] };
    throw new Error(`consulta inesperada: ${sql}`);
  });
  return { query };
}

describe('diagnóstico no contexto do turno', () => {
  it('inclui somente a captação do negócio e da organização correta, dentro do teto', async () => {
    const db = banco({ clinic_name: 'Clínica correta', role: 'Dona', qualification_category: 'A',
      qualification_score: 82, secret: 'não entra', main_problem_open_text: 'x'.repeat(2000) });
    const result = await getLeadContext(db as never, {} as never,
      { tenantId: 'org-a', leadId: 'contato-a', fuso: 'America/Sao_Paulo' },
      { historyLimit: 20, maxTokens: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.diagnostico).toContain('Clínica correta');
    expect(result.context.diagnostico).toContain('Categoria interna: A');
    expect(result.context.diagnostico).toContain('Nunca revele classificação');
    expect(result.context.diagnostico).not.toContain('secret');
    expect(result.context.diagnostico).not.toContain('clinic_name');
    expect(result.tokenCount).toBeLessThanOrEqual(1000);
    const captureCall = db.query.mock.calls.find(([sql]) => sql.includes('from webhook_lead_captures'));
    expect(captureCall?.[1]).toEqual(['org-a', 'negocio-a']);
  });

  it('sem diagnóstico ou captação de outra org mantém o turno sem o bloco', async () => {
    const db = banco({ clinic_name: 'Clínica de outra org' }, 'org-b');
    const result = await getLeadContext(db as never, {} as never,
      { tenantId: 'org-a', leadId: 'contato-a', fuso: 'America/Sao_Paulo' },
      { historyLimit: 20, maxTokens: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.diagnostico).toBeUndefined();
  });

  it('dois negócios associados não deixam o contexto escolher a captação de um deles', async () => {
    const db = banco({ clinic_name: 'Não escolher' }, 'org-a', [
      { id: 'negocio-a', custom_fields: null, responsible_agent_id: 'agente-a' },
      { id: 'negocio-b', custom_fields: null, responsible_agent_id: 'agente-b' },
    ]);
    const result = await getLeadContext(db as never, {} as never,
      { tenantId: 'org-a', leadId: 'contato-a', fuso: 'America/Sao_Paulo' },
      { historyLimit: 20, maxTokens: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.diagnostico).toBeUndefined();
    expect(db.query.mock.calls.some(([sql]) => sql.includes('from webhook_lead_captures'))).toBe(false);
  });
});
