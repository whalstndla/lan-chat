// electron/crypto/keyManager.js
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

function loadOrCreateKeyPair(storagePath) {
  const privateKeyPath = path.join(storagePath, 'private_key.pem')
  const publicKeyPath = path.join(storagePath, 'public_key.pem')

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8')
    const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf-8')
    const privateKey = crypto.createPrivateKey(privateKeyPem)
    const publicKey = crypto.createPublicKey(publicKeyPem)
    return { privateKey, publicKey }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })

  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))

  return { privateKey, publicKey }
}

function exportPublicKey(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

function importPublicKey(base64String) {
  const derBuffer = Buffer.from(base64String, 'base64')
  return crypto.createPublicKey({ key: derBuffer, type: 'spki', format: 'der' })
}

module.exports = { loadOrCreateKeyPair, exportPublicKey, importPublicKey }
