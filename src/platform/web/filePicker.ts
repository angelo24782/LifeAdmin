import type { CameraPort, FilePickerOptions, FilePickerPort } from '../ports'

/** Web: selettore file del browser tramite `<input type="file">` (nessun elemento resta nel DOM). */
export function createWebFilePicker(doc: Document = document): FilePickerPort {
  return {
    pickFiles(options: FilePickerOptions) {
      return new Promise<File[]>((resolve) => {
        const input = doc.createElement('input')
        input.type = 'file'
        input.accept = options.accept.join(',')
        input.multiple = options.multiple ?? false

        input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), {
          once: true,
        })
        input.addEventListener('cancel', () => resolve([]), { once: true })
        input.click()
      })
    },
  }
}

/** Web: nessuna acquisizione diretta; i telefoni useranno il selettore (che offre la fotocamera). */
export const webCamera: CameraPort = {
  isAvailable: false,
  takePhoto: () => Promise.resolve(null),
}
