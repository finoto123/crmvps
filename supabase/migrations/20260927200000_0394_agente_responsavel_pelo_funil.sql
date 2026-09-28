-- Relação explícita de roteamento. NULL mantém o comportamento anterior.
-- A permissão de escrita continua na versão publicada (pipeline_ids).
alter table public.crm_pipelines
  add column if not exists responsible_agent_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_pipelines'::regclass
       and conname = 'crm_pipelines_responsible_agent_org_fk'
  ) then
    alter table public.crm_pipelines
      add constraint crm_pipelines_responsible_agent_org_fk
      foreign key (organization_id, responsible_agent_id)
      references public.ai_agents (organization_id, id)
      on delete set null (responsible_agent_id);
  end if;
end $$;

comment on column public.crm_pipelines.responsible_agent_id is
  'Agente responsável pelo atendimento dos negócios abertos deste funil. Relação de roteamento; o escopo de escrita continua em ai_agent_versions.pipeline_ids.';

create index if not exists idx_crm_pipelines_org_responsible_agent
  on public.crm_pipelines (organization_id, responsible_agent_id)
  where responsible_agent_id is not null;
