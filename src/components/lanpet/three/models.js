import * as THREE from 'three'

export const coats = { fox: '#f4ad62', rabbit: '#f1aecf', otter: '#76cecc', cat: '#b3a0e4', bird: '#f7d864', bear: '#a0cf85' }

// 한 장면이 공유하는 도형과 재질은 장면을 닫을 때 한 번씩 해제한다.
export function createModelKit() {
  const geometries = new Map()
  const materials = new Map()
  const geometry = (key, create) => {
    if (!geometries.has(key)) geometries.set(key, create())
    return geometries.get(key)
  }
  const material = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .33, metalness: .02 }))
    return materials.get(color)
  }
  function mesh(parent, shape, color, position, scale = [1, 1, 1]) {
    const object = new THREE.Mesh(shape, material(color))
    object.position.set(...position)
    object.scale.set(...scale)
    object.castShadow = true
    object.receiveShadow = true
    parent.add(object)
    return object
  }
  const sphere = (parent, color, position, scale) => mesh(parent, geometry('sphere', () => new THREE.SphereGeometry(1, 24, 16)), color, position, scale)
  const box = (parent, color, position, scale) => mesh(parent, geometry('box', () => new THREE.BoxGeometry(1, 1, 1)), color, position, scale)
  const cylinder = (parent, color, position, scale) => mesh(parent, geometry('cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 24)), color, position, scale)
  const cone = (parent, color, position, scale) => mesh(parent, geometry('cone', () => new THREE.ConeGeometry(1, 1, 24)), color, position, scale)
  const ring = (parent, color, position, scale) => mesh(parent, geometry('ring', () => new THREE.TorusGeometry(1, .11, 8, 32)), color, position, scale)
  function star(parent, color, position, scale = [.15, .15, .15]) {
    const shape = geometry('star', () => {
      const outline = new THREE.Shape()
      for (let index = 0; index < 10; index++) {
        const radius = index % 2 === 0 ? 1 : .44
        const angle = Math.PI / 2 + index * Math.PI / 5
        const point = [Math.cos(angle) * radius, Math.sin(angle) * radius]
        if (index === 0) outline.moveTo(...point)
        else outline.lineTo(...point)
      }
      outline.closePath()
      return new THREE.ExtrudeGeometry(outline, { depth: .25, bevelEnabled: true, bevelSize: .08, bevelThickness: .08, bevelSegments: 2, steps: 1 })
    })
    return mesh(parent, shape, color, position, scale)
  }
  return { sphere, box, cylinder, cone, ring, star, dispose() { geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.clear(); materials.clear() } }
}

export function createPet(kit, resident = {}) {
  const parts = (resident.appearanceId || '').split('-')
  const species = coats[parts[1]] ? parts[1] : 'bear'
  const branch = parts[2]
  const stage = resident.stage || parts[0] || 'seed'
  const color = coats[species]
  const pet = new THREE.Group()
  const body = new THREE.Group()
  pet.add(body)
  const { sphere, cone, ring, star } = kit
  sphere(body, color, [0, .87, 0], [.68, .74, .56])
  sphere(body, '#fff1da', [0, .53, .47], [.38, .32, .12])
  const feet = [-1, 1].map(side => sphere(body, color, [side * .35, .12, .15], [.24, .13, .3]))
  const arms = [-1, 1].map(side => sphere(body, color, [side * .63, .63, .03], [.17, .32, .19]))
  arms[0].rotation.z = -.3; arms[1].rotation.z = .3
  for (const side of [-1, 1]) {
    const eye = sphere(body, '#273e54', [side * .24, 1.05, .51], [.125, .18, .066])
    eye.userData.eye = true
    sphere(body, '#ffffff', [side * .24 - .025, 1.115, .572], [.043, .055, .02])
    sphere(body, '#ffffff', [side * .24 + .037, .993, .575], [.022, .025, .014])
    sphere(body, '#ed94ab', [side * .43, .84, .47], [.105, .065, .023])
    if (['bear', 'otter'].includes(species)) {
      sphere(body, color, [side * .5, 1.49, -.03], [.23, .24, .17])
      sphere(body, '#ffdcc2', [side * .5, 1.49, .11], [.12, .13, .03])
    }
    if (['fox', 'cat'].includes(species)) {
      const ear = cone(body, color, [side * .45, 1.58, -.03], [.29, .62, .22]); ear.rotation.z = side * -.25
      const inner = cone(body, '#f4c1c1', [side * .45, 1.59, .13], [.15, .35, .04]); inner.rotation.z = side * -.25
    }
    if (species === 'rabbit') {
      const ear = sphere(body, color, [side * .34, 1.74, -.05], [.2, .56, .18]); ear.rotation.z = side * -.16
      const inner = sphere(body, '#db81a6', [side * .34, 1.77, .10], [.09, .39, .03]); inner.rotation.z = side * -.16
    }
  }
  if (species === 'bird') {
    sphere(body, '#efae44', [0, .85, .59], [.16, .095, .15])
    for (let index = 0; index < 3; index++) { const tuft = sphere(body, color, [(index - 1) * .15, 1.6, 0], [.12, .31, .11]); tuft.rotation.z = (index - 1) * -.5 }
  } else {
    sphere(body, '#654552', [0, .845, .583], [.058, .04, .027])
    for (const side of [-1, 1]) { const smile = ring(body, '#654552', [side * .047, .787, .57], [.065, .052, .16]); smile.rotation.z = .2 }
  }
  if (species === 'fox') {
    const tail = sphere(body, color, [.62, .5, -.4], [.27, .58, .29]); tail.rotation.z = -.8
    sphere(body, '#fff1da', [.98, .81, -.4], [.2, .26, .2])
    for (const side of [-1, 1]) sphere(body, '#fff1da', [side * .39, .78, .45], [.22, .16, .09])
  }
  if (species === 'cat') { const tail = ring(body, color, [.57, .48, -.36], [.43, .45, 1]); tail.rotation.y = .7 }
  if (species === 'otter') sphere(body, color, [.3, .15, -.6], [.23, .12, .55])
  if (stage === 'grown' && branch === 'care') {
    for (let index = 0; index < 5; index++) sphere(body, '#f495bc', [Math.cos(index * 1.256) * .18, 1.54 + Math.sin(index * 1.256) * .18, .34], [.14, .14, .09])
    sphere(body, '#ffe681', [0, 1.54, .44], [.105, .105, .06])
    const leaf = sphere(body, '#74ad7d', [-.32, 1.52, .25], [.23, .075, .12]); leaf.rotation.z = .6
  }
  if (stage === 'grown' && branch === 'active') {
    const band = ring(body, '#62c6d3', [0, 1.3, 0], [.65, .55, .62]); band.rotation.x = Math.PI / 2
    star(body, '#fff093', [0, 1.37, .56], [.2, .2, .2])
    sphere(body, '#62c6d3', [.68, 1.26, -.04], [.27, .1, .08])
  }
  if (stage === 'grown' && branch === 'social') {
    for (const side of [-1, 1]) { const bow = sphere(body, '#dc70a3', [side * .17, .43, .61], [.18, .13, .09]); bow.rotation.z = side * .45 }
    sphere(body, '#ffe599', [0, .43, .69], [.08, .08, .05])
  }
  if (stage === 'seed') pet.scale.setScalar(.8)
  if (stage === 'grown') pet.scale.setScalar(1.08)
  pet.userData = { body, feet, arms, species, originalScale: pet.scale.x }
  return pet
}

export function createRoom(kit, room = {}) {
  const group = new THREE.Group()
  const { box, sphere, cylinder, ring, cone, star } = kit
  const wall = { cream: '#f9e9ce', rose: '#f3cee0', sky: '#cce8ee' }[room.wall] || '#f9e9ce'
  const tile = { parquet: ['#e6bf9c', '#f5d9b7'], check: ['#e4b5cd', '#ffecf3'], candy: ['#c4b4e2', '#eee3f5'] }[room.floor] || ['#e6bf9c', '#f5d9b7']
  box(group, '#d8b3a1', [0, -.23, 0], [8.3, .45, 5.6])
  for (let x = 0; x < 10; x++) for (let z = 0; z < 7; z++) box(group, tile[(x + z) % 2], [-3.6 + x * .8, .012, -2.4 + z * .8], [.797, .035, .797])
  box(group, wall, [0, 1.65, -2.65], [8.2, 3.3, .18])
  box(group, wall, [-4.03, 1.15, 0], [.16, 2.3, 5.3])
  box(group, '#fff5df', [0, 3.25, -2.47], [8.2, .12, .15])
  box(group, '#d5ae85', [0, .15, -2.48], [8.2, .2, .15])
  box(group, '#fff5df', [-3.94, 2.3, 0], [.2, .1, 5.3])
  for (const side of [-1, 1]) {
    const x = side * 2.38
    box(group, '#fff6e5', [x, 1.93, -2.5], [1.38, 1.92, .14])
    box(group, '#9ed6e5', [x, 1.96, -2.39], [1.17, 1.69, .07])
    box(group, '#fffaf1', [x, 1.94, -2.3], [.06, 1.72, .07])
    box(group, '#fffaf1', [x, 1.94, -2.3], [1.18, .06, .07])
    for (const direction of [-1, 1]) for (let fold = 0; fold < 3; fold++) {
      cylinder(group, '#dd93b6', [x + direction * .63 + (fold - 1) * .09, 2.08, -2.19], [.09, 1.76, .09])
    }
    box(group, '#c69a6c', [x, 2.98, -2.19], [1.85, .06, .07])
  }
  box(group, '#cbae6d', [0, 2.24, -2.4], [1.35, .91, .12])
  box(group, '#a9cbaa', [0, 2.24, -2.3], [1.15, .71, .08])
  star(group, '#ffeaaa', [0, 2.24, -2.23], [.24, .24, .1])
  const rug = cylinder(group, '#eba7c5', [0, .055, .6], [2.65, .06, 1.45])
  const trim = ring(group, '#f3d28d', [0, .095, .6], [2.57, 1.37, .14]); trim.rotation.x = -Math.PI / 2
  rug.receiveShadow = true
  const furnishing = new THREE.Group(); furnishing.position.set(2.6, 0, -1.3); group.add(furnishing)
  if (room.furniture === 'sofa') {
    box(furnishing, '#ba819f', [0, .36, 0], [1.8, .5, .8])
    box(furnishing, '#e6b1c9', [0, .89, -.3], [1.8, .75, .22])
    for (const side of [-1, 1]) { sphere(furnishing, '#e6b1c9', [side * .8, .67, 0], [.2, .3, .5]); sphere(furnishing, '#f7dfad', [side * .37, .78, -.08], [.27, .25, .12]) }
  } else if (room.furniture === 'piano') {
    box(furnishing, '#68657f', [0, .7, 0], [1.6, 1.2, .5]); box(furnishing, '#494657', [0, .68, .42], [1.6, .15, .45])
    for (let key = 0; key < 12; key++) box(furnishing, '#fff8e4', [-.7 + key * .127, .78, .4], [.12, .025, .4])
    for (let key = 0; key < 8; key++) box(furnishing, '#3d3a4e', [-.62 + key * .17, .81, .27], [.065, .035, .23])
  } else if (room.furniture === 'castle') {
    box(furnishing, '#d5c1e6', [0, .65, 0], [1.2, 1.3, .75])
    for (const side of [-1, 1]) { cylinder(furnishing, '#e5cee8', [side * .7, .75, 0], [.28, 1.5, .28]); cone(furnishing, '#ba87b8', [side * .7, 1.75, 0], [.39, .5, .39]) }
    box(furnishing, '#a187a9', [0, .3, .39], [.4, .6, .04])
    star(furnishing, '#ffeaa8', [0, 1.6, 0], [.23, .23, .2])
  } else {
    cylinder(furnishing, '#d69970', [0, .26, 0], [.32, .52, .32])
    cylinder(furnishing, '#8e7655', [0, .77, 0], [.035, 1, .035])
    for (let leaf = 0; leaf < 6; leaf++) { const angle = leaf * 2.4; const object = sphere(furnishing, '#88b37c', [Math.cos(angle) * .24, .65 + leaf * .12, Math.sin(angle) * .2], [.32, .09, .16]); object.rotation.z = Math.cos(angle) * .4 }
  }
  return group
}

export function createTrack(kit) {
  const group = new THREE.Group()
  kit.box(group, '#b5d4b0', [0, -.3, 0], [10, .5, 5.2])
  for (let lane = 0; lane < 2; lane++) {
    kit.box(group, ['#f5d9cf', '#cddfe8'][lane], [0, .01, lane * 1.65 - .8], [8.8, .06, 1.4])
    for (let marker = 0; marker < 31; marker++) kit.box(group, '#fff7ea', [-4 + marker * 8 / 30, .052, lane * 1.65 - 1.43], [.026, .01, .12])
  }
  for (let x = 0; x < 2; x++) for (let z = 0; z < 10; z++) kit.box(group, (x + z) % 2 ? '#635775' : '#fffaf0', [4.04 + x * .14, .055, -1.53 + z * .3], [.14, .01, .3])
  for (const x of [-4.7, 4.7]) { kit.cylinder(group, '#fff7e0', [x, .7, -2], [.045, 1.4, .045]); kit.star(group, '#f4cd78', [x, 1.5, -2], [.23, .23, .2]) }
  for (let index = 0; index < 7; index++) kit.sphere(group, '#93bb87', [-4.3 + index * 1.4, .24, -2.26], [.45, .4, .3])
  return group
}
