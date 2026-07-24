interface ErrorBody {
  error?: string
  detail?: string
  missingFields?: string[]
}

interface ErrorWithBody {
  data?: ErrorBody
  message?: string
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const body = (error as ErrorWithBody | null)?.data
  if (body?.detail && body.missingFields && body.missingFields.length > 0) {
    return `${body.detail} (missing: ${body.missingFields.join(", ")})`
  }
  if (body?.detail) return body.detail
  if (body?.error) return body.error

  const message = (error as Error | null)?.message
  if (message && message.trim().length > 0) {
    const trimmed = message.trim()
    if (/^<!doctype html>|^<html/i.test(trimmed)) return fallback
    return trimmed
  }

  return fallback
}
