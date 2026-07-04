export class SocketManager {
  constructor (app) {
    this._app = app
    this._reconnectDelayBase = 0
  }

  createWebSocket () {
    let webSocketProtocol = 'ws:'
    if (location.protocol === 'https:') {
      webSocketProtocol = 'wss:'
    }

    this._webSocket = new WebSocket(`${webSocketProtocol}//${location.host}`)

    this._webSocket.onopen = () => {
      this._app.caption.set('Loading...')
      this._reconnectDelayBase = 0
    }

    this._webSocket.onclose = (event) => {
      this._app.handleDisconnect()

      if (event.code === 1006) {
        this._app.caption.set('Lost connection!')
      } else {
        this._app.caption.set('Disconnected due to error.')
      }

      this.scheduleReconnect()
    }

    this._webSocket.onmessage = (message) => {
      const payload = JSON.parse(message.data)

      switch (payload.message) {
        case 'init':
          this._app.setPublicConfig(payload.config)
          this._app.setPageReady(true)

          payload.servers.forEach((serverPayload, serverId) => {
            this._app.addServer(serverId, serverPayload, payload.timestampPoints)
          })

          this._app.handleSyncComplete()
          break

        case 'updateServers': {
          for (let serverId = 0; serverId < payload.updates.length; serverId++) {
            const serverRegistration = this._app.serverRegistry.getServerRegistration(serverId)
            const serverUpdate = payload.updates[serverId]

            if (serverRegistration) {
              serverRegistration.handlePing(serverUpdate, payload.timestamp)
              serverRegistration.updateServerStatus(serverUpdate, this._app.publicConfig.minecraftVersions)
            }
          }

          this._app.percentageBar.redraw()
          this._app.updateGlobalStats()
          break
        }
      }
    }
  }

  scheduleReconnect () {
    this._webSocket = undefined

    this._reconnectDelayBase++

    this._reconnectDelaySeconds = Math.min((this._reconnectDelayBase * this._reconnectDelayBase), 30)

    const reconnectInterval = setInterval(() => {
      this._reconnectDelaySeconds--

      if (this._reconnectDelaySeconds === 0) {
        clearInterval(reconnectInterval)
        this._app.caption.set('Reconnecting...')
        this.createWebSocket()
      } else if (this._reconnectDelaySeconds > 0) {
        this._app.caption.set(`Reconnecting in ${this._reconnectDelaySeconds}s...`)
      }
    }, 1000)
  }
}
