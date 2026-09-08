// 두 개의 임시 프로필로 실제 Electron 렌더러·preload·IPC·암호화 DB·로컬 WS를 검증한다.
// 실행 전 npm run prerelease 로 Electron SQLite ABI를 준비해야 한다. 기존 사용자 데이터와 .env는 읽지 않는다.
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
const { setTimeout: delay } = require('node:timers/promises')

const projectDirectory = path.resolve(__dirname, '..')
const harnessPath = path.join(projectDirectory, 'tests/lanpet/electronHarness.cjs')
const outputDirectory = path.join(projectDirectory, 'Docs/lanpet-qa')
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lanpet-electron-qa-'))
const report = {
  executedAt: new Date().toISOString(),
  environment: 'Two real Electron processes on one Mac, with isolated temporary profiles and loopback WebSocket communication.',
  limits: [
    'mDNS and UDP discovery advertisements are disabled only in the harness; actual discovery on two physical PCs is not covered.',
    'The process-local clock begins at Tuesday 10:00, advances 11 minutes between social sessions to honor the invite rate limit, and advances 31 minutes to inspect a completed nap. The OS clock is unchanged.',
    'Care and onboarding use rendered UI; protocol assertions call the actual renderer preload API and traverse the real main process, encrypted database, and peer sockets.',
  ],
  checks: [], screenshots: [],
}
fs.mkdirSync(outputDirectory, { recursive: true })
const applications = []
let vite

function record(name, details = {}) {
  report.checks.push({ name, passed: true, ...details })
  process.stdout.write(`[Lanpet Electron QA] ${name}\n`)
}

