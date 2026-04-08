const os = require('os')

function normalizeHostname(hostname) {
  if (typeof hostname !== 'string') return ''
  return hostname.trim().replace(/\.$/, '')
}

function extractIpv4FromMappedIpv6(address) {
  if (typeof address !== 'string') return null
  const match = address.trim().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  return match?.[1] || null
}

function isIpv4Address(address) {
  if (typeof address !== 'string') return false
  const octets = address.split('.')
  if (octets.length !== 4) return false
  return octets.every((octet) => {
    const number = Number(octet)
    return Number.isInteger(number) && number >= 0 && number <= 255
  })
}

function isLoopbackOrUnspecifiedIpv4(address) {
  return typeof address === 'string' && (address.startsWith('127.') || address === '0.0.0.0')
}

function isLinkLocalIpv4(address) {
  return typeof address === 'string' && address.startsWith('169.254.')
}

function isPrivateIpv4(address) {
  if (!isIpv4Address(address)) return false
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true
  const octets = address.split('.').map(Number)
  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
}

function normalizeAdvertisedAddresses(addressValue) {
  const rawAddresses = Array.isArray(addressValue)
    ? addressValue
    : typeof addressValue === 'string'
      ? addressValue.split(',')
      : []

  return [...new Set(
    rawAddresses
      .map(address => (typeof address === 'string' ? address.trim() : ''))
      .filter(address => isIpv4Address(address))
  )]
}

function scoreInterfaceAddress(interfaceName, address) {
  let score = 0
  const normalizedInterfaceName = String(interfaceName || '').toLowerCase()

  if (isPrivateIpv4(address)) score += 100
  if (normalizedInterfaceName === 'en0') score += 50
  if (/^(en|eth|wlan|wifi|wi-fi|wl)/.test(normalizedInterfaceName)) score += 30
  if (/^(bridge|br-|docker|veth|vbox|vmnet|utun|tun|tap|llw|awdl)/.test(normalizedInterfaceName)) score -= 80
  if (isLinkLocalIpv4(address)) score -= 120
  if (isLoopbackOrUnspecifiedIpv4(address)) score -= 200

  return score
}

function collectLocalIpv4Addresses(networkInterfaces = os.networkInterfaces()) {
  const addressEntries = []

  Object.entries(networkInterfaces || {}).forEach(([interfaceName, interfaces]) => {
    interfaces?.forEach((networkInterface) => {
      if (networkInterface?.family !== 'IPv4') return
      if (networkInterface.internal) return
      if (!isIpv4Address(networkInterface.address)) return

      addressEntries.push({
        interfaceName,
        address: networkInterface.address,
        score: scoreInterfaceAddress(interfaceName, networkInterface.address),
      })
    })
  })

  addressEntries.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.interfaceName.localeCompare(right.interfaceName)
  })

  return [...new Set(addressEntries.map(entry => entry.address))]
}

function selectPrimaryLocalIpv4(networkInterfaces = os.networkInterfaces()) {
  return collectLocalIpv4Addresses(networkInterfaces)[0] || 'localhost'
}

function buildPeerConnectHostCandidates(peerInfo) {
  const rawAddresses = Array.isArray(peerInfo?.addresses) ? peerInfo.addresses : []
  const advertisedAddresses = normalizeAdvertisedAddresses(peerInfo?.advertisedAddresses)
  const ipv4AddressesFromMdns = rawAddresses
    .map(address => (typeof address === 'string' ? address.trim() : ''))
    .filter(address => isIpv4Address(address))
  const mappedIpv4Addresses = rawAddresses
    .map(address => extractIpv4FromMappedIpv6(address))
    .filter(address => isIpv4Address(address))
  const refererIpv4 = isIpv4Address(peerInfo?.refererAddress) ? [peerInfo.refererAddress] : []
  const normalizedHost = normalizeHostname(peerInfo?.host)
  const hostIpv4 = isIpv4Address(normalizedHost) ? [normalizedHost] : []
  const allIpv4Addresses = [
    ...advertisedAddresses,
    ...ipv4AddressesFromMdns,
    ...mappedIpv4Addresses,
    ...refererIpv4,
    ...hostIpv4,
  ]

  const preferredIpv4Addresses = [...new Set(allIpv4Addresses)].filter(address =>
    !isLoopbackOrUnspecifiedIpv4(address) && !isLinkLocalIpv4(address)
  )
  const lowPriorityIpv4Addresses = [...new Set(allIpv4Addresses)].filter(address =>
    !preferredIpv4Addresses.includes(address)
  )

  const candidates = [
    ...preferredIpv4Addresses,
    ...(normalizedHost && !isIpv4Address(normalizedHost) ? [normalizedHost] : []),
    ...lowPriorityIpv4Addresses,
  ]

  return [...new Set(candidates)]
}

module.exports = {
  buildPeerConnectHostCandidates,
  collectLocalIpv4Addresses,
  normalizeAdvertisedAddresses,
  selectPrimaryLocalIpv4,
}
