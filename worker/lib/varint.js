export function writeVarInt (value) {
  const bytes = []
  while (true) {
    if ((value & ~0x7F) === 0) {
      bytes.push(value)
      break
    }
    bytes.push((value & 0x7F) | 0x80)
    value >>>= 7
  }
  return new Uint8Array(bytes)
}

export function readVarInt (buffer, offset = 0) {
  let numRead = 0
  let result = 0
  let read

  do {
    read = buffer[offset + numRead]
    const value = read & 0x7F
    result |= value << (7 * numRead)
    numRead++
    if (numRead > 5) {
      throw new Error('VarInt is too big')
    }
  } while ((read & 0x80) !== 0)

  return { value: result, bytesRead: numRead }
}

export function concatBytes (...parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}
