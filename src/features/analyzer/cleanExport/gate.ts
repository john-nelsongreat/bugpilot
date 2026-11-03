export interface CleanExportAuthorization {
  allowed: boolean
  reason: string
}

/**
 * The single authorization gate for clean export.
 *
 * In this slice it always allows the export: everything runs locally in the tab and there
 * is no paid capability to meter. Client-side gating is advisory only — anyone can call the
 * builder from a console — so it must never be treated as a security boundary.
 *
 * A future daily-credit system would replace this body with a check of a server-issued
 * signed token (or call a server route for the capability). The real enforcement would live
 * on the server; this module only decides whether the UI offers the action.
 */
export function authorizeCleanExport(): CleanExportAuthorization {
  return {
    allowed: true,
    reason: 'Clean export runs entirely in this browser tab, so it is enabled without credits.',
  }
}
