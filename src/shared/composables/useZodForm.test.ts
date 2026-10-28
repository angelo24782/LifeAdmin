import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, type VNode } from 'vue'
import { z } from 'zod'

import { registerSchema, type RegisterInput } from '@/features/auth/schemas'

import { useZodForm } from './useZodForm'

/**
 * I test montano un form vero (attaccato a `document.body`) perché focus, ordine del DOM e
 * attributi ARIA si verificano solo sugli elementi renderizzati. Lo schema è quello reale di
 * registrazione: la normalizzazione attesa è quella di `registerSchema`, non una copia.
 * I campi testuali sono `type="text"`: con `type="email"` il browser (e jsdom) toglie già gli spazi
 * esterni, e il test non dimostrerebbe più il trim dello schema.
 */
function useRegisterForm() {
  return useZodForm({
    schema: registerSchema,
    text: { email: '', displayName: '' },
    checkbox: { acceptedPrivacy: false },
  })
}

type RegisterForm = ReturnType<typeof useRegisterForm>
type RegisterField = 'email' | 'displayName' | 'acceptedPrivacy'
type SubmitHandler = (data: RegisterInput) => void | Promise<void>

interface Mounted {
  readonly wrapper: VueWrapper
  readonly form: RegisterForm
  readonly submit: (event?: Event) => Promise<void>
}

const wrappers: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

function mountRegisterForm(
  onSubmit: SubmitHandler = () => undefined,
  order: readonly RegisterField[] = ['email', 'displayName', 'acceptedPrivacy'],
): Mounted {
  let form: RegisterForm | undefined
  let submit: ((event?: Event) => Promise<void>) | undefined

  // Componenti come oggetti semplici passati a `mount`: un componente di prova per test.
  const RegisterFormTest = {
    setup() {
      const current = useRegisterForm()
      const handler = current.handleSubmit(onSubmit)
      form = current
      submit = handler

      function errorMessage(name: RegisterField): VNode | null {
        const message = current.errors[name]
        return message === undefined
          ? null
          : h('p', { id: current.errorId(name), role: 'alert' }, message)
      }

      function renderField(name: RegisterField): VNode[] {
        const input =
          name === 'acceptedPrivacy'
            ? h('input', { type: 'checkbox', ...current.field(name) })
            : h('input', { type: 'text', ...current.field(name) })
        return [input, errorMessage(name)].filter((node) => node !== null)
      }

      return () =>
        h('form', { ...current.formAttrs.value, novalidate: true, onSubmit: handler }, [
          ...order.flatMap(renderField),
          current.formError.value === undefined
            ? null
            : h('p', { 'data-testid': 'form-error', role: 'alert' }, current.formError.value),
          h('button', { type: 'submit' }, 'Registrati'),
        ])
    },
  }

  const wrapper = mount(RegisterFormTest, { attachTo: document.body })
  wrappers.push(wrapper)
  if (form === undefined || submit === undefined) throw new Error('setup non eseguito')
  return { wrapper, form, submit }
}

function input(wrapper: VueWrapper, name: RegisterField) {
  return wrapper.get<HTMLInputElement>(`input[name="${name}"]`)
}

async function fillValidForm(wrapper: VueWrapper, email: string, displayName: string) {
  await input(wrapper, 'email').setValue(email)
  await input(wrapper, 'displayName').setValue(displayName)
  await input(wrapper, 'acceptedPrivacy').trigger('click')
}

