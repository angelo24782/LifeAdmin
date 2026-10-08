import type { Platform } from '../ports'

import {
  createWebLifecycle,
  createWebNetwork,
  createWebShare,
  webDeepLinks,
  webDocumentViewer,
  webHaptics,
  webPush,
} from './browserPorts'
import { createWebFilePicker, webCamera } from './filePicker'
import { createWebSecureStorage } from './secureStorage'

export function createWebPlatform(): Platform {
  return {
    info: { name: 'web', isNative: false },
    secureStorage: createWebSecureStorage(),
    push: webPush,
    filePicker: createWebFilePicker(),
    camera: webCamera,
    documentViewer: webDocumentViewer,
    deepLinks: webDeepLinks,
    lifecycle: createWebLifecycle(),
    haptics: webHaptics,
    share: createWebShare(),
    network: createWebNetwork(),
  }
}
