/**
 * Every way the archive reader can stop or skip, with the message the user sees.
 * Fatal codes abort the whole archive; skip codes drop one entry and keep going.
 */
export const ARCHIVE_REFUSAL_CODES = [
  'archive_too_large',
  'entry_count_exceeded',
  'wall_clock_exceeded',
  'total_uncompressed_exceeded',
  'declared_ratio_exceeded',
  'actual_ratio_exceeded',
  'declared_size_understated',
  'path_traversal',
  'absolute_path',
  'drive_letter_path',
  'backslash_in_path',
  'name_too_long',
  'duplicate_name',
  'symlink_entry',
  'nested_archive',
  'encrypted_entry',
  'not_a_zip',
  'not_a_tar',
  'unsupported_format',
  'multi_disk_not_supported',
  'central_directory_too_large',
  'overlapping_entries',
  'local_central_disagreement',
  'analysable_budget_exceeded',
  'corrupt_central_directory',
  'corrupt_local_header',
  'corrupt_deflate_stream',
  'corrupt_tar_header',
  'corrupt_gzip_stream',
  'multi_member_gzip',
  'archive_truncated',
  'crc_mismatch',
  'unsupported_compression',
  'null_byte_in_name',
  'cancelled',
  'worker_error',
] as const

export const ARCHIVE_SKIP_CODES = [
  'single_file_too_large',
  'binary_content',
  'ignored_folder',
  'empty_entry',
  'directory_entry',
  'special_entry',
  'source_set_aside',
  'notebook_unreadable',
  'generated_file',
  'data_descriptor_mismatch',
  'not_reached',
] as const

export type ArchiveRefusalCode = (typeof ARCHIVE_REFUSAL_CODES)[number]
export type ArchiveSkipCode = (typeof ARCHIVE_SKIP_CODES)[number]
export type ArchiveReasonCode = ArchiveRefusalCode | ArchiveSkipCode

/** `subject` is the offending name or number; `extra` carries a second detail (e.g. a method id). */
type PlainMessage = (subject: string, extra?: string) => string

