import * as THREE from 'three'
import { createModelKit, createPet, createRoom, createTrack } from './models'

const dieRotations = { 1: [0, 0, 0], 2: [0, -Math.PI / 2, 0], 3: [Math.PI / 2, 0, 0], 4: [-Math.PI / 2, 0, 0], 5: [0, Math.PI / 2, 0], 6: [0, Math.PI, 0] }
const pipPositions = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }

function createDie() {
  const textures = [2, 5, 3, 4, 1, 6].map(value => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff4dd'; context.fillRect(0, 0, 128, 128)
    context.strokeStyle = '#e6c4ab'; context.lineWidth = 7; context.strokeRect(4, 4, 120, 120)
    context.fillStyle = value === 1 ? '#c26087' : '#66506e'
    for (const [x, y] of pipPositions[value]) { context.beginPath(); context.arc(64 + x * 31, 64 + y * 31, 10, 0, Math.PI * 2); context.fill() }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
    return texture
  })
  const materials = textures.map(map => new THREE.MeshStandardMaterial({ map, roughness: .28 }))
  const geometry = new THREE.BoxGeometry(.75, .75, .75)
  const mesh = new THREE.Mesh(geometry, materials); mesh.castShadow = true
  return { mesh, dispose() { textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometry.dispose() } }
}

