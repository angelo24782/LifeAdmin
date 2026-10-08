import { describe, expect, it, vi } from 'vitest'

import { createWebLifecycle, createWebNetwork, createWebShare, webPush } from './browserPorts'
import { createWebSecureStorage } from './secureStorage'

describe('web secure storage', () => {
  it('stores, reads and removes values through the provided storage', async () => {
    const backing = new Map<string, string>()
    const storage = createWebSecureStorage(
      () =>
        ({
          getItem: (key: string) => backing.get(key) ?? null,
          setItem: (key: string, value: string) => void backing.set(key, value),
          removeItem: (key: string) => void backing.delete(key),
        }) as unknown as Storage,
    )

    await storage.setItem('session', 'abc')
    expect(await storage.getItem('session')).toBe('abc')
    expect(backing.get('session')).toBe('abc')

    await storage.removeItem('session')
    expect(await storage.getItem('session')).toBeNull()
  })

  it('falls back to memory when localStorage is unavailable', async () => {
    const storage = createWebSecureStorage(() => undefined)

    await storage.setItem('k', 'v')
    expect(await storage.getItem('k')).toBe('v')
    await storage.removeItem('k')
    expect(await storage.getItem('k')).toBeNull()
  })

  it('falls back to memory when localStorage throws', async () => {
    const storage = createWebSecureStorage(() => {
      throw new Error('blocked')
    })

    await storage.setItem('k', 'v')
    expect(await storage.getItem('k')).toBe('v')
  })
})

describe('web lifecycle', () => {
  it('maps page visibility to resume and pause and supports unsubscribing', () => {
    const lifecycle = createWebLifecycle(document)
    const onResume = vi.fn()
    const onPause = vi.fn()
    const stopResume = lifecycle.onResume(onResume)
    lifecycle.onPause(onPause)

    const visibility = vi.spyOn(document, 'visibilityState', 'get')

    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onResume).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onResume).toHaveBeenCalledTimes(1)

    stopResume()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onResume).toHaveBeenCalledTimes(1)

    visibility.mockRestore()
  })
})

describe('web network', () => {
  it('reports connectivity changes', () => {
    const network = createWebNetwork(window)
    const handler = vi.fn()
    const stop = network.onChange(handler)

    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    expect(handler.mock.calls).toEqual([[false], [true]])

    stop()
    window.dispatchEvent(new Event('offline'))
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('web share', () => {
  it('is unavailable without the Web Share API', async () => {
    const share = createWebShare({} as Navigator)

    expect(share.canShare).toBe(false)
    await expect(share.share({ title: 'x' })).resolves.toBeUndefined()
  })

  it('delegates to navigator.share when available', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    const share = createWebShare({ share: nativeShare } as unknown as Navigator)

    await share.share({ title: 'T', url: 'https://example.com' })

    expect(share.canShare).toBe(true)
    expect(nativeShare).toHaveBeenCalledWith({
      title: 'T',
      text: undefined,
      url: 'https://example.com',
    })
  })
})

describe('web push', () => {
  it('is unsupported and never registers a token', async () => {
    expect(webPush.isSupported).toBe(false)
    expect(await webPush.checkPermission()).toBe('unsupported')
    expect(await webPush.register()).toBeNull()
  })
})
