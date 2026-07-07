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

  async resolve () {
    if (this._isSkipSrv()) {
      return {
        host: this._ip,
        port: this._port,
        remainingTimeout: config.rates.connectTimeout
      }
    }

    const startTime = TimeTracker.getEpochMillis()

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

        return {
          host: this._ip,
          port: this._port,
          remainingTimeout: this._remainingConnectTimeout(startTime)
        }
      }

      const srvRecord = answers.find((answer) => answer.type === 33) || answers[0]
      const parts = srvRecord.data.split(' ')
      const port = parseInt(parts[2], 10)
      const host = parts[3].replace(/\.$/, '')

      return {
        host,
        port,
        remainingTimeout: this._remainingConnectTimeout(startTime)
      }
    } catch {
      return {
        host: this._ip,
        port: this._port,
        remainingTimeout: this._remainingConnectTimeout(startTime)
      }
    }
  }
}
