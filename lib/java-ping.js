const net = require('net')

function writeVarInt (value) {
  const buf = Buffer.alloc(5)
  let written = 0

  while (true) {
    if ((value & 0xFFFFFF80) === 0) {
      buf.writeUInt8(value, written++)
      break
    } else {
      buf.writeUInt8(value & 0x7F | 0x80, written++)
      value >>>= 7
    }
  }

  return buf.slice(0, written)
}

function writeString (value) {
  const encoded = Buffer.from(value, 'utf8')
  return Buffer.concat([writeVarInt(encoded.length), encoded])
}

function writeUInt16BE (value) {
  const buf = Buffer.alloc(2)
  buf.writeUInt16BE(value)
  return buf
}

function createPacket (packetId, payload) {
  const packetIdBytes = writeVarInt(packetId)
  const packetData = Buffer.concat([packetIdBytes, payload])
  return Buffer.concat([writeVarInt(packetData.length), packetData])
}

function readVarInt (buffer, offset = 0) {
  let numRead = 0
  let result = 0
  let read

  do {
    read = buffer[offset + numRead]
    result |= (read & 0x7F) << (7 * numRead)
    numRead++
    if (numRead > 5) {
      throw new Error('VarInt is too big')
    }
  } while ((read & 0x80) !== 0)

  return { value: result, bytesRead: numRead }
}

function pingJavaWithHandshake (connectHost, connectPort, handshakeHost, handshakePort, timeout, protocolVersion) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: connectHost,
      port: connectPort || 25565
    })

    const timeoutTask = setTimeout(() => {
      socket.destroy()
      reject(new Error('Socket timeout'))
    }, timeout)

    const closeSocket = () => {
      socket.destroy()
      clearTimeout(timeoutTask)
    }

    socket.setNoDelay(true)

    socket.on('connect', () => {
      const handshakePayload = Buffer.concat([
        writeVarInt(protocolVersion),
        writeString(handshakeHost),
        writeUInt16BE(handshakePort || 25565),
        writeVarInt(1)
      ])

      socket.write(createPacket(0x00, handshakePayload))
      socket.write(createPacket(0x00, Buffer.alloc(0)))
    })

    let incomingBuffer = Buffer.alloc(0)

    socket.on('data', (data) => {
      incomingBuffer = Buffer.concat([incomingBuffer, data])

      if (incomingBuffer.length < 5) {
        return
      }

      let offset = 0

      try {
        const packetLengthInfo = readVarInt(incomingBuffer, offset)
        offset += packetLengthInfo.bytesRead

        if (incomingBuffer.length - offset < packetLengthInfo.value) {
          return
        }

        const packetIdInfo = readVarInt(incomingBuffer, offset)
        offset += packetIdInfo.bytesRead

        if (packetIdInfo.value !== 0) {
          closeSocket()
          reject(new Error('Received unexpected packet'))
          return
        }

        const jsonLengthInfo = readVarInt(incomingBuffer, offset)
        const jsonText = incomingBuffer.subarray(
          offset + jsonLengthInfo.bytesRead,
          offset + jsonLengthInfo.bytesRead + jsonLengthInfo.value
        ).toString('utf8')

        closeSocket()
        resolve(JSON.parse(jsonText))
      } catch (err) {
        closeSocket()
        reject(err)
      }
    })

    socket.on('error', (err) => {
      closeSocket()
      reject(err)
    })
  })
}

module.exports = {
  pingJavaWithHandshake
}
