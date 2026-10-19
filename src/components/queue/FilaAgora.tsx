import { useMemo, useState } from "react";
import { GlassCard, Button as NpButton } from "@design-system";
import { Clock, MapPin } from "lucide-react";
import type { FilaAbertura, PublicService } from "@/hooks/usePublicQueue";
import { calcularPrevisao, fmtMinutos, rotuloCategoria, textoSaida, type Painel } from "@/lib/filaPrevisao";
import { pedirLocalizacao, tempoAteSalaoMin } from "@/lib/filaTrajeto";

// Fila pública: toda comanda aberta aparece (em atendimento ou aguardando),
// disponibilidade por tipo de serviço e tempo de saída pela localização da cliente.
export function FilaAgora({ painel, services, fila }: { painel: Painel | null; services: PublicService[]; fila: FilaAbertura }) {
  const categorias = useMemo(
    () => Array.from(new Set(services.map((s) => s.category).filter((c): c is string => !!c))),
    [services],
  );
  const previsao = useMemo(() => (painel ? calcularPrevisao(painel, categorias) : null), [painel, categorias]);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [trajeto, setTrajeto] = useState<{ estado: "idle" | "carregando" | "ok" | "erro"; min?: number }>({ estado: "idle" });

  const itens = previsao?.itens ?? [];
  const emAtendimento = itens.filter((i) => i.situacao === "em_atendimento").length;
  const aguardando = itens.length - emAtendimento;
  const categoria = escolhida ?? categorias[0] ?? null;
  const prevCategoria = previsao?.categorias.find((c) => c.categoria === categoria) ?? null;

  const calcularTrajeto = async () => {
    setTrajeto({ estado: "carregando" });
    try {
      const origem = await pedirLocalizacao();
      setTrajeto({ estado: "ok", min: await tempoAteSalaoMin(origem) });
    } catch {
      setTrajeto({ estado: "erro" });
    }
  };

  return (
    <>
      <GlassCard padding={24} className="text-center">
        <p className="np-caps">Agora no salão</p>
        <div className="mt-2 flex items-baseline justify-center gap-3">
          <span className="np-num text-7xl leading-none tabular-nums text-foreground">{itens.length}</span>
          <span className="text-left text-sm leading-tight text-muted-foreground">
            {itens.length === 1 ? "pessoa na fila" : "pessoas na fila"}
          </span>
        </div>
        {itens.length > 0 ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {emAtendimento} em atendimento · {aguardando} aguardando
            </p>
            <ul className="mt-4 space-y-2 text-left text-sm">
              {itens.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-[color:var(--np-surface-inset)] px-3 py-2">
                  <span className="min-w-0">
                    <span className={item.situacao === "em_atendimento" ? "font-medium text-[color:var(--np-positive)]" : "font-medium text-[color:var(--np-accent-text)]"}>
                      {item.situacao === "em_atendimento" ? "Em atendimento" : "Aguardando"}
                    </span>
                    {item.servico && <span className="block truncate text-muted-foreground">{item.servico}</span>}
                  </span>
                  <span className="shrink-0 text-right text-muted-foreground">
                    {item.situacao === "aguardando" && item.minutos === 0 ? (
                      <strong className="text-foreground">começa agora</strong>
                    ) : (
                      <>
                        {item.situacao === "em_atendimento" ? "termina em" : "começa em"}{" "}
                        <strong className="np-num tabular-nums text-foreground">~{fmtMinutos(item.minutos)}</strong>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 font-medium text-[color:var(--np-positive)]">Fila vazia! Atendimento imediato.</p>
        )}
      </GlassCard>

      {fila.aberta && previsao && categorias.length > 0 && (
        <GlassCard padding={20}>
          <p className="np-caps text-center">Quando é a minha vez?</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {categorias.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setEscolhida(c)}
                className={`rounded-full px-4 py-1.5 text-sm transition ${c === categoria ? "bg-[color:var(--np-accent-soft)] text-foreground ring-1 ring-[color:var(--np-accent-border)]" : "bg-[color:var(--np-surface-inset)] text-muted-foreground"}`}
              >
                {rotuloCategoria(c)}
              </button>
            ))}
          </div>

          {prevCategoria && (
            <div role="status" className="mt-4 text-center text-sm">
              {prevCategoria.livres > 0 ? (
                <p className="font-medium text-[color:var(--np-positive)]">
                  {prevCategoria.livres === 1 ? "1 profissional livre agora" : `${prevCategoria.livres} profissionais livres agora`}
                </p>
              ) : (
                <>
                  <p className="font-medium text-foreground">Nenhuma profissional livre agora.</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-4 w-4 text-[color:var(--np-accent-text)]" />
                    Próxima livre em <strong className="np-num tabular-nums text-foreground">~{fmtMinutos(prevCategoria.proximaLivreMin)}</strong>
                  </p>
                  <p className="mt-1 text-muted-foreground">Garanta seu lugar comprando agora.</p>
                </>
              )}
            </div>
          )}

          <div className="mt-4">
            {trajeto.estado === "ok" && prevCategoria ? (
              <p className="rounded-xl bg-[color:var(--np-surface-inset)] px-3 py-2 text-center text-sm text-foreground">
                {textoSaida(trajeto.min!, prevCategoria.proximaLivreMin)}
              </p>
            ) : (
              <NpButton variant="secondary" size="lg" block icon={MapPin} onClick={calcularTrajeto} disabled={trajeto.estado === "carregando"}>
                {trajeto.estado === "carregando" ? "Calculando..." : "Calcular meu tempo até o salão"}
              </NpButton>
            )}
            {trajeto.estado === "erro" && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Não conseguimos sua localização. Libere a localização no navegador e tente de novo.
              </p>
            )}
          </div>
        </GlassCard>
      )}
    </>
  );
}
