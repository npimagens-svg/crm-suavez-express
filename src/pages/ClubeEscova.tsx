import { useState } from "react";
import {
  ArrowDown,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Instagram,
  MapPin,
  MessageCircle,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import { CountUp, Reveal, useInView, prefersReducedMotion } from "@/components/clube/Reveal";

/**
 * Clube da Escova — página pública de vendas (assinatura recorrente Asaas).
 * Rota /clube-escova (sem login). Marca NP Hair Express: #F7A100 sobre near-black.
 * Tráfego = Instagram no celular → mobile-first.
 */

const BRAND = "#F7A100";
const INK = "#17120f";
const WHATS =
  "https://wa.me/5519990091315?text=Quero%20saber%20do%20Clube%20da%20Escova";

type Comprimento = "curto" | "longo";

interface Plano {
  escovas: 4 | 8;
  preco: Record<Comprimento, number>;
  avulso: Record<Comprimento, number>;
  link: Record<Comprimento, string>;
  destaque?: boolean;
}

const PLANOS: Plano[] = [
  {
    escovas: 4,
    preco: { curto: 197, longo: 247 },
    avulso: { curto: 308, longo: 388 }, // 4 × R$77 / 4 × R$97
    link: {
      curto: "https://www.asaas.com/c/ctbr9733y2dye8r1",
      longo: "https://www.asaas.com/c/a8d8qc2fryztsjeq",
    },
    destaque: true,
  },
  {
    escovas: 8,
    preco: { curto: 347, longo: 447 },
    avulso: { curto: 616, longo: 776 }, // 8 × R$77 / 8 × R$97
    link: {
      curto: "https://www.asaas.com/c/wqep6rzf1vn2g27r",
      longo: "https://www.asaas.com/c/2xqfpqmyug6kbq3h",
    },
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "E se eu não usar todas as escovas do mês?",
    a: "Elas valem dentro do mês e não acumulam pro seguinte. O Clube foi feito pra quem vem toda semana — se você faz escova umas 2 vezes por mês, o avulso ainda é a melhor conta pra você. A gente prefere te falar isso agora do que te ver pagando por algo que não usa.",
  },
  {
    q: "Tem fidelidade?",
    a: "Não. Você cancela quando quiser, sem multa e sem letra miúda. Se o Clube não encaixar na sua rotina, é só avisar que a gente encerra a assinatura.",
  },
  {
    q: "Como funciona o pagamento?",
    a: "É uma assinatura mensal automática no cartão, pelo Asaas — plataforma de pagamento usada por milhares de empresas no Brasil, ambiente seguro. Também dá pra pagar por Pix ou boleto. Você assina uma vez e não pensa mais nisso.",
  },
  {
    q: "Cabelo longo paga mais?",
    a: "Sim, tem plano próprio. Consideramos longo o cabelo que passa da linha do busto — leva mais produto e mais tempo de secador. E a economia em relação ao avulso é ainda maior.",
  },
  {
    q: "Posso usar duas escovas no mesmo dia ou na mesma semana?",
    a: "Pode. As escovas são suas dentro do mês: duas na mesma semana, ou até no mesmo dia — compromisso de manhã e festa à noite, tá valendo. O único limite é o total do seu plano.",
  },
  {
    q: "Escova modelada entra no plano?",
    a: "O plano cobre a escova lisa. Quer modelada? É só pedir na hora e somar R$10 na comanda daquele dia. Simples assim.",
  },
  {
    q: "Preciso agendar horário?",
    a: "Não — aqui ninguém agenda. Você chega, pega a fila digital pelo celular e acompanha sua vez de onde estiver. Assinante entra na mesma fila de todo mundo, do jeito que você já conhece.",
  },
];

/* ---------- seções ---------- */

function PlanoCard({ p, comprimento }: { p: Plano; comprimento: Comprimento }) {
  const preco = p.preco[comprimento];
  const avulso = p.avulso[comprimento];
  const economia = avulso - preco;
  const porEscova = Math.round(preco / p.escovas);

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border p-6 transition-transform duration-300 hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        p.destaque
          ? "border-[#F7A100] bg-[#221a12] shadow-[0_10px_40px_-12px_rgba(247,161,0,0.25)]"
          : "border-white/10 bg-[#1e1813] hover:border-[#F7A100]/40"
      }`}
    >
      {p.destaque && (
        <span className="absolute -top-3 left-6 rounded-full bg-[#F7A100] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#17120f]">
          Mais escolhido
        </span>
      )}

      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a89a87]">
        {p.escovas} escovas por mês
      </p>
      <p className="mt-1 font-serif text-2xl text-[#f6f0e7]">
        {p.escovas === 4 ? "Uma por semana" : "Duas por semana"}
      </p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="font-mono text-[2.6rem] font-bold leading-none text-[#F7A100]">
          R${preco}
        </span>
        <span className="text-sm text-[#a89a87]">/mês</span>
      </div>
      <p className="mt-2 text-sm text-[#cdbfab]">
        Sai a <b className="text-[#f6f0e7]">R${porEscova} por escova</b>
        <span className="text-[#7d7160]"> · avulso custaria R${avulso}</span>
      </p>
      <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-[#F7A100]">
        <Wallet className="h-4 w-4" aria-hidden />
        R${economia} de volta no seu bolso, todo mês
      </p>

      <ul className="mt-6 space-y-2.5 border-t border-white/10 pt-5 text-sm text-[#cdbfab]">
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F7A100]" aria-hidden />
          Escovas valem dentro do mês
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F7A100]" aria-hidden />
          Sem hora marcada — fila digital pelo celular
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F7A100]" aria-hidden />
          Cancela quando quiser, sem fidelidade
        </li>
      </ul>

      <a
        href={p.link[comprimento]}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-6 block rounded-xl py-3.5 text-center text-base font-bold transition-colors ${
          p.destaque
            ? "bg-[#F7A100] text-[#17120f] hover:bg-[#ffb524]"
            : "border border-[#F7A100]/60 text-[#F7A100] hover:bg-[#F7A100] hover:text-[#17120f]"
        }`}
      >
        Assinar agora
      </a>
    </div>
  );
}

