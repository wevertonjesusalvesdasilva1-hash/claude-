# Diário de Bordo · Leitura RAW

Lê a folha **"DIÁRIO DE BORDO – PRODUÇÃO E PARADAS"** digitalizada (PDF ou foto) e entrega as linhas no
formato da planilha *CONTROLE DE PARADA DE MÁQUINAS (RAW)*: abas **PRODUÇÃO** e **PARADAS**.

## Como usar

1. Arraste o PDF (várias páginas) ou fotos das folhas.
2. Cada folha é lida **duas vezes**, de forma independente, e o app compara. Células amarelas/vermelhas
   são as que merecem conferência; acima de cada linha aparece o recorte da folha original (clique para ampliar).
3. Corrigiu algo? O app **aprende** ("PC210MO" → "PC210F-10M0") e passa a corrigir sozinho.
4. **Copiar PRODUÇÃO / PARADAS** (cole na primeira célula vazia da coluna **B** da base) ou **Baixar Excel**
   (abas no layout da planilha, datas/horas reais, fórmulas de tempo).

Só folhas das máquinas RAW05–RAW12 entram na exportação por padrão.

## O que o app confere

- Chapa fora da lista: corrige só se UMA chapa da lista está a 1 dígito (7710 → 7910) e avisa; senão mantém e sugere.
- Duas leituras diferentes: a chapa da lista vence; nos demais campos fica a primeira e a outra aparece no aviso.
- Horário inválido, início = fim, duração absurda (produção > 12 h, parada > 8 h), data fora da folha.
- Folha repetida, linha vista por só uma leitura, parada sem motivo marcado.
- Listas (chapas, peças, modelos) editáveis na própria tela.

## Instalação (Vercel)

Projeto Vite + função serverless `api/extract.js`. Variáveis de ambiente:

| Variável | Para quê |
|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio (fica só no servidor) |
| `GEMINI_MODEL` | opcional, padrão `gemini-flash-latest` |

## Desenvolvimento

```bash
npm install
npm test         # regras de leitura, exportação e função serverless
npm run build    # gera dist/
```

## Estrutura

- `src/core/layout.js`, `image.js` – endireita a página, acha a grade e a máquina marcada.
- `src/core/rows.js`, `parse.js`, `lists.js` – junta as duas leituras, valida e aprende correções.
- `src/core/export.js` – texto para colar e `.xlsx`.
- `api/extract.js` – chama o Gemini com a chave do servidor.

Leitores gratuitos offline foram testados sobre recortes de uma folha real (TrOCR 39%, Tesseract 18% de acerto em
chapa/hora/turno) e descartados.
