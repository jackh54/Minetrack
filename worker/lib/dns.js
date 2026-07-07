import config from '../../config.json'
import { TimeTracker } from './time.js'

const SKIP_SRV_TIMEOUT = config.skipSrvTimeout || 60 * 60 * 1000
const MIN_CONNECT_TIMEOUT = 2000
const MAX_DNS_BUDGET = Math.max(config.rates.connectTimeout - MIN_CONNECT_TIMEOUT, 500)

export class DNSResolver {
  constructor (ip, port) {
    this._ip = ip
    this._port = port
    this._skipSrvUntil = undefined
  }

  _skipSrv () {
    this._skipSrvUntil = TimeTracker.getEpochMillis() + SKIP_SRV_TIMEOUT
  }

  _isSkipSrv () {
    return this._skipSrvUntil && TimeTracker.getEpochMillis() <= this._skipSrvUntil
  }

  _remainingConnectTimeout (startTime) {
    const elapsed = TimeTracker.getEpochMillis() - startTime
    const dnsBudgetUsed = Math.min(elapsed, MAX_DNS_BUDGET)
    return Math.max(config.rates.connectTimeout - dnsBudgetUsed, MIN_CONNECT_TIMEOUT)
  }

  _noSrvResult (startTime) {
    return {
      configuredHost: this._ip,
      configuredPort: this._port,
      srvHost: undefined,
      srvPort: undefined,
      remainingTimeout: this._remainingConnectTimeout(startTime)
    }
  }

  async resolve () {
    const startTime = TimeTracker.getEpochMillis()

    if (this._isSkipSrv()) {
      return {
        configuredHost: this._ip,
        configuredPort: this._port,
        srvHost: undefined,
        srvPort: undefined,
        remainingTimeout: config.rates.connectTimeout
      }
    }

    try {
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent('_minecraft._tcp.' + this._ip)}&type=SRV`,
        { headers: { Accept: 'application/dns-json' } }
      )

      if (!response.ok) {
        throw new Error('DNS query failed')
      }

      const data = await response.json()
      const answers = data.Answer || []

      if (answers.length === 0) {
        const isSkipSrvTimeoutDisabled = typeof config.skipSrvTimeout === 'number' && config.skipSrvTimeout === 0

        if (!this._isSkipSrv() && !isSkipSrvTimeoutDisabled) {
          this._skipSrv()
        }

        return this._noSrvResult(startTime)
      }

      const srvRecord = answers.find((answer) => answer.type === 33) || answers[0]
      const parts = srvRecord.data.split(' ')
      const port = parseInt(parts[2], 10)
      const host = parts[3].replace(/\.$/, '')

      return {
        configuredHost: this._ip,
        configuredPort: this._port,
        srvHost: host,
        srvPort: port,
        remainingTimeout: this._remainingConnectTimeout(startTime)
      }
    } catch {
      return this._noSrvResult(startTime)
    }
  }
}