function ContaNaMesa() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const shown = inView || prefersReducedMotion();
  const barBase =
    "h-9 rounded-lg transition-[width] duration-1000 ease-out motion-reduce:transition-none";

  return (
    <div
      ref={ref}
      className="rounded-2xl border border-white/10 bg-[#1e1813] p-6 sm:p-8"
    >
      <div className="space-y-6">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-sm text-[#a89a87]">
              4 escovas avulsas no mês
            </span>
            <CountUp
              to={308}
              className="font-mono text-2xl font-bold text-[#7d7160] line-through decoration-[#7d7160]/60 decoration-2"
            />
          </div>
          <div className="w-full rounded-lg bg-white/5">
            <div
              className={`${barBase} bg-[#4a4038]`}
              style={{ width: shown ? "100%" : "0%" }}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-[#f6f0e7]">
              As mesmas 4 no Clube
            </span>
            <CountUp
              to={197}
              className="font-mono text-3xl font-bold text-[#F7A100]"
            />
          </div>
          <div className="w-full rounded-lg bg-white/5">
            <div
              className={`${barBase} bg-[#F7A100] shadow-[0_0_24px_rgba(247,161,0,0.35)]`}
              style={{ width: shown ? "64%" : "0%" }}
            />
          </div>
        </div>
      </div>

      <p className="mt-8 border-t border-white/10 pt-6 text-center font-serif text-xl leading-snug text-[#f6f0e7] sm:text-2xl">
        Sai a <span className="text-[#F7A100]">R$49 cada escova</span>. São
        R$111 que ficam com você — todo santo mês.
      </p>
      <p className="mt-2 text-center text-sm text-[#a89a87]">
        No cabelo longo a diferença é ainda maior: R$141 por mês.
      </p>
    </div>
  );
}

function FaqItem({
  item,
  open,
  onToggle,
}: {
  item: { q: string; a: string };
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-xl border transition-colors ${
        open ? "border-[#F7A100]/50 bg-[#221a12]" : "border-white/10 bg-[#1e1813]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-[15px] font-semibold text-[#f6f0e7]">
          {item.q}
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-[#F7A100] transition-transform duration-300 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm leading-relaxed text-[#cdbfab]">
            {item.a}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- página ---------- */

export default function ClubeEscova() {
  const [comprimento, setComprimento] = useState<Comprimento>("curto");
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const hero = useInView<HTMLDivElement>(0, false);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#17120f] text-[#f6f0e7] antialiased">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#17120f]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <p className="text-sm font-bold uppercase tracking-[0.28em] text-[#f6f0e7]">
            NP Hair <span className="text-[#F7A100]">Express</span>
          </p>
          <a
            href="#planos"
            className="hidden rounded-full bg-[#F7A100] px-5 py-2 text-sm font-bold text-[#17120f] transition-colors hover:bg-[#ffb524] sm:block"
          >
            Assinar
          </a>
        </div>
      </header>

      {/* 1 · HERO */}
      <section
        ref={hero.ref}
        className="relative overflow-hidden px-5 pb-16 pt-14 sm:pb-24 sm:pt-20"
      >
        <div
          className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[720px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(closest-side, rgba(247,161,0,0.28), transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#F7A100]/40 bg-[#F7A100]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[#F7A100]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F7A100] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#F7A100]" />
              </span>
              Só 30 vagas no 1º lote
            </span>
          </Reveal>

          <Reveal delay={100}>
            <h1 className="mt-6 font-serif text-[2.05rem] leading-[1.1] min-[420px]:text-4xl sm:text-6xl sm:leading-[1.05]">
              Escova toda semana.
              <br />
              <em className="text-[#F7A100]">Preço fechado.</em>
            </h1>
          </Reveal>

          <Reveal delay={200}>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[#cdbfab] sm:text-lg">
              O Clube da Escova é a assinatura do NP Hair Express: 4 ou 8
              escovas por mês pagando bem menos que o avulso. A partir de{" "}
              <b className="text-[#f6f0e7]">R$197/mês</b> — até{" "}
              <b className="text-[#f6f0e7]">R$329 de economia</b> todo mês.
            </p>
          </Reveal>

          <Reveal delay={300}>
            <div className="mt-8 flex flex-col items-center gap-4">
              <a
                href="#planos"
                className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-[#F7A100] px-8 py-4 text-lg font-bold text-[#17120f] transition-colors hover:bg-[#ffb524] sm:w-auto"
              >
                Quero ver os planos
                <ArrowDown className="h-5 w-5" aria-hidden />
              </a>
              <p className="text-xs uppercase tracking-[0.18em] text-[#7d7160]">
                sem hora marcada · fila digital · Salto/SP
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 2 · A CONTA NA MESA */}
      <section className="px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <h2 className="text-center font-serif text-3xl sm:text-4xl">
              A conta na mesa
            </h2>
            <p className="mt-3 text-center text-[#a89a87]">
              Mesma escova, mesmas profissionais, mesma cadeira. Só o preço que
              muda.
            </p>
          </Reveal>
          <Reveal delay={120} className="mt-8">
            <ContaNaMesa />
          </Reveal>
        </div>
      </section>

      {/* 3 · COMO FUNCIONA */}
      <section className="border-y border-white/5 bg-[#1a1410] px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <h2 className="text-center font-serif text-3xl sm:text-4xl">
              Como funciona
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Smartphone,
                title: "Assine em 1 minuto",
                text: "Escolhe o plano, paga pelo celular no ambiente seguro do Asaas e pronto: você já é do Clube.",
              },
              {
                icon: CalendarClock,
                title: "Chegue sem marcar",
                text: "Terça a sábado, no horário que encaixar no seu dia. Pegou a fila digital, é só acompanhar sua vez pelo celular.",
              },
              {
                icon: Sparkles,
                title: "Saia pronta, sem pagar",
                text: "Sua escova do mês já está paga. Levantou da cadeira, tá liberada — sem abrir a carteira.",
              },
            ].map((s, i) => (
              <Reveal key={s.title} delay={i * 120}>
                <div className="h-full rounded-2xl border border-white/10 bg-[#1e1813] p-6 transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none">
                  <span className="font-mono text-sm font-bold text-[#7d7160]">
                    0{i + 1}
                  </span>
                  <s.icon className="mt-3 h-7 w-7 text-[#F7A100]" aria-hidden />
                  <h3 className="mt-4 text-lg font-bold text-[#f6f0e7]">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#cdbfab]">
                    {s.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 4 · PLANOS */}
      <section id="planos" className="scroll-mt-20 px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <h2 className="text-center font-serif text-3xl sm:text-4xl">
              Escolha o seu plano
            </h2>
            <p className="mt-3 text-center text-[#a89a87]">
              Assinatura mensal pelo Asaas. Sem fidelidade — cancela quando
              quiser.
            </p>
          </Reveal>

          {/* toggle comprimento */}
          <Reveal delay={100}>
            <div className="mt-8 flex justify-center">
              <div className="inline-flex rounded-full border border-white/10 bg-[#1e1813] p-1">
                {(
                  [
                    ["curto", "Curto ou médio"],
                    ["longo", "Longo"],
                  ] as [Comprimento, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setComprimento(value)}
                    aria-pressed={comprimento === value}
                    className={`rounded-full px-5 py-2 text-sm font-bold transition-colors ${
                      comprimento === value
                        ? "bg-[#F7A100] text-[#17120f]"
                        : "text-[#a89a87] hover:text-[#f6f0e7]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-[#7d7160]">
              Longo = passa da linha do busto
            </p>
          </Reveal>

          <div
            key={comprimento}
            className="mt-8 grid gap-6 animate-fade-in motion-reduce:animate-none sm:grid-cols-2"
          >
            {PLANOS.map((p) => (
              <PlanoCard key={p.escovas} p={p} comprimento={comprimento} />
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-[#7d7160]">
            Escova modelada soma R$10 na hora. Pagamento seguro pelo Asaas —
            cartão, Pix ou boleto.
          </p>
        </div>
      </section>

      {/* 5 · PRA QUEM É */}
      <section className="border-y border-white/5 bg-[#1a1410] px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <h2 className="text-center font-serif text-3xl sm:text-4xl">
              O Clube é pra você que&hellip;
            </h2>
          </Reveal>
          <div className="mt-10 space-y-4">
            {[
              {
                icon: BadgeCheck,
                title: "…já vem toda semana",
                text: "Se escova já faz parte da sua rotina, você está pagando caro demais no avulso. Era só isso que faltava te contar.",
              },
              {
                icon: Clock,
                title: "…trabalha com o cabelo feito",
                text: "Antes do expediente, da reunião, do evento. Cabelo arrumado vira compromisso fixo — com preço fixo.",
              },
              {
                icon: Wallet,
                title: "…cansou de pagar avulso",
                text: "Um valor fechado por mês, sem surpresa na comanda. Você sabe exatamente quanto o seu cabelo custa.",
              },
            ].map((b, i) => (
              <Reveal key={b.title} delay={i * 100}>
                <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#1e1813] p-5">
                  <span className="rounded-xl bg-[#F7A100]/10 p-2.5">
                    <b.icon className="h-6 w-6 text-[#F7A100]" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-serif text-xl text-[#f6f0e7]">
                      {b.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#cdbfab]">
                      {b.text}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 6 · FAQ / OBJEÇÕES */}
      <section className="px-5 py-14 sm:py-20">
        <div className="mx-auto max-w-2xl">
          <Reveal>
            <h2 className="text-center font-serif text-3xl sm:text-4xl">
              Pode perguntar
            </h2>
            <p className="mt-3 text-center text-[#a89a87]">
              As dúvidas que toda cliente tem antes de assinar — respondidas sem
              enrolação.
            </p>
          </Reveal>
          <div className="mt-8 space-y-3">
            {FAQ.map((item, i) => (
              <Reveal key={item.q} delay={Math.min(i * 60, 240)}>
                <FaqItem
                  item={item}
                  open={faqOpen === i}
                  onToggle={() => setFaqOpen(faqOpen === i ? null : i)}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 7 · URGÊNCIA + CTA FINAL */}
      <section className="px-5 pb-20 pt-4 sm:pb-24">
        <Reveal>
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-[#F7A100] px-6 py-12 text-center sm:px-12 sm:py-16">
            <div
              className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full"
              style={{
                background:
                  "radial-gradient(closest-side, rgba(255,255,255,0.35), transparent 70%)",
              }}
              aria-hidden
            />
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#17120f]/70">
              Primeiro lote · 30 assinantes
            </p>
            <h2
              className="mx-auto mt-3 max-w-xl font-serif text-3xl leading-tight sm:text-4xl"
              style={{ color: INK }}
            >
              As primeiras 30 assinantes entram com esse preço.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[#17120f]/80">
              Depois que o lote fechar, fecha mesmo — a agenda da equipe tem
              limite. Se escova toda semana já é a sua vida, garante a sua vaga
              agora.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#planos"
                className="w-full rounded-xl bg-[#17120f] px-8 py-4 text-lg font-bold text-[#F7A100] transition-transform hover:scale-[1.03] motion-reduce:transition-none sm:w-auto"
              >
                Garantir minha vaga
              </a>
              <a
                href={WHATS}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#17120f]/30 px-8 py-[14px] text-base font-bold text-[#17120f] transition-colors hover:bg-[#17120f]/10 sm:w-auto"
              >
                <MessageCircle className="h-5 w-5" aria-hidden />
                Tirar dúvida no WhatsApp
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* 8 · RODAPÉ */}
      <footer className="border-t border-white/5 px-5 pb-28 pt-10 text-center sm:pb-10">
        <p className="text-sm font-bold uppercase tracking-[0.28em] text-[#f6f0e7]">
          NP Hair <span className="text-[#F7A100]">Express</span>
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#7d7160]">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          R. 7 de Setembro, 374 — Centro, Salto/SP · terça a sábado
        </p>
        <div className="mt-3">
          <a
            href="https://www.instagram.com/nphairexpress"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F7A100] hover:underline"
          >
            <Instagram className="h-3.5 w-3.5" aria-hidden />
            @nphairexpress
          </a>
        </div>
      </footer>

      {/* CTA sticky mobile */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#17120f]/95 px-4 py-3 backdrop-blur transition-transform duration-300 motion-reduce:transition-none sm:hidden ${
          hero.inView ? "translate-y-full" : "translate-y-0"
        }`}
      >
        <a
          href="#planos"
          className="block rounded-xl bg-[#F7A100] py-3.5 text-center text-base font-bold text-[#17120f]"
        >
          Assinar por R$197/mês
        </a>
      </div>
    </div>
  );
}
