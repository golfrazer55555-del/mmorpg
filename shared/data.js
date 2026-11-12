// 게임 데이터 정의 (서버/클라이언트 공용)

export const GAME_NAME = '엘더문 온라인';
export const TICK_RATE = 10; // 서버 시뮬레이션 Hz
export const MAX_LEVEL = 30;
export const INTEREST_RADIUS = 80; // 클라이언트에 동기화되는 반경

export const WORLD = {
  size: 420,
  half: 210,
  playRadius: 194,
  townRadius: 34,
  waterLevel: -0.6,
  lake: { x: 58, z: 62, r: 17 },
  boss: { x: -162, z: 6, r: 16 },
};

export const CLASSES = {
  warrior: {
    name: '전사', icon: '🛡️',
    desc: '튼튼한 체력과 강력한 근접 공격으로 최전선을 지킵니다.',
    hp: [140, 22], mp: [40, 4], atk: [11, 2.5], def: [6, 1.7],
    range: 2.8, atkCd: 1.0, speed: 7, crit: 0.1,
    skills: ['power_strike', 'whirlwind', 'war_cry'],
  },
  mage: {
    name: '마법사', icon: '🔮',
    desc: '원거리에서 강력한 원소 마법을 퍼붓고 동료를 치유합니다.',
    hp: [85, 12], mp: [110, 11], atk: [13, 2.9], def: [2, 0.9],
    range: 13, atkCd: 1.2, speed: 6.6, crit: 0.1,
    skills: ['fireball', 'frost_nova', 'heal'],
  },
  archer: {
    name: '궁수', icon: '🏹',
    desc: '빠른 연사와 높은 치명타로 먼 거리의 적을 제압합니다.',
    hp: [100, 15], mp: [65, 6], atk: [11, 2.6], def: [3, 1.2],
    range: 15, atkCd: 0.85, speed: 7.4, crit: 0.2,
    skills: ['piercing_shot', 'arrow_rain', 'swift_wind'],
  },
};

// type: target(단일 대상) / aoe_self(자신 주변) / aoe_target(대상 지점) / buff / heal
export const SKILLS = {
  power_strike: { name: '강타', icon: '💥', mp: 12, cd: 5, type: 'target', range: 3.4, mult: 2.4, desc: '적 하나에게 강력한 일격을 가합니다.' },
  whirlwind: { name: '회오리 베기', icon: '🌀', mp: 20, cd: 9, type: 'aoe_self', radius: 5.5, mult: 1.6, desc: '주변의 모든 적을 베어냅니다.' },
  war_cry: { name: '전투 함성', icon: '📯', mp: 16, cd: 24, type: 'buff', buff: { atk: 1.35, def: 1.2, dur: 10 }, heal: 0.15, desc: '10초간 공격력/방어력이 오르고 체력을 회복합니다.' },
  fireball: { name: '화염구', icon: '🔥', mp: 14, cd: 4, type: 'target', range: 15, mult: 2.7, desc: '거대한 불덩이를 날립니다.' },
  frost_nova: { name: '서리 폭발', icon: '❄️', mp: 24, cd: 10, type: 'aoe_self', radius: 7.5, mult: 1.3, slow: { mult: 0.45, dur: 4 }, desc: '주변의 적에게 피해를 주고 느리게 만듭니다.' },
  heal: { name: '치유의 빛', icon: '✨', mp: 26, cd: 12, type: 'heal', radius: 12, heal: 0.38, desc: '자신과 주변 아군의 체력을 회복합니다.' },
  piercing_shot: { name: '관통 사격', icon: '🎯', mp: 12, cd: 5, type: 'target', range: 18, mult: 2.5, critBonus: 0.3, desc: '치명타 확률이 높은 강력한 화살.' },
  arrow_rain: { name: '화살비', icon: '🌧️', mp: 22, cd: 11, type: 'aoe_target', range: 17, radius: 5.5, mult: 1.5, desc: '대상 주변에 화살을 쏟아붓습니다.' },
  swift_wind: { name: '바람의 질주', icon: '💨', mp: 14, cd: 18, type: 'buff', buff: { speed: 1.6, atkSpeed: 1.5, dur: 7 }, desc: '7초간 이동/공격 속도가 크게 증가합니다.' },
};

