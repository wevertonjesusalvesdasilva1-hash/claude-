# Leitor do Diário de Bordo

Lê a folha **"DIÁRIO DE BORDO – PRODUÇÃO E PARADAS"** digitalizada (PDF ou foto) e entrega as linhas
no formato da planilha *CONTROLE DE PARADA DE MÁQUINAS (RAW)*: abas **PRODUÇÃO** e **PARADAS**.

## Como usar

1. Crie uma chave gratuita em <https://aistudio.google.com/apikey> e cole no app (ela fica só no navegador).
2. Arraste o PDF (várias páginas) ou fotos das folhas.
3. Confira as células destacadas (amarelo = conferir, vermelho = valor impossível). Acima de cada linha
   aparece o recorte da folha original para comparar.
4. Use **Copiar PRODUÇÃO** / **Copiar PARADAS** (cole na primeira célula vazia da coluna **B** da base)
   ou **Baixar Excel**, que gera as duas abas no mesmo layout da planilha, com datas/horas reais e fórmulas.

Só folhas das máquinas RAW05–RAW12 entram na exportação por padrão.

## Desenvolvimento

```bash
npm install
npm run dev      # servidor local
npm test         # testes das regras de leitura e da exportação
npm run build    # gera dist/ (site estático; pode ir para a Vercel)
```

## Como funciona

- `src/core/layout.js` – endireita a página (gira 90°/180°/270° e corrige inclinação), acha a grade
  impressa do formulário e a bolinha da máquina marcada.
- `src/core/gemini.js` – envia a folha e as duas tabelas ampliadas ao Gemini e pede JSON estruturado,
  com a opção "não sei" para campos ilegíveis.
- `src/core/parse.js`, `src/core/rows.js` – validam horários, chapas, turnos, datas, peças, modelos e
  motivos contra os valores já usados na planilha (`src/data/vocab.js`). **Nunca trocam o que foi lido**:
  só marcam a célula e sugerem o valor parecido.
- `src/core/export.js` – texto para colar (TSV) e arquivo `.xlsx`.

## Por que não leitura 100% offline/grátis

Foram testados dois leitores gratuitos que rodam no navegador sobre recortes limpos de uma folha real
(38 campos de chapa, hora e turno): TrOCR (escrita à mão) acertou 15 (39%) e Tesseract 7 (18%).
Isso gera erros demais; por isso a leitura usa um modelo de visão (Gemini, com plano gratuito).
