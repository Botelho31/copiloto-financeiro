# Copiloto Financeiro

🇺🇸 [Read in English](README.md)

Copiloto financeiro pessoal, self-hosted, feito para o Brasil. Puxa o histórico de
transações bancárias diariamente via [Pluggy](https://docs.pluggy.ai/) (Open Finance
Brasil), guarda tudo em SQLite, e responde: quanto estou gastando, vou conseguir pagar
as próximas contas, e se não, o que preciso ajustar. Suporta uma família inteira — cada
pessoa mantém sua própria conexão bancária e seus próprios dados, e dívidas podem ser
explicitamente compartilhadas entre pessoas.

Um monorepo em Bun workspaces: `backend/` é o servidor Elysia (API + autenticação + sync
por cron + migrations), `frontend/` é uma SPA em Vite + React, e `shared/` guarda os
tipos TypeScript do formato de dados entre os dois. Veja `ARCHITECTURE.md` (em inglês)
para entender como tudo se encaixa, e `backend/API-ARCHITECTURE.md` para saber o que
pertence a cada rota do backend. Vai contribuir? Leia `CONTRIBUTING.md` primeiro.

## Filosofia

Construído pra uma pessoa específica: o desenvolvedor brasileiro que já usa agentes de
IA no dia a dia e queria controlar as próprias finanças (ou as da família) do mesmo
jeito — a planilha de Excel parou de escalar, e um app de orçamento SaaS que você não
consegue mudar pra caber em como seu dinheiro realmente funciona também não resolve.

