const crypto = require('crypto')
const { GROWTH_REQUIREMENTS, isWorkingHours, clamp } = require('./engine')

const DAY = 86400000
const BRANCHES = ['care', 'active', 'social']
const SPECIES = [
  { id: 'fox', name: '살구여우', color: '#ffbb6c', branches: ['꽃잎여우', '번개여우', '리본여우'] },
  { id: 'rabbit', name: '솜토끼', color: '#f8b6d6', branches: ['정원토끼', '달빛토끼', '축제토끼'] },
  { id: 'otter', name: '방울수달', color: '#87dcdb', branches: ['산호수달', '파도수달', '진주수달'] },
  { id: 'cat', name: '별고양이', color: '#baadf6', branches: ['찻잎고양이', '혜성고양이', '왕관고양이'] },
  { id: 'bird', name: '구름새', color: '#ffdf72', branches: ['꽃구름새', '무지개새', '노래구름새'] },
  { id: 'bear', name: '젤리곰', color: '#a7df96', branches: ['꿀단지곰', '모험곰', '하트곰'] },
]
const FOODS = [
  { id: 'rice', name: '동글 주먹밥', icon: '🍙', price: 8, care: 14, joy: 2, energy: 4, branch: 'care' },
  { id: 'berry', name: '반짝 열매', icon: '🍓', price: 12, care: 8, joy: 8, energy: 8, branch: 'active' },
  { id: 'cake', name: '우정 컵케이크', icon: '🧁', price: 16, care: 10, joy: 14, energy: 3, branch: 'social' },
]
const DECORATIONS = [
  { id: 'cream', name: '바닐라 벽지', icon: '🌼', slot: 'wall', price: 0 },
  { id: 'rose', name: '딸기 밀크 벽지', icon: '🌸', slot: 'wall', price: 60 },
  { id: 'sky', name: '소다 하늘 벽지', icon: '☁️', slot: 'wall', price: 60 },
  { id: 'parquet', name: '비스킷 마루', icon: '🧇', slot: 'floor', price: 0 },
  { id: 'check', name: '피크닉 체크', icon: '🧺', slot: 'floor', price: 75 },
  { id: 'candy', name: '캔디 카펫', icon: '🍬', slot: 'floor', price: 75 },
  { id: 'plant', name: '작은 화분', icon: '🪴', slot: 'furniture', price: 0 },
  { id: 'sofa', name: '구름 소파', icon: '🛋️', slot: 'furniture', price: 100 },
  { id: 'piano', name: '장난감 피아노', icon: '🎹', slot: 'furniture', price: 140 },
  { id: 'castle', name: '쿠션 성', icon: '🏰', slot: 'furniture', price: 180 },
]
const WORLD_ERRORS = {
  NOT_ENOUGH_COINS: '반짝 코인이 부족해요. 미니게임이나 무료 복권으로 모아 보세요.',
  ITEM_NOT_OWNED: '먼저 상점에서 이 아이템을 구입해 주세요.',
  ITEM_ALREADY_OWNED: '이미 가지고 있는 가구예요.',
  WORLD_COOLDOWN: '잠깐 쉬어 주세요. 먹이는 5분마다, 무료 간식은 1시간마다 줄 수 있어요.',
  LOTTERY_LIMIT: '무료 복권은 24시간마다 한 장 받을 수 있어요.',
  GAME_LIMIT: '미니게임은 최근 24시간 동안 다섯 번까지 도전할 수 있어요.',
  GAME_NOT_ACTIVE: '진행 중인 게임이 없거나 선택 시간이 지났어요. 다시 시작해 주세요.',
  GAME_TOO_FAST: '펫이 준비할 시간을 잠깐 기다려 주세요.',
  INVALID_GAME_INPUT: '화면에 표시된 세 가지 선택 중 하나를 골라 주세요.',
}

function speciesFromSeed(seed) {
  return SPECIES[crypto.createHash('sha256').update(seed).digest().readUInt32BE(0) % SPECIES.length]
}

function waitUntil(code, retryAt) { const error = new Error(code); error.retryAt = retryAt; throw error }