const PLAIN_MESSAGES: Record<ArchiveReasonCode, PlainMessage> = {
  archive_too_large: (n) =>
    `This archive is ${n} bytes, over the byte ceiling BugPilot reads in the browser. Split it into a smaller archive or pick the files you want checked.`,
  entry_count_exceeded: (n) =>
    `This archive holds more than ${n} entries. BugPilot stops reading at that count so a huge archive cannot fill the tab.`,
  wall_clock_exceeded: (n) =>
    `BugPilot spent more than ${n} second(s) reading this upload and stopped, so nothing was kept. A very large or deeply nested upload looks like this from the inside, so pick a smaller folder or split the archive.`,
  total_uncompressed_exceeded: (n) =>
    `The files add up to more than ${n} bytes, which is over the ceiling BugPilot keeps in the browser. A zip bomb looks like this, so nothing was read.`,
  declared_ratio_exceeded: () =>
    'An entry claims to expand far more than a normal text file does, so BugPilot refused it before unpacking anything.',
  actual_ratio_exceeded: () =>
    'An entry expanded far more than its own header admitted while it was being unpacked, so reading stopped at that point.',
  declared_size_understated: () =>
    'An entry produced more bytes than its header declared, so the archive is inconsistent and reading stopped.',
  path_traversal: () =>
    'A file name inside the archive points out of the archive with "..". BugPilot never reads a name like this, because it would try to leave the folder it is unpacking into.',
  absolute_path: () =>
    'A file name inside the archive starts with "/", which would point at your real filesystem. BugPilot refuses the archive.',
  drive_letter_path: () =>
    'A file name inside the archive contains a Windows drive letter, which would point at your real filesystem. BugPilot refuses the archive.',
  backslash_in_path: () =>
    'A file name inside the archive uses backslashes as separators. BugPilot only accepts "/" paths and refuses this archive.',
  name_too_long: () =>
    'A file name inside the archive is longer than BugPilot will handle, so the archive is refused.',
  duplicate_name: (name) =>
    `Two entries in the archive have the same name ("${name}"). Reading the second would hide the first, so the archive is refused.`,
  symlink_entry: (name) =>
    `The entry "${name}" is a symbolic link. Following it could read a file outside the archive, so BugPilot refuses the archive.`,
  nested_archive: (name) =>
    `The entry "${name}" is itself an archive. BugPilot does not open archives inside archives, so the upload is refused.`,
  encrypted_entry: (name) =>
    `The entry "${name}" is encrypted. BugPilot does not ask for or handle archive passwords, so nothing was unpacked.`,
  not_a_zip: () =>
    'This does not look like a .zip archive: the end-of-directory record is missing. BugPilot only reads .zip, .tar and .gz files.',
  not_a_tar: () =>
    'This does not look like a .tar archive: its first block does not carry the tar header signature. BugPilot only reads .zip, .tar and .gz files.',
  unsupported_format: (kind) =>
    kind === ''
      ? 'BugPilot could not recognise this file: it does not carry the signature of a .zip, .tar or .gz archive, and it is not plain text. Only those formats are read in the browser.'
      : `This is a .${kind} archive. BugPilot does not decode .${kind} files in the browser. Re-archive the project as a .zip or a .tar.gz and upload that instead.`,
  multi_disk_not_supported: () =>
    'This archive is split across several disks or volumes. BugPilot reads one file, so the archive is refused.',
  central_directory_too_large: (n) =>
    `The archive index claims to be ${n} bytes, over the ceiling BugPilot reads in one piece. The archive is refused before the index is parsed.`,
  overlapping_entries: (name, extra) =>
    extra === undefined
      ? `The entries "${name}" and another entry point at overlapping bytes. Reading both would let one compressed range count twice, so the archive is refused.`
      : `The entry "${name}" ${extra}, so the archive is refused.`,
  local_central_disagreement: (name) =>
    `The local header for "${name}" disagrees with the archive index about its name, sizes, checksum or compression. BugPilot cannot tell which record is real, so the archive is refused.`,
  analysable_budget_exceeded: (n) =>
    `The files to analyse add up to more than ${n} bytes, which is the analysis budget for this upload. Nothing was read, because this run keeps nothing partial.`,
  corrupt_central_directory: () =>
    'The archive index is damaged or points outside the file, so BugPilot stopped reading.',
  corrupt_local_header: (name) =>
    `The local header for "${name}" does not match the archive index, so the archive is refused.`,
  corrupt_deflate_stream: (name) =>
    `The compressed data for "${name}" is damaged or was cut off, so reading stopped.`,
  corrupt_tar_header: (name, extra) =>
    `A header block in this archive is damaged${name ? ` ("${name}")` : ''}${extra ? `: ${extra}` : ''}. BugPilot stopped reading and unpacked nothing, because a header it cannot trust could point anywhere in the file.`,
  corrupt_gzip_stream: (name, extra) =>
    `The compressed data in "${name || 'this file'}" is damaged or incomplete${extra ? `: ${extra}` : ''}. BugPilot checked the gzip header and the checksum at the end of the stream and unpacked nothing. Re-create the .gz file and upload that.`,
  multi_member_gzip: (name) =>
    `"${name || 'this file'}" is two or more gzip streams joined into one file. BugPilot reads a single gzip stream, so nothing was unpacked. Split the file, or re-create the archive as one .zip or .tar.gz.`,
  archive_truncated: (name) =>
    name === ''
      ? 'This archive stops partway through: a header or a file body promises more bytes than the file contains. BugPilot read nothing from it. Re-download or re-create the archive.'
      : `This archive is cut off inside "${name}": the header promises more bytes than the file contains. BugPilot read nothing from it. Re-download or re-create the archive.`,
  crc_mismatch: (name) =>
    `The contents of "${name}" do not match the checksum stored in the archive, so the archive is refused.`,
  unsupported_compression: (name, extra) =>
    `The entry "${name}" uses compression method ${extra ?? 'unknown'}, which BugPilot cannot unpack.`,
  null_byte_in_name: (name) =>
    `A file name inside the archive is cut short by a NUL byte ("${name}"), which is how path-traversal tricks hide a second name. The archive is refused.`,
  cancelled: () => 'You cancelled the upload, so nothing was read.',
  worker_error: () => 'The file reader stopped with an unexpected error. Nothing was stored.',
  single_file_too_large: (name) =>
    `"${name}" is bigger than the per-file ceiling, so BugPilot skipped this file and kept going with the rest.`,
  data_descriptor_mismatch: (name) =>
    `"${name}" stores its checksum and sizes after its data, and that record does not match the archive index, so BugPilot skipped this file and kept going with the rest.`,
  binary_content: (name) =>
    `"${name}" is a binary file, not text, so there is nothing for BugPilot to read.`,
  ignored_folder: (name) =>
    name.split('/').includes('.git')
      ? `"${name}" is inside .git, which BugPilot never reads, at any setting.`
      : `"${name}" is inside a generated or vendored folder (for example node_modules or dist), which BugPilot skips by default. Tick "Include generated and vendored files" to check it too.`,
  empty_entry: (name) => `"${name}" has no content to read.`,
  directory_entry: () => 'Folder entries are not read as files.',
  special_entry: (name, extra) =>
    `"${name}" is a ${extra ?? 'special entry'}, not an ordinary file. BugPilot never follows links, creates devices or reads archive volume records, so it skipped this entry and kept going.`,
  source_set_aside: (name, extra) =>
    `"${name}" was left out of this run${extra ? `: ${extra}` : ''}. BugPilot checked the uploads you added one by one, so an upload it cannot trust does not stop the others; nothing from "${name}" was read or kept.`,
  notebook_unreadable: (name, extra) =>
    `"${name}" is a notebook BugPilot could not read${extra ? `: ${extra}` : ''}. The notebook was skipped and the other files were still checked; nothing from it was kept.`,
  generated_file: (name, extra) =>
    `"${name}" looks generated or vendored${extra ? ` (${extra})` : ''}, so BugPilot skipped it. Tick "Include generated and vendored files" to check it too; the same size limits apply.`,
  not_reached: (name, extra) =>
    `"${name}" was not reached${extra ? `: ${extra}` : ''}. The report covers only the files BugPilot actually read.`,
}

