import type { CleanExportFile } from '../cleanExport/build'

/** Hands one in-memory file to the browser's download flow. */
export function downloadCleanFile(file: CleanExportFile): void {
  const blob = new Blob([new Uint8Array(file.bytes)], { type: file.mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking sooner can cancel a blob download that has not started yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