export const TIER_COLORS = ['#9e9e9e', '#e0e0e0', '#4fc3f7', '#ba68c8', '#ffb300'];

// 장비/소모품
export const ITEMS = {
  hp_potion: { name: '체력 물약', icon: '🧪', type: 'consumable', hp: 0.45, price: 12, desc: '최대 체력의 45%를 회복합니다.' },
  mp_potion: { name: '마나 물약', icon: '💧', type: 'consumable', mp: 0.45, price: 12, desc: '최대 마나의 45%를 회복합니다.' },
  big_hp_potion: { name: '고급 체력 물약', icon: '❤️‍🩹', type: 'consumable', hp: 1.0, price: 60, desc: '체력을 모두 회복합니다.' },

  // 전사 무기
  sword_0: { name: '낡은 검', icon: '🗡️', type: 'weapon', cls: 'warrior', atk: 0, level: 1, tier: 0, price: 5 },
  sword_1: { name: '강철 검', icon: '🗡️', type: 'weapon', cls: 'warrior', atk: 6, level: 2, tier: 1, price: 90 },
  sword_2: { name: '기사의 장검', icon: '🗡️', type: 'weapon', cls: 'warrior', atk: 14, level: 6, tier: 2, price: 340 },
  sword_3: { name: '룬 블레이드', icon: '⚔️', type: 'weapon', cls: 'warrior', atk: 26, level: 11, tier: 3, price: 900 },
  sword_4: { name: '월광의 대검', icon: '⚔️', type: 'weapon', cls: 'warrior', atk: 44, level: 18, tier: 4, price: 3000 },
  // 마법사 무기
  staff_0: { name: '견습 지팡이', icon: '🪄', type: 'weapon', cls: 'mage', atk: 0, level: 1, tier: 0, price: 5 },
  staff_1: { name: '참나무 지팡이', icon: '🪄', type: 'weapon', cls: 'mage', atk: 7, level: 2, tier: 1, price: 90 },
  staff_2: { name: '수정 지팡이', icon: '🪄', type: 'weapon', cls: 'mage', atk: 16, level: 6, tier: 2, price: 340 },
  staff_3: { name: '별빛 지팡이', icon: '🔱', type: 'weapon', cls: 'mage', atk: 29, level: 11, tier: 3, price: 900 },
  staff_4: { name: '엘더문의 홀', icon: '🔱', type: 'weapon', cls: 'mage', atk: 48, level: 18, tier: 4, price: 3000 },
  // 궁수 무기
  bow_0: { name: '사냥꾼의 활', icon: '🏹', type: 'weapon', cls: 'archer', atk: 0, level: 1, tier: 0, price: 5 },
  bow_1: { name: '장궁', icon: '🏹', type: 'weapon', cls: 'archer', atk: 6, level: 2, tier: 1, price: 90 },
  bow_2: { name: '숲지기의 활', icon: '🏹', type: 'weapon', cls: 'archer', atk: 15, level: 6, tier: 2, price: 340 },
  bow_3: { name: '폭풍의 활', icon: '🏹', type: 'weapon', cls: 'archer', atk: 27, level: 11, tier: 3, price: 900 },
  bow_4: { name: '창공의 활', icon: '🏹', type: 'weapon', cls: 'archer', atk: 45, level: 18, tier: 4, price: 3000 },
  // 방어구 (공용)
  armor_1: { name: '천 갑옷', icon: '👕', type: 'armor', def: 4, hp: 20, level: 1, tier: 1, price: 70 },
  armor_2: { name: '가죽 갑옷', icon: '🦺', type: 'armor', def: 9, hp: 60, level: 5, tier: 2, price: 280 },
  armor_3: { name: '강철 갑옷', icon: '🥋', type: 'armor', def: 17, hp: 140, level: 10, tier: 3, price: 800 },
  armor_4: { name: '미스릴 갑옷', icon: '🛡️', type: 'armor', def: 28, hp: 280, level: 16, tier: 4, price: 2600 },

  // 잡템 (판매용)
  slime_gel: { name: '슬라임 젤리', icon: '🟢', type: 'loot', price: 4, desc: '말랑말랑하다. 상인에게 팔 수 있다.' },
  wolf_pelt: { name: '늑대 가죽', icon: '🐺', type: 'loot', price: 10 },
  goblin_coin: { name: '고블린 주화', icon: '🪙', type: 'loot', price: 22 },
  bone_shard: { name: '뼛조각', icon: '🦴', type: 'loot', price: 35 },
  ember_core: { name: '불씨 핵', icon: '🔥', type: 'loot', price: 55 },
  golem_heart: { name: '골렘의 심장', icon: '💎', type: 'loot', price: 800 },
};

