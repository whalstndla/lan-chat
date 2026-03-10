// electron/crypto/keyManager.js
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

function 키쌍생성또는로드(저장폴더경로) {
  const 개인키경로 = path.join(저장폴더경로, 'private_key.pem')
  const 공개키경로 = path.join(저장폴더경로, 'public_key.pem')

  if (fs.existsSync(개인키경로) && fs.existsSync(공개키경로)) {
    const 개인키PEM = fs.readFileSync(개인키경로, 'utf-8')
    const 공개키PEM = fs.readFileSync(공개키경로, 'utf-8')
    const 개인키객체 = crypto.createPrivateKey(개인키PEM)
    const 공개키객체 = crypto.createPublicKey(공개키PEM)
    return { 개인키객체, 공개키객체 }
  }

  const { privateKey: 개인키객체, publicKey: 공개키객체 } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })

  fs.writeFileSync(개인키경로, 개인키객체.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  fs.writeFileSync(공개키경로, 공개키객체.export({ type: 'spki', format: 'pem' }))

  return { 개인키객체, 공개키객체 }
}

function 공개키내보내기(공개키객체) {
  return 공개키객체.export({ type: 'spki', format: 'der' }).toString('base64')
}

function 공개키가져오기(base64문자열) {
  const derBuffer = Buffer.from(base64문자열, 'base64')
  return crypto.createPublicKey({ key: derBuffer, type: 'spki', format: 'der' })
}

module.exports = { 키쌍생성또는로드, 공개키내보내기, 공개키가져오기 }
