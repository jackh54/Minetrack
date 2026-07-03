import config from '../../config.json'

export const GRAPH_UPDATE_TIME_GAP = 60 * 1000

export class TimeTracker {
  constructor () {
    this._serverGraphPoints = []
    this._graphPoints = []
    this._lastHistoryGraphUpdate = undefined
  }

  newPointTimestamp () {
    const timestamp = TimeTracker.getEpochMillis()

    TimeTracker.pushAndShift(this._serverGraphPoints, timestamp, TimeTracker.getMaxServerGraphDataLength())

    const updateHistoryGraph = config.logToDatabase && (!this._lastHistoryGraphUpdate || timestamp - this._lastHistoryGraphUpdate >= GRAPH_UPDATE_TIME_GAP)

    if (updateHistoryGraph) {
      this._lastHistoryGraphUpdate = timestamp
      TimeTracker.pushAndShift(this._graphPoints, timestamp, TimeTracker.getMaxGraphDataLength())
    }

    return {
      timestamp,
      updateHistoryGraph
    }
  }

  loadGraphPoints (startTime, timestamps) {
    this._graphPoints = TimeTracker.everyN(timestamps, startTime, GRAPH_UPDATE_TIME_GAP, (i) => timestamps[i])
  }

  getGraphPointAt (i) {
    return TimeTracker.toSeconds(this._graphPoints[i])
  }

  getServerGraphPoints () {
    return this._serverGraphPoints.map(TimeTracker.toSeconds)
  }

  getGraphPoints () {
    return this._graphPoints.map(TimeTracker.toSeconds)
  }

  static toSeconds (timestamp) {
    return Math.floor(timestamp / 1000)
  }

  static getEpochMillis () {
    return Date.now()
  }

  static getMaxServerGraphDataLength () {
    return Math.ceil(config.serverGraphDuration / config.rates.pingAll)
  }

  static getMaxGraphDataLength () {
    return Math.ceil(config.graphDuration / GRAPH_UPDATE_TIME_GAP)
  }

  static everyN (array, start, diff, adapter) {
    const selected = []
    let lastPoint = start

    for (let i = 0; i < array.length; i++) {
      const point = array[i]

      if (point - lastPoint >= diff) {
        lastPoint = point
        selected.push(adapter(i))
      }
    }

    return selected
  }

  static pushAndShift (array, value, maxLength) {
    array.push(value)

    if (array.length > maxLength) {
      array.splice(0, array.length - maxLength)
    }
  }
}
