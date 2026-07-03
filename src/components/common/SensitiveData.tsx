import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Proteção de dados sensíveis (comissão de profissionais + faturamento).
 * Só ativa para o usuário MASTER (dono). Os valores saem borrados e ilegíveis;
 * clicar no olho pede uma senha (separada do login) para revelar.
 * Recarregar a página, ficar parado alguns minutos ou trocar de aba re-oculta.
 *
 * A senha NÃO fica em texto puro no código — só o hash SHA-256 dela.
 */
const REVEAL_HASH =
  "55dbdcef1c20045f24bc6a539e9e2ff4836ec4180af42fa1e402375bbb22b24f";
const AUTO_LOCK_MS = 4 * 60 * 1000; // re-oculta após 4 min sem revelar de novo

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type SensitiveCtx = {
  active: boolean; // proteção ligada (usuário master)
  locked: boolean; // valores estão ocultos agora
  requestUnlock: () => void; // abre o prompt de senha
  lock: () => void; // volta a ocultar
};

const Ctx = createContext<SensitiveCtx>({
  active: false,
  locked: false,
  requestUnlock: () => {},
  lock: () => {},
});

export function useSensitive() {
  return useContext(Ctx);
}

export function SensitiveDataProvider({ children }: { children: ReactNode }) {
  const { isMaster } = useAuth();
  const active = !!isMaster;

  const [unlocked, setUnlocked] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<number | null>(null);

  const lock = useCallback(() => {
    setUnlocked(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const scheduleAutoLock = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setUnlocked(false), AUTO_LOCK_MS);
  }, []);

  const requestUnlock = useCallback(() => {
    setPwd("");
    setError(false);
    setPromptOpen(true);
  }, []);

  const confirm = useCallback(async () => {
    setChecking(true);
    const ok = (await sha256Hex(pwd)) === REVEAL_HASH;
    setChecking(false);
    if (ok) {
      setUnlocked(true);
      setPromptOpen(false);
      setPwd("");
      scheduleAutoLock();
    } else {
      setError(true);
    }
  }, [pwd, scheduleAutoLock]);

  // Re-oculta ao trocar de aba / minimizar (proteção se sair do PC)
  useEffect(() => {
    if (!active) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") setUnlocked(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [active]);

  const locked = active && !unlocked;

  return (
    <Ctx.Provider value={{ active, locked, requestUnlock, lock }}>
      {children}

      {/* Botão flutuante: revelar (quando bloqueado) / ocultar (quando revelado) */}
      {active && (
        <button
          onClick={unlocked ? lock : requestUnlock}
          className={`fixed bottom-4 right-4 z-[9998] flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-lg ${
            unlocked
              ? "bg-slate-900/90 hover:bg-slate-900"
              : "bg-amber-600 hover:bg-amber-700"
          }`}
          title={
            unlocked
              ? "Ocultar comissões e faturamento"
              : "Ver comissões e faturamento (pede senha)"
          }
        >
          {unlocked ? (
            <>
              <LockIcon /> Ocultar valores
            </>
          ) : (
            <>
              <EyeIcon /> Ver valores
            </>
          )}
        </button>
      )}

      {/* Prompt de senha */}
      {promptOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPromptOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2 text-slate-900">
              <LockIcon />
              <h2 className="text-base font-semibold">Dados protegidos</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Digite a senha de visualização para ver comissões e faturamento.
            </p>
            <input
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => {
                setPwd(e.target.value);
                setError(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
              placeholder="Senha de visualização"
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
                error
                  ? "border-red-400 focus:ring-red-200"
                  : "border-slate-300 focus:ring-slate-200"
              }`}
            />
            {error && (
              <p className="mt-1 text-xs text-red-500">Senha incorreta.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPromptOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={checking || !pwd}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {checking ? "..." : "Ver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * Envolve qualquer valor/bloco sensível. Fora do master, ou revelado, mostra normal.
 * Bloqueado: borra de forma ilegível e mostra um olho para pedir a senha.
 */
export function Sensitive({
  children,
  className = "",
  block = false,
}: {
  children: ReactNode;
  className?: string;
  /** true = bloco grande (olho centralizado); false = valor inline */
  block?: boolean;
}) {
  const { active, locked, requestUnlock } = useSensitive();
  if (!active || !locked) return <>{children}</>;

  return (
    <span
      className={`relative ${block ? "block" : "inline-flex items-center"} ${className}`}
    >
      <span
        aria-hidden
        style={{
          filter: "blur(9px)",
          userSelect: "none",
          pointerEvents: "none",
        }}
        className="opacity-90"
      >
        {children}
      </span>
      <button
        type="button"
        onClick={requestUnlock}
        title="Ver (pede senha)"
        className={`absolute inset-0 z-10 flex items-center justify-center ${
          block ? "" : ""
        } cursor-pointer text-slate-500 hover:text-slate-800`}
      >
        <EyeIcon />
      </button>
    </span>
  );
}

/* ícones inline (sem dependência externa) */
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
