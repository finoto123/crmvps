import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const pool = new pg.Pool({ host: "127.0.0.1", port: Number(process.env.TEST_DB_PORT ?? 54329),
  user: "postgres", password: "postgres", database: "postgres" });
const A = "e5c07e00-0000-4000-8000-0000000000a1";
const B = "e5c07e00-0000-4000-8000-0000000000b1";
let pipelineA: string;
let agentA: string;
let agentB: string;

beforeAll(async () => {
  for (const [id, slug] of [[A, "resp-pipeline-a"], [B, "resp-pipeline-b"]]) {
    await pool.query(`insert into organizations (id, slug, legal_name, display_name)
      values ($1, $2, 'Teste LTDA', 'Teste')`, [id, slug]);
  }
  pipelineA = (await pool.query<{ id: string }>(`insert into crm_pipelines
    (organization_id, name, slug) values ($1, 'Funil A', 'resp-funil-a') returning id`, [A])).rows[0]!.id;
  agentA = (await pool.query<{ id: string }>(`insert into ai_agents
    (organization_id, name, kind, system_prompt, model)
    values ($1, 'Responsável A', 'mcp_agent', 'oi', 'claude-sonnet-4-6') returning id`, [A])).rows[0]!.id;
  agentB = (await pool.query<{ id: string }>(`insert into ai_agents
    (organization_id, name, kind, system_prompt, model)
    values ($1, 'Responsável B', 'mcp_agent', 'oi', 'claude-sonnet-4-6') returning id`, [B])).rows[0]!.id;
});
afterAll(async () => {
  await pool.query("delete from organizations where id in ($1, $2)", [A, B]);
  await pool.end();
});

describe("responsável do funil", () => {
  it("nasce sem agente; instalação antiga preserva roteamento", async () => {
    const { rows } = await pool.query<{ responsible_agent_id: string | null }>(
      "select responsible_agent_id from crm_pipelines where organization_id=$1 and id=$2", [A, pipelineA]);
    expect(rows[0]?.responsible_agent_id).toBeNull();
  });
  it("FK composta recusa agente de outra organização", async () => {
    await expect(pool.query("update crm_pipelines set responsible_agent_id=$3 where organization_id=$1 and id=$2",
      [A, pipelineA, agentB])).rejects.toThrow();
    await pool.query("update crm_pipelines set responsible_agent_id=$3 where organization_id=$1 and id=$2",
      [A, pipelineA, agentA]);
    const { rows } = await pool.query<{ responsible_agent_id: string }>(
      "select responsible_agent_id from crm_pipelines where organization_id=$1 and id=$2", [A, pipelineA]);
    expect(rows[0]?.responsible_agent_id).toBe(agentA);
  });
});
