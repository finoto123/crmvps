import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ agent_id: z.string().uuid().nullable() }).strict();
type Client = Awaited<ReturnType<typeof createClient>>;

async function lerFunil(client: Client, orgId: string, pipelineId: string) {
  const { data, error } = await client.from("crm_pipelines")
    .select("id, responsible_agent_id")
    .eq("organization_id", orgId).eq("id", pipelineId).eq("is_archived", false).maybeSingle();
  if (error) throw error;
  return data;
}

async function agentesCompativeis(client: Client, orgId: string, pipelineId: string) {
  const { data: agents, error } = await client.from("ai_agents")
    .select("id, name, published_version_id")
    .eq("organization_id", orgId).is("archived_at", null).is("paused_at", null)
    .not("published_version_id", "is", null).order("name");
  if (error) throw error;
  const versionIds = (agents ?? []).flatMap((a) => a.published_version_id ? [a.published_version_id] : []);
  if (!versionIds.length) return [];
  const { data: versions, error: versionError } = await client.from("ai_agent_versions")
    .select("id, agent_id, pipeline_ids")
    .eq("organization_id", orgId).eq("status", "published").in("id", versionIds);
  if (versionError) throw versionError;
  const eligible = new Set((versions ?? [])
    .filter((v) => Array.isArray(v.pipeline_ids) && v.pipeline_ids.includes(pipelineId))
    .map((v) => `${v.agent_id}:${v.id}`));
  return (agents ?? []).filter((a) => eligible.has(`${a.id}:${a.published_version_id}`))
    .map(({ id, name }) => ({ id, name }));
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "pipeline_responsible_agent" });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const client = await createClient();
  try {
    const pipeline = await lerFunil(client, auth.org.orgId, id);
    if (!pipeline) return fail("not_found", "Funil não encontrado.", 404, { requestId });
    const agents = await agentesCompativeis(client, auth.org.orgId, id);
    return ok({ agent_id: pipeline.responsible_agent_id, agents }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível carregar a configuração.", 500, { requestId });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "pipeline_responsible_agent" });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Selecione um agente válido.", 422, { requestId });
  const orgId = auth.org.orgId;
  const client = await createClient();
  try {
    const pipeline = await lerFunil(client, orgId, id);
    if (!pipeline) return fail("not_found", "Funil não encontrado.", 404, { requestId });
    if (parsed.data.agent_id) {
      const agents = await agentesCompativeis(client, orgId, id);
      if (!agents.some((a) => a.id === parsed.data.agent_id)) {
        return fail("validation_failed", "Este agente não está publicado ou não pode atender este funil.", 422, { requestId });
      }
    }
    const { data, error } = await client.from("crm_pipelines")
      .update({ responsible_agent_id: parsed.data.agent_id })
      .eq("organization_id", orgId).eq("id", id).eq("is_archived", false)
      .select("responsible_agent_id").single();
    if (error) throw error;
    void audit({ action: "pipeline.responsible_agent_updated", actorUserId: auth.user.id,
      organizationId: orgId, resourceType: "crm_pipeline", resourceId: id, requestId,
      metadata: { previous_agent_id: pipeline.responsible_agent_id, agent_id: data.responsible_agent_id } });
    return ok({ agent_id: data.responsible_agent_id }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível salvar a configuração.", 500, { requestId });
  }
}
