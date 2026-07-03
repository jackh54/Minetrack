import { MinetrackDO } from './minetrack-do.js'

export { MinetrackDO }

export default {
  async fetch (request, env) {
    const url = new URL(request.url)

    if (shouldRouteToDurableObject(request, url)) {
      const id = env.MINETRACK.idFromName('singleton')
      const stub = env.MINETRACK.get(id)
      return stub.fetch(request)
    }

    return env.ASSETS.fetch(request)
  }
}

function shouldRouteToDurableObject (request, url) {
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    return true
  }

  return /hashedfavicon_[a-f0-9]{32}\.png/i.test(url.pathname)
}
