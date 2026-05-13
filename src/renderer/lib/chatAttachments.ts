import type { PlanPromptAttachment } from '@shared/types'
import type { ClipboardEvent, DragEvent } from 'react'

const MAX_ATTACHMENT_BYTES = 10_000_000

export async function filesToPromptAttachments(files: FileList | File[]): Promise<{
  attachments: PlanPromptAttachment[]
  errors: string[]
}> {
  const attachments: PlanPromptAttachment[] = []
  const errors: string[] = []
  for (const file of Array.from(files)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${file.name} is too large. Attach files under 10 MB.`)
      continue
    }
    const isImage = file.type.startsWith('image/')
    attachments.push({
      name: file.name || (isImage ? 'pasted-image.png' : 'attachment.txt'),
      type: file.type,
      size: file.size,
      content: isImage ? await readAsDataUrl(file) : await file.text(),
      encoding: isImage ? 'dataUrl' : 'text'
    })
  }
  return { attachments, errors }
}

export function filesFromClipboard(e: ClipboardEvent): File[] {
  return Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'))
}

export function filesFromDrop(e: DragEvent): File[] {
  return Array.from(e.dataTransfer.files).filter((file) => file.size > 0)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'))
    reader.readAsDataURL(file)
  })
}