export const START_WEAPON = { warrior: 'sword_0', mage: 'staff_0', archer: 'bow_0' };
export const WEAPON_PREFIX = { warrior: 'sword', mage: 'staff', archer: 'bow' };

// 상점 판매 목록 ('W1' 등은 클래스별 무기로 치환)
export const SHOP_LIST = ['hp_potion', 'mp_potion', 'big_hp_potion', 'W1', 'W2', 'armor_1', 'armor_2', 'W3', 'armor_3'];

// 몬스터 정의. drops: [아이템, 확률] — 'W2' 등은 처치자 직업의 무기로 치환
export const MONSTERS = {
  slime: {
    name: '초록 슬라임', level: 1, hp: 38, atk: 6, def: 0, xp: 14, gold: [1, 4],
    speed: 2.6, aggro: 0, range: 1.7, atkCd: 1.6, respawn: 8, size: 1.0,
    drops: [['slime_gel', 0.5], ['hp_potion', 0.12], ['mp_potion', 0.08]],
  },
  wolf: {
    name: '회색 늑대', level: 5, hp: 120, atk: 14, def: 3, xp: 46, gold: [3, 9],
    speed: 5.6, aggro: 8, range: 2.1, atkCd: 1.3, respawn: 12, size: 1.0,
    drops: [['wolf_pelt', 0.45], ['hp_potion', 0.15], ['W1', 0.02], ['armor_1', 0.03]],
  },
  goblin: {
    name: '고블린 약탈자', level: 9, hp: 220, atk: 22, def: 7, xp: 92, gold: [8, 16],
    speed: 4.6, aggro: 10, range: 2.2, atkCd: 1.4, respawn: 14, size: 1.0,
    drops: [['goblin_coin', 0.5], ['hp_potion', 0.18], ['mp_potion', 0.12], ['W2', 0.025], ['armor_2', 0.02]],
  },
  skeleton: {
    name: '해골 전사', level: 13, hp: 340, atk: 31, def: 11, xp: 165, gold: [12, 24],
    speed: 4.4, aggro: 11, range: 2.3, atkCd: 1.4, respawn: 15, size: 1.0,
    drops: [['bone_shard', 0.5], ['big_hp_potion', 0.06], ['W3', 0.02], ['armor_3', 0.02]],
  },
  imp: {
    name: '화염 임프', level: 17, hp: 440, atk: 40, def: 13, xp: 260, gold: [18, 34],
    speed: 5.0, aggro: 12, range: 9, atkCd: 1.8, respawn: 16, size: 1.0, ranged: true,
    drops: [['ember_core', 0.5], ['big_hp_potion', 0.08], ['W3', 0.03], ['armor_4', 0.01]],
  },
  golem: {
    name: '고대 골렘', level: 22, hp: 7000, atk: 62, def: 22, xp: 3200, gold: [400, 700],
    speed: 3.4, aggro: 14, range: 4.2, atkCd: 2.2, respawn: 150, size: 3.2, boss: true,
    slam: { every: 3, radius: 8, mult: 1.5 },
    drops: [['golem_heart', 1], ['W4', 0.35], ['armor_4', 0.25], ['big_hp_potion', 1]],
  },
};

