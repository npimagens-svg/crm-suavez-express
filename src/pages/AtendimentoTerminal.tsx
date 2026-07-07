// @ts-nocheck
// Terminal de Atendimento — versão mobile pras profissionais (senhoras).
// Elas SÓ executam: pegam a comanda já aberta pela recepção, veem os serviços
// lançados e editam valor / profissional responsável, ou adicionam um serviço.
// Regra de ouro: TUDO grande e fácil. Fonte graúda, botões altos, alto contraste.
import { useState, useEffect } from "react";
import { supabase } from "@/lib/dynamicSupabaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useServices } from "@/hooks/useServices";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ChevronRight, Plus, Pencil, Trash2, Check, X, RefreshCw, Search, Loader2, UserRound } from "lucide-react";

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

export default function AtendimentoTerminal() {
  const { salonId } = useAuth();
  const { services } = useServices();
  const { professionals } = useProfessionals();
  const { toast } = useToast();
  const profs = professionals.filter((p: any) => p.is_active);
  const activeServices = services.filter((s: any) => s.is_active);

  const [comandas, setComandas] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [sel, setSel] = useState<any | null>(null); // comanda selecionada
  const [items, setItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editProf, setEditProf] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const loadComandas = async () => {
    if (!salonId) return;
    setLoadingList(true);
    const { data } = await supabase
      .from("comandas")
      .select("id, comanda_number, created_at, total, client:clients(name)")
      .eq("salon_id", salonId)
      .is("closed_at", null)
      .order("created_at", { ascending: false });
    setComandas(data || []);
    setLoadingList(false);
  };

  const loadItems = async (comandaId: string) => {
    setLoadingItems(true);
    const { data } = await supabase
      .from("comanda_items")
      .select("*")
      .eq("comanda_id", comandaId)
      .order("created_at", { ascending: true });
    setItems((data || []).filter((i: any) => i.item_type === "service" || !i.item_type));
    setLoadingItems(false);
  };

  useEffect(() => { loadComandas(); }, [salonId]);

  const openComanda = async (c: any) => { setSel(c); setEditId(null); await loadItems(c.id); };
  const backToList = async () => { setSel(null); setItems([]); setEditId(null); await loadComandas(); };

  const recalcTotals = async (comandaId: string) => {
    const { data } = await supabase.from("comanda_items").select("total_price").eq("comanda_id", comandaId);
    const subtotal = (data || []).reduce((a: number, i: any) => a + Number(i.total_price || 0), 0);
    await supabase.from("comandas").update({ subtotal, total: subtotal }).eq("id", comandaId);
  };

  const startEdit = (it: any) => {
    setEditId(it.id);
    setEditPrice(String(it.unit_price ?? ""));
    setEditProf(it.professional_id || sel?.professional_id || "");
  };

  const saveEdit = async (it: any) => {
    setBusy(true);
    try {
      const price = parseFloat(editPrice) || 0;
      const qty = it.quantity || 1;
      await supabase.from("comanda_items").update({
        unit_price: price,
        total_price: price * qty,
        professional_id: editProf || null,
      }).eq("id", it.id);
      await recalcTotals(sel.id);
      setEditId(null);
      await loadItems(sel.id);
      toast({ title: "Serviço atualizado" });
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const removeItem = async (it: any) => {
    setBusy(true);
    try {
      await supabase.from("comanda_items").delete().eq("id", it.id);
      await recalcTotals(sel.id);
      await loadItems(sel.id);
    } catch { toast({ title: "Erro ao remover", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const addService = async (svc: any) => {
    setBusy(true);
    try {
      await supabase.from("comanda_items").insert({
        comanda_id: sel.id,
        service_id: svc.id,
        professional_id: sel?.professional_id || null,
        description: svc.name,
        item_type: "service",
        quantity: 1,
        unit_price: svc.price,
        total_price: svc.price,
      });
      await recalcTotals(sel.id);
      setAddOpen(false); setAddSearch("");
      await loadItems(sel.id);
      toast({ title: "Serviço adicionado" });
    } catch { toast({ title: "Erro ao adicionar", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const profName = (id: string) => profs.find((p: any) => p.id === id)?.name || "Sem profissional";

  // ---------- LISTA DE CLIENTES (comandas abertas) ----------
  if (!sel) {
    return (
      <div className="min-h-[100dvh] bg-white text-zinc-900">
        <header className="sticky top-0 z-10 bg-zinc-900 text-white px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Atendimento</h1>
          <button onClick={loadComandas} className="flex items-center gap-2 text-base bg-white/10 rounded-full px-4 py-2 active:bg-white/20">
            <RefreshCw className="h-5 w-5" /> Atualizar
          </button>
        </header>

        <div className="p-4 space-y-3">
          <p className="text-lg text-zinc-500">Toque no nome da cliente:</p>
          {loadingList ? (
            <div className="py-16 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-zinc-400" /></div>
          ) : comandas.length === 0 ? (
            <div className="py-16 text-center text-xl text-zinc-500">Nenhuma comanda aberta agora.</div>
          ) : (
            comandas.map((c) => (
              <button
                key={c.id}
                onClick={() => openComanda(c)}
                className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-5 py-5 text-left active:bg-zinc-50 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="text-2xl font-bold leading-tight truncate">{c.client?.name || "Cliente"}</div>
                  <div className="text-base text-zinc-500 mt-1">Comanda {String(c.comanda_number).padStart(4, "0")}</div>
                </div>
                <ChevronRight className="h-8 w-8 text-orange-500 shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ---------- SERVIÇOS DA COMANDA ----------
  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900 pb-28">
      <header className="sticky top-0 z-10 bg-zinc-900 text-white px-4 py-4 flex items-center gap-3">
        <button onClick={backToList} className="flex items-center gap-1 text-lg active:opacity-70">
          <ArrowLeft className="h-7 w-7" />
        </button>
        <div className="min-w-0">
          <div className="text-2xl font-bold truncate">{sel.client?.name || "Cliente"}</div>
          <div className="text-sm text-white/70">Comanda {String(sel.comanda_number).padStart(4, "0")}</div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {loadingItems ? (
          <div className="py-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-zinc-400" /></div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-xl text-zinc-500">Nenhum serviço lançado ainda.</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className="rounded-2xl border-2 border-zinc-200 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-xl font-bold leading-tight">{it.description}</div>
                <div className="text-2xl font-extrabold whitespace-nowrap">{brl(it.total_price)}</div>
              </div>

              {editId === it.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-base text-zinc-500">Valor (R$)</label>
                    <Input type="number" inputMode="decimal" step="0.01" value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="h-14 text-2xl font-bold text-right" />
                  </div>
                  <div>
                    <label className="text-base text-zinc-500">Profissional</label>
                    <Select value={editProf} onValueChange={setEditProf}>
                      <SelectTrigger className="h-14 text-lg"><SelectValue placeholder="Escolher" /></SelectTrigger>
                      <SelectContent>
                        {profs.map((p: any) => (
                          <SelectItem key={p.id} value={p.id} className="text-lg py-3">{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => saveEdit(it)} disabled={busy}
                      className="flex-1 h-14 rounded-xl bg-orange-500 text-white text-xl font-bold flex items-center justify-center gap-2 active:bg-orange-600 disabled:opacity-60">
                      {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Check className="h-6 w-6" />} Salvar
                    </button>
                    <button onClick={() => setEditId(null)} className="h-14 px-5 rounded-xl border-2 border-zinc-300 text-lg active:bg-zinc-100">
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-lg text-zinc-600">
                    <UserRound className="h-5 w-5 text-zinc-400" />
                    {it.professional_id ? profName(it.professional_id) : (sel.professional_id ? profName(sel.professional_id) : "Sem profissional")}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => startEdit(it)}
                      className="flex-1 h-14 rounded-xl border-2 border-orange-500 text-orange-600 text-xl font-bold flex items-center justify-center gap-2 active:bg-orange-50">
                      <Pencil className="h-6 w-6" /> Editar
                    </button>
                    <button onClick={() => removeItem(it)} disabled={busy}
                      className="h-14 px-5 rounded-xl border-2 border-zinc-300 text-red-600 active:bg-red-50 disabled:opacity-60">
                      <Trash2 className="h-6 w-6" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Botão grande fixo: adicionar serviço */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-white border-t-2 border-zinc-100">
        <button onClick={() => { setAddOpen(true); setAddSearch(""); }}
          className="w-full h-16 rounded-2xl bg-zinc-900 text-white text-2xl font-bold flex items-center justify-center gap-3 active:bg-zinc-800">
          <Plus className="h-8 w-8" /> Adicionar serviço
        </button>
      </div>

      {/* Seletor de serviço — tela cheia, lista grande */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <header className="bg-zinc-900 text-white px-4 py-4 flex items-center gap-3">
            <button onClick={() => setAddOpen(false)}><ArrowLeft className="h-7 w-7" /></button>
            <h2 className="text-2xl font-bold">Escolher serviço</h2>
          </header>
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-zinc-400" />
              <Input autoFocus placeholder="Buscar serviço..." value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                className="h-14 pl-12 text-xl" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
            {activeServices
              .filter((s: any) => s.name.toLowerCase().includes(addSearch.toLowerCase()))
              .map((s: any) => (
                <button key={s.id} onClick={() => addService(s)} disabled={busy}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border-2 border-zinc-200 px-5 py-4 text-left active:bg-zinc-50 disabled:opacity-60">
                  <span className="text-xl font-semibold">{s.name}</span>
                  <span className="text-xl font-bold whitespace-nowrap">{brl(s.price)}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
