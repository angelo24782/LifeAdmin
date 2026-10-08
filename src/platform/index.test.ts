import { describe, expect, it } from 'vitest'

import { isNativeRuntime, loadPlatform } from '.'

describe('isNativeRuntime', () => {
  it('is false without the Capacitor global', () => {
    expect(isNativeRuntime({})).toBe(false)
  })

  it('is false when Capacitor reports a non-native platform', () => {
    expect(isNativeRuntime({ Capacitor: { isNativePlatform: () => false } })).toBe(false)
  })

  it('is true when Capacitor reports a native platform', () => {
    expect(isNativeRuntime({ Capacitor: { isNativePlatform: () => true } })).toBe(true)
  })
})

describe('loadPlatform', () => {
  it('returns the web platform outside the native shell', async () => {
    const platform = await loadPlatform({})

    expect(platform.info).toEqual({ name: 'web', isNative: false })
    expect(platform.push.isSupported).toBe(false)
    expect(platform.camera.isAvailable).toBe(false)
  })
})
