import { isCloudflareProxiedAddress } from './cloudflare-ips.js'

async function resolveIPv4Addresses (hostname) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    { headers: { Accept: 'application/dns-json' } }
  )

  if (!response.ok) {
    throw new Error('DNS query failed')
  }

  const data = await response.json()
  const answers = data.Answer || []

  return answers
    .filter((answer) => answer.type === 1)
    .map((answer) => answer.data)
}

export async function resolveConnectTarget (configuredHost, configuredPort, srvHost, srvPort) {
  const connectPort = srvPort || configuredPort || 25565
  const candidates = []

  if (srvHost) {
    candidates.push(srvHost)
  }

  if (!candidates.includes(configuredHost)) {
    candidates.push(configuredHost)
  }

  let lastResolutionError

  for (const host of candidates) {
    try {
      const addresses = await resolveIPv4Addresses(host)

      if (addresses.length === 0) {
        continue
      }

      if (!isCloudflareProxiedAddress(addresses)) {
        return {
          connectHost: host,
          connectPort
        }
      }
    } catch (err) {
      lastResolutionError = err
    }
  }

  if (lastResolutionError) {
    throw lastResolutionError
  }

  throw new Error('Server behind Cloudflare proxy')
}
