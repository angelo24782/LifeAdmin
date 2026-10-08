import type {
  CameraPort,
  FilePickerPort,
  Platform,
  PlatformName,
  PushPermission,
  PushPort,
  PushTap,
  SecureStorage,
  Unsubscribe,
} from '../ports'

/** Piccolo emettitore tipizzato usato dai fake per simulare eventi di piattaforma nei test. */
class Emitter<T> {
  private readonly handlers = new Set<(value: T) => void>()

  subscribe(handler: (value: T) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  emit(value: T): void {
    for (const handler of [...this.handlers]) handler(value)
  }
}

export interface FakePlatform extends Platform {
  /** Contenuto corrente dello storage sicuro (ispezionabile dai test). */
  readonly storageContents: ReadonlyMap<string, string>
  setOnline(online: boolean): void
  emitResume(): void
  emitPause(): void
  emitBackButton(): void
  emitDeepLink(url: string): void
  emitPushTap(tap: PushTap): void
  emitPushToken(token: string): void
  setPushPermission(permission: PushPermission): void
  setPickedFiles(files: File[]): void
  readonly openedDocuments: readonly string[]
}

export interface FakePlatformOptions {
  readonly name?: PlatformName
  readonly online?: boolean
  readonly launchUrl?: string | null
  readonly pushPermission?: PushPermission
}

/** Implementazione in memoria della piattaforma, per test di feature, shell e store. */
export function createFakePlatform(options: FakePlatformOptions = {}): FakePlatform {
  const name = options.name ?? 'web'
  const isNative = name !== 'web'

  const storage = new Map<string, string>()
  const secureStorage: SecureStorage = {
    getItem: (key) => Promise.resolve(storage.get(key) ?? null),
    setItem: (key, value) => {
      storage.set(key, value)
      return Promise.resolve()
    },
    removeItem: (key) => {
      storage.delete(key)
      return Promise.resolve()
    },
  }

  let online = options.online ?? true
  let pushPermission: PushPermission =
    options.pushPermission ?? (isNative ? 'prompt' : 'unsupported')
  let pickedFiles: File[] = []
  const openedDocuments: string[] = []

  const network = new Emitter<boolean>()
  const resume = new Emitter<void>()
  const pause = new Emitter<void>()
  const back = new Emitter<void>()
  const deepLinks = new Emitter<string>()
  const pushTaps = new Emitter<PushTap>()
  const pushTokens = new Emitter<string>()

  const push: PushPort = {
    isSupported: isNative,
    checkPermission: () => Promise.resolve(pushPermission),
    requestPermission: () => {
      if (pushPermission === 'prompt') pushPermission = 'granted'
      return Promise.resolve(pushPermission)
    },
    register: () => Promise.resolve(pushPermission === 'granted' ? 'fake-push-token' : null),
    unregister: () => Promise.resolve(),
    onTokenRefresh: (handler) => pushTokens.subscribe(handler),
    onNotificationTap: (handler) => pushTaps.subscribe(handler),
  }

  const filePicker: FilePickerPort = { pickFiles: () => Promise.resolve(pickedFiles) }
  const camera: CameraPort = { isAvailable: isNative, takePhoto: () => Promise.resolve(null) }

  return {
    info: { name, isNative },
    secureStorage,
    push,
    filePicker,
    camera,
    documentViewer: {
      open: (signedUrl) => {
        openedDocuments.push(signedUrl)
        return Promise.resolve()
      },
    },
    deepLinks: {
      getLaunchUrl: () => Promise.resolve(options.launchUrl ?? null),
      onOpen: (handler) => deepLinks.subscribe(handler),
    },
    lifecycle: {
      onResume: (handler) => resume.subscribe(() => handler()),
      onPause: (handler) => pause.subscribe(() => handler()),
      onBackButton: (handler) => back.subscribe(() => handler()),
    },
    haptics: { impact: () => Promise.resolve(), notify: () => Promise.resolve() },
    share: { canShare: true, share: () => Promise.resolve() },
    network: {
      isOnline: () => online,
      onChange: (handler) => network.subscribe(handler),
    },

    storageContents: storage,
    openedDocuments,
    setOnline(value) {
      online = value
      network.emit(value)
    },
    emitResume: () => resume.emit(undefined),
    emitPause: () => pause.emit(undefined),
    emitBackButton: () => back.emit(undefined),
    emitDeepLink: (url) => deepLinks.emit(url),
    emitPushTap: (tap) => pushTaps.emit(tap),
    emitPushToken: (token) => pushTokens.emit(token),
    setPushPermission(permission) {
      pushPermission = permission
    },
    setPickedFiles(files) {
      pickedFiles = files
    },
  }
}
