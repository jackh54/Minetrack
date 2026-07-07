// Cloudflare IP ranges from https://www.cloudflare.com/ips-v4
const CLOUDFLARE_IPV4_RANGES = [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22]
]

function ipToInt (ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0)
}

export function isCloudflareIPv4 (ip) {
  const value = ipToInt(ip)

  for (const [base, bits] of CLOUDFLARE_IPV4_RANGES) {
    const mask = ~((1 << (32 - bits)) - 1) >>> 0

    if ((value & mask) === (ipToInt(base) & mask)) {
      return true
    }
  }

  return false
}

export function isCloudflareProxiedAddress (ips) {
  return ips.length > 0 && ips.every(isCloudflareIPv4)
}
