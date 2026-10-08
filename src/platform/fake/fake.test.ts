import { describe, expect, it, vi } from 'vitest'

import { createFakePlatform } from '.'

describe('fake platform', () => {
  it('defaults to a web platform without push', async () => {
    const platform = createFakePlatform()

    expect(platform.info).toEqual({ name: 'web', isNative: false })
    expect(await platform.push.checkPermission()).toBe('unsupported')
  })

  it('simulates a native platform with a permission prompt flow', async () => {
    const platform = createFakePlatform({ name: 'ios' })

    expect(platform.info.isNative).toBe(true)
    expect(await platform.push.checkPermission()).toBe('prompt')
    expect(await platform.push.register()).toBeNull()
    expect(await platform.push.requestPermission()).toBe('granted')
    expect(await platform.push.register()).toBe('fake-push-token')
  })

  it('emits lifecycle, deep link, network and push events to subscribers', () => {
    const platform = createFakePlatform({ name: 'android' })
    const resume = vi.fn()
    const link = vi.fn()
    const online = vi.fn()
    const tap = vi.fn()
    platform.lifecycle.onResume(resume)
    platform.deepLinks.onOpen(link)
    platform.network.onChange(online)
    platform.push.onNotificationTap(tap)

    platform.emitResume()
    platform.emitDeepLink('https://app.example/items/1')
    platform.setOnline(false)
    platform.emitPushTap({ path: '/items/1' })

    expect(resume).toHaveBeenCalledTimes(1)
    expect(link).toHaveBeenCalledWith('https://app.example/items/1')
    expect(online).toHaveBeenCalledWith(false)
    expect(platform.network.isOnline()).toBe(false)
    expect(tap).toHaveBeenCalledWith({ path: '/items/1' })
  })

  it('keeps secure storage in memory and records opened documents', async () => {
    const platform = createFakePlatform()

    await platform.secureStorage.setItem('k', 'v')
    await platform.documentViewer.open('https://signed.example/doc')

    expect(platform.storageContents.get('k')).toBe('v')
    expect(platform.openedDocuments).toEqual(['https://signed.example/doc'])
  })
})
