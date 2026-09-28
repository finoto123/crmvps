import type pg from 'pg';

export type CorrespondenciaDoFunil =
  | { kind: 'none' }
  | { kind: 'one'; leadId: string; pipelineId: string; agentId: string }
  | { kind: 'ambiguous' };

/** Só negócios abertos do contato e funis com responsável declarado entram na decisão. */
export async function agenteDoFunilDoContato(
  db: pg.Pool,
  organizationId: string,
  contactId: string,
): Promise<CorrespondenciaDoFunil> {
  const { rows } = await db.query<{ lead_id: string; pipeline_id: string; agent_id: string }>(
    `select l.id as lead_id, l.pipeline_id, p.responsible_agent_id as agent_id
       from crm_leads l
       join crm_pipelines p on p.organization_id = l.organization_id and p.id = l.pipeline_id
      where l.organization_id = $1 and l.contact_id = $2 and l.status = 'open'
        and p.is_archived = false and p.responsible_agent_id is not null
      order by l.id
      limit 2`,
    [organizationId, contactId],
  );
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length > 1) return { kind: 'ambiguous' };
  return { kind: 'one', leadId: rows[0]!.lead_id, pipelineId: rows[0]!.pipeline_id, agentId: rows[0]!.agent_id };
}

/** Ambiguidade é trabalho humano visível; nenhuma resposta automática é gerada. */
export async function sinalizarAmbiguidadeDoFunil(
  db: pg.Pool,
  organizationId: string,
  conversationId: string,
  reason: 'ambiguous' | 'invalid' = 'ambiguous',
): Promise<void> {
  const title = reason === 'ambiguous' ? 'Escolher negócio para o atendimento' : 'Revisar agente responsável pelo funil';
  const body = reason === 'ambiguous'
    ? 'Há mais de um negócio aberto com agente definido para esta pessoa. Revise os negócios antes de retomar o atendimento automático.'
    : 'O agente configurado para o funil não está disponível ou não pode atender este negócio. Revise a configuração antes de retomar o atendimento automático.';
  await db.query(
    `update conversations set status = 'pending'
      where organization_id = $1 and id = $2 and status in ('open', 'ai_handling')`,
    [organizationId, conversationId],
  );
  await db.query(
    `insert into agent_inbox_items
       (organization_id, kind, severity, title, body, ref_kind, ref_id)
     select $1, 'other', 'warn', $3, $4,
            'conversation', $2
      where not exists (
        select 1 from agent_inbox_items
         where organization_id = $1 and ref_kind = 'conversation' and ref_id = $2
           and title = $3 and status = 'open'
      )`,
    [organizationId, conversationId, title, body],
  );
}
