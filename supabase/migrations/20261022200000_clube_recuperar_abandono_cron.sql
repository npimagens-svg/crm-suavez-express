-- Liga a mensagem de carrinho abandonado do Clube (ok do Cleiton 22/10/2026, sem envio retroativo).
-- Aplicado direto no banco às 23h46 de 22/10 (jobid 7). Desligar: select cron.unschedule('clube-recuperar-abandono');
SELECT cron.schedule('clube-recuperar-abandono', '*/2 * * * *', 'select clube_recuperar_abandono()');