// 화면의 크기와 가시성은 React 호스트가 관리하고, 이 모듈은 장면과 GPU 자원만 소유한다.
export function createPetScene(canvas, { mode = 'room', portrait = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: portrait, preserveDrawingBuffer: portrait, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.shadowMap.enabled = !portrait
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  if (!portrait) scene.background = new THREE.Color(mode === 'race' ? '#e9f0dc' : '#f8eadf')
  const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 60)
  const kit = createModelKit()
  const hemisphere = new THREE.HemisphereLight('#fff9e6', '#b7a1bd', 2.4); scene.add(hemisphere)
  const sunlight = new THREE.DirectionalLight('#fff4df', 3.5); sunlight.position.set(-3, 7, 6); sunlight.castShadow = !portrait
  sunlight.shadow.mapSize.set(1024, 1024); sunlight.shadow.camera.left = -7; sunlight.shadow.camera.right = 7; sunlight.shadow.camera.top = 7; sunlight.shadow.camera.bottom = -7
  sunlight.shadow.normalBias = .04; sunlight.shadow.bias = -.0002; scene.add(sunlight)
  const fill = new THREE.DirectionalLight('#e1f1ff', 1.6); fill.position.set(4, 3, -3); scene.add(fill)
  let set = null
  let setKey = ''
  let residentsKey = ''
  let residents = []
  let data = {}
  let active = false
  let visible = true
  let disposed = false
  let reducedMotion = false
  let effectKey = ''
  let effectStarted = -100
  let rollStarted = -100
  let lastFrame = 0
  let elapsed = 0
  const effects = new THREE.Group(); scene.add(effects)
  const wave = kit.ring(effects, '#efd497', [0, .15, .7], [1, 1, .1]); wave.rotation.x = -Math.PI / 2; wave.visible = false
  const spark = kit.sphere(effects, '#f0bf74', [0, 1, .7], [.15, .15, .15]); spark.visible = false
  const particles = Array.from({ length: 32 }, (_, index) => {
    const object = kit.star(effects, ['#f3c55f', '#eea3c9', '#9ccfc0', '#b4a1df'][index % 4], [0, 0, 0], [.08, .08, .08])
    object.visible = false
    return object
  })
  const die = mode === 'race' ? createDie() : null
  if (die) { scene.add(die.mesh); die.mesh.position.set(0, .57, 2.03) }
  const cue = new THREE.Group(); scene.add(cue)

  function resize(width, height) {
    if (disposed || width < 1 || height < 1) return
    renderer.setSize(width, height, false)
    const aspect = width / height
    let horizontal = 5.8
    let vertical = Math.max(3.3, horizontal / aspect)
    if (mode === 'race') { horizontal = 5.4; vertical = Math.max(2.6, horizontal / aspect) }
    if (portrait) { horizontal = 1.45; vertical = 1.45 }
    camera.left = -vertical * aspect; camera.right = vertical * aspect; camera.top = vertical; camera.bottom = -vertical
    if (portrait) { camera.position.set(0, 1.55, 6); camera.lookAt(0, 1.07, 0) }
    else if (mode === 'race') { camera.position.set(2.4, 5.5, 9.5); camera.lookAt(0, .15, 0) }
    else { camera.position.set(4.5, 5.8, 9.5); camera.lookAt(0, 1, -.1) }
    camera.updateProjectionMatrix()
    render()
  }

  function update(next) {
    data = next
    const nextSetKey = JSON.stringify(next.room || {})
    if (!portrait && nextSetKey !== setKey) {
      if (set) scene.remove(set)
      set = mode === 'race' ? createTrack(kit) : createRoom(kit, next.room)
      scene.add(set); setKey = nextSetKey
    }
    const inputResidents = (next.residents || []).slice(0, 4)
    const nextResidentsKey = JSON.stringify(inputResidents.map(value => [value.appearanceId, value.stage]))
    if (nextResidentsKey !== residentsKey) {
      residents.forEach(object => scene.remove(object))
      residents = inputResidents.map((value, index) => {
        const object = createPet(kit, value)
        if (mode === 'race') { object.scale.multiplyScalar(.65); object.position.set(-4, .07, index * 1.65 - .8); object.rotation.y = Math.PI / 2 }
        else if (!portrait) { object.scale.multiplyScalar(1.45); object.position.set((index - (inputResidents.length - 1) / 2) * 1.65, .1, .55 + index % 2 * .5); object.rotation.y = .28 }
        object.userData.baseX = object.position.x; object.userData.baseZ = object.position.z
        scene.add(object)
        return object
      })
      residentsKey = nextResidentsKey
    }
    const nextEffect = next.effect?.id || ''
    if (nextEffect && nextEffect !== effectKey) {
      effectKey = nextEffect; effectStarted = elapsed
      if (mode === 'race') rollStarted = elapsed
    }
    cue.clear()
    if (mode === 'memory' && Number.isInteger(next.cue)) {
      kit.cylinder(cue, '#fff0d4', [1.8, .15, .7], [.65, .25, .65])
      if (next.cue === 0) {
        kit.sphere(cue, '#e57d8c', [1.8, .72, .7], [.38, .45, .32])
        for (let seed = 0; seed < 7; seed++) kit.sphere(cue, '#ffe9b6', [1.57 + seed % 3 * .2, .55 + Math.floor(seed / 3) * .15, .985], [.025, .035, .013])
        kit.star(cue, '#84b782', [1.8, 1.15, .7], [.23, .18, .2]).rotation.x = -Math.PI / 2
      } else if (next.cue === 1) {
        kit.sphere(cue, '#fff6df', [1.8, .62, .7], [.42, .43, .25]); kit.box(cue, '#456968', [1.8, .4, .94], [.32, .3, .04])
      } else {
        kit.cylinder(cue, '#c699bb', [1.8, .52, .7], [.3, .45, .3]); kit.sphere(cue, '#ffdeec', [1.8, .84, .7], [.4, .22, .4]); kit.sphere(cue, '#df799b', [1.8, 1.06, .7], [.12, .12, .12])
      }
    }
    render()
  }

  function render() {
    if (disposed || (!portrait && !visible)) return
    const effectAge = elapsed - effectStarted
    const rolling = data.rolling || elapsed - rollStarted < .85
    residents.forEach((object, index) => {
      const { body, feet, arms, baseX, baseZ } = object.userData
      let walking = false
      if (mode === 'race') {
        const target = -4 + Math.min(30, (data.distances || [])[index] || 0) * 8 / 30
        if (reducedMotion) object.position.x = target
        else if (!rolling) object.position.x += (target - object.position.x) * .12
        walking = Math.abs(target - object.position.x) > .025 && !rolling
      } else if (!portrait && data.roaming && !data.resting && !reducedMotion) {
        object.position.x = baseX + Math.sin(elapsed * .35 + index * 1.6) * .4
        object.position.z = baseZ + Math.cos(elapsed * .3 + index) * .25
        object.rotation.y = .25 + Math.cos(elapsed * .35 + index) * .35
        walking = true
      }
      let bob = 0
      if (!reducedMotion && !portrait) bob = Math.sin(elapsed * 2 + index) * .018
      if (walking) bob += Math.abs(Math.sin(elapsed * 10)) * .055
      if (!reducedMotion && effectAge < 1.6 && effectAge >= 0 && mode !== 'race') bob += Math.abs(Math.sin(effectAge * 7)) * .17 * (1 - effectAge / 1.6)
      body.position.y = bob
      body.rotation.z = data.resting ? -.12 : 0
      body.scale.y = data.resting ? .86 : 1
      feet.forEach((foot, side) => { foot.rotation.x = walking ? Math.sin(elapsed * 10 + side * Math.PI) * .38 : 0 })
      arms.forEach((arm, side) => { arm.rotation.x = walking ? Math.sin(elapsed * 10 + side * Math.PI) * .38 : 0 })
    })
    if (die) {
      if (!reducedMotion && rolling) { die.mesh.rotation.set(elapsed * 8, elapsed * 10, elapsed * 5); die.mesh.position.y = .72 + Math.abs(Math.sin(elapsed * 9)) * .35 }
      else { die.mesh.rotation.set(...(dieRotations[data.die] || dieRotations[1])); die.mesh.position.y = .56 }
    }
    particles.forEach((particle, index) => {
      particle.visible = !reducedMotion && effectAge >= 0 && effectAge < 2.5
      if (!particle.visible) return
      const angle = index * 2.4
      const speed = .35 + index % 5 * .17
      particle.position.set(Math.cos(angle) * effectAge * speed, 1 + Math.sin(effectAge / 2.5 * Math.PI) * (1 + index % 3 * .4), .7 + Math.sin(angle) * effectAge * speed)
      particle.rotation.set(effectAge * 2, angle + effectAge * 3, angle)
      particle.scale.setScalar(.1 * (1 - effectAge / 2.5))
    })
    wave.visible = !reducedMotion && effectAge >= 0 && effectAge < 1.5
    if (wave.visible) wave.scale.set(1 + effectAge * 1.2, .65 + effectAge * .8, Math.max(.01, .13 - effectAge * .07))
    spark.visible = !reducedMotion && ['battle', 'cooperativePlay', 'play'].includes(data.effect?.kind) && effectAge >= 0 && effectAge < 1.5
    if (spark.visible) {
      spark.position.set(Math.sin(effectAge * 5) * 1.4, 1.1 + Math.sin(effectAge * 7) * .3, .7)
      spark.scale.setScalar(.17 + Math.sin(effectAge * 8) * .06)
    }
    renderer.render(scene, camera)
  }

  function frame(timestamp) {
    if (timestamp - lastFrame < 1000 / 30) return
    elapsed += Math.min(.08, Math.max(0, (timestamp - lastFrame) / 1000))
    lastFrame = timestamp
    render()
  }
  function setActive(value, reduce = false) {
    visible = value
    reducedMotion = reduce
    active = value && !disposed && !portrait && !reduce
    lastFrame = performance.now()
    renderer.setAnimationLoop(active ? frame : null)
    render()
  }
  return { update, resize, setActive, render, dispose() {
    if (disposed) return
    disposed = true; active = false
    renderer.setAnimationLoop(null)
    kit.dispose(); die?.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss()
  } }
}

const portraitCache = new Map()
let portraitScene
let portraitCanvas
let portraitCleanup
export function petPortrait(appearanceId, stage) {
  const key = `${appearanceId}:${stage}`
  if (portraitCache.has(key)) return portraitCache.get(key)
  if (!portraitScene) {
    portraitCanvas = document.createElement('canvas')
    portraitScene = createPetScene(portraitCanvas, { portrait: true })
    portraitScene.resize(220, 220)
  }
  portraitScene.update({ residents: [{ appearanceId, stage }] })
  const result = portraitCanvas.toDataURL('image/png')
  portraitCache.set(key, result)
  if (portraitCache.size > 96) portraitCache.delete(portraitCache.keys().next().value)
  clearTimeout(portraitCleanup)
  portraitCleanup = setTimeout(() => { portraitScene?.dispose(); portraitScene = null; portraitCanvas = null }, 3000)
  return result
}
