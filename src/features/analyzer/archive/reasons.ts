/**
 * Every way the archive reader can stop or skip, with the message the user sees.
 * Fatal codes abort the whole archive; skip codes drop one entry and keep going.
 */
export const ARCHIVE_REFUSAL_CODES = [
  'archive_too_large',
  'entry_count_exceeded',
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
  'zip64_not_supported',
  'corrupt_central_directory',
  'corrupt_local_header',
  'corrupt_deflate_stream',
  'crc_mismatch',
  'unsupported_compression',
  'data_descriptor_not_supported',
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
    'This does not look like a .zip archive: the end-of-directory record is missing. BugPilot only reads .zip files.',
  zip64_not_supported: () =>
    'This archive uses the ZIP64 format, which this reader does not support. Nothing was unpacked.',
  corrupt_central_directory: () =>
    'The archive index is damaged or points outside the file, so BugPilot stopped reading.',
  corrupt_local_header: (name) =>
    `The local header for "${name}" does not match the archive index, so the archive is refused.`,
  corrupt_deflate_stream: (name) =>
    `The compressed data for "${name}" is damaged or was cut off, so reading stopped.`,
  crc_mismatch: (name) =>
    `The contents of "${name}" do not match the checksum stored in the archive, so the archive is refused.`,
  unsupported_compression: (name, extra) =>
    `The entry "${name}" uses compression method ${extra ?? 'unknown'}, which BugPilot cannot unpack.`,
  data_descriptor_not_supported: (name) =>
    `The entry "${name}" stores its sizes after its data instead of in the header, so BugPilot cannot know how much to unpack and refuses the archive.`,
  null_byte_in_name: (name) =>
    `A file name inside the archive is cut short by a NUL byte ("${name}"), which is how path-traversal tricks hide a second name. The archive is refused.`,
  cancelled: () => 'You cancelled the upload, so nothing was read.',
  worker_error: () => 'The file reader stopped with an unexpected error. Nothing was stored.',
  single_file_too_large: (name) =>
    `"${name}" is bigger than the per-file ceiling, so BugPilot skipped this file and kept going with the rest.`,
  binary_content: (name) =>
    `"${name}" is a binary file, not text, so there is nothing for BugPilot to read.`,
  ignored_folder: (name) =>
    `"${name}" is inside a generated or vendored folder (for example node_modules or dist), which BugPilot skips by default.`,
  empty_entry: (name) => `"${name}" has no content to read.`,
  directory_entry: () => 'Folder entries are not read as files.',
}

/**
 * Build the message. The template needs the offending number or name so a refusal is actionable
 * rather than "archive rejected".
 */
export function archiveReasonMessage(code: ArchiveReasonCode, subject: string | number = '', extra?: string): string {
  return PLAIN_MESSAGES[code](String(subject), extra)
}