class LanpetWorld {
  constructor(service) { this.service = service; this.db = service.db }
  read() {
    const row = this.db.prepare('SELECT state_json FROM lanpet_world WHERE singleton_id = 1').get()
    return row ? JSON.parse(row.state_json) : null
  }
  save(state) {
    this.db.prepare('INSERT INTO lanpet_world VALUES (1, ?) ON CONFLICT(singleton_id) DO UPDATE SET state_json = excluded.state_json').run(JSON.stringify(state))
  }
  ensure(pet, now) {
    let state = this.read()
    if (!state) state = { version: 1, balance: 100, owned: ['cream', 'parquet', 'plant'], bag: { rice: 3 }, room: { wall: 'cream', floor: 'parquet', furniture: 'plant' }, earnings: [], ledger: [], gameStarts: [], lastAt: now }
    if (state.progress?.petId !== pet.petId) {
      // 기존 펫도 최초 이관 시 시드를 고정하고 수치와 성장 단계를 보존한다.
      const seed = crypto.randomBytes(16).toString('hex')
      const fallback = { calm: 'care', active: 'active', social: 'social', balanced: 'care' }
      state.progress = { petId: pet.petId, seed, speciesId: speciesFromSeed(seed).id, scores: { care: 0, active: 0, social: 0 }, branch: pet.stage === 'grown' ? fallback[pet.temperament] || 'care' : null, lastScoreAt: {} }
      state.game = null
      this.save(state)
    }
    if (state.game?.kind === 'race' && state.game.status === 'playing' && state.game.ruleVersion !== 2) {
      state.game.status = 'expired'
      state.game.upgraded = true
      this.save(state)
    }
    return state
  }
  winner(progress) {
    // 동점도 저장된 시드로 결정하므로 새로고침이나 버튼 연타로 바뀌지 않는다.
    const offset = parseInt(progress.seed.slice(0, 2), 16) % 3
    return [...BRANCHES.slice(offset), ...BRANCHES.slice(0, offset)].sort((a, b) => progress.scores[b] - progress.scores[a])[0]
  }
  decorate(pet, now) {
    if (!pet) return null
    const state = this.ensure(pet, now)
    const progress = state.progress
    const species = SPECIES.find(value => value.id === progress.speciesId)
    const branch = progress.branch || this.winner(progress)
    const nextStage = { seed: 'young', young: 'grown' }[pet.stage]
    const requirement = GROWTH_REQUIREMENTS[nextStage]
    const appearanceId = `${pet.stage}-${species.id}-${progress.branch || 'base'}`
    const eligible = requirement && pet.growthPoints >= requirement.growthPoints && pet.bond >= requirement.bond && pet.growthAgeMinutes >= requirement.minimumGrowthAgeMinutes
    const choice = { choiceId: `${nextStage}.${species.id}.${branch}`, stage: nextStage, appearanceId: `${nextStage}-${species.id}-${nextStage === 'grown' ? branch : 'base'}`, label: nextStage === 'grown' ? species.branches[BRANCHES.indexOf(branch)] : `${species.name} 새싹`, family: branch }
    return { ...pet, appearanceId, speciesId: species.id, speciesName: species.name, branch, formName: pet.stage === 'grown' ? species.branches[BRANCHES.indexOf(branch)] : species.name, growthChoices: eligible ? [choice] : [], tree: BRANCHES.map((id, index) => ({ id, name: species.branches[index], score: progress.scores[id], leading: id === branch, appearanceId: `grown-${species.id}-${id}` })), growthRequirement: requirement || null }
  }
  snapshot(pet, now) {
    if (!pet) return null
    const state = this.ensure(pet, now)
    const game = state.game
    const activeGame = game && game.status === 'playing' && now <= game.expiresAt
    const starts = state.gameStarts.filter(at => at > now - DAY)
    const earnings = state.earnings.filter(entry => entry.at > now - DAY)
    const feedReadyAt = state.fedAt == null ? 0 : state.fedAt + 300000
    let publicGame = null
    if (game) {
      let status = game.status
      if (status === 'playing' && !activeGame) status = 'expired'
      const upgraded = game.kind === 'race' && game.ruleVersion !== 2
      if (upgraded) status = 'archived'
      publicGame = {
        id: game.id, kind: game.kind, status, ruleVersion: game.ruleVersion || 1,
        round: game.round, score: game.score, reward: game.reward,
        target: activeGame && game.kind === 'memory' ? game.targets[game.round] : null,
        expiresAt: game.expiresAt, inputReadyAt: game.lastInputAt + 1100,
        distance: game.distance || 0, rivalDistance: game.rivalDistance || 0,
        lastRoll: game.rolls?.at(-1) || null, lastCorrect: game.lastCorrect, upgraded,
      }
    }
    return {
      balance: state.balance, bag: state.bag, owned: state.owned, room: state.room,
      foods: FOODS, decorations: DECORATIONS, species: SPECIES, ledger: state.ledger.slice(-12).reverse(),
      feedReadyAt, snackReadyAt: Math.max(feedReadyAt, state.snackAt == null ? 0 : state.snackAt + 3600000),
      lotteryReadyAt: state.lotteryAt == null ? 0 : state.lotteryAt + DAY, lotteryPrize: state.lotteryPrize || null,
      gamePlaysRemaining: Math.max(0, 5 - starts.length), gameReadyAt: starts.length >= 5 ? Math.min(...starts) + DAY : 0,
      socialCoinsRemaining: Math.max(0, 3 - earnings.length), socialCoinsReadyAt: earnings.length >= 3 ? Math.min(...earnings.map(entry => entry.at)) + DAY : 0,
      game: publicGame,
    }
  }
  changeCoins(state, amount, reason, now) {
    if (state.balance + amount < 0) throw new Error('NOT_ENOUGH_COINS')
    state.balance += amount
    state.ledger.push({ amount, reason, at: now })
    state.ledger = state.ledger.slice(-50)
  }
  addExperience(state, branch, amount, now) {
    if (!state.progress || state.progress.branch) return
    const key = branch
    if (state.progress.lastScoreAt[key] != null && now - state.progress.lastScoreAt[key] < 300000) return
    state.progress.scores[key] = Math.min(999, state.progress.scores[key] + amount)
    state.progress.lastScoreAt[key] = now
  }
  experience(pet, branch, now) {
    const state = this.ensure(pet, now)
    this.addExperience(state, branch, 1, now)
    this.save(state)
  }
  social(pet, eventId, now) {
    const state = this.ensure(pet, now)
    state.earnings = state.earnings.filter(entry => entry.at > now - DAY)
    if (!state.earnings.some(entry => entry.id === eventId) && state.earnings.length < 3) {
      state.earnings.push({ id: eventId, at: now })
      this.changeCoins(state, 12, '친구와 놀이', now)
      this.addExperience(state, 'social', 2, now)
    }
    this.save(state)
  }
  grow(pet, input, now) {
    const state = this.ensure(pet, now)
    const choice = this.decorate(pet, now).growthChoices.find(value => value.choiceId === input.choiceId)
    if (!choice) throw new Error('GROWTH_NOT_AVAILABLE')
    if (choice.stage === 'grown') state.progress.branch = this.winner(state.progress)
    this.save(state)
    return { ok: true, choice, pet: { ...pet, stage: choice.stage, appearanceId: choice.appearanceId, stageChangedAt: now, updatedAt: now, stateRevision: pet.stateRevision + 1 } }
  }
  command(input, now) {
    const settings = this.service.getSettings()
    if (!settings.enabled) throw new Error('FEATURE_DISABLED')
    if (!isWorkingHours(now, settings.workHours)) throw new Error('OUTSIDE_WORK_HOURS')
    let pet = this.service.evaluateAndSave(now)
    if (!pet) throw new Error('PET_NOT_FOUND')
    const state = this.ensure(pet, now)
    if (now < Math.max(state.lastAt, pet.lastEvaluatedAt)) throw new Error('CLOCK_ROLLBACK')
    if (pet.lifecycleState !== 'active') throw new Error('PET_UNAVAILABLE')
    if (input.type === 'buy') {
      const food = FOODS.find(value => value.id === input.itemId)
      const decoration = DECORATIONS.find(value => value.id === input.itemId)
      if (!food && !decoration) throw new Error('INVALID_COMMAND')
      if (decoration && state.owned.includes(decoration.id)) throw new Error('ITEM_ALREADY_OWNED')
      if (food && (state.bag[food.id] || 0) >= 99) throw new Error('INVALID_COMMAND')
      this.changeCoins(state, -(food || decoration).price, (food || decoration).name + ' 구매', now)
      if (food) state.bag[food.id] = (state.bag[food.id] || 0) + 1
      else state.owned.push(decoration.id)
    } else if (input.type === 'equip') {
      const item = DECORATIONS.find(value => value.id === input.itemId)
      if (!item || !state.owned.includes(item.id)) throw new Error('ITEM_NOT_OWNED')
      state.room[item.slot] = item.id
    } else if (input.type === 'feed') {
      const free = input.itemId === 'snack'
      const food = free ? { care: 6, joy: 2, energy: 2, branch: 'care' } : FOODS.find(value => value.id === input.itemId)
      if (!food) throw new Error('INVALID_COMMAND')
      const readyAt = Math.max(state.fedAt == null ? 0 : state.fedAt + 300000, free && state.snackAt != null ? state.snackAt + 3600000 : 0)
      if (now < readyAt) waitUntil('WORLD_COOLDOWN', readyAt)
      if (!free && !(state.bag[food.id] > 0)) throw new Error('ITEM_NOT_OWNED')
      if (free) state.snackAt = now
      else state.bag[food.id] -= 1
      state.fedAt = now
      this.addExperience(state, food.branch, 3, now)
      pet = this.service.store.savePet({ ...pet, care: clamp(pet.care + food.care, 0, 100), joy: clamp(pet.joy + food.joy, 0, 100), energy: clamp(pet.energy + food.energy, 0, 100), lastPetInteractionAt: now, stateRevision: pet.stateRevision + 1, updatedAt: now })
    } else if (input.type === 'lottery') {
      if (state.lotteryAt != null && now - state.lotteryAt < DAY) waitUntil('LOTTERY_LIMIT', state.lotteryAt + DAY)
      const draw = crypto.randomInt(100)
      let prize = 10
      if (draw >= 60) prize = 20
      if (draw >= 90) prize = 50
      if (draw >= 99) prize = 100
      state.lotteryAt = now
      state.lotteryPrize = prize
      this.changeCoins(state, prize, '무료 행운 복권', now)
    } else if (input.type === 'gameStart') {
      if (!['race', 'memory'].includes(input.kind)) throw new Error('INVALID_COMMAND')
      if (state.game?.status === 'playing' && state.game.expiresAt > now) throw new Error('SESSION_CONFLICT')
      state.gameStarts = state.gameStarts.filter(at => at > now - DAY)
      if (state.gameStarts.length >= 5) waitUntil('GAME_LIMIT', Math.min(...state.gameStarts) + DAY)
      state.gameStarts.push(now)
      state.game = { id: crypto.randomUUID(), kind: input.kind, ruleVersion: 2, status: 'playing', round: 0, score: 0, distance: 0, rivalDistance: 0, rolls: [], targets: input.kind === 'memory' ? Array.from({ length: 5 }, () => crypto.randomInt(3)) : [], lastInputAt: now, expiresAt: now + 60000 }
    } else if (input.type === 'gameAction') {
      const game = state.game
      if (!game || game.id !== input.gameId || game.status !== 'playing' || now > game.expiresAt || input.round !== game.round) throw new Error('GAME_NOT_ACTIVE')
      if (game.kind === 'race' ? input.choice !== 'roll' : !Number.isInteger(input.choice) || input.choice < 0 || input.choice > 2) throw new Error('INVALID_GAME_INPUT')
      if (now - game.lastInputAt < 1100) waitUntil('GAME_TOO_FAST', game.lastInputAt + 1100)
      if (game.kind === 'race') {
        const roll = { own: crypto.randomInt(1, 7), rival: crypto.randomInt(1, 7) }
        game.rolls.push(roll)
        game.distance += roll.own
        game.rivalDistance += roll.rival
      } else {
        game.lastCorrect = input.choice === game.targets[game.round]
        if (game.lastCorrect) game.score += 1
      }
      game.round += 1
      game.lastInputAt = now
      if (game.round === 5) {
        game.status = 'completed'
        game.reward = game.kind === 'race' ? 10 + Math.floor(game.distance / 3) : 5 + game.score * 3
        this.changeCoins(state, game.reward, game.kind === 'race' ? '주사위 경주' : '간식 짝맞추기', now)
        this.addExperience(state, 'active', 3, now)
      }
    } else throw new Error('INVALID_COMMAND')
    state.lastAt = now
    this.save(state)
  }
}

module.exports = { LanpetWorld, WORLD_ERRORS, SPECIES, FOODS, DECORATIONS, speciesFromSeed }
