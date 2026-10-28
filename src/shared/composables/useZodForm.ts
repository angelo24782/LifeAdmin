import { computed, nextTick, readonly, ref, shallowReactive, shallowReadonly, useId } from 'vue'
import type { z } from 'zod'

/**
 * Composable di form su zod 4 (SPECIFICA §23.12 B), al posto di `@tanstack/vue-form`.
 *
 * I valori del form sono separati dall'output dello schema: un campo testuale è sempre una stringa
 * e una checkbox sempre un booleano (il consenso parte da `false` anche se lo schema accetta solo
 * `true`). Lo schema valida e normalizza (trim, minuscole, stringa vuota → `undefined`) solo al
 * momento dell'invio: `onSubmit` riceve `z.output` dello schema, mai i valori grezzi.
 *
 * Validazione al blur e all'invio (SPECIFICA §6 "Form"); durante la digitazione solo per i campi
 * già toccati o che mostrano già un errore (anche del server). Un errore del server
 * (`setFieldError`) resta finché il campo non viene modificato.
 */
export interface UseZodFormOptions<
  TSchema extends z.ZodType,
  TTextKey extends string,
  TCheckboxKey extends string,
> {
  readonly schema: TSchema
  /** Valori iniziali dei campi testuali (`<input>`, `<textarea>`). */
  readonly text: Readonly<Record<TTextKey, string>>
  /** Valori iniziali delle checkbox. */
  readonly checkbox: Readonly<Record<TCheckboxKey, boolean>>
}

interface FieldBindingBase {
  readonly id: string
  readonly name: string
  readonly 'aria-invalid': boolean
  /** Id dell'elemento `role="alert"` con l'errore, presente solo quando l'errore c'è. */
  readonly 'aria-describedby': string | undefined
  readonly onInput: (event: Event) => void
  readonly onBlur: () => void
}

export interface TextFieldBinding extends FieldBindingBase {
  readonly value: string
}

export interface CheckboxFieldBinding extends FieldBindingBase {
  readonly checked: boolean
}

export function useZodForm<
  TSchema extends z.ZodType,
  TTextKey extends string = never,
  TCheckboxKey extends string = never,
