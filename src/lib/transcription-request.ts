export interface TranscriptionRequestInput {
  model: string
  file: Blob
  sourceLang: string
}

export function buildTranscriptionFormData(input: TranscriptionRequestInput): FormData {
  const form = new FormData()
  form.append('model', input.model)
  form.append('file', input.file, 'segment.wav')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (input.sourceLang !== 'auto') form.append('language', input.sourceLang)
  return form
}
