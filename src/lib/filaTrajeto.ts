// Tempo de carro da cliente até o NP Hair Express (R. Sete de Setembro, 374 — Centro, Salto/SP).
// Rota pelo OSRM público; se falhar, estimativa pela distância em linha reta.

export const SALAO = { lat: -23.2003703, lng: -47.2934739 };

export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Linha reta × 1,4 (ruas) a 30 km/h na cidade, mínimo 2 min. */
export function estimativaLinhaRetaMin(km: number): number {
  return Math.max(2, Math.ceil(((km * 1.4) / 30) * 60));
}

export async function tempoAteSalaoMin(origem: { lat: number; lng: number }): Promise<number> {
  try {
    // Coordenada arredondada (~1 km): o serviço de rotas não recebe a posição exata da cliente.
    const lat = origem.lat.toFixed(2);
    const lng = origem.lng.toFixed(2);
    const url = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${SALAO.lng},${SALAO.lat}?overview=false`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await resp.json();
    const seg = json?.routes?.[0]?.duration;
    if (typeof seg === "number") return Math.max(2, Math.ceil(seg / 60));
  } catch {
    // cai na estimativa abaixo
  }
  return estimativaLinhaRetaMin(distanciaKm(origem, SALAO));
}

export function pedirLocalizacao(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("sem_suporte"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  });
}
