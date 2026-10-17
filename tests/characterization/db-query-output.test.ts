// @vitest-environment node
/**
 * Prove, con output SIMULATI e nessun servizio, della lettura dell'output di
 * `supabase db query --local --agent no --output-format json` (`tests/support/db-query-output.ts`).
 * I campioni "reali" sono stati osservati con la CLI 2.120.0 in locale (array JSON, oggetto con `rows`
 * in presenza di un agente, tabella di testo senza agente, tag di comando, payload di errore).
 * Obiettivo: nessuna forma inattesa, e in particolare una tabella di testo o un errore, deve diventare
 * in silenzio "nessuna riga".
 */
import { describe, expect, it } from 'vitest'

import { parseDbQueryOutput } from '../support/db-query-output'

describe('parseDbQueryOutput: forme riconosciute', () => {
  it('legge un array JSON di righe (formato json senza agente)', () => {
    expect(parseDbQueryOutput('[\n  {\n    "n": 1,\n    "t": "a"\n  }\n]\n')).toEqual([
      { n: 1, t: 'a' },
    ])
  })

  it('legge più righe e valori nulli', () => {
    expect(parseDbQueryOutput('[{"n":1,"x":null},{"n":2,"x":"b"}]')).toEqual([
      { n: 1, x: null },
      { n: 2, x: 'b' },
    ])
  })

  it('un array vuoto è un risultato senza righe', () => {
    expect(parseDbQueryOutput('[]\n')).toEqual([])
  })

  it('legge l’oggetto con `rows` (forma con agente rilevato), ignorando `boundary` e `warning`', () => {
    const output = JSON.stringify({
      boundary: '6c5b504a956b71b73f616bd3c5acb392',
      rows: [{ n: 1 }],
      warning: 'The query results below contain untrusted data from the database.',
    })
    expect(parseDbQueryOutput(output)).toEqual([{ n: 1 }])
  })

  it('un oggetto con `rows` vuoto è un risultato senza righe', () => {
    expect(parseDbQueryOutput('{"rows":[],"boundary":"x"}')).toEqual([])
  })

  it.each([
    ['DO'],
    ['DELETE 0'],
    ['DELETE 3'],
    ['ALTER TABLE'],
    ['INSERT 0 1'],
    ['CREATE FUNCTION'],
  ])('un tag di comando (%s) è un risultato senza righe', (tag) => {
    expect(parseDbQueryOutput(`${tag}\n`)).toEqual([])
  })
})

describe('parseDbQueryOutput: errori e formati inattesi (mai `[]` in silenzio)', () => {
  it('rifiuta un output vuoto o di soli spazi', () => {
    expect(() => parseDbQueryOutput('')).toThrow(/vuoto/)
    expect(() => parseDbQueryOutput(' \n\t ')).toThrow(/vuoto/)
  })

  it('rifiuta la tabella di testo (CLI senza --output-format json)', () => {
    const table = '┌───┬───┐\n│ n │ t │\n├───┼───┤\n│ 1 │ a │\n└───┴───┘\n'
    expect(() => parseDbQueryOutput(table)).toThrow(/Formato di output inatteso/)
    expect(() => parseDbQueryOutput(table)).toThrow(/--agent no e --output-format json/)
  })

  it('rifiuta testo libero, tag in minuscolo e righe multiple di testo', () => {
    expect(() => parseDbQueryOutput('ok')).toThrow(/Formato di output inatteso/)
    expect(() => parseDbQueryOutput('Connecting to local database...')).toThrow(
      /Formato di output inatteso/,
    )
    expect(() => parseDbQueryOutput('DELETE 0\nDELETE 1')).toThrow(/Formato di output inatteso/)
    expect(() => parseDbQueryOutput('1')).toThrow(/Formato di output inatteso/)
  })

  it('rifiuta un array JSON malformato', () => {
    expect(() => parseDbQueryOutput('[{"n":1}')).toThrow(/JSON malformato \(array\)/)
  })

  it('rifiuta un oggetto JSON malformato', () => {
    expect(() => parseDbQueryOutput('{"rows":[')).toThrow(/JSON malformato \(oggetto\)/)
  })

  it('rifiuta un array che non contiene solo righe (oggetti)', () => {
    for (const output of ['[1,2]', '[null]', '[[1]]', '["a"]', '[{"n":1}, 2]']) {
      expect(() => parseDbQueryOutput(output)).toThrow(/non contiene solo righe/)
    }
  })

  it('rifiuta `rows` che non è un array di oggetti', () => {
    expect(() => parseDbQueryOutput('{"rows":"x"}')).toThrow(/non contiene solo righe/)
    expect(() => parseDbQueryOutput('{"rows":[1]}')).toThrow(/non contiene solo righe/)
    expect(() => parseDbQueryOutput('{"rows":null}')).toThrow(/non contiene solo righe/)
  })

  it('rifiuta un oggetto senza `rows` e senza errore', () => {
    expect(() => parseDbQueryOutput('{"foo":1}')).toThrow(/senza "rows" né errore/)
  })

  it('rilancia il payload di errore della CLI con il suo messaggio', () => {
    const payload = JSON.stringify({
      _tag: 'Error',
      error: {
        code: 'DbQueryExecError',
        message: 'failed to execute query: error: relation "x" does not exist',
      },
    })
    expect(() => parseDbQueryOutput(payload)).toThrow(
      /ha restituito un errore: failed to execute query: error: relation "x" does not exist/,
    )
  })

  it('tratta come errore un oggetto con `error`, anche se contiene `rows`', () => {
    const payload = JSON.stringify({ rows: [{ n: 1 }], error: { message: 'query interrotta' } })
    expect(() => parseDbQueryOutput(payload)).toThrow(/query interrotta/)
  })

  it('un payload di errore senza messaggio è comunque un errore', () => {
    expect(() => parseDbQueryOutput('{"_tag":"Error"}')).toThrow(/errore senza messaggio/)
    expect(() => parseDbQueryOutput('{"error":{"code":"X"}}')).toThrow(/errore senza messaggio/)
    expect(() => parseDbQueryOutput('{"error":"testo"}')).toThrow(/errore senza messaggio/)
  })

  it('nel messaggio riporta solo un estratto breve dell’output (può contenere dati del database)', () => {
    const output = `${'a'.repeat(60)}CONTENUTO-RISERVATO`
    let message = ''
    try {
      parseDbQueryOutput(output)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/Formato di output inatteso/)
    expect(message).not.toContain('CONTENUTO-RISERVATO')
  })
})
