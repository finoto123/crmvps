import { describe, expect, it, vi } from 'vitest';
import { agenteDoFunilDoContato } from './agente-do-funil';

describe('correspondência do negócio aberto', () => {
  it.each([
    [[], 'none'],
    [[{ lead_id: 'a', pipeline_id: 'pa', agent_id: 'aa' }], 'one'],
    [[{ lead_id: 'a', pipeline_id: 'pa', agent_id: 'aa' }, { lead_id: 'b', pipeline_id: 'pb', agent_id: 'ab' }], 'ambiguous'],
  ])('%s → %s', async (rows, kind) => {
    const query = vi.fn().mockResolvedValue({ rows });
    const result = await agenteDoFunilDoContato({ query } as never, 'org-correta', 'contato-correto');
    expect(result.kind).toBe(kind);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.organization_id = l.organization_id');
    expect(sql).toContain("l.status = 'open'");
    expect(sql).toContain('p.responsible_agent_id is not null');
    expect(sql).toContain('l.organization_id = $1 and l.contact_id = $2');
    expect(params).toEqual(['org-correta', 'contato-correto']);
  });
});
