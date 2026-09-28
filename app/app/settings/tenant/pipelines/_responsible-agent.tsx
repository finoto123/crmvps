"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

const NENHUM = "__nenhum__";
type Agent = { id: string; name: string };
type Config = { agent_id: string | null; agents: Agent[] };

export function ResponsibleAgentSection({ pipelineId }: { pipelineId: string }) {
  const t = useT();
  const [config, setConfig] = useState<Config | null>(null);
  const [choice, setChoice] = useState<string>(NENHUM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const url = `/api/v1/pipelines/${encodeURIComponent(pipelineId)}/responsible-agent`;

  useEffect(() => {
    let active = true;
    fetch(url).then((r) => r.json()).then((body: { data?: Config }) => {
      if (!active) return;
      if (!body.data) { setError(true); return; }
      setConfig(body.data);
      setChoice(body.data.agent_id ?? NENHUM);
      setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [url]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: choice === NENHUM ? null : choice }) });
      const body = await response.json() as { data?: { agent_id: string | null }; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Não foi possível salvar.");
      setConfig((current) => current ? { ...current, agent_id: body.data!.agent_id } : current);
      toast.success(t("Responsável pelo funil atualizado."));
    } catch (err) {
      toast.error(err instanceof Error ? t(err.message) : t("Não foi possível salvar."));
    } finally {
      setSaving(false);
    }
  }

  return <section className="space-y-3 border-t border-border pt-6">
    <h3 className="text-sm font-semibold">{t("Quem atende os contatos deste funil")}</h3>
    <p className="text-xs text-muted-foreground">{t("Quando houver um único negócio aberto neste funil, este agente atende a conversa. A campanha, quando houver, mantém a preferência.")}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{t("Não foi possível carregar os agentes.")}</p> : null}
    {config ? <div className="flex flex-wrap items-center gap-3">
      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger aria-label={t("Agente responsável pelo funil")} className="w-full max-w-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NENHUM}>{t("Nenhum agente definido")}</SelectItem>
          {config.agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" onClick={save} disabled={saving || choice === (config.agent_id ?? NENHUM)}>{t("Salvar")}</Button>
    </div> : !error ? <p className="text-sm text-muted-foreground">{t("Carregando agentes…")}</p> : null}
    {config && config.agents.length === 0 ? <p className="text-xs text-muted-foreground">{t("Publique uma versão com acesso a este funil para poder selecioná-la aqui.")}</p> : null}
    {config?.agent_id && !config.agents.some((agent) => agent.id === config.agent_id) ? <p role="alert" className="text-xs text-destructive">{t("O agente configurado deixou de ser compatível. Escolha outro ou remova a associação.")}</p> : null}
  </section>;
}
