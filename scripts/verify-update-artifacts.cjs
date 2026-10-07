const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const yaml = require('js-yaml')
const { version, build } = require('../package.json')

const artifactDirectory = path.resolve(__dirname, '../dist/app')
const metadata = yaml.load(fs.readFileSync(path.join(artifactDirectory, 'latest-mac.yml'), 'utf8'))
if (metadata.version !== version || !Array.isArray(metadata.files) || metadata.files.length === 0) {
  throw new Error('Release version or update file list does not match the application.')
}
const legacyEntry = metadata.files.find(entry => entry.url === metadata.path)
if (!legacyEntry || legacyEntry.sha512 !== metadata.sha512) throw new Error('Legacy update metadata does not match its file entry.')
for (const target of build.mac.target) {
  const extension = typeof target === 'string' ? target : target.target
  if (['zip', 'dmg'].includes(extension) && !metadata.files.some(entry => entry.url.endsWith(`.${extension}`))) {
    throw new Error(`Expected macOS update artifact is missing: ${extension}`)
  }
}

for (const entry of metadata.files) {
  const fileName = decodeURIComponent(entry.url)
  if (path.basename(fileName) !== fileName) throw new Error('Update artifact path must be a local file name.')
  const filePath = path.join(artifactDirectory, fileName)
  const contents = fs.readFileSync(filePath)
  const checksum = crypto.createHash('sha512').update(contents).digest('base64')
  if (entry.sha512 !== checksum || (entry.size !== undefined && entry.size !== contents.length)) {
    throw new Error(`Update artifact checksum or size mismatch: ${fileName}`)
  }
  console.log(`Verified ${fileName} (${contents.length} bytes)`)
}
