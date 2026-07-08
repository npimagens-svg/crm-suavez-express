-- Fila multi-serviço: cliente pode escolher mais de um serviço na compra.
-- service_ids guarda todos os serviços selecionados (array de uuid em jsonb);
-- service_id continua com o primeiro (compatibilidade com o fluxo existente).
alter table queue_entries add column if not exists service_ids jsonb default null;
