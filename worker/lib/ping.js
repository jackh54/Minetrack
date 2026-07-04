import { connect } from 'cloudflare:sockets'
import { concatBytes, readVarInt, writeVarInt } from './varint.js'

const MAX_PLAYER_COUNT = 250000

function writeString (value) {
  const encoded = new TextEncoder().encode(value)
  return concatBytes(writeVarInt(encoded.length), encoded)
}

function writeUInt16BE (value) {
  const bytes = new Uint8Array(2)
  bytes[0] = (value >> 8) & 0xFF
  bytes[1] = value & 0xFF
  return bytes
}

function createPacket (packetId, payload) {
  const packetIdBytes = writeVarInt(packetId)
  const packetData = concatBytes(packetIdBytes, payload)
  return concatBytes(writeVarInt(packetData.length), packetData)
}

async function readVarIntFromReader (reader, buffer) {
  let offset = 0

  while (true) {
    if (offset >= buffer.length) {
      const { value, done } = await reader.read()
      if (done) {
        throw new Error('Socket closed before response was received')
      }

      const next = new Uint8Array(buffer.length + value.length)
      next.set(buffer)
      next.set(value, buffer.length)
      buffer = next
    }

    try {
      const result = readVarInt(buffer, offset)
      return {
        value: result.value,
        bytesRead: result.bytesRead,
        buffer
      }
    } catch {
      offset = buffer.length
    }
  }
}

async function readPacket (reader) {
  let buffer = new Uint8Array(0)

  const packetLengthInfo = await readVarIntFromReader(reader, buffer)
  buffer = packetLengthInfo.buffer
  const packetLength = packetLengthInfo.value
  const packetLengthBytes = packetLengthInfo.bytesRead

  while (buffer.length < packetLengthBytes + packetLength) {
    const { value, done } = await reader.read()
    if (done) {
      throw new Error('Socket closed before response was received')
    }

    const next = new Uint8Array(buffer.length + value.length)
    next.set(buffer)
    next.set(value, buffer.length)
    buffer = next
  }

  const packetStart = packetLengthBytes
  const packetIdInfo = readVarInt(buffer, packetStart)
  const dataOffset = packetStart + packetIdInfo.bytesRead

  return {
    packetId: packetIdInfo.value,
    data: buffer.subarray(dataOffset, packetStart + packetLength)
  }
}

function parseStatusResponse (data) {
  const jsonLengthInfo = readVarInt(data, 0)
  const jsonText = new TextDecoder().decode(
    data.subarray(jsonLengthInfo.bytesRead, jsonLengthInfo.bytesRead + jsonLengthInfo.value)
  )

  return JSON.parse(jsonText)
}

export function capPlayerCount (host, playerCount) {
  if (playerCount !== Math.min(playerCount, MAX_PLAYER_COUNT)) {
    return MAX_PLAYER_COUNT
  }

  if (playerCount !== Math.max(playerCount, 0)) {
    return 0
  }

  return playerCount
}

export async function pingJavaServer (host, port, protocolVersion, timeoutMs) {
  const socket = connect({ hostname: host, port: port || 25565 })
  const writer = socket.writable.getWriter()
  const reader = socket.readable.getReader()

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Ping timed out')), timeoutMs)
  })

  try {
    return await Promise.race([
      (async () => {
        const handshakePayload = concatBytes(
          writeVarInt(protocolVersion),
          writeString(host),
          writeUInt16BE(port || 25565),
          writeVarInt(1)
        )

        await writer.write(createPacket(0x00, handshakePayload))
        await writer.write(createPacket(0x00, new Uint8Array(0)))

        const packet = await readPacket(reader)
        if (packet.packetId !== 0x00) {
          throw new Error('Unexpected status response packet')
        }

        const status = parseStatusResponse(packet.data)
        const payload = {
          players: {
            online: capPlayerCount(host, parseInt(status.players.online, 10))
          },
          version: parseInt(status.version.protocol, 10)
        }

        if (status.favicon && status.favicon.startsWith('data:image/')) {
          payload.favicon = status.favicon
        }

        return payload
      })(),
      timeout
    ])
  } finally {
    try {
      await writer.close()
    } catch {
      // Ignore close errors.
    }

    try {
      await reader.cancel()
    } catch {
      // Ignore cancel errors.
    }

    socket.close()
  }
}

export async function pingServer (serverRegistration, timeout, protocolVersion) {
  switch (serverRegistration.data.type) {
    case 'PC': {
      const resolved = await serverRegistration.dnsResolver.resolve()
      const remainingTimeout = Math.max(resolved.remainingTimeout, 500)

      return pingJavaServer(
        resolved.host,
        resolved.port,
        protocolVersion,
        remainingTimeout
      )
    }

    case 'PE':
      throw new Error('Bedrock servers are not supported on Cloudflare Workers')

    default:
      throw new Error('Unsupported type: ' + serverRegistration.data.type)
  }
}
