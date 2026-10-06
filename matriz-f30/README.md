# Matriz de Polivalência F30 — Caldeiraria

Painel de competências da célula F30 (Komatsu Suzano). Página única, sem build.

## Como funciona
- `index.html` — o app inteiro (HTML, CSS e JS).
- `config.js` — URL e chave publicável do Supabase. A chave é publicável de propósito: a segurança está nas políticas RLS, não nela.
- `vercel.json` — proxy de `/supabase.js` e cabeçalhos de segurança.

## Banco (Supabase, projeto `matriz-f30`, região sa-east-1)
| tabela | o que guarda |
|---|---|
| `people` | colaboradores: chapa, nome, cargo, turno |
| `pieces` | peças: linha, nº de códigos, aplicações, meta, crítica, processo |
| `levels` | uma linha por pessoa × peça × processo — é aqui que TW e SAW ficam separados |
| `audit` | quem mudou o quê e quando; só insere, ninguém edita nem apaga |
| `config` | validade da avaliação em meses |

## Acesso
Nenhuma linha é pública. Sem login autenticado, o RLS não devolve nada —
nem nome, nem chapa, nem nível. Usuários são criados no painel do Supabase,
em Authentication → Users.

## Regras de cálculo
Nenhum indicador tem peso escondido. Nível → %: 1=0, 2=25, 3=50, 4=75, 5=100.
Domínio é média aritmética das peças que a pessoa solda no processo ativo.
TW e SAW nunca entram na mesma conta.
