/**
 * Porte della piattaforma (SPECIFICA §14 regole 2–5, §22.6).
 *
 * Feature, store e componenti dipendono SOLO da queste interfacce. Le implementazioni vivono in
 * `web/` (browser), `native/` (Capacitor, da M14) e `fake/` (test). Nessuna logica di business qui.
 */

export type Unsubscribe = () => void

export type PlatformName = 'web' | 'ios' | 'android'

export interface PlatformInfo {
  readonly name: PlatformName
  readonly isNative: boolean
}

/**
 * Archiviazione chiave/valore per dati sensibili (sessione di autenticazione).
 * Web: localStorage. Native: Keychain / Keystore. Firma compatibile con lo `storage` asincrono
 * accettato dal client Supabase.
 */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

export interface PushTap {
  /** Percorso interno ricevuto nel payload; va validato con la whitelist dei deep link. */
  readonly path: string
}

export interface PushPort {
  readonly isSupported: boolean
  checkPermission(): Promise<PushPermission>
  requestPermission(): Promise<PushPermission>
  /** Restituisce il token del dispositivo, oppure `null` se non disponibile. */
  register(): Promise<string | null>
  unregister(): Promise<void>
  onTokenRefresh(handler: (token: string) => void): Unsubscribe
  onNotificationTap(handler: (tap: PushTap) => void): Unsubscribe
}

export interface FilePickerOptions {
  /** Tipi MIME ammessi, es. `['application/pdf', 'image/png']`. */
  readonly accept: readonly string[]
  readonly multiple?: boolean
}

export interface FilePickerPort {
  /** Restituisce i file scelti; array vuoto se l'utente annulla. */
  pickFiles(options: FilePickerOptions): Promise<File[]>
}

export interface CameraPort {
  readonly isAvailable: boolean
  /** Scatta una foto; `null` se l'utente annulla. */
  takePhoto(): Promise<File | null>
}

export interface DocumentViewerPort {
  /** Apre un documento tramite URL firmato nel visualizzatore appropriato. */
  open(signedUrl: string): Promise<void>
}

export interface DeepLinksPort {
  /** URL che ha avviato l'app a freddo (se presente). */
  getLaunchUrl(): Promise<string | null>
  /** Link aperti mentre l'app è in esecuzione. */
  onOpen(handler: (url: string) => void): Unsubscribe
}

export interface AppLifecyclePort {
  onResume(handler: () => void): Unsubscribe
  onPause(handler: () => void): Unsubscribe
  /** Tasto/gesto Indietro di sistema (Android). Sul Web non emette mai. */
  onBackButton(handler: () => void): Unsubscribe
}

export type HapticImpact = 'light' | 'medium' | 'heavy'
export type HapticNotification = 'success' | 'warning' | 'error'

export interface HapticsPort {
  impact(style: HapticImpact): Promise<void>
  notify(type: HapticNotification): Promise<void>
}

export interface ShareContent {
  readonly title?: string
  readonly text?: string
  readonly url?: string
}

export interface SharePort {
  readonly canShare: boolean
  share(content: ShareContent): Promise<void>
}

export interface NetworkPort {
  isOnline(): boolean
  onChange(handler: (online: boolean) => void): Unsubscribe
}

export interface Platform {
  readonly info: PlatformInfo
  readonly secureStorage: SecureStorage
  readonly push: PushPort
  readonly filePicker: FilePickerPort
  readonly camera: CameraPort
  readonly documentViewer: DocumentViewerPort
  readonly deepLinks: DeepLinksPort
  readonly lifecycle: AppLifecyclePort
  readonly haptics: HapticsPort
  readonly share: SharePort
  readonly network: NetworkPort
}
