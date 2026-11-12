// 월드 시뮬레이션 스모크 테스트: node scripts/smoke-test.js
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { generateSpawns, isWalkable, heightAt, zoneAt } from '../shared/terrain.js';
import { NPCS, ZONES } from '../shared/data.js';

const saves = new Map();
const world = new World({ bots: 4, store: { load: (t) => saves.get(t) || null, save: (t, d) => saves.set(t, d) } });

// 스폰 지점 검증
const spawns = generateSpawns();
for (const s of spawns) assert.ok(isWalkable(s.x, s.z), 'spawn walkable');
for (const [id, z] of Object.entries(ZONES)) {
  if (!z.monster) continue;
  const n = spawns.filter((s) => s.type === z.monster).length;
  assert.ok(n >= z.count * 0.8, `${id} spawns: ${n}`);
}
assert.equal(zoneAt(0, 0), 'town');
assert.ok(Number.isFinite(heightAt(10, 10)));

const inbox = [];
const conn = world.connect((m) => inbox.push(m));
conn.receive({ t: 'join', name: '테스터', cls: 'warrior', color: '#ff0000' });
const welcome = inbox.find((m) => m.t === 'welcome');
assert.ok(welcome, 'welcome received');
const me = world.players.get(welcome.id);
assert.equal(me.name, '테스터');

// 잘못된 이름
const bad = [];
world.connect((m) => bad.push(m)).receive({ t: 'join', name: 'a' });
assert.equal(bad[0].t, 'err');

// 퀘스트 수락
const elder = NPCS.find((n) => n.role === 'quest');
me.x = elder.x; me.z = elder.z + 2;
conn.receive({ t: 'quest' });
assert.equal(me.quest.active, true);
assert.equal(me.quest.target, 'slime');

// 상점
const shop = NPCS.find((n) => n.role === 'shop');
me.x = shop.x - 2; me.z = shop.z;
const gold0 = me.gold;
conn.receive({ t: 'buy', item: 'hp_potion', n: 2 });
assert.equal(me.gold, gold0 - 24);

// 슬라임 사냥
const slime = [...world.monsters.values()].find((m) => m.type === 'slime');
let kills = 0;
for (let i = 0; i < 6; i++) {
  const s = [...world.monsters.values()].filter((m) => m.type === 'slime' && !m.dead)[i];
  me.x = s.x + 1; me.z = s.z;
  let guard = 0;
  while (!s.dead && guard++ < 400) {
    world.tick();
    me.x = s.x + 1; me.z = s.z;
    conn.receive({ t: 'atk', id: s.id });
  }
  assert.ok(s.dead, 'slime died');
  kills++;
}
assert.equal(me.quest.progress, 6);
assert.ok(me.xp > 0 || me.level > 1, 'gained xp');

// 퀘스트 완료
me.x = elder.x; me.z = elder.z + 2;
conn.receive({ t: 'quest' });
assert.equal(me.quest.idx, 1);
assert.ok(me.level >= 2, 'level up from quest: ' + me.level);

// 스킬
const target = [...world.monsters.values()].find((m) => m.type === 'slime' && !m.dead);
me.x = target.x + 1; me.z = target.z;
me.mp = 999;
conn.receive({ t: 'sk', s: 'power_strike', id: target.id });
assert.ok(me.cds.power_strike > world.time);

// 이동 검증 (텔레포트 거부)
const before = { x: me.x, z: me.z };
for (let i = 0; i < 3; i++) world.tick();
conn.receive({ t: 'move', x: me.x + 80, z: me.z, ry: 0 });
assert.deepEqual({ x: me.x, z: me.z }, before);

// 스냅샷
inbox.length = 0;
world.tick();
const snap = inbox.find((m) => m.t === 's');
assert.ok(snap && snap.P.length >= 1, 'snapshot');

// 저장/재접속
conn.close();
assert.ok(saves.get(welcome.token), 'saved');
const inbox2 = [];
const conn2 = world.connect((m) => inbox2.push(m));
conn2.receive({ t: 'join', token: welcome.token });
const w2 = inbox2.find((m) => m.t === 'welcome');
assert.equal(w2.me.name, '테스터');
assert.equal(w2.me.quest.idx, 1);

// 장비 구매/장착
const p2 = world.players.get(w2.id);
p2.gold = 1000; p2.x = shop.x - 2; p2.z = shop.z;
conn2.receive({ t: 'buy', item: 'armor_1' });
conn2.receive({ t: 'equip', item: 'armor_1' });
assert.equal(p2.equip.armor, 'armor_1');
const def0 = p2.stats.def;
conn2.receive({ t: 'buy', item: 'sword_1' });
conn2.receive({ t: 'equip', item: 'sword_1' });
assert.equal(p2.equip.weapon, 'sword_1');
assert.ok(p2.inv.sword_0 === 1, 'old weapon returned to bag');
conn2.receive({ t: 'buy', item: 'staff_1' }); // 다른 직업 무기는 상점 목록에 없음
assert.ok(!p2.inv.staff_1);
assert.ok(def0 > 0);

// 사망 및 부활
const wolf = [...world.monsters.values()].find((m) => m.type === 'wolf');
p2.x = wolf.x + 1; p2.z = wolf.z; p2.hp = 1;
let g = 0;
while (!p2.dead && g++ < 200) world.tick();
assert.ok(p2.dead, 'player died to wolf');
conn2.receive({ t: 'respawn' });
assert.ok(p2.dead, 'cannot respawn before timer');
for (let i = 0; i < 60; i++) world.tick();
conn2.receive({ t: 'respawn' });
assert.ok(!p2.dead && p2.hp === p2.stats.maxHp, 'respawned');
assert.ok(Math.hypot(p2.x, p2.z) < 12, 'respawned in town');

// 장시간 시뮬레이션 (봇/몬스터 AI 안정성)
const t0 = Date.now();
for (let i = 0; i < 3000; i++) world.tick();
const ms = (Date.now() - t0) / 3000;
for (const m of world.monsters.values()) assert.ok(Number.isFinite(m.x) && Number.isFinite(m.z), 'monster pos finite');
const bots = [...world.players.values()].filter((p) => p.bot);
console.log('bots:', bots.map((b) => `${b.name} Lv${b.level} ${b.ai.state} (${b.x.toFixed(0)},${b.z.toFixed(0)})`).join(' | '));
console.log(`tick avg ${ms.toFixed(3)}ms, monsters ${world.monsters.size}, spawns ${spawns.length}`);
console.log('✅ smoke test passed');