async function submitForm(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('useZodForm: dati passati alla callback', () => {
  it('passes the data normalized by registerSchema (trim, lowercase, empty name → undefined)', async () => {
    const onSubmit = vi.fn<SubmitHandler>()
    const { wrapper } = mountRegisterForm(onSubmit)

    await fillValidForm(wrapper, '  Mario.Rossi@Example.IT ', '   ')
    await submitForm(wrapper)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const data = onSubmit.mock.calls[0]?.[0]
    expect(data).toStrictEqual(
      registerSchema.parse({
        email: '  Mario.Rossi@Example.IT ',
        displayName: '   ',
        acceptedPrivacy: true,
      }),
    )
    expect(data?.email).toBe('mario.rossi@example.it')
    expect(data?.displayName).toBeUndefined()
    expect(data?.acceptedPrivacy).toBe(true)
  })

  it('trims a non-empty display name', async () => {
    const onSubmit = vi.fn<SubmitHandler>()
    const { wrapper } = mountRegisterForm(onSubmit)

    await fillValidForm(wrapper, 'anna@example.it', '  Anna  ')
    await submitForm(wrapper)

    expect(onSubmit.mock.calls[0]?.[0].displayName).toBe('Anna')
  })

  it('keeps the raw values in the form, separate from the schema output', async () => {
    const { wrapper, form } = mountRegisterForm()

    expect(form.values.value).toStrictEqual({
      email: '',
      displayName: '',
      acceptedPrivacy: false,
    })
    await fillValidForm(wrapper, ' A@B.IT ', ' ')

    expect(form.values.value).toStrictEqual({
      email: ' A@B.IT ',
      displayName: ' ',
      acceptedPrivacy: true,
    })
  })
})

describe('useZodForm: binding dei campi', () => {
  it('binds text fields with value and checkboxes with checked', async () => {
    const { wrapper, form } = mountRegisterForm()

    expect(form.field('email')).toHaveProperty('value', '')
    expect(form.field('email')).not.toHaveProperty('checked')
    expect(form.field('acceptedPrivacy')).toHaveProperty('checked', false)
    expect(form.field('acceptedPrivacy')).not.toHaveProperty('value')

    await input(wrapper, 'acceptedPrivacy').trigger('click')
    expect(form.values.value.acceptedPrivacy).toBe(true)
    expect(input(wrapper, 'acceptedPrivacy').element.checked).toBe(true)

    await input(wrapper, 'acceptedPrivacy').trigger('click')
    expect(form.values.value.acceptedPrivacy).toBe(false)
  })

  it('gives each field a unique id, also across two forms of the same app', () => {
    const ids: string[] = []
    const TwoForms = {
      setup() {
        for (const form of [useRegisterForm(), useRegisterForm()]) {
          ids.push(
            form.field('email').id,
            form.field('displayName').id,
            form.field('acceptedPrivacy').id,
          )
        }
        return () => h('div')
      },
    }
    wrappers.push(mount(TwoForms))

    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(6)
  })

  it('marks a valid field as not invalid and without aria-describedby', () => {
    const { wrapper } = mountRegisterForm()
    const email = input(wrapper, 'email')

    expect(email.attributes('aria-invalid')).toBe('false')
    expect(email.attributes('aria-describedby')).toBeUndefined()
  })
})

describe('useZodForm: invio non valido', () => {
  it('does not call the callback and links each error to a role="alert" element', async () => {
    const onSubmit = vi.fn<SubmitHandler>()
    const { wrapper, form } = mountRegisterForm(onSubmit)

    await submitForm(wrapper)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(form.errors.email).toBe('Inserisci un indirizzo email valido.')
    expect(form.errors.acceptedPrivacy).toBe('Per registrarti devi accettare Termini e Privacy.')
    expect(form.errors.displayName).toBeUndefined()

    for (const name of ['email', 'acceptedPrivacy'] as const) {
      const field = input(wrapper, name)
      expect(field.attributes('aria-invalid')).toBe('true')
      const describedBy = field.attributes('aria-describedby')
      const alert = wrapper.get(`#${describedBy ?? 'missing'}`)
      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toBe(form.errors[name])
    }
    expect(input(wrapper, 'displayName').attributes('aria-invalid')).toBe('false')
  })

  it('moves the focus to the first invalid field', async () => {
    const { wrapper } = mountRegisterForm()

    await submitForm(wrapper)

    expect(document.activeElement).toBe(input(wrapper, 'email').element)
  })

  it('follows the DOM order, not the schema order, when choosing the field to focus', async () => {
    const { wrapper } = mountRegisterForm(undefined, ['acceptedPrivacy', 'displayName', 'email'])

    await submitForm(wrapper)

    expect(document.activeElement).toBe(input(wrapper, 'acceptedPrivacy').element)
  })

  it('focuses a later field when the earlier ones are valid', async () => {
    const { wrapper } = mountRegisterForm()

    await input(wrapper, 'email').setValue('mario@example.it')
    await submitForm(wrapper)

    expect(document.activeElement).toBe(input(wrapper, 'acceptedPrivacy').element)
  })

  it('reports issues without a field (refine on the object) as a form error', async () => {
    const schema = z
      .object({ password: z.string(), confirm: z.string() })
      .refine((value) => value.password === value.confirm, { error: 'Le password non coincidono.' })
    let formError: (() => string | undefined) | undefined
    let submit: (() => Promise<void>) | undefined
    const onSubmit = vi.fn()
    const PasswordForm = {
      setup() {
        const form = useZodForm({ schema, text: { password: 'a', confirm: 'b' }, checkbox: {} })
        formError = () => form.formError.value
        submit = form.handleSubmit(onSubmit)
        return () => h('form')
      },
    }
    wrappers.push(mount(PasswordForm, { attachTo: document.body }))

    await submit?.()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(formError?.()).toBe('Le password non coincidono.')
  })
})

describe('useZodForm: validazione durante la compilazione', () => {
  it('does not validate an untouched field while typing', async () => {
    const { wrapper, form } = mountRegisterForm()

    await input(wrapper, 'email').setValue('non-una-email')

    expect(form.errors.email).toBeUndefined()
    expect(form.touched.email).toBeUndefined()
  })

  it('validates on blur and then on every input of the touched field', async () => {
    const { wrapper, form } = mountRegisterForm()
    const email = input(wrapper, 'email')

    await email.setValue('non-una-email')
    await email.trigger('blur')
    expect(form.touched.email).toBe(true)
    expect(form.errors.email).toBe('Inserisci un indirizzo email valido.')

    await email.setValue('mario@example.it')
    expect(form.errors.email).toBeUndefined()

    await email.setValue('di-nuovo-sbagliata')
    expect(form.errors.email).toBe('Inserisci un indirizzo email valido.')
  })

  it('validates on blur only the blurred field', async () => {
    const { wrapper, form } = mountRegisterForm()

    await input(wrapper, 'email').trigger('blur')

    expect(form.errors.email).toBeDefined()
    expect(form.errors.acceptedPrivacy).toBeUndefined()
  })

  it('clears the error of a field corrected after a failed submit', async () => {
    const { wrapper, form } = mountRegisterForm()

    await submitForm(wrapper)
    await input(wrapper, 'acceptedPrivacy').trigger('click')

    expect(form.errors.acceptedPrivacy).toBeUndefined()
    expect(input(wrapper, 'acceptedPrivacy').attributes('aria-invalid')).toBe('false')
  })
})

describe('useZodForm: errori del server', () => {
  it('shows a server field error until the field is modified, even after a blur', async () => {
    const { wrapper, form } = mountRegisterForm()
    const email = input(wrapper, 'email')
    await email.setValue('mario@example.it')

    form.setFieldError('email', 'Errore dal server.')
    await flushPromises()
    expect(email.attributes('aria-invalid')).toBe('true')

    await email.trigger('blur')
    expect(form.errors.email).toBe('Errore dal server.')

    await email.setValue('mario.rossi@example.it')
    expect(form.errors.email).toBeUndefined()
  })

  it('revalidates an untouched field that showed a server error', async () => {
    const { wrapper, form } = mountRegisterForm()

    form.setFieldError('email', 'Errore dal server.')
    await input(wrapper, 'email').setValue('non-una-email')

    expect(form.errors.email).toBe('Inserisci un indirizzo email valido.')
  })

  it('shows a form error and clears it on the next valid submit', async () => {
    const { wrapper, form } = mountRegisterForm()
    await fillValidForm(wrapper, 'mario@example.it', '')

    form.setFormError('Email o password non corretti.')
    await flushPromises()
    expect(wrapper.get('[data-testid="form-error"]').text()).toBe('Email o password non corretti.')

    await submitForm(wrapper)
    expect(form.formError.value).toBeUndefined()
    expect(wrapper.find('[data-testid="form-error"]').exists()).toBe(false)
  })

  it('replaces server field errors with the local validation on submit', async () => {
    const { wrapper, form } = mountRegisterForm()

    form.setFieldError('displayName', 'Errore dal server.')
    await submitForm(wrapper)

    expect(form.errors.displayName).toBeUndefined()
  })
})

describe('useZodForm: invio in corso', () => {
  it('ignores a second submit while the first is pending and exposes submitting/aria-busy', async () => {
    let resolve: (() => void) | undefined
    const onSubmit = vi.fn<SubmitHandler>(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    const { wrapper, form } = mountRegisterForm(onSubmit)
    await fillValidForm(wrapper, 'mario@example.it', '')

    await submitForm(wrapper)
    await submitForm(wrapper)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(form.submitting.value).toBe(true)
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')

    resolve?.()
    await flushPromises()

    expect(form.submitting.value).toBe(false)
    expect(wrapper.get('form').attributes('aria-busy')).toBe('false')
    await submitForm(wrapper)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('propagates the callback error and resets submitting', async () => {
    const failure = new Error('errore della callback')
    const onSubmit = vi.fn<SubmitHandler>(() => Promise.reject(failure))
    const { wrapper, form, submit } = mountRegisterForm(onSubmit)
    await fillValidForm(wrapper, 'mario@example.it', '')

    await expect(submit()).rejects.toBe(failure)
    expect(form.submitting.value).toBe(false)

    await expect(submit()).rejects.toBe(failure)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('propagates a synchronous callback error too', async () => {
    const failure = new Error('errore sincrono')
    const { wrapper, form, submit } = mountRegisterForm(() => {
      throw failure
    })
    await fillValidForm(wrapper, 'mario@example.it', '')

    await expect(submit()).rejects.toBe(failure)
    expect(form.submitting.value).toBe(false)
  })

  it('prevents the native form submission', async () => {
    const { submit } = mountRegisterForm()
    const event = new Event('submit', { cancelable: true })

    await submit(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('useZodForm: uso scorretto', () => {
  it('throws when called outside a component setup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(() => useRegisterForm()).toThrow('useZodForm va chiamato dentro setup()')
    } finally {
      warn.mockRestore()
    }
  })

  it('throws when the same name is both a text field and a checkbox', () => {
    const Duplicated = {
      setup() {
        useZodForm({ schema: z.object({}), text: { same: '' }, checkbox: { same: false } })
        return () => h('form')
      },
    }

    expect(() => mount(Duplicated)).toThrow('il campo "same" è sia testuale sia checkbox')
  })
})
