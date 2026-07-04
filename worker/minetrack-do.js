import config from '../config.json'
import servers from '../servers.json'
import minecraftVersions from '../minecraft_versions.json'
import { Database } from './lib/database.js'
import { messageOf } from './lib/message.js'
import { pingServer } from './lib/ping.js'
import { assignServerColors, getHashedFaviconUrl, ServerRegistration } from './lib/servers.js'
import { TimeTracker } from './lib/time.js'

const HASHED_FAVICON_URL_REGEX = /hashedfavicon_([a-f0-9]{32})\.png/i

export class MinetrackDO {
  constructor (state, env) {
    this.state = state
    this.env = env
    this.serverRegistrations = []
    this.timeTracker = new TimeTracker()
    this.database = undefined
    this._ready = false
    this._readyPromise = undefined
    this._isRunningTasks = false
  }

  async fetch (request) {
    await this.ensureReady()

    const url = new URL(request.url)
    const faviconMatch = url.pathname.match(HASHED_FAVICON_URL_REGEX)

    if (faviconMatch) {
      return this.handleFaviconRequest(faviconMatch[1])
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    return new Response('Not found', { status: 404 })
  }

  async alarm () {
    await this.ensureReady()
    await this.pingAll()
    await this.scheduleNextPing()
  }

  async ensureReady () {
    if (this._ready) {
      return
    }

    if (!this._readyPromise) {
      this._readyPromise = this.initialize()
    }

    await this._readyPromise
  }

  async initialize () {
    const configuredServers = assignServerColors(servers)

    configuredServers.forEach((server, serverId) => {
      this.serverRegistrations.push(new ServerRegistration(this, serverId, server))
    })

    if (!config.serverGraphDuration) {
      config.serverGraphDuration = 3 * 60 * 10000
    }

    if (config.logToDatabase && this.env.DB) {
      this.database = new Database(this.env.DB)
      await this.database.ensureIndexes()
      await this.database.loadGraphPoints(this, config.graphDuration)
      await this.database.loadRecords(this)

      if (config.oldPingsCleanup?.enabled) {
        await this.database.deleteOldPings()
      }
    }

    for (const serverRegistration of this.serverRegistrations) {
      serverRegistration.ensureFaviconHash()
    }

    await this.scheduleNextPing()
    await this.pingAll()
    this._ready = true
  }

  async scheduleNextPing () {
    await this.state.storage.setAlarm(Date.now() + config.rates.pingAll)
  }

  async handleWebSocketUpgrade (request) {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server)
    server.serializeAttachment({ connectedAt: Date.now() })

    await this.handleClientConnection(server)

    return new Response(null, {
      status: 101,
      webSocket: client
    })
  }

  async handleClientConnection (client) {
    if (config.logToDatabase) {
      client.addEventListener('message', async (event) => {
        if (event.data === 'requestHistoryGraph') {
          const graphData = this.serverRegistrations.map((serverRegistration) => serverRegistration.graphData)

          this.send(client, messageOf('historyGraph', {
            timestamps: this.timeTracker.getGraphPoints(),
            graphData
          }))
        }
      })
    }

    const minecraftVersionNames = {}
    Object.keys(minecraftVersions).forEach((key) => {
      minecraftVersionNames[key] = minecraftVersions[key].map((version) => version.name)
    })

    for (const serverRegistration of this.serverRegistrations) {
      serverRegistration.ensureFaviconHash()
    }

    const initMessage = {
      config: {
        graphDurationLabel: config.graphDurationLabel || (Math.floor(config.graphDuration / (60 * 60 * 1000)) + 'h'),
        graphMaxLength: TimeTracker.getMaxGraphDataLength(),
        serverGraphMaxLength: TimeTracker.getMaxServerGraphDataLength(),
        servers: this.serverRegistrations.map((serverRegistration) => serverRegistration.getPublicData()),
        minecraftVersions: minecraftVersionNames,
        isGraphVisible: config.logToDatabase
      },
      timestampPoints: this.timeTracker.getServerGraphPoints(),
      servers: this.serverRegistrations.map((serverRegistration) => serverRegistration.getPingHistory())
    }

    this.send(client, messageOf('init', initMessage))
  }

  async handleFaviconRequest (faviconHash) {
    for (const serverRegistration of this.serverRegistrations) {
      serverRegistration.ensureFaviconHash()

      if (serverRegistration.faviconHash === faviconHash && serverRegistration.lastFavicon) {
        const base64 = serverRegistration.lastFavicon.split(',')[1]
        const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

        return new Response(binary, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=604800'
          }
        })
      }
    }

    return new Response('Not found', { status: 404 })
  }

  async pingAll () {
    if (this._isRunningTasks) {
      return
    }

    this._isRunningTasks = true

    try {
      const { timestamp, updateHistoryGraph } = this.timeTracker.newPointTimestamp()
      const results = await Promise.all(this.serverRegistrations.map(async (serverRegistration) => {
        const version = serverRegistration.getNextProtocolVersion()

        try {
          const resp = await pingServer(serverRegistration, config.rates.connectTimeout, version.protocolId)
          return { serverRegistration, resp, err: null, version }
        } catch (err) {
          return { serverRegistration, resp: null, err, version }
        }
      }))

      const updates = []

      for (const { serverRegistration, resp, err, version } of results) {
        if (config.logToDatabase && this.database) {
          const unsafePlayerCount = resp?.players?.online ?? null
          await this.database.insertPing(serverRegistration.data.ip, timestamp, unsafePlayerCount)
        }

        const update = serverRegistration.handlePing(timestamp, resp, err, version, updateHistoryGraph)

        if (update.favicon) {
          serverRegistration.ensureFaviconHash()
        }

        updates[serverRegistration.serverId] = update
      }

      this.broadcast(messageOf('updateServers', {
        timestamp: TimeTracker.toSeconds(timestamp),
        updateHistoryGraph,
        updates
      }))
    } finally {
      this._isRunningTasks = false
    }
  }

  send (client, payload) {
    try {
      client.send(payload)
    } catch {
      // Ignore send failures for closed sockets.
    }
  }

  broadcast (payload) {
    for (const client of this.state.getWebSockets()) {
      this.send(client, payload)
    }
  }

  webSocketClose () {
    // Hibernation API handles lifecycle; no cleanup required.
  }
}

export { getHashedFaviconUrl }
