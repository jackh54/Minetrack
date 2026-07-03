import config from '../../config.json'
import { TimeTracker } from './time.js'

export class Database {
  constructor (db) {
    this._db = db
  }

  async ensureIndexes () {
    await this._db.batch([
      this._db.prepare('CREATE TABLE IF NOT EXISTS pings (timestamp INTEGER NOT NULL, ip TEXT, playerCount INTEGER)'),
      this._db.prepare('CREATE TABLE IF NOT EXISTS players_record (timestamp INTEGER, ip TEXT NOT NULL PRIMARY KEY, playerCount INTEGER)'),
      this._db.prepare('CREATE INDEX IF NOT EXISTS ip_index ON pings (ip, playerCount)'),
      this._db.prepare('CREATE INDEX IF NOT EXISTS timestamp_index ON pings (timestamp)')
    ])
  }

  async loadGraphPoints (app, graphDuration) {
    const endTime = TimeTracker.getEpochMillis()
    const startTime = endTime - graphDuration
    const pingData = await this.getRecentPings(startTime, endTime)
    const relativeGraphData = {}

    for (const row of pingData) {
      let graphData = relativeGraphData[row.ip]
      if (!graphData) {
        relativeGraphData[row.ip] = graphData = [[], []]
      }

      graphData[0].push(row.timestamp)
      graphData[1].push(row.playerCount)
    }

    for (const serverRegistration of app.serverRegistrations) {
      const graphData = relativeGraphData[serverRegistration.data.ip]
      if (graphData) {
        serverRegistration.loadGraphPoints(startTime, graphData[0], graphData[1])
      }
    }

    const serverIps = Object.keys(relativeGraphData)
    if (serverIps.length > 0) {
      const timestamps = relativeGraphData[serverIps[0]][0]
      app.timeTracker.loadGraphPoints(startTime, timestamps)
    }
  }

  async loadRecords (app) {
    await Promise.all(app.serverRegistrations.map(async (serverRegistration) => {
      serverRegistration.findNewGraphPeak()

      const record = await this.getRecord(serverRegistration.data.ip)
      if (record) {
        serverRegistration.recordData = {
          playerCount: record.playerCount,
          timestamp: TimeTracker.toSeconds(record.timestamp)
        }
        return
      }

      const legacyRecord = await this.getRecordLegacy(serverRegistration.data.ip)
      const newTimestamp = legacyRecord?.timestamp ?? null
      const newPlayerCount = legacyRecord?.playerCount ?? null

      serverRegistration.recordData = {
        playerCount: newPlayerCount,
        timestamp: TimeTracker.toSeconds(newTimestamp)
      }

      await this._db.prepare(
        'INSERT INTO players_record (timestamp, ip, playerCount) VALUES (?, ?, ?)'
      ).bind(newTimestamp, serverRegistration.data.ip, newPlayerCount).run()
    }))
  }

  async getRecentPings (startTime, endTime) {
    const result = await this._db.prepare(
      'SELECT * FROM pings WHERE timestamp >= ? AND timestamp <= ?'
    ).bind(startTime, endTime).all()

    return result.results || []
  }

  async getRecord (ip) {
    const result = await this._db.prepare(
      'SELECT playerCount, timestamp FROM players_record WHERE ip = ?'
    ).bind(ip).all()

    if (!result.results?.length) {
      return null
    }

    return result.results[0]
  }

  async getRecordLegacy (ip) {
    const result = await this._db.prepare(
      'SELECT MAX(playerCount) AS playerCount, timestamp FROM pings WHERE ip = ?'
    ).bind(ip).all()

    if (!result.results?.length) {
      return null
    }

    const row = result.results[0]
    if (row.playerCount === null) {
      return null
    }

    return row
  }

  async insertPing (ip, timestamp, unsafePlayerCount) {
    await this._db.prepare(
      'INSERT INTO pings (timestamp, ip, playerCount) VALUES (?, ?, ?)'
    ).bind(timestamp, ip, unsafePlayerCount).run()
  }

  async updatePlayerCountRecord (ip, playerCount, timestamp) {
    await this._db.prepare(
      'UPDATE players_record SET timestamp = ?, playerCount = ? WHERE ip = ?'
    ).bind(timestamp, playerCount, ip).run()
  }

  async deleteOldPings () {
    const oldestTimestamp = TimeTracker.getEpochMillis() - config.graphDuration

    await this._db.prepare(
      'DELETE FROM pings WHERE timestamp < ?'
    ).bind(oldestTimestamp).run()
  }
}
