const MAX_PLAYER_COUNT = 250000

function capPlayerCount (host, playerCount) {
  if (playerCount !== Math.min(playerCount, MAX_PLAYER_COUNT)) {
    return MAX_PLAYER_COUNT
  }

  if (playerCount !== Math.max(playerCount, 0)) {
    return 0
  }

  return playerCount
}

const MCSRVSTAT_API = 'https://api.mcsrvstat.us/3'

export async function pingJavaServerViaHttp (hostname) {
  const response = await fetch(`${MCSRVSTAT_API}/${encodeURIComponent(hostname)}`, {
    headers: {
      'User-Agent': 'Minetrack/5.6.1 (https://github.com/Cryptkeeper/Minetrack)'
    }
  })

  if (!response.ok) {
    throw new Error('HTTP status lookup failed')
  }

  const data = await response.json()

  if (!data.online) {
    throw new Error('Server offline')
  }

  const payload = {
    players: {
      online: capPlayerCount(hostname, parseInt(data.players?.online, 10) || 0)
    }
  }

  if (data.protocol?.version > 0) {
    payload.version = data.protocol.version
  }

  if (data.version) {
    payload.versionName = data.version
  }

  if (data.icon && data.icon.startsWith('data:image/')) {
    payload.favicon = data.icon
  }

  return payload
}
