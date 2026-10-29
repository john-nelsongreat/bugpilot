import type { DiagnosticCategory } from './types'

export const DIAGNOSTIC_CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  'missing-module': 'Missing module',
  'import-failure': 'Import failure',
  'undefined-name': 'Undefined name',
  'type-mismatch': 'Type mismatch',
  'missing-attribute': 'Missing attribute',
  'missing-key': 'Missing key',
  'index-out-of-range': 'Index out of range',
  'missing-file': 'Missing file',
  'permission-denied': 'Permission denied',
  'syntax-error': 'Syntax error',
  'indentation-error': 'Indentation error',
  'division-by-zero': 'Division by zero',
  'invalid-value': 'Invalid value',
  'recursion-error': 'Recursion error',
  'unicode-error': 'Unicode error',
  'json-decode-error': 'JSON decode error',
  'port-in-use': 'Port already in use',
  'network-request-failed': 'Network request failed',
  'cors-blocked': 'CORS blocked request',
  'react-error': 'React error',
  unrecognized: 'Unrecognised',
}

export const CONFIDENCE_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
} as const

export function diagnosticCategoryLabel(category: string): string {
  const known = DIAGNOSTIC_CATEGORY_LABELS[category as DiagnosticCategory]
  if (known) return known

  const words = category.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (words === '') return category
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}