/**
 * Build the message. The template needs the offending number or name so a refusal is actionable
 * rather than "archive rejected".
 */
export function archiveReasonMessage(code: ArchiveReasonCode, subject: string | number = '', extra?: string): string {
  return PLAIN_MESSAGES[code](String(subject), extra)
}

/**
 * The reason a read stopped while keeping what it had. A refusal message must not be reused here:
 * it says nothing was kept, and a partial report says the opposite.
 */
const PARTIAL_MESSAGES: Partial<Record<ArchiveReasonCode, PlainMessage>> = {
  wall_clock_exceeded: (n) =>
    `BugPilot reached its ${n} second reading limit. The files and findings read before that point are kept and clearly marked as a partial result.`,
  total_uncompressed_exceeded: (n) =>
    `BugPilot reached its ${n} byte unpacking budget. The files and findings read before that point are kept and clearly marked as a partial result.`,
  analysable_budget_exceeded: (n) =>
    `The files to analyse add up to more than ${n} bytes, the analysis budget for this upload. BugPilot kept the files that still fitted inside it and marks the rest as not reached, so this report is a partial result.`,
  cancelled: () =>
    'You cancelled the upload. The files and findings read before you cancelled are kept and clearly marked as a partial result.',
}

export function partialReasonMessage(code: ArchiveReasonCode, subject: string | number = '', extra?: string): string {
  const template = PARTIAL_MESSAGES[code]
  return template ? template(String(subject), extra) : archiveReasonMessage(code, subject, extra)
}
