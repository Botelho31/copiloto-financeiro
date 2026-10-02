# Copiloto Financeiro

🇺🇸 [Read in English](README.en.md)

Copiloto financeiro pessoal, self-hosted, feito para o Brasil. Puxa transações
bancárias via [Pluggy](https://docs.pluggy.ai/) (Open Finance Brasil) e acompanha
gastos, contas, dívidas, metas e projeção de fluxo de caixa da família — uma visão por
pessoa, mais uma combinada.

Bun workspace: `backend/` (API Elysia + sync com o Pluggy + servidor MCP), `frontend/`
(Vite + React), `shared/` (tipos compartilhados). Veja `ARCHITECTURE.md` (em inglês) /
`backend/API-ARCHITECTURE.md` pros detalhes internos, `CONTRIBUTING.md` antes de abrir
um PR.

## Filosofia

Construído com agente de IA em primeiro lugar: toda operação é uma ferramenta MCP
(`backend/src/mcp-server.ts`) antes de ser uma rota REST — o Claude opera direto hoje,
qualquer agente com MCP poderia. Vem só com o básico e é deliberadamente não opinativo
além disso; bifurque e mude o código se algo não bater com o seu dinheiro.

## Configuração

O jeito mais simples: mande o link deste repositório pro Claude Code e peça pra ele
configurar — ele cuida de tudo (`/get-started`).

Prefere fazer à mão?

1. `bun install`, depois copie `.env.example` pra `.env` (os padrões já servem).
2. `bun run dev`, acesse a URL impressa e defina uma senha. Isso criptografa o banco
   de dados — salve o código de recuperação que aparece, ele é o único jeito de entrar
   se você esquecer a senha e nunca é mostrado de novo.
3. Pra usar pelo Claude Code (MCP): em `/config` → "Chaves de API", gere uma chave e
   salve ela (só aparece uma vez) em `data/mcp-api-key` — só a chave, mais nada.
4. Adicione pessoas e suas conexões com o Pluggy (um Item ID via
   [meu-pluggy](https://github.com/pluggyai/meu-pluggy)) em `/config`.

Sem contas — só essa senha. O sync roda quando você desbloqueia, se já faz um tempo
(ou quando quiser, em "Sincronizar agora"). Bloquear o app corta o acesso do MCP
também. Feito pra ficar na sua máquina ou rede local, não na internet aberta (veja
"Deploy").

## Desenvolvimento

- `bun run dev` / `bun run dev:backend` / `bun run dev:frontend`
- `bun run build` / `bun run start` — build de produção + servir
- `bun run typecheck` / `bun run test` / `bun run lint`

## Deploy

```bash
docker compose up -d --build
```

Builda a imagem, roda as migrations ao iniciar, serve em `127.0.0.1:8080` e persiste
`./data` (o banco criptografado, o arquivo necessário pra desbloqueá-lo e a chave do
MCP — faça backup disso como uma unidade só). Ainda sem contas, então não exponha isso
na internet aberta — mantenha em localhost/rede local, ou acesse remotamente com algo
como Tailscale.
