// Prompt and response schema shared by both reading passes (server side only).
import { CHAPAS, PECAS, MODELOS, MOTIVOS } from '../src/data/vocab.js';

const timeField = { type: 'STRING', nullable: true, description: 'HH:MM em 24h, ex: 07:54' };
const chapaField = { type: 'STRING', nullable: true, description: 'número da chapa (crachá), só dígitos' };
const textField = { type: 'STRING', nullable: true };

export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    maquina: { type: 'STRING', nullable: true, description: 'RAW05, RAW06, RAW09, RAW10, RAW11 ou RAW12 (bolinha preenchida); texto escrito se for outra máquina' },
    data: { type: 'STRING', nullable: true, description: 'data do cabeçalho, dd/mm' },
    producao: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          linha: { type: 'INTEGER', description: 'número da linha (1 a 10) na tabela impressa, contando de cima' },
          data: textField, peca: textField, modelo: textField,
          chapa1: chapaField, ini1: timeField, fim1: timeField,
          chapa2: chapaField, ini2: timeField, fim2: timeField,
          chapa3: chapaField, ini3: timeField, fim3: timeField,
          turno_finalizou: { type: 'STRING', nullable: true, description: '1, 2 ou 3' },
          obs: textField,
          duvidas: { type: 'ARRAY', items: { type: 'STRING' }, description: 'nomes dos campos que você não conseguiu ler com segurança' },
        },
        required: ['linha'],
      },
    },
    paradas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          linha: { type: 'INTEGER', description: 'posição da linha (1 a 10) na tabela impressa, contando de cima' },
          data: textField, chapa: chapaField, ini: timeField, fim: timeField,
          turno: { type: 'STRING', nullable: true, description: '1, 2 ou 3' },
          motivo: { type: 'STRING', nullable: true, description: `coluna marcada com X: ${MOTIVOS.join(' | ')}` },
          descricao: textField,
          duvidas: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['linha'],
      },
    },
  },
  required: ['producao', 'paradas'],
};

const list = (v, fallback) => (Array.isArray(v) && v.length ? v.slice(0, 80).map((x) => String(x).slice(0, 40)) : fallback);

export function buildPrompt(pass, hints = {}) {
  const chapas = list(hints.chapas, CHAPAS), pecas = list(hints.pecas, PECAS), modelos = list(hints.modelos, MODELOS);
  const how = pass === 'B'
    ? 'Você recebe somente as ampliações das duas tabelas. Leia cada linha de forma independente: primeiro a coluna CHAPA inteira, dígito por dígito, depois os horários.'
    : 'A primeira imagem é a folha inteira, já na posição correta; as seguintes são ampliações da tabela 1 e da tabela 2.';
  return `Você transcreve folhas manuscritas "DIÁRIO DE BORDO – PRODUÇÃO E PARADAS" (Komatsu, robôs de solda RAW). ${how}

CABEÇALHO: MÁQUINA (bolinha preenchida entre 05, 06, 09, 10, 11, 12 → RAW05…RAW12) e DATA (dd/mm).

TABELA 1 – REGISTRO DE PRODUÇÃO (até 10 linhas): N°, DATA, PEÇA, MODELO e, para cada turno (1º, 2º, 3º), CHAPA, INÍCIO e FIM; depois TURNO QUE FINALIZOU (1, 2 ou 3) e OBSERVAÇÕES. Transcreva só as linhas que têm escrita.

TABELA 2 – CONTROLE DE PARADAS (até 10 linhas): N°, DATA, CHAPA, INÍCIO, FIM, TURNO (1, 2 ou 3), o MOTIVO (um X numa destas colunas: ${MOTIVOS.join(', ')}) e DESCRIÇÃO DA PARADA. "TROCA DE CONSUMÍVEIS" corresponde a CONSUMIVEIS.

REGRAS
- Aspas de repetição: um sinal pequeno (", u, ч, -, ~) no lugar do valor significa "igual à linha de cima". Escreva o valor repetido por extenso (DATA, PEÇA, MODELO, CHAPA).
- Horários em 24h no formato HH:MM ("5:30" → "05:30"). Cruzar a meia-noite é normal.
- CHAPA é o número do crachá do operador, 4 ou 5 dígitos. Chapas conhecidas: ${chapas.join(', ')}. Leia dígito por dígito; 1 e 7, 4 e 9, 6 e 0 se parecem na letra deste pessoal, então compare com a lista, mas copie o que está escrito se for claramente outro número.
- PEÇA costuma ser: ${pecas.join(', ')}. MODELO costuma ser: ${modelos.join(', ')}. Se estiver escrito diferente, copie como está.
- Na DESCRIÇÃO DA PARADA aparecem com frequência as palavras Tyorei (reunião; também escrita Tiorei, Fiorei, Forey, Chorei), Almoço, Janta, Arame, Setup, "Aguardando ponte". Se a palavra for parecida, escreva a forma correta.
- O X do MOTIVO fica dentro de UMA coluna do cabeçalho; confira com cuidado de qual coluna é, olhando o cabeçalho diretamente acima dela (SET-UP e TROCA DE PEÇA são vizinhas, assim como TROCA DE CONSUMÍVEIS).
- Use em "linha" o número da linha na tabela impressa, contando de cima.
- NÃO invente. Se não conseguir ler um campo, devolva null e coloque o nome do campo em "duvidas". Prefira admitir dúvida a chutar.
- Responda somente com o JSON do esquema.`;
}
