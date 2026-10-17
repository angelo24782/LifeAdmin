/**
 * Lettura dell'output di `supabase db query --local --agent no --output-format json` (CLI 2.120.0),
 * usata dall'helper SQL dei test d'integrazione. Funzione pura, senza effetti collaterali.
 *
 * Perché è rigorosa: la CLI cambia formato a seconda dell'ambiente (con un agente AI rilevato risponde con
 * un oggetto con `rows`; altrimenti, in formato di testo, con una tabella senza JSON). Un parser permissivo
 * trasformerebbe in "nessuna riga" ciò che è solo un formato imprevisto e i test fallirebbero, o peggio
 * passerebbero, per il motivo sbagliato. Qui ogni forma NON riconosciuta lancia un errore esplicito.
 */
export type Row = Record<string, unknown>

/** Quanti caratteri dell'output riportare in un errore (l'output potrebbe contenere dati del database). */
const EXCERPT_LENGTH = 60

/** Tag di comando senza righe: `DO`, `ALTER TABLE`, `DELETE 0`, `INSERT 0 1`, `CREATE FUNCTION`… */
const COMMAND_TAG = /^[A-Z][A-Z0-9 ]*$/

const excerpt = (output: string): string => {
  const flat = output.replace(/\s+/g, ' ')
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat
}

function parseJson(output: string, what: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(
      `Output di "supabase db query" non valido: JSON malformato (${what}): ${excerpt(output)}`,
    )
  }
}

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function toRows(value: unknown, what: string): Row[] {
  if (!Array.isArray(value) || !value.every(isRow)) {
    throw new Error(
      `Output di "supabase db query" inatteso: ${what} non contiene solo righe (oggetti)`,
    )
  }
  return value
}

/**
 * Restituisce le righe dell'output, o `[]` solo per un risultato davvero senza righe (`[]`, oggetto con
 * `rows` vuoto, tag di comando). Lancia per: output vuoto, JSON malformato, payload di errore della CLI,
 * forme JSON non riconosciute, tabella di testo e qualunque altro formato.
 */
export function parseDbQueryOutput(stdout: string): Row[] {
  const output = stdout.trim()
  if (output === '') {
    throw new Error('Output di "supabase db query" vuoto: atteso JSON o un tag di comando')
  }

  if (output.startsWith('[')) {
    return toRows(parseJson(output, 'array'), 'l’array')
  }

  if (output.startsWith('{')) {
    const parsed = parseJson(output, 'oggetto')
    if (!isRow(parsed)) {
      throw new Error('Output di "supabase db query" inatteso: l’oggetto JSON non è valido')
    }
    // Payload di errore della CLI (`{"_tag":"Error","error":{"message":…}}` o simili): mai un risultato valido.
    if (parsed['_tag'] === 'Error' || 'error' in parsed) {
      const error = parsed['error']
      const message =
        isRow(error) && typeof error['message'] === 'string'
          ? error['message']
          : 'errore senza messaggio'
      throw new Error(`"supabase db query" ha restituito un errore: ${message}`)
    }
    if (!('rows' in parsed)) {
      throw new Error(
        `Output di "supabase db query" inatteso: oggetto JSON senza "rows" né errore: ${excerpt(output)}`,
      )
    }
    return toRows(parsed['rows'], '"rows"')
  }

  if (COMMAND_TAG.test(output)) return []

  throw new Error(
    `Formato di output inatteso da "supabase db query" (atteso JSON o tag di comando; ` +
      `una tabella di testo indica che mancano --agent no e --output-format json): ${excerpt(output)}`,
  )
}
