import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/dynamicSupabaseClient";
import type { QueueEntry, QueueSettings, QueueStats } from "@/types/queue";

// Public hook: fetches queue data without requiring authentication
// Uses the first (and only) salon in the database

async function getSalonId(): Promise<string | null> {
  const { data } = await supabase
    .from("salons")
    .select("id")
    .limit(1)
    .single();
  return data?.id || null;
}

export function usePublicQueue() {
  const salonQuery = useQuery({
    queryKey: ["public_salon_id"],
    queryFn: getSalonId,
    staleTime: 1000 * 60 * 30, // cache 30 min
  });

  const salonId = salonQuery.data;

  const settingsQuery = useQuery({
    queryKey: ["public_queue_settings", salonId],
    queryFn: async () => {
      if (!salonId) return null;
      const { data } = await supabase
        .from("queue_settings")
        .select("*")
        .eq("salon_id", salonId)
        .maybeSingle();

      return (data || {
        inflation_factor: 1.7,
        credit_validity_days: 30,
        notify_options: [20, 40, 60, 90],
      }) as QueueSettings;
    },
    enabled: !!salonId,
  });

  const queueQuery = useQuery({
    queryKey: ["public_queue", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("queue_entries")
        .select(`
          *,
          service:services(id, name, price, duration_minutes)
        `)
        .eq("salon_id", salonId)
        .in("status", ["waiting", "checked_in", "in_service"])
        .order("position", { ascending: true });

      if (error) throw error;
      return data as QueueEntry[];
    },
    enabled: !!salonId,
    refetchInterval: 15000,
  });

  const professionalsQuery = useQuery({
    queryKey: ["public_professionals_count", salonId],
    queryFn: async () => {
      if (!salonId) return 1;
      const { count } = await supabase
        .from("professionals")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId)
        .eq("is_active", true);
      return count || 1;
    },
    enabled: !!salonId,
    staleTime: 1000 * 60 * 30,
  });

  const servicesQuery = useQuery({
    queryKey: ["public_services", salonId],
    queryFn: async () => {
      if (!salonId) return [];
      const { data, error } = await supabase
        .from("services")
        .select("id, name, price, duration_minutes, is_active, queue_enabled")
        .eq("salon_id", salonId)
        .eq("is_active", true)
        .eq("queue_enabled", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!salonId,
  });

  const entries = queueQuery.data || [];
  const activeEntries = entries.filter((e) => ["waiting", "checked_in"].includes(e.status));
  const totalMinutes = activeEntries.reduce((sum, e) => sum + (e.service?.duration_minutes || 45), 0);
  const activeProfessionals = professionalsQuery.data || 1;
  const estimatedMinutes = Math.ceil(totalMinutes / activeProfessionals);

  const stats: QueueStats = {
    totalInQueue: activeEntries.length,
    inflatedCount: 0,
    estimatedMinutes,
    activeProfessionals,
  };

  const findOrCreateClient = async (name: string, phone: string, email?: string): Promise<string | null> => {
    if (!salonId) return null;

    // Clean phone: keep only digits
    const cleanPhone = phone.replace(/\D/g, "");

    // Try to find existing client by phone
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("salon_id", salonId)
      .or(`phone.eq.${cleanPhone},phone.eq.${phone}`)
      .limit(1)
      .maybeSingle();

    if (existing) return existing.id;

    // Create new client
    const { data: newClient } = await supabase
      .from("clients")
      .insert({
        salon_id: salonId,
        name,
        phone: cleanPhone,
        email: email || null,
      })
      .select("id")
      .single();

    return newClient?.id || null;
  };

  const addToQueue = async (input: {
    customer_name: string;
    customer_phone: string;
    customer_email?: string;
    service_id: string;
    notify_minutes_before?: number;
    payment_id?: string;
  }) => {
    if (!salonId) throw new Error("Salon not found");

    // Find or create client in CRM
    const customerId = await findOrCreateClient(
      input.customer_name,
      input.customer_phone,
      input.customer_email
    );

    // Get next position
    const { data: lastEntry } = await supabase
      .from("queue_entries")
      .select("position")
      .eq("salon_id", salonId)
      .in("status", ["waiting", "checked_in", "in_service"])
      .order("position", { ascending: false })
      .limit(1);

    const position = (lastEntry && lastEntry.length > 0) ? lastEntry[0].position + 1 : 1;

    const { data, error } = await supabase
      .from("queue_entries")
      .insert({
        salon_id: salonId,
        customer_id: customerId,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone,
        customer_email: input.customer_email || null,
        service_id: input.service_id,
        source: "online",
        position,
        notify_minutes_before: input.notify_minutes_before || 40,
        payment_id: input.payment_id || null,
        payment_status: "pending",
        status: "waiting",
      })
      .select(`*, service:services(id, name, price, duration_minutes)`)
      .single();

    if (error) throw error;
    return data as QueueEntry;
  };

  const addLead = async (input: { name: string; phone: string; max_queue_size: number }) => {
    if (!salonId) throw new Error("Salon not found");
    const { error } = await supabase
      .from("queue_leads")
      .insert({ salon_id: salonId, ...input });
    if (error) throw error;
  };

  return {
    salonId,
    settings: settingsQuery.data,
    entries,
    activeEntries,
    stats,
    services: servicesQuery.data || [],
    isLoading: salonQuery.isLoading || queueQuery.isLoading,
    addToQueue,
    addLead,
  };
}