>(options: UseZodFormOptions<TSchema, TTextKey, TCheckboxKey>) {
  type FieldName = TTextKey | TCheckboxKey

  const { schema } = options
  const textValues: Record<TTextKey, string> = shallowReactive({ ...options.text })
  const checkboxValues: Record<TCheckboxKey, boolean> = shallowReactive({ ...options.checkbox })
  const fieldNames: readonly FieldName[] = [
    ...Object.keys(options.text).filter(isTextKey),
    ...Object.keys(options.checkbox).filter(isCheckboxKey),
  ]
  const duplicate = Object.keys(options.text).find(isCheckboxKey)
  if (duplicate !== undefined) {
    throw new Error(`useZodForm: il campo "${duplicate}" è sia testuale sia checkbox.`)
  }

  const baseId = useId()
  if (!baseId) {
    throw new Error('useZodForm va chiamato dentro setup() di un componente.')
  }

  const errors: Partial<Record<FieldName, string>> = shallowReactive<
    Partial<Record<FieldName, string>>
  >({})
  const touched: Partial<Record<FieldName, boolean>> = shallowReactive<
    Partial<Record<FieldName, boolean>>
  >({})
  /** Campi il cui errore viene dal server: la validazione locale non lo sovrascrive. */
  const serverErrorFields = new Set<FieldName>()
  const formError = ref<string | undefined>()
  const submitting = ref(false)

  const values = computed(() => ({ ...textValues, ...checkboxValues }))
  const formAttrs = computed(() => ({ 'aria-busy': submitting.value }))

  function isTextKey(key: PropertyKey): key is TTextKey {
    return typeof key === 'string' && Object.hasOwn(options.text, key)
  }

  function isCheckboxKey(key: PropertyKey): key is TCheckboxKey {
    return typeof key === 'string' && Object.hasOwn(options.checkbox, key)
  }

  function isFieldName(key: PropertyKey): key is FieldName {
    return isTextKey(key) || isCheckboxKey(key)
  }

  function fieldId(name: FieldName): string {
    return `${baseId}-${name}`
  }

  function errorId(name: FieldName): string {
    return `${fieldId(name)}-error`
  }

  /** Primo messaggio di errore per ogni campo; quelli senza campo (refine sull'oggetto) a parte. */
  function collectIssues(issues: readonly z.core.$ZodIssue[]) {
    const byField = new Map<FieldName, string>()
    const unassigned: string[] = []
    for (const issue of issues) {
      const key = issue.path[0]
      if (key !== undefined && isFieldName(key)) {
        if (!byField.has(key)) byField.set(key, issue.message)
      } else {
        unassigned.push(issue.message)
      }
    }
    return { byField, unassigned }
  }

  function setLocalError(name: FieldName, message: string | undefined): void {
    if (message === undefined) delete errors[name]
    else errors[name] = message
  }

  function validateField(name: FieldName): void {
    if (serverErrorFields.has(name)) return
    const result = schema.safeParse(values.value)
    setLocalError(
      name,
      result.success ? undefined : collectIssues(result.error.issues).byField.get(name),
    )
  }

  function handleInput(name: FieldName, event: Event): void {
    const target = event.target
    if (isTextKey(name)) {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
      textValues[name] = target.value
    } else {
      if (!(target instanceof HTMLInputElement)) return
      checkboxValues[name] = target.checked
    }
    const errorShown = errors[name] !== undefined
    if (serverErrorFields.delete(name)) delete errors[name]
    if (touched[name] === true || errorShown) validateField(name)
  }

  function handleBlur(name: FieldName): void {
    touched[name] = true
    validateField(name)
  }

  function bindingBase(name: FieldName): FieldBindingBase {
    const hasError = errors[name] !== undefined
    return {
      id: fieldId(name),
      name,
      'aria-invalid': hasError,
      'aria-describedby': hasError ? errorId(name) : undefined,
      onInput: (event: Event) => handleInput(name, event),
      onBlur: () => handleBlur(name),
    }
  }

  function field(name: TTextKey): TextFieldBinding
  function field(name: TCheckboxKey): CheckboxFieldBinding
  function field(name: FieldName): TextFieldBinding | CheckboxFieldBinding {
    if (isTextKey(name)) return { ...bindingBase(name), value: textValues[name] }
    return { ...bindingBase(name), checked: checkboxValues[name] }
  }

  /** Mette il focus sul primo campo non valido nell'ordine reale del DOM, non dello schema. */
  async function focusFirstInvalid(): Promise<void> {
    await nextTick()
    const invalid = fieldNames
      .filter((name) => errors[name] !== undefined)
      .map((name) => document.getElementById(fieldId(name)))
      .filter((element) => element !== null)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    invalid[0]?.focus()
  }

  /**
   * Gestore di `submit`: valida tutto, mette il focus sul primo campo non valido oppure passa a
   * `onSubmit` i dati normalizzati. Ignora un secondo invio mentre il primo è in corso. Gli errori
   * lanciati da `onSubmit` si propagano al chiamante (che li converte in `AppError`).
   */
  function handleSubmit(onSubmit: (data: z.output<TSchema>) => void | Promise<void>) {
    return async (event?: Event): Promise<void> => {
      event?.preventDefault()
      if (submitting.value) return

      formError.value = undefined
      serverErrorFields.clear()
      for (const name of fieldNames) touched[name] = true

      const result = schema.safeParse(values.value)
      if (!result.success) {
        const { byField, unassigned } = collectIssues(result.error.issues)
        for (const name of fieldNames) setLocalError(name, byField.get(name))
        formError.value = unassigned[0]
        await focusFirstInvalid()
        return
      }

      for (const name of fieldNames) delete errors[name]
      submitting.value = true
      try {
        await onSubmit(result.data)
      } finally {
        submitting.value = false
      }
    }
  }

  /** Errore restituito dal server per un campo; resta finché l'utente non modifica il campo. */
  function setFieldError(name: FieldName, message: string): void {
    serverErrorFields.add(name)
    errors[name] = message
  }

  /** Errore generale del form (es. credenziali errate), da mostrare in un `role="alert"`. */
  function setFormError(message: string | undefined): void {
    formError.value = message
  }

  return {
    values,
    errors: shallowReadonly(errors),
    touched: shallowReadonly(touched),
    formError: readonly(formError),
    submitting: readonly(submitting),
    formAttrs,
    field,
    errorId,
    handleSubmit,
    setFieldError,
    setFormError,
  }
}
