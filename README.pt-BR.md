# Copiloto Financeiro

🇺🇸 [Read in English](README.md)

Copiloto financeiro pessoal, self-hosted, feito para o Brasil. Puxa transações
bancárias diariamente via [Pluggy](https://docs.pluggy.ai/) (Open Finance Brasil), e
acompanha gastos, contas a pagar, dívidas e projeção de fluxo de caixa de toda a
família.

Um monorepo em Bun workspaces: `backend/` (API Elysia + sync por cron), `frontend/`
(Vite + React), `shared/` (tipos compartilhados). Veja `ARCHITECTURE.md` (em inglês) e
`backend/API-ARCHITECTURE.md` para entender como é construído, `CONTRIBUTING.md` antes
de abrir um PR.

## Filosofia

Construído com agente de IA em primeiro lugar, pro desenvolvedor brasileiro que já usa
agentes no dia a dia: toda operação existe como uma ferramenta MCP
(`backend/src/mcp-server.ts`) antes de existir como uma rota REST com um formulário em
cima — o Claude é o cliente principal hoje, mas qualquer agente com MCP opera do mesmo
jeito. Vem só com o básico de finanças pessoais e é deliberadamente não opinativo além
disso — se algo não bate com como o seu dinheiro funciona, bifurque e mude o código em
vez de esperar por uma configuração.

## Configuração

Este app só _lê_ do Pluggy — use o [meu-pluggy](https://github.com/pluggyai/meu-pluggy)
pra de fato conectar uma conta bancária e pegar um Item ID.

1. Copie `.env.example` para `.env` e defina `SESSION_SECRET` (veja como no próprio
   arquivo).
2. `bun install`
3. `bun run dev` (backend + frontend juntos) — acesse `/setup` na URL impressa pra
   criar a conta de administrador, depois adicione a família e configure o resto
   (credenciais do Pluggy, horário do cron, provedores de notificação) em `/config`.

## Desenvolvimento

- `bun run dev` / `bun run dev:backend` / `bun run dev:frontend`
- `bun run build` / `bun run start` — build de produção + servir
- `bun run typecheck` / `bun run test` / `bun run lint`

## Notificações

Depois de cada sincronização, regras em `backend/src/services/notifications/rules.ts`
(transação grande, déficit projetado) podem notificar uma pessoa via Pushover e/ou
email — configure o token do Pushover / relay SMTP da instância e o destino de cada
pessoa em `/config`.

## Deploy

```bash
docker compose up -d --build
```

Builda a imagem, roda as migrations ao iniciar, e persiste o SQLite em `./data` via um
volume bind-mounted. Coloque atrás de qualquer reverse proxy que você já use — o app em
si só precisa de uma porta, e cuida do próprio login e limite de requisições.
