export interface TranscriptionRequestInput {
  model: string
  file: Blob
  sourceLang: string
  /**
   * Upload filename. The extension sends WAV segments; the SPA records WebM
   * through MediaRecorder, and the container suffix is what providers sniff.
   */
  fileName?: string
}

export function buildTranscriptionFormData(input: TranscriptionRequestInput): FormData {
  const form = new FormData()
  form.append('model', input.model)
  form.append('file', input.file, input.fileName ?? 'segment.wav')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (input.sourceLang !== 'auto') form.append('language', input.sourceLang)
  return form
}
