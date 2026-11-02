const POLYNOMIAL = 0xedb88320

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? POLYNOMIAL ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/**
 * fflate 0.8 dropped its CRC helper, so the checksum the ZIP trailer is verified against is
 * computed here. `seed` is the running value so callers can fold chunks without copying.
 */
export function crc32(data: Uint8Array, seed = 0xffffffff): number {
  let crc = seed >>> 0
  for (let i = 0; i < data.length; i += 1) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return crc
}

/** Finalise the running value into the number stored in an archive header. */
export function crc32Finish(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0
}
