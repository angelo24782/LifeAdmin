import type {
  AppLifecyclePort,
  DeepLinksPort,
  DocumentViewerPort,
  HapticsPort,
  NetworkPort,
  PushPort,
  SharePort,
  Unsubscribe,
} from '../ports'

const noop: Unsubscribe = () => undefined

/** Web: i documenti si aprono in una nuova scheda, senza esporre `opener`. */
export const webDocumentViewer: DocumentViewerPort = {
  open(signedUrl) {
    window.open(signedUrl, '_blank', 'noopener,noreferrer')
    return Promise.resolve()
  },
}

/** Web: la navigazione è gestita direttamente dal router; nessun deep link nativo. */
export const webDeepLinks: DeepLinksPort = {
  getLaunchUrl: () => Promise.resolve(null),
  onOpen: () => noop,
}

/** Web: pausa/ripresa corrispondono alla visibilità della pagina. */
export function createWebLifecycle(doc: Document = document): AppLifecyclePort {
  const onVisibility = (handler: () => void, visible: boolean): Unsubscribe => {
    const listener = () => {
      if ((doc.visibilityState === 'visible') === visible) handler()
    }
    doc.addEventListener('visibilitychange', listener)
    return () => doc.removeEventListener('visibilitychange', listener)
  }

  return {
    onResume: (handler) => onVisibility(handler, true),
    onPause: (handler) => onVisibility(handler, false),
    onBackButton: () => noop,
  }
}

export const webHaptics: HapticsPort = {
  impact: () => Promise.resolve(),
  notify: () => Promise.resolve(),
}

/** Web: push non supportate nell'MVP (web push è P1, SPECIFICA §22.2). */
export const webPush: PushPort = {
  isSupported: false,
  checkPermission: () => Promise.resolve('unsupported'),
  requestPermission: () => Promise.resolve('unsupported'),
  register: () => Promise.resolve(null),
  unregister: () => Promise.resolve(),
  onTokenRefresh: () => noop,
  onNotificationTap: () => noop,
}

export function createWebShare(nav: Navigator = navigator): SharePort {
  return {
    canShare: typeof nav.share === 'function',
    async share(content) {
      if (typeof nav.share !== 'function') return
      await nav.share({ title: content.title, text: content.text, url: content.url })
    },
  }
}

export function createWebNetwork(win: Window = window): NetworkPort {
  return {
    isOnline: () => win.navigator.onLine,
    onChange(handler) {
      const online = () => handler(true)
      const offline = () => handler(false)
      win.addEventListener('online', online)
      win.addEventListener('offline', offline)
      return () => {
        win.removeEventListener('online', online)
        win.removeEventListener('offline', offline)
      }
    },
  }
}
