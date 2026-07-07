import { createHash } from 'node:crypto'
import config from '../../config.json'
import { DNSResolver } from './dns.js'
import { GRAPH_UPDATE_TIME_GAP, TimeTracker } from './time.js'
import minecraftVersions from '../../minecraft_versions.json'

const HASHED_FAVICON_PREFIX = '/hashedfavicon_'

export function getHashedFaviconUrl (hash) {
  return `${HASHED_FAVICON_PREFIX}${hash}.png`
}

function md5Hex (value) {
  return createHash('md5').update(value).digest('hex')
}

export class ServerRegistration {
  constructor (app, serverId, data) {
    this._app = app
    this.serverId = serverId
    this.data = data
    this._pingHistory = []
    this.dnsResolver = new DNSResolver(this.data.ip, this.data.port)
    this.versions = []
    this.recordData = undefined
    this.graphData = []
    this.lastFavicon = undefined
    this.faviconHash = undefined
    this._graphPeakIndex = undefined
    this.versionName = undefined
  }

  handlePing (timestamp, resp, err, version, updateHistoryGraph) {
    const unsafePlayerCount = resp?.players?.online ?? null

    TimeTracker.pushAndShift(this._pingHistory, unsafePlayerCount, TimeTracker.getMaxServerGraphDataLength())

    if (updateHistoryGraph) {
      TimeTracker.pushAndShift(this.graphData, unsafePlayerCount, TimeTracker.getMaxGraphDataLength())
    }

    return this.getUpdate(timestamp, resp, err, version)
  }

  getUpdate (timestamp, resp, err, version) {
    const update = {}
    update.playerCount = resp?.players?.online ?? null

    if (resp) {
      if (resp.version && this.updateProtocolVersionCompat(resp.version, resp.versionName)) {
        update.versions = this.versions
        if (this.versionName) {
          update.versionName = this.versionName
        }
      }

      if (config.logToDatabase && (!this.recordData || resp.players.online > this.recordData.playerCount)) {
        this.recordData = {
          playerCount: resp.players.online,
          timestamp: TimeTracker.toSeconds(timestamp)
        }

        update.recordData = this.recordData
        this._app.database?.updatePlayerCountRecord(this.data.ip, resp.players.online, timestamp)
      }

      if (this.updateFavicon(resp.favicon)) {
        update.favicon = this.getFaviconUrl()
      }

      if (config.logToDatabase && this.findNewGraphPeak()) {
        update.graphPeakData = this.getGraphPeak()
      }
    } else if (err) {
      update.error = this.filterError(err)
    }

    return update
  }

  getPingHistory () {
    if (this._pingHistory.length > 0) {
      const payload = {
        versions: this.versions,
        recordData: this.recordData,
        favicon: this.getFaviconUrl()
      }

      if (this.versionName) {
        payload.versionName = this.versionName
      }

      const graphPeakData = this.getGraphPeak()
      if (graphPeakData) {
        payload.graphPeakData = graphPeakData
      }

      payload.playerCount = this._pingHistory[this._pingHistory.length - 1]
      payload.playerCountHistory = this._pingHistory

      return payload
    }

    return {
      error: {
        message: 'Pinging...'
      },
      recordData: this.recordData,
      graphPeakData: this.getGraphPeak(),
      favicon: this.data.favicon
    }
  }

  loadGraphPoints (startTime, timestamps, points) {
    this.graphData = TimeTracker.everyN(timestamps, startTime, GRAPH_UPDATE_TIME_GAP, (i) => points[i])
  }

  findNewGraphPeak () {
    let index = -1

    for (let i = 0; i < this.graphData.length; i++) {
      const point = this.graphData[i]
      if (point !== null && (index === -1 || point > this.graphData[index])) {
        index = i
      }
    }

    if (index >= 0) {
      const lastGraphPeakIndex = this._graphPeakIndex
      this._graphPeakIndex = index
      return index !== lastGraphPeakIndex
    }

    this._graphPeakIndex = undefined
    return false
  }

  getGraphPeak () {
    if (this._graphPeakIndex === undefined) {
      return undefined
    }

    return {
      playerCount: this.graphData[this._graphPeakIndex],
      timestamp: this._app.timeTracker.getGraphPointAt(this._graphPeakIndex)
    }
  }

  updateFavicon (favicon) {
    if (this.data.favicon) {
      return false
    }

    if (favicon && favicon !== this.lastFavicon) {
      this.lastFavicon = favicon
      this.faviconHash = undefined
      return true
    }

    return false
  }

  ensureFaviconHash () {
    if (!this.faviconHash && this.lastFavicon) {
      this.faviconHash = md5Hex(this.lastFavicon)
    }
  }

  getFaviconUrl () {
    if (this.faviconHash) {
      return getHashedFaviconUrl(this.faviconHash)
    }

    if (this.data.favicon) {
      return this.data.favicon
    }
  }

  findProtocolIndex (protocolId) {
    const protocolVersions = minecraftVersions[this.data.type]
    let bestIndex = -1

    for (let i = 0; i < protocolVersions.length; i++) {
      if (protocolVersions[i].protocolId === protocolId) {
        bestIndex = i
      }
    }

    return bestIndex
  }

  updateProtocolVersionCompat (reportedProtocolId, versionName) {
    const protocolIndex = this.findProtocolIndex(reportedProtocolId)

    if (protocolIndex >= 0) {
      if (this.versions.length === 1 && this.versions[0] === protocolIndex) {
        return false
      }

      this.versions = [protocolIndex]
      this.versionName = undefined
      return true
    }

    if (versionName && this.versionName !== versionName) {
      this.versions = []
      this.versionName = versionName
      return true
    }

    return false
  }

  getNextProtocolVersion () {
    if (this.data.type === 'PE') {
      return {
        protocolId: 0,
        protocolIndex: 0
      }
    }

    const protocolVersions = minecraftVersions[this.data.type]
    const latestIndex = protocolVersions.length - 1

    return {
      protocolId: protocolVersions[latestIndex].protocolId,
      protocolIndex: latestIndex
    }
  }

  filterError (err) {
    let message = 'Unknown error'

    for (const key of ['message', 'description', 'errno']) {
      if (err[key]) {
        message = err[key]
        break
      }
    }

    if (message.toLowerCase().includes('proxy request failed')) {
      message = 'Unreachable (CF proxy)'
    } else if (message.toLowerCase().includes('server behind cloudflare proxy')) {
      message = 'Unreachable (CF proxy)'
    }

    if (message.length > 28) {
      message = message.substring(0, 28) + '...'
    }

    return { message }
  }

  getPublicData () {
    return {
      name: this.data.name,
      ip: this.data.ip,
      type: this.data.type,
      color: this.data.color
    }
  }
}

export function assignServerColors (servers) {
  return servers.map((server) => {
    if (server.color) {
      return server
    }

    let hash = 0
    for (let i = server.name.length - 1; i >= 0; i--) {
      hash = server.name.charCodeAt(i) + ((hash << 5) - hash)
    }

    const color = Math.floor(Math.abs((Math.sin(hash) * 10000) % 1 * 16777216)).toString(16)
    return {
      ...server,
      color: '#' + Array(6 - color.length + 1).join('0') + color
    }
  })
}
