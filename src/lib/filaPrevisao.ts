// Previsão da fila pública a partir do painel bruto (RPC fila_public_painel).
// Toda comanda aberta conta como gente no salão; cada profissional atende uma
// cliente por vez, na ordem de abertura das comandas dela. Quem pagou online e
// ainda não tem comanda vai para a profissional que fica livre primeiro.

export interface PainelComanda {
  profissional: number | null;
  aberta_em: string;
  minutos: number;
  servico: string | null;
  categoria: string | null;
}

export interface PainelAguardando {
  criado_em: string;
  chegou: boolean;
  minutos: number;
  servico: string | null;
  categoria: string | null;
}

export interface PainelProfissional {
  id: number;
  categorias: string[];
  presente: boolean;
}

export interface Painel {
  agora: string;
  comandas: PainelComanda[];
  aguardando: PainelAguardando[];
  profissionais: PainelProfissional[];
}

export interface ItemFila {
  situacao: "em_atendimento" | "aguardando";
  servico: string | null;
  /** em atendimento: minutos para terminar; aguardando: minutos para começar */
  minutos: number;
}

export interface PrevisaoCategoria {
  categoria: string;
  livres: number;
  /** minutos até a próxima profissional dessa categoria ficar livre (0 = livre agora) */
  proximaLivreMin: number;
}

export interface Previsao {
  itens: ItemFila[];
  categorias: PrevisaoCategoria[];
}

// Atendimento que passou do tempo do catálogo ainda está acontecendo: conta como terminando.
export const MINUTOS_TERMINANDO = 5;
const MIN = 60_000;

/** Profissionais que podem atender a categoria: presentes; se nenhuma presente, todas que atendem. */
function candidatas(profs: PainelProfissional[], categoria: string | null): PainelProfissional[] {
  const daCategoria = categoria ? profs.filter((p) => p.categorias.includes(categoria)) : profs;
  const base = daCategoria.length ? daCategoria : profs;
  const presentes = base.filter((p) => p.presente);
  return presentes.length ? presentes : base;
}

export function calcularPrevisao(painel: Painel, categorias: string[]): Previsao {
  const agora = new Date(painel.agora).getTime();
  const livreEm = new Map<number, number>();
  // Começa no passado: a 1ª comanda da profissional conta da hora em que abriu.
  for (const p of painel.profissionais) livreEm.set(p.id, Number.NEGATIVE_INFINITY);

  const itens: { ordem: number; item: ItemFila }[] = [];
  const semProfissional: PainelAguardando[] = [];

  const comandas = [...painel.comandas].sort((a, b) => a.aberta_em.localeCompare(b.aberta_em));
  for (const c of comandas) {
    if (c.profissional == null || !livreEm.has(c.profissional)) {
      semProfissional.push({ criado_em: c.aberta_em, chegou: true, minutos: c.minutos, servico: c.servico, categoria: c.categoria });
      continue;
    }
    const cursor = livreEm.get(c.profissional)!;
    const abertaEm = new Date(c.aberta_em).getTime();
    const inicio = Math.max(abertaEm, cursor);
    let fim = inicio + c.minutos * MIN;
    if (inicio <= agora) {
      fim = Math.max(fim, agora + MINUTOS_TERMINANDO * MIN);
      itens.push({ ordem: abertaEm, item: { situacao: "em_atendimento", servico: c.servico, minutos: Math.ceil((fim - agora) / MIN) } });
    } else {
      itens.push({ ordem: abertaEm, item: { situacao: "aguardando", servico: c.servico, minutos: Math.ceil((inicio - agora) / MIN) } });
    }
    livreEm.set(c.profissional, fim);
  }

  const espera = [...semProfissional, ...painel.aguardando];
  for (const a of espera) {
    const ordem = new Date(a.criado_em).getTime();
    const cands = candidatas(painel.profissionais, a.categoria);
    if (!cands.length) {
      itens.push({ ordem, item: { situacao: "aguardando", servico: a.servico, minutos: 0 } });
      continue;
    }
    const escolhida = cands.reduce((m, p) => (livreEm.get(p.id)! < livreEm.get(m.id)! ? p : m));
    const inicio = Math.max(agora, livreEm.get(escolhida.id)!);
    livreEm.set(escolhida.id, inicio + a.minutos * MIN);
    itens.push({ ordem, item: { situacao: "aguardando", servico: a.servico, minutos: Math.ceil((inicio - agora) / MIN) } });
  }

  itens.sort((x, y) => {
    if (x.item.situacao !== y.item.situacao) return x.item.situacao === "em_atendimento" ? -1 : 1;
    return x.item.minutos - y.item.minutos || x.ordem - y.ordem;
  });

  const previsaoCategorias = categorias.map((categoria) => {
    const cands = candidatas(painel.profissionais, categoria);
    const tempos = cands.map((p) => livreEm.get(p.id)!);
    return {
      categoria,
      livres: tempos.filter((t) => t <= agora).length,
      proximaLivreMin: tempos.length ? Math.max(0, Math.ceil((Math.min(...tempos) - agora) / MIN)) : 0,
    };
  });

  return { itens: itens.map((i) => i.item), categorias: previsaoCategorias };
}

const ROTULOS: Record<string, string> = {
  CABELOS: "Cabelo",
  "MANICURE E PEDICURE": "Unhas",
  "ESTETICA FACIAL": "Sobrancelha",
};

export function rotuloCategoria(categoria: string): string {
  return ROTULOS[categoria] ?? categoria.charAt(0) + categoria.slice(1).toLowerCase();
}

/** "45 min", "1h", "1h20" */
export function fmtMinutos(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Texto para quem vai sair de casa: tempo de trajeto x tempo até a vez dela. */
export function textoSaida(trajetoMin: number, esperaMin: number): string {
  if (esperaMin <= 0) {
    return `Tem profissional livre agora. Você leva ~${fmtMinutos(trajetoMin)} até o salão: pode sair agora.`;
  }
  if (trajetoMin >= esperaMin) {
    return `Você leva ~${fmtMinutos(trajetoMin)} até o salão e sua vez é em ~${fmtMinutos(esperaMin)}. Pode sair agora.`;
  }
  return `Você leva ~${fmtMinutos(trajetoMin)} até o salão e sua vez é em ~${fmtMinutos(esperaMin)}. Saia daqui a ~${fmtMinutos(esperaMin - trajetoMin)}.`;
}