**Construído com agente de IA em primeiro lugar, para brasileiros.** Toda operação de
domínio que este app tem — categorizar uma transação, reconciliar uma dívida, checar a
projeção do próximo mês, adicionar uma regra de categoria — existe como uma ferramenta
MCP (`backend/src/mcp-server.ts`) antes de existir como uma rota REST com um formulário
em cima. O Claude é o cliente principal contra o qual isso é construído e testado hoje,
mas as ferramentas falam MCP puro, então qualquer agente capaz de manter uma conexão MCP
consegue operar o app da mesma forma. A interface web não é cidadã de segunda classe —
são as mesmas operações, as mesmas funções do backend, só que acessadas clicando em vez
de perguntando. E é construído sobre o
[Open Finance Brasil](https://www.bcb.gov.br/estabilidadefinanceira/openfinance) via
Pluggy desde o dia um, não uma ferramenta genérica de orçamento com uma integração
bancária brasileira colada por cima — essa é a fundação inteira, não um recurso a mais.

Alguns princípios concretos que seguem disso:

- **Não gostou do que está mostrando? Altere.** Isso vem só com o básico de finanças
  pessoais — contas, categorias, contas a pagar, dívidas, uma projeção de fluxo de
  caixa — e deliberadamente não é opinativo além disso. Não é uma tentativa de antecipar
  o workflow de cada família com uma tela de configuração pra cada caso (veja as regras
  de notificação acima: variável de ambiente + uma função que você edita, não um
  construtor de regras na interface). Se alguma coisa não bate com como o seu dinheiro
  realmente funciona, a expectativa é você bifurcar e mudar o código, não abrir uma
  issue pedindo a feature e esperar.
- **O backend é a fonte da verdade para todo número.** Qualquer coisa que pareça um
  cálculo — data de quitação de uma dívida, um resumo por categoria, o patrimônio
  líquido — é computada uma vez, no servidor, e entregue tanto pro frontend quanto pra
  um agente (via MCP) já pronta. Nenhum dos dois recalcula por conta própria. Isso foi
  violado algumas vezes no início (veja o histórico de correções no
  `backend/API-ARCHITECTURE.md`) e toda vez isso fez a interface discordar de si mesma
  entre páginas — e é exatamente isso que garante que as ferramentas MCP e a API REST
  nunca discordem sobre o que um número significa, já que chamam exatamente as mesmas
  funções.
- **Dados reais em vez de fixtures, quando importa.** As peculiaridades de paginação e
  sinal de saldo do Pluggy só apareceram testando contra uma conexão bancária real — uma
  fixture inventada teria escondido o mesmo bug tranquilamente. Os testes automatizados
  ainda rodam contra um SQLite real (mesmo que descartável), não um ORM mockado, pelo
  mesmo motivo.
- **Aditivo em vez de reescrito.** Novos recursos (perfis de membros da família, dívidas
  compartilhadas, regras de notificação) foram construídos como extensões do modelo já
  existente, não como um redesenho — uma dívida compartilhada continua sendo uma única
  linha, agora com um ponteiro opcional pra quem ela é compartilhada, não um subsistema
  novo.
- **Nem uma camada a mais do que o problema pede.** O backend é routes + services, não
  routes + services + repositories — uma terceira camada foi considerada e descartada
  porque nada neste código precisava da indireção extra. Adicione estrutura quando
  duplicação ou um bug real exigir, não antecipando.
- **Do tamanho certo pra ser bifurcado, não só usado.** Sem feature flags, sem
  autenticação multi-tenant, sem abstração prematura para usuários hipotéticos futuros
  _deste_ deployment — mas a lógica de domínio fica atrás de fronteiras limpas de
  route/service justamente para que alguém rodando seu próprio fork consiga mudar regras
  de categorização, adicionar um recurso novo, plugar uma ferramenta MCP nova, ou
  adicionar um provedor de notificação novo sem brigar com a arquitetura pra fazer isso.

## Configuração

Este app só _lê_ do Pluggy — ele não cuida de conectar suas contas bancárias.
Use o [meu-pluggy](https://github.com/pluggyai/meu-pluggy) (o app de referência do
próprio Pluggy, construído sobre o widget Connect deles) pra conectar cada conta
bancária e pegar o(s) Item ID(s) que você depois cola aqui, por pessoa.

1. Copie `.env.example` para `.env`. O único valor que você realmente precisa definir é
   `SESSION_SECRET` (uma string aleatória longa, ex.: `openssl rand -hex 32`) — o resto
   é opcional:
   - `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` / `PLUGGY_ITEM_IDS` servem só como
     bootstrap único, pra herdar credenciais de antes dos perfis de membros da família
     existirem. As credenciais do Pluggy normalmente vivem no banco de dados agora,
     inseridas por pessoa em `/config` depois da configuração inicial — deixe em branco
     numa instalação nova.
   - `CRON_SCHEDULE` (padrão `0 6 * * *`) — quando a sincronização diária roda.
   - `MIN_BUFFER` (padrão `0`) — piso de saldo abaixo do qual um mês projetado é
     marcado como déficit.
   - `LARGE_TRANSACTION_THRESHOLD` (padrão `500`) — regra de notificação: avisa sobre
     qualquer transação recém-sincronizada igual ou acima desse valor (em reais).
   - `PUSHOVER_APP_TOKEN` / `SMTP_HOST` e afins — só necessários se você quiser
     notificações push; veja "Notificações" abaixo.
   - `PORT` (padrão `3000`) / `DB_PATH` (padrão `./data/budget.sqlite`).
2. Instale as dependências (lockfile único, os três workspaces): `bun install`
3. Rode os servidores de desenvolvimento: `bun run dev` roda backend + frontend juntos
   num terminal só (via `concurrently`). Pra rodar separadamente em dois terminais:
   - `bun run dev:backend` — backend na `:3000` com hot reload (também roda as
     migrations do banco ao iniciar)
   - `bun run dev:frontend` — servidor Vite, faz proxy de `/api` e `/public` pro backend
4. Acesse a URL do servidor Vite em `/setup` pra criar a conta de administrador. O login
   é single-admin (uma família, sem cadastro aberto). Depois de entrar, adicione cada
   membro da família em `/config` — nome, cor, e o Pluggy Client ID/Secret/Item IDs de
   cada um — e veja tudo somado na visão `/household`.

## Notificações

Depois de cada sincronização, um pequeno conjunto de regras
(`backend/src/services/notifications/rules.ts`) verifica o que mudou — uma transação
acima de `LARGE_TRANSACTION_THRESHOLD`, um déficit projetado pro próximo mês — e, na
primeira vez que cada uma dispara, cria uma notificação e entrega pelos canais que você
habilitou pra aquela pessoa em `/config`:

- **Pushover** — defina `PUSHOVER_APP_TOKEN` (um token único a nível de aplicação, pra
  todo o deployment, do [pushover.net](https://pushover.net)), e cada pessoa adiciona a
  própria chave de usuário do Pushover em `/config`.
- **Email** — defina `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (um
  relay único pra todo o deployment), e cada pessoa adiciona o próprio endereço de
  destino.

Os dois têm um botão de teste no mesmo painel de `/config` antes de você confiar neles.
Adicionar um provedor ou regra nova é uma mudança de código (veja os comentários em
`backend/src/services/notifications/`), não um sistema configurável pela interface —
isso é pra ser bifurcado e ajustado, não construído como um motor de regras genérico que
ninguém pediu ainda.

## Desenvolvimento

- `bun run dev` — os dois servidores de desenvolvimento juntos num terminal;
  `bun run dev:backend` / `bun run dev:frontend` — os mesmos dois, separados
- `bun run build` — builda o frontend (Vite → `frontend/dist`), servido pelo backend em
  produção
- `bun run start` — roda o backend a partir da raiz do repo, servindo o frontend já
  buildado
- `bun run typecheck` — checa os tipos de `backend/` e `frontend/`

A sincronização diária roda no `CRON_SCHEDULE` (padrão `0 6 * * *`) e também uma vez ao
iniciar se a última sincronização bem-sucedida tiver mais de 24h. Você também pode
disparar manualmente: `POST /api/sync/run` (exige uma sessão autenticada).

## Deploy com Docker Compose (CasaOS)

```bash
docker compose up -d --build
```

Isso builda a imagem, roda as migrations automaticamente ao iniciar, e persiste o banco
SQLite em `./data/budget.sqlite` via um volume bind-mounted. No CasaOS, aponte o
recurso de compose app / instalação customizada pra este `docker-compose.yml`, e monte
o volume em `/DATA/AppData/copiloto-financeiro` seguindo a convenção do CasaOS (ajuste o
caminho em `volumes:` no `docker-compose.yml` conforme necessário).

O container expõe a porta `3000` internamente, mapeada pra `8080` no host por padrão —
ajuste no `docker-compose.yml` se isso conflitar com algo na sua caixa CasaOS.

### Expondo pra internet (Caddy + WireGuard + Oracle Cloud)

Este app não precisa do próprio hardening contra DDoS/exposição — ele é pensado pra
ficar atrás de um reverse proxy que você já roda em outro lugar (ex.: uma caixa na
Oracle Cloud rodando Caddy, alcançada a partir do seu servidor doméstico via
WireGuard). Ele só precisa de um login (já embutido) e de responder numa porta que o
Caddy consiga alcançar. Exemplo de trecho pro seu Caddyfile já existente:

```
copiloto.example.com {
    reverse_proxy <ip-wireguard-desta-caixa>:8080
}
```

O Caddy cuida da terminação TLS e fica na frente do app; a caixa doméstica nunca fica
diretamente acessível pela internet. O app em si limita a taxa de requisições no
endpoint de login como uma camada extra de defesa em cima disso.
