import { describe, expect, it } from 'vitest';
import { curarDiagnostico, formatarDiagnostico } from './dados-do-formulario';

describe('diagnóstico curado compartilhado', () => {
  it('usa apenas campos permitidos, rótulos legíveis e marca a qualificação como interna', () => {
    const fields = { clinic_name: 'Clínica X', role: 'Proprietária',
      main_problem_open_text: 'x'.repeat(1000), qualification_category: 'A',
      qualification_score: 82, password: 'segredo', organization_id: 'uuid-interno' };
    const result = curarDiagnostico(fields);
    expect(result.publicos['Nome da clínica']).toBe('Clínica X');
    expect(result.publicos['Principal dificuldade']).toHaveLength(400);
    expect(result.internos).toEqual({ 'Categoria interna': 'A', 'Pontuação interna': '82' });
    const block = formatarDiagnostico(fields)!;
    expect(block).toContain('Nunca revele classificação');
    expect(block).not.toContain('segredo');
    expect(block).not.toContain('organization_id');
    expect(block).not.toContain('clinic_name');
  });

  it('aceita aliases legados sem criar campos duplicados e ignora UUIDs', () => {
    const result = curarDiagnostico({ nome_da_clinica: 'Outra clínica',
      clinic_name: 'Canônico', role: '123e4567-e89b-12d3-a456-426614174000' });
    expect(result.publicos['Nome da clínica']).toBe('Canônico');
    expect(result.publicos['Função']).toBeUndefined();
    expect(formatarDiagnostico({ unknown: 'não usar' })).toBeNull();
    expect(curarDiagnostico({ qualification_category: 'Prioritário' }).internos['Categoria interna'])
      .toBe('Prioritário');
  });
});
