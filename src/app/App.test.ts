import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { providePlatform } from '@/platform'
import { createFakePlatform } from '@/platform/fake'

import App from './App.vue'
import { createAppRouter } from './router'

async function mountApp(name: 'web' | 'ios' | 'android') {
  const router = createAppRouter(createMemoryHistory())
  await router.push('/')
  await router.isReady()

  const wrapper = mount(App, {
    global: {
      plugins: [
        router,
        {
          install: (app) => providePlatform(app, createFakePlatform({ name })),
        },
      ],
    },
  })
  await flushPromises()
  return wrapper
}

describe('App (smoke)', () => {
  it('renders the home page with an accessible heading', async () => {
    const wrapper = await mountApp('web')

    expect(wrapper.find('main').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toBe('Le scadenze della tua vita, sotto controllo.')
  })

  it.each([
    ['web', 'Web'],
    ['ios', 'iOS'],
    ['android', 'Android'],
  ] as const)('shows the %s platform from the injected port', async (name, label) => {
    const wrapper = await mountApp(name)

    expect(wrapper.get('[data-testid="platform-label"]').text()).toBe(`Piattaforma: ${label}`)
  })
})
