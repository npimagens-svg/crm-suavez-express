import { Check, Clock, Sparkles, Crown } from "lucide-react";

/**
 * Clube da Escova — página pública de vendas (assinatura recorrente).
 * Rota /clube-escova (sem login). Link de assinatura = Asaas recorrente mensal.
 * Marca NP Hair Express (laranja #F7A100).
 */

const BRAND = "#F7A100";

interface Plano {
  nome: string;
  escovas: number;
  comprimento: string;
  preco: number;
  avulso: number; // valor da mesma qtd no avulso, p/ mostrar economia
  link: string;
  destaque?: boolean;
}

const PLANOS: Plano[] = [
  {
    nome: "Clube 4x no mês",
    escovas: 4,
    comprimento: "Cabelo curto ou médio",
    preco: 197,
    avulso: 308, // 4 x R$77
    link: "https://www.asaas.com/c/ctbr9733y2dye8r1",
  },
  {
    nome: "Clube 4x no mês",
    escovas: 4,
    comprimento: "Cabelo longo",
    preco: 247,
    avulso: 388, // 4 x R$97
    link: "https://www.asaas.com/c/a8d8qc2fryztsjeq",
  },
  {
    nome: "Clube 8x no mês",
    escovas: 8,
    comprimento: "Cabelo curto ou médio",
    preco: 347,
    avulso: 616, // 8 x R$77
    link: "https://www.asaas.com/c/wqep6rzf1vn2g27r",
    destaque: true,
  },
  {
    nome: "Clube 8x no mês",
    escovas: 8,
    comprimento: "Cabelo longo",
    preco: 447,
    avulso: 776, // 8 x R$97
    link: "https://www.asaas.com/c/2xqfpqmyug6kbq3h",
    destaque: true,
  },
];

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

function PlanoCard({ p }: { p: Plano }) {
  const economia = p.avulso - p.preco;
  return (
    <div
      className="relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm"
      style={{ borderColor: p.destaque ? BRAND : "#e5e5e5" }}
    >
      {p.destaque && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
          style={{ background: BRAND }}
        >
          Mais escolhido
        </span>
      )}

      <div className="flex items-center gap-2">
        {p.escovas >= 8 ? (
          <Crown className="h-5 w-5" style={{ color: BRAND }} />
        ) : (
          <Sparkles className="h-5 w-5" style={{ color: BRAND }} />
        )}
        <h3 className="text-lg font-extrabold text-neutral-900">{p.nome}</h3>
      </div>
      <p className="mt-1 text-sm text-neutral-500">{p.comprimento}</p>

      <div className="mt-4 flex items-end gap-1">
        <span className="text-4xl font-black text-neutral-900">{BRL(p.preco)}</span>
        <span className="mb-1 text-sm text-neutral-500">/mês</span>
      </div>
      <p className="mt-1 text-sm font-semibold" style={{ color: BRAND }}>
        Economia de {BRL(economia)} por mês
      </p>

      <ul className="mt-5 space-y-2.5 text-sm text-neutral-700">
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: BRAND }} />
          <span><b>{p.escovas} escovas</b> no mês</span>
        </li>
        <li className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: BRAND }} />
          <span>Horário da tarde, <b>sem agendar</b> — é só chegar</span>
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: BRAND }} />
          <span>Cabelo sempre feito, cuidado o mês inteiro</span>
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: BRAND }} />
          <span>Cobrança mensal, cancela quando quiser</span>
        </li>
      </ul>

      <a
        href={p.link}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 block rounded-xl py-3 text-center text-base font-bold text-white transition-opacity hover:opacity-90"
        style={{ background: BRAND }}
      >
        Assinar agora
      </a>
    </div>
  );
}

export default function ClubeEscova() {
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-neutral-900 px-4 py-8 text-center text-white">
        <p className="text-sm font-semibold uppercase tracking-[3px]" style={{ color: BRAND }}>
          NP Hair Express
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Clube da Escova</h1>
        <p className="mx-auto mt-3 max-w-md text-neutral-300">
          Sua escova pronta o mês inteiro por um valor fixo — mais barato que fazer avulso,
          sem precisar agendar.
        </p>
        <span
          className="mt-4 inline-block rounded-full border px-4 py-1 text-xs font-bold uppercase tracking-wide"
          style={{ borderColor: BRAND, color: BRAND }}
        >
          Primeiras 30 vagas
        </span>
      </header>

      {/* Planos */}
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PLANOS.map((p, i) => (
            <PlanoCard key={i} p={p} />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-neutral-500">
          Cabelo longo = passa da linha do busto. Pagamento seguro pelo Asaas (PIX, cartão ou boleto).
          <br />Dúvidas? Fale com a gente no WhatsApp{" "}
          <a
            href="https://wa.me/5511978355751?text=Quero%20saber%20do%20Clube%20da%20Escova"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold"
            style={{ color: BRAND }}
          >
            (11) 97835-5751
          </a>
          .
        </p>
      </main>

      <footer className="pb-8 text-center text-xs text-neutral-400">
        NP Hair Express · Salão sem agendamento
      </footer>
    </div>
  );
}