async function waitFor(check, description, timeoutMs = 20000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) { lastError = error }
    await delay(150)
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`)
}

class ElectronApplication {
  constructor(name) {
    this.name = name
    this.pending = new Map()
    this.sequence = 0
    this.logs = []
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    this.process = spawn(require('electron'), [harnessPath, path.join(temporaryDirectory, name)], { cwd: projectDirectory, env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.lines = readline.createInterface({ input: this.process.stdout })
    this.lines.on('line', line => {
      if (!line.startsWith('LANPET_QA:')) return this.rememberLog(line)
      const message = JSON.parse(line.slice('LANPET_QA:'.length))
      if (message.ready) this.resolveReady()
      if (message.rendererGone) this.rejectAll(new Error(`${name} renderer stopped: ${message.rendererGone}`))
      const entry = this.pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${name}: ${message.error}`))
      else entry.resolve(message.result)
    })
    this.process.stderr.on('data', data => this.rememberLog(data.toString()))
    this.process.on('error', error => this.rejectAll(error))
    this.process.on('exit', (code, signal) => {
      this.exited = true
      this.rememberLog(`Process exited: code=${code}, signal=${signal}`)
      if (!this.quitting) this.rejectAll(new Error(`${name} exited (${code}, ${signal}). ${this.logs.slice(-4).join(' ')}`))
    })
    applications.push(this)
  }

  rememberLog(line) { this.logs.push(line); if (this.logs.length > 80) this.logs.shift() }
  rejectAll(error) {
    this.rejectReady(error)
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
  }
  request(operation, fields = {}) {
    if (this.exited) return Promise.reject(new Error(`${this.name} has exited.`))
    return new Promise((resolve, reject) => {
      const id = `${this.name}-${++this.sequence}`
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name} ${operation} response timed out.`)) }, 25000)
      this.pending.set(id, { resolve, reject, timer })
      this.process.stdin.write(`${JSON.stringify({ id, operation, ...fields })}\n`)
    })
  }
  evaluate(expression) { return this.request('evaluate', { expression }) }
  snapshot() { return this.evaluate('window.electronAPI.lanpet.getSnapshot()') }
  command(command) { return this.evaluate(`window.electronAPI.lanpet.command(${JSON.stringify({ requestId: crypto.randomUUID(), ...command })})`) }
  async click(text, selector = 'button', parentSelector = 'dialog') {
    return waitFor(() => this.evaluate(`(() => {
      const parent = document.querySelector(${JSON.stringify(parentSelector)});
      const button = [...(parent?.querySelectorAll(${JSON.stringify(selector)}) || [])].find(item => {
        const label = item.cloneNode(true);
        label.querySelectorAll('[aria-hidden="true"], .lanpet-count').forEach(decoration => decoration.remove());
        return label.textContent.trim() === ${JSON.stringify(text)};
      });
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`), `${this.name}: click ${text}`)
  }
  async fill(selector, value) {
    return this.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('Input not found');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
  }
  async screenshot(filename) {
    const screenshotPath = path.join(outputDirectory, filename)
    // 확대와 크기 변경 뒤 compositor가 새 프레임을 그린 다음 증거를 저장한다.
    await this.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    await this.request('capture', { path: screenshotPath })
    report.screenshots.push(screenshotPath)
    // 한글 테스트 이름으로 화면의 고정 문구와 접근성 안내에 남은 영문을 확인한다.
    const untranslated = await this.evaluate(`(() => {
      const dialog = document.querySelector('.lanpet-dialog');
      if (!dialog) return [];
      const labels = [...dialog.querySelectorAll('[aria-label], [title]')].map(element => (element.getAttribute('aria-label') || '') + (element.getAttribute('title') || ''));
      return [dialog.innerText, ...labels].join(' ').match(/[A-Za-z]+/g) || [];
    })()`)
    assert.deepEqual(untranslated, [], `${filename}: untranslated UI labels`)
    return screenshotPath
  }
  async close() {
    if (this.exited) return
    this.quitting = true
    try { await this.request('quit') } catch { this.process.kill('SIGTERM') }
    await waitFor(() => this.exited, `${this.name} quit`, 5000).catch(() => this.process.kill('SIGKILL'))
    this.lines.close()
  }
}

async function prepareVite() {
  const url = 'http://localhost:5173'
  let responding = false
  try { responding = (await fetch(url)).ok } catch { /* 새 테스트 서버를 시작한다. */ }
  if (!responding) {
    vite = spawn(process.execPath, [path.join(projectDirectory, 'node_modules/vite/bin/vite.js'), '--strictPort'], { cwd: projectDirectory, stdio: ['ignore', 'pipe', 'pipe'] })
    let viteFailure = ''
    vite.stderr.on('data', data => { viteFailure += data.toString() })
    await waitFor(async () => (await fetch(url)).ok, `Vite server ${viteFailure}`, 15000)
  }
  const page = await (await fetch(url)).text()
  assert(page.includes('/src/main.jsx'), 'Port 5173 must serve the LAN Chat Vite entry.')
  const component = await (await fetch(`${url}/src/components/lanpet/LanpetPanel.jsx`)).text()
  assert(component.includes('LanpetPanel'), 'Port 5173 must serve the current Lanpet checkout.')
}

async function setup(application, nickname, petName) {
  await Promise.race([application.ready, delay(25000).then(() => { throw new Error(`${application.name} did not load.`) })])
  await application.request('resize', { width: 1200, height: 800 })
  await application.request('clock', { timestamp: new Date(2026, 8, 8, 10, 0, 0).getTime() })
  await waitFor(() => application.evaluate("!!document.querySelector('#setup-nickname')"), 'SetupScreen')
  if (application.name === 'alpha') await application.screenshot('00-registration.png')
  await application.fill('#setup-nickname', nickname)
  await application.fill('#setup-username', application.name)
  await application.fill('#setup-password', 'LanpetQa-Temporary-Only')
  await application.fill('#setup-password-confirm', 'LanpetQa-Temporary-Only')
  await application.evaluate("document.querySelector('#setup-password-confirm').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}))")
  await waitFor(() => application.evaluate("!!document.querySelector('.lanpet-launcher')"), 'authenticated Lanpet launcher', 30000)
  // 앱 시작 패치 노트가 있으면 먼저 닫아 실제 사용자 진입 경로를 유지한다.
  await application.request('key', { key: 'Escape' })
  await application.click('랜펫', 'button', 'body')
  await waitFor(() => application.evaluate("!!document.querySelector('.lanpet-onboarding')"), 'Lanpet onboarding')
  if (application.name === 'alpha') await application.screenshot('01-onboarding.png')
  await application.click('다음')
  await application.fill('.lanpet-field input', petName)
  await application.click('다음')
  assert.equal(await application.evaluate("document.querySelector('.lanpet-checkbox input').checked"), false)
  await application.click('친구 맞이하기')
  await waitFor(async () => (await application.snapshot()).pet?.name === petName, 'created pet persisted')
  const snapshot = await application.snapshot()
  assert.equal(snapshot.sharingEnabled, false)
  assert.equal(snapshot.pet.stage, 'seed')
  record(`${application.name}: registration and private-by-default onboarding`)
}

async function waitForSession(application, sessionId, status) {
  return waitFor(async () => {
    const snapshot = await application.snapshot()
    const session = [...snapshot.invitations, ...snapshot.sessions].find(item => item.sessionId === sessionId)
    return session?.status === status && session
  }, `${application.name} session ${sessionId}: ${status}`, 25000)
}

async function advancePair(first, second) {
  await Promise.all([first, second].map(application => application.request('clock', { advanceMs: 11 * 60000 })))
  await Promise.all([first, second].map(application => application.snapshot()))
  await waitFor(async () => (await first.snapshot()).peers.some(peer => peer.available), 'peer summaries after the test clock advances', 15000)
}

async function socialActivity(first, second, activity, peerId) {
  const invited = await first.command({ type: 'invite', peerId, activity })
  assert.equal(invited.ok, true, `${activity} invite: ${invited.message || invited.code}`)
  const invitation = invited.snapshot.invitations.find(item => item.activity === activity && item.direction === 'outgoing')
  assert(invitation, `Outgoing ${activity} invitation must exist.`)
  const sessionId = invitation.sessionId
  await waitForSession(second, sessionId, 'incomingPending')
  const accepted = await second.command({ type: 'respond', sessionId, response: 'accept' })
  assert.equal(accepted.ok, true, `${activity} accept: ${accepted.code}`)
  if (activity !== 'gift') {
    await Promise.all([waitForSession(first, sessionId, 'inProgress'), waitForSession(second, sessionId, 'inProgress')])
    const rounds = { visit: 1, cooperativePlay: 3, battle: 5 }[activity]
    for (let round = 1; round <= rounds; round += 1) {
      await waitFor(async () => {
        const snapshots = await Promise.all([first.snapshot(), second.snapshot()])
        return snapshots.every(snapshot => snapshot.sessions.some(session => session.sessionId === sessionId && session.turn === round && !session.ownChoice))
      }, `${activity} round ${round} ready`)
      if (activity === 'battle' && round === 1) {
        await first.screenshot('04-battle-live.png')
      }
      const [firstMove, secondMove] = await Promise.all([
        first.command({ type: 'action', sessionId, choice: 'focus' }),
        second.command({ type: 'action', sessionId, choice: activity === 'battle' ? 'spark' : 'focus' }),
      ])
      assert.equal(firstMove.ok, true, `${activity} first input: ${firstMove.code}`)
      assert.equal(secondMove.ok, true, `${activity} second input: ${secondMove.code}`)
    }
  }
  const [firstResult, secondResult] = await Promise.all([waitForSession(first, sessionId, 'completed'), waitForSession(second, sessionId, 'completed')])
  if (activity === 'battle') {
    assert.equal(firstResult.result.outcome, 'win')
    assert.equal(secondResult.result.outcome, 'loss')
    assert.equal(firstResult.result.ownScore, 5)
    assert.equal(secondResult.result.peerScore, 5)
    await first.screenshot('05-battle-result.png')
  }
  if (activity === 'gift') {
    const received = (await second.snapshot()).inventory.find(item => item.itemType === 'friendshipStar')
    assert.equal(received?.quantity, 1)
  }
  record(`${activity}: actual two-peer exchange completed`, { sessionId, firstOutcome: firstResult.result?.outcome, secondOutcome: secondResult.result?.outcome })
  return sessionId
}

async function inspectLayout(application, filename) {
  const layout = await application.evaluate(`(() => {
    const dialog = document.querySelector('dialog');
    const content = dialog.querySelector('.lanpet-content');
    const bounds = dialog.getBoundingClientRect();
    return { viewportWidth: innerWidth, viewportHeight: innerHeight, dialogWidth: bounds.width, horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1 || content.scrollWidth > content.clientWidth + 1, withinViewport: bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1 };
  })()`)
  await application.screenshot(filename)
  assert.equal(layout.horizontalOverflow, false, `Horizontal overflow: ${JSON.stringify(layout)}`)
  assert.equal(layout.withinViewport, true, `Dialog outside viewport: ${JSON.stringify(layout)}`)
  record(`Renderer layout: ${filename}`, layout)
}

async function run() {
  await prepareVite()
  const first = new ElectronApplication('alpha')
  const second = new ElectronApplication('beta')
  await Promise.all([setup(first, '테스트 가람', '이끼'), setup(second, '테스트 나래', '고사리')])

  const beforeCare = await first.snapshot()
  await first.click('돌보기')
  await waitFor(async () => (await first.snapshot()).pet.care > beforeCare.pet.care, 'UI care reaches main process')
  const afterCare = await first.snapshot()
  assert.equal(afterCare.pet.care, beforeCare.pet.care + 12)
  await first.screenshot('02-pet-home.png')
  record('Rendered Care action updates the actual encrypted pet state')

  const request = { type: 'care', action: 'tidy', requestId: crypto.randomUUID() }
  const one = await first.command(request)
  const two = await first.command(request)
  assert.equal(one.ok, true)
  assert.equal(two.ok, true)
  for (const field of ['care', 'joy', 'energy', 'bond', 'growthPoints']) assert.equal(one.snapshot.pet[field], two.snapshot.pet[field], `Duplicate request changed ${field}.`)
  assert.equal(one.snapshot.history.length, two.snapshot.history.length)
  const forbidden = await first.command({ type: 'exec', source: 'never-run' })
  assert.equal(forbidden.ok, false)
  assert.equal(forbidden.code, 'INVALID_COMMAND')
  assert.match(forbidden.message, /랜펫/)
  assert.doesNotMatch(forbidden.message, /[A-Za-z]/)
  record('Duplicate request id does not repeat care; unsupported command is rejected')

  await first.evaluate("(() => { window.__lanpetQaChanges = 0; window.__lanpetQaUnsubscribe = window.electronAPI.lanpet.onChanged(() => { window.__lanpetQaChanges += 1 }); return true; })()")
  await first.evaluate("document.querySelector('[aria-label=\"랜펫 닫기\"]').click()")
  assert.equal((await first.command({ type: 'settings', allowGift: false })).ok, true)
  assert((await first.evaluate('window.__lanpetQaChanges')) > 0, 'Closing the panel must not remove another subscriber.')
  await first.click('랜펫', 'button', 'body')
  await waitFor(() => first.evaluate("!!document.querySelector('.lanpet-pocket')"), 'reopened panel')
  await first.evaluate('(() => { window.__lanpetQaUnsubscribe(); return true; })()')
  const eventsBefore = await first.evaluate('window.__lanpetQaChanges')
  assert.equal((await first.command({ type: 'settings', allowGift: true })).ok, true)
  assert.equal(await first.evaluate('window.__lanpetQaChanges'), eventsBefore)
  record('Close/reopen preserves independent subscriptions and unsubscribe removes only its listener')

  await Promise.all([first, second].map(application => application.command({ type: 'settings', sharingEnabled: true })))
  const secondPeer = await second.request('peerInfo')
  assert(secondPeer.wsPort && secondPeer.peerId)
  const connection = await first.evaluate(`window.electronAPI.connectManualPeer(${JSON.stringify({ host: '127.0.0.1', wsPort: secondPeer.wsPort })})`)
  assert.equal(connection.ok, true, connection.error)
  await waitFor(async () => {
    const snapshots = await Promise.all([first.snapshot(), second.snapshot()])
    return snapshots.every(snapshot => snapshot.peers.some(peer => peer.online && peer.available && peer.supported))
  }, 'trusted Lanpet peer capabilities and summaries', 30000)
  await Promise.all([first.click('친구'), second.click('친구')])
  await first.screenshot('03-neighborhood.png')
  record('Manual loopback connection discovers a supported, trusted, available Lanpet peer')

  await first.click('설정')
  await first.evaluate("[...document.querySelectorAll('.lanpet-activity-settings label')].find(label => label.querySelector('strong').textContent === '친선 배틀').querySelector('input').click()")
  await waitFor(async () => (await first.snapshot()).allowBattle === false, 'activity preference saved from UI')
  await first.command({ type: 'settings', allowBattle: true })
  await first.click('친구')
  await first.click('초대 차단')
  await waitFor(async () => (await first.snapshot()).blockedPeerIds.includes(secondPeer.peerId), 'peer invitation block saved from UI')
  assert.equal(await first.evaluate("[...document.querySelectorAll('.lanpet-peer-actions button')].every(button => button.disabled)"), true)
  await first.click('초대 차단 해제')
  await waitFor(async () => !(await first.snapshot()).blockedPeerIds.includes(secondPeer.peerId), 'peer invitation unblock saved from UI')
  await waitFor(async () => (await first.snapshot()).peers.some(peer => peer.available && peer.activities.includes('battle')), 'peer available after preference changes')
  record('Rendered activity preference and invitation block/unblock persist through the actual API')

  const activities = ['visit', 'cooperativePlay', 'battle', 'gift']
  for (let index = 0; index < activities.length; index += 1) {
    if (index > 0) await advancePair(first, second)
    await socialActivity(first, second, activities[index], secondPeer.peerId)
  }
  await second.click('추억')
  await second.screenshot('06-keepsake-journal.png')

  await first.click('내 펫')
  const beforeNap = await first.snapshot()
  await first.click('쉬기')
  const napping = await waitFor(async () => {
    const snapshot = await first.snapshot()
    return snapshot.pet.napEndsAt && snapshot
  }, 'scheduled nap after the rendered Rest action')
  assert.equal(napping.pet.energy, beforeNap.pet.energy, 'Starting a nap must not grant energy immediately.')
  assert.equal(await first.evaluate("[...document.querySelectorAll('.lanpet-care-actions button')].every(button => button.disabled)"), true)
  await first.screenshot('11-scheduled-nap.png')
  await first.click('친구')
  assert.equal(await first.evaluate("[...document.querySelectorAll('.lanpet-peer-actions button')].every(button => button.disabled)"), true)
  await Promise.all([first, second].map(application => application.request('clock', { advanceMs: 31 * 60000 })))
  await first.click('주변 친구 새로고침')
  await waitFor(async () => !(await first.snapshot()).pet.napEndsAt, 'nap completes after 30 minutes of office time')
  await first.click('내 펫')
  await waitFor(() => first.evaluate("!document.querySelector('.lanpet-care-actions button').disabled"), 'care returns after the scheduled nap')
  assert((await first.snapshot()).pet.energy > napping.pet.energy, 'Completing the nap must restore energy.')
  record('Rendered Rest schedules a nap, pauses invitations, and restores energy only after 30 work minutes')
  await inspectLayout(first, '07-desktop.png')
  await first.request('resize', { width: 700, height: 800 })
  await inspectLayout(first, '08-narrow.png')
  await first.request('zoom', { factor: 2 })
  await inspectLayout(first, '09-narrow-200-percent.png')
  for (const [tab, filename] of [['친구', 'friends'], ['추억', 'journal'], ['설정', 'settings']]) {
    await first.click(tab)
    await inspectLayout(first, `10-zoom-${filename}.png`)
  }
  await first.evaluate("document.querySelector('[aria-label=\"랜펫 닫기\"]').focus()")
  for (let index = 0; index < 12; index += 1) {
    await first.request('key', { key: 'Tab' })
    assert.equal(await first.evaluate("!!document.activeElement?.closest('dialog')"), true, 'Keyboard focus must remain inside the dialog.')
  }
  await first.request('key', { key: 'Escape' })
  await waitFor(() => first.evaluate("!document.querySelector('dialog')"), 'Escape closes the native dialog')
  record('Native dialog traps Tab focus and closes with Escape')
  report.passed = true
}

run().catch(async error => {
  report.passed = false
  report.error = error.stack
  for (const application of applications) {
    report[`${application.name}Logs`] = application.logs.slice(-30)
    if (!application.exited) {
      report[`${application.name}Snapshot`] = await application.snapshot().catch(() => null)
      await application.screenshot(`failure-${application.name}.png`).catch(() => {})
    }
  }
  process.stderr.write(`[Lanpet Electron QA] FAILED: ${error.stack}\n`)
  process.exitCode = 1
}).finally(async () => {
  await Promise.all(applications.map(application => application.close()))
  if (vite) vite.kill('SIGTERM')
  fs.writeFileSync(path.join(outputDirectory, 'electron-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  process.stdout.write(`[Lanpet Electron QA] Report: ${path.join(outputDirectory, 'electron-report.json')}\n`)
})
