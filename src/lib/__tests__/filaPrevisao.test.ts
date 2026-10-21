import { describe, it, expect } from "vitest";
import { calcularPrevisao, textoSaida, fmtMinutos, type Painel } from "../filaPrevisao";
import { distanciaKm, estimativaLinhaRetaMin, SALAO } from "../filaTrajeto";

const AGORA = "2026-10-17T18:00:00.000Z";
const antes = (min: number) => new Date(new Date(AGORA).getTime() - min * 60000).toISOString();
const CAB = "CABELOS";
const UNHA = "MANICURE E PEDICURE";

function painel(p: Partial<Painel>): Painel {
  return {
    agora: AGORA,
    comandas: [],
    aguardando: [],
    profissionais: [
      { id: 1, categorias: [CAB], presente: true },
      { id: 2, categorias: [UNHA], presente: true },
    ],
    ...p,
  };
}

describe("calcularPrevisao", () => {
  it("salão vazio: todas livres agora", () => {
    const r = calcularPrevisao(painel({}), [CAB, UNHA]);
    expect(r.itens).toEqual([]);
    expect(r.categorias).toEqual([
      { categoria: CAB, livres: 1, proximaLivreMin: 0 },
      { categoria: UNHA, livres: 1, proximaLivreMin: 0 },
    ]);
  });

  it("comanda aberta (Abrir Comanda já marca in_service) aparece como em atendimento", () => {
    const r = calcularPrevisao(painel({
      comandas: [{ profissional: 1, aberta_em: antes(10), minutos: 55, servico: "ESCOVA", categoria: CAB }],
    }), [CAB]);
    expect(r.itens).toEqual([{ situacao: "em_atendimento", servico: "ESCOVA", minutos: 45 }]);
    expect(r.categorias[0]).toEqual({ categoria: CAB, livres: 0, proximaLivreMin: 45 });
  });

  it("2ª comanda da mesma profissional espera a 1ª terminar", () => {
    const r = calcularPrevisao(painel({
      comandas: [
        { profissional: 1, aberta_em: antes(10), minutos: 40, servico: "A", categoria: CAB },
        { profissional: 1, aberta_em: antes(5), minutos: 40, servico: "B", categoria: CAB },
      ],
    }), [CAB]);
    expect(r.itens).toEqual([
      { situacao: "em_atendimento", servico: "A", minutos: 30 },
      { situacao: "aguardando", servico: "B", minutos: 30 },
    ]);
    expect(r.categorias[0].proximaLivreMin).toBe(70);
  });

  it("atendimento que passou do tempo conta como terminando (5 min)", () => {
    const r = calcularPrevisao(painel({
      comandas: [{ profissional: 1, aberta_em: antes(120), minutos: 40, servico: "A", categoria: CAB }],
    }), [CAB]);
    expect(r.itens[0].minutos).toBe(5);
    expect(r.categorias[0].proximaLivreMin).toBe(5);
  });

  it("online pago sem comanda vai pra profissional da categoria que fica livre primeiro", () => {
    const r = calcularPrevisao(painel({
      profissionais: [
        { id: 1, categorias: [CAB], presente: true },
        { id: 3, categorias: [CAB], presente: true },
      ],
      comandas: [
        { profissional: 1, aberta_em: antes(0), minutos: 60, servico: "A", categoria: CAB },
        { profissional: 3, aberta_em: antes(0), minutos: 20, servico: "B", categoria: CAB },
      ],
      aguardando: [{ criado_em: antes(30), chegou: false, minutos: 40, servico: "C", categoria: CAB }],
    }), [CAB]);
    expect(r.itens.find((i) => i.servico === "C")).toEqual({ situacao: "aguardando", servico: "C", minutos: 20 });
    expect(r.categorias[0]).toEqual({ categoria: CAB, livres: 0, proximaLivreMin: 60 });
  });

  it("profissional ausente não conta; se nenhuma presente, usa todas da categoria", () => {
    const ausente = calcularPrevisao(painel({
      profissionais: [
        { id: 1, categorias: [CAB], presente: true },
        { id: 3, categorias: [CAB], presente: false },
      ],
      comandas: [{ profissional: 1, aberta_em: antes(0), minutos: 30, servico: "A", categoria: CAB }],
    }), [CAB]);
    expect(ausente.categorias[0]).toEqual({ categoria: CAB, livres: 0, proximaLivreMin: 30 });

    const ninguem = calcularPrevisao(painel({
      profissionais: [{ id: 3, categorias: [CAB], presente: false }],
    }), [CAB]);
    expect(ninguem.categorias[0]).toEqual({ categoria: CAB, livres: 1, proximaLivreMin: 0 });
  });

  it("item lançado pra outra profissional ocupa ela (corte da Neide na comanda da Wanessa)", () => {
    const r = calcularPrevisao(painel({
      profissionais: [
        { id: 1, categorias: [CAB], presente: true },
        { id: 2, categorias: [CAB, UNHA], presente: true },
      ],
      comandas: [{ profissional: 1, aberta_em: antes(10), minutos: 240, servico: "ALINHAMENTO", categoria: CAB, outras: [{ profissional: 2, minutos: 30 }] }],
    }), [CAB]);
    expect(r.itens).toEqual([{ situacao: "em_atendimento", servico: "ALINHAMENTO", minutos: 260 }]);
    expect(r.categorias[0]).toEqual({ categoria: CAB, livres: 0, proximaLivreMin: 20 });
  });

  it("comanda sem profissional entra como aguardando", () => {
    const r = calcularPrevisao(painel({
      comandas: [{ profissional: null, aberta_em: antes(1), minutos: 40, servico: "X", categoria: UNHA }],
    }), [UNHA]);
    expect(r.itens).toEqual([{ situacao: "aguardando", servico: "X", minutos: 0 }]);
    expect(r.categorias[0].proximaLivreMin).toBe(40);
  });
});

describe("textos", () => {
  it("fmtMinutos", () => {
    expect(fmtMinutos(45)).toBe("45 min");
    expect(fmtMinutos(60)).toBe("1h");
    expect(fmtMinutos(80)).toBe("1h20");
  });
  it("textoSaida: dá tempo de esperar ou sai agora", () => {
    expect(textoSaida(12, 30)).toBe("Você leva ~12 min até o salão e sua vez é em ~30 min. Saia daqui a ~18 min.");
    expect(textoSaida(20, 10)).toBe("Você leva ~20 min até o salão e sua vez é em ~10 min. Pode sair agora.");
    expect(textoSaida(10, 0)).toBe("Tem profissional livre agora. Você leva ~10 min até o salão: pode sair agora.");
  });
});

describe("trajeto", () => {
  it("linha reta: Itu centro ~8 km → ~23 min; no salão = 2 min", () => {
    const km = distanciaKm({ lat: -23.2642, lng: -47.2992 }, SALAO);
    expect(km).toBeGreaterThan(6);
    expect(km).toBeLessThan(8);
    expect(estimativaLinhaRetaMin(km)).toBeGreaterThan(15);
    expect(estimativaLinhaRetaMin(0)).toBe(2);
  });
});
