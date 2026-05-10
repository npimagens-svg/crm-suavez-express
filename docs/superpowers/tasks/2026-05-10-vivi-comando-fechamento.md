# TODO — Comando `#fechamento DD/MM` na Vivi

**Status:** BLOQUEADO (VPS Hostinger 72.60.6.168 fora do ar em 10/05 18:54).

**Quando VPS voltar**, executar:

## 1. Login N8N agentes
```bash
curl -i -X POST 'http://72.60.6.168:5679/rest/login' \
  -H 'Content-Type: application/json' \
  -d '{"emailOrLdapLoginId":"npimagens@gmail.com","password":"XFlow2026Agentes!"}'
# Capturar header Set-Cookie
```

## 2. Backup workflow Vivi
```bash
COOKIE='n8n-auth=...'
curl -H "Cookie: $COOKIE" 'http://72.60.6.168:5679/rest/workflows/Jnqt15rnIduC4Z4i' > /tmp/vivi_backup.json
```

## 3. Editar Code node "Processa Comando" (ou similar)

Adicionar no início da lógica de comandos:

```javascript
// Comando #fechamento DD/MM ou #fechamento DD/MM/YYYY
const fechMatch = text.match(/^#fechamento (\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
if (fechMatch) {
  const [, dd, mm, yyyy] = fechMatch;
  const year = yyyy || new Date().getFullYear();
  const isoDate = `${year}-${mm}-${dd}`;
  return [{
    json: {
      command: "fechamento",
      date: isoDate,
      should_dispatch: true,
      message: `🔄 Reprocessando fechamento de ${dd}/${mm}/${year}...`
    }
  }];
}
```

## 4. Adicionar branch dispatcher

Após "Processa Comando", IF node:
- Condition: `{{ $json.command === "fechamento" }}`
- True branch:
  - HTTP Request POST `http://localhost:5679/webhook/fechamento` com body `{ "date": "{{ $json.date }}" }`
  - HTTP Z-API enviar `$json.message` pro número admin

## 5. Validar

Cleiton manda `#fechamento 12/05` no WhatsApp da Vivi → recebe resposta `🔄 Reprocessando fechamento de 12/05/...` → relatório completo chega em ~5-10s.

## Refs
- Workflow Vivi: `Jnqt15rnIduC4Z4i`
- Workflow Fechamento Diário: `I4T0KZiPY7y9s61w`
- Webhook fechamento ativo: `http://72.60.6.168:5679/webhook/fechamento`