// 지역별 몬스터 배치
export const ZONES = {
  town: { name: '엘더문 마을', level: '안전 지대', monster: null, count: 0 },
  meadow: { name: '속삭이는 초원', level: 'Lv 1-4', monster: 'slime', count: 30 },
  forest: { name: '서리솔 숲', level: 'Lv 4-8', monster: 'wolf', count: 22 },
  highland: { name: '붉은바위 고원', level: 'Lv 8-12', monster: 'goblin', count: 20 },
  graveyard: { name: '잊혀진 묘지', level: 'Lv 12-16', monster: 'skeleton', count: 20 },
  volcano: { name: '잿불 화산지대', level: 'Lv 16-22', monster: 'imp', count: 16 },
};

export const NPCS = [
  { id: 'npc_elder', name: '촌장 엘다', role: 'quest', x: 0, z: -12, ry: 0, color: '#7e57c2' },
  { id: 'npc_merchant', name: '상인 보로', role: 'shop', x: 12, z: 5, ry: -Math.PI / 2, color: '#ef8f00' },
  { id: 'npc_priest', name: '사제 루미', role: 'heal', x: -12, z: 5, ry: Math.PI / 2, color: '#eceff1' },
];

export const QUESTS = [
  { name: '말랑한 골칫거리', target: 'slime', count: 6, minLevel: 1, xp: 90, gold: 30, items: [['hp_potion', 5], ['mp_potion', 3]],
    text: '마을 밖 초원에 슬라임이 너무 많아졌다네. 6마리만 처치해 주겠나?' },
  { name: '서리솔 숲의 늑대', target: 'wolf', count: 8, minLevel: 4, xp: 420, gold: 90, items: [['armor_1', 1], ['hp_potion', 5]],
    text: '북쪽 서리솔 숲의 늑대들이 사냥꾼들을 위협하고 있네. 늑대 8마리를 처치해 주게.' },
  { name: '고원의 약탈자들', target: 'goblin', count: 10, minLevel: 8, xp: 1300, gold: 220, items: [['W2', 1], ['hp_potion', 8]],
    text: '동쪽 붉은바위 고원에 고블린 약탈단이 진을 쳤다네. 10마리를 쓰러뜨려 주게!' },
  { name: '잠들지 못한 자들', target: 'skeleton', count: 10, minLevel: 12, xp: 2900, gold: 380, items: [['armor_3', 1], ['big_hp_potion', 3]],
    text: '남쪽 묘지에서 해골들이 일어나고 있네... 그들을 다시 잠재워 주게.' },
  { name: '잿불의 군세', target: 'imp', count: 10, minLevel: 16, xp: 5200, gold: 600, items: [['W3', 1], ['big_hp_potion', 5]],
    text: '서쪽 화산지대의 화염 임프들이 숲을 태우려 하네. 10마리를 처치해 주게.' },
  { name: '고대 골렘의 각성', target: 'golem', count: 1, minLevel: 19, xp: 12000, gold: 2000, items: [['W4', 1]],
    text: '화산 깊은 곳의 고대 골렘이 깨어났네. 동료들과 힘을 합쳐 쓰러뜨려 주게!' },
];

export function xpToNext(level) {
  return Math.round(40 * Math.pow(level, 1.75) + 40);
}

export function resolveItemId(id, cls) {
  if (/^W\d$/.test(id)) return WEAPON_PREFIX[cls] + '_' + id[1];
  return id;
}

export function computeStats(p) {
  const c = CLASSES[p.cls];
  const lv = p.level - 1;
  const w = p.equip?.weapon ? ITEMS[p.equip.weapon] : null;
  const a = p.equip?.armor ? ITEMS[p.equip.armor] : null;
  return {
    maxHp: Math.round(c.hp[0] + c.hp[1] * lv + (a?.hp || 0)),
    maxMp: Math.round(c.mp[0] + c.mp[1] * lv),
    atk: Math.round(c.atk[0] + c.atk[1] * lv + (w?.atk || 0)),
    def: Math.round(c.def[0] + c.def[1] * lv + (a?.def || 0)),
    range: c.range,
    atkCd: c.atkCd,
    speed: c.speed,
    crit: c.crit,
  };
}

export function monsterXpFactor(playerLevel, monsterLevel) {
  const diff = playerLevel - monsterLevel;
  if (diff <= 3) return 1;
  return Math.max(0.1, 1 - (diff - 3) * 0.2);
}
