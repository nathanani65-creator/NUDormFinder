'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const { parseFilters, searchProperties, haversineMeters } = require('../server/search');

const db = open(':memory:');
const log = console.log;
console.log = () => {};
seed(db);
console.log = log;

const gateId = (short) => db.prepare('SELECT id FROM gates WHERE short_name = ?').get(short).id;
const soiId = (name) => db.prepare('SELECT id FROM sois WHERE name = ?').get(name).id;
const search = (q) => searchProperties(db, parseFilters(q));

test('ตัวอย่างในแนวคิด: ประตู 4 → ซอยกระบอกวิศวะ → ≤ 3,000 บาท → มีแอร์', () => {
  const results = search({
    gate: String(gateId('ประตู 4')),
    soi: String(soiId('ซอยกระบอกวิศวะ')),
    max_price: '3000',
    amenity: 'aircon',
  });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.soi_name, 'ซอยกระบอกวิศวะ');
    assert.ok(r.price_min <= 3000);
    assert.ok(r.amenities.some((a) => a.code === 'aircon'));
  }
  // วิศวะเพลส ราคาเริ่ม 3,200 ต้องไม่ติดมา
  assert.ok(!results.some((r) => r.name.startsWith('วิศวะเพลส')));
});

test('ตัวเลือกในกลุ่มเดียวกันเป็น OR: หอพัก OR คอนโด', () => {
  const dorm = search({ type: 'dorm' }).length;
  const condo = search({ type: 'condo' }).length;
  const both = search({ type: 'dorm,condo' });
  assert.equal(both.length, dorm + condo);
  assert.ok(both.every((r) => ['dorm', 'condo'].includes(r.type_code)));
});

test('สิ่งอำนวยความสะดวกต้องมีครบทุกข้อ (AND)', () => {
  const results = search({ amenity: 'aircon,parking_car' });
  assert.ok(results.length > 0);
  for (const r of results) {
    const codes = r.amenities.map((a) => a.code);
    assert.ok(codes.includes('aircon') && codes.includes('parking_car'));
  }
  assert.ok(results.length < search({ amenity: 'aircon' }).length);
});

test('ที่พักที่อยู่ใกล้สองประตูแสดงเพียงรายการเดียว', () => {
  const g5 = gateId('ประตู 5');
  const g6 = gateId('ประตู 6');
  const results = search({ gate: `${g5},${g6}` });
  const ids = results.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const shared = results.find((r) => r.name.startsWith('อพาร์ตเมนต์สองประตู'));
  assert.deepEqual(shared.gates.map((g) => g.id).sort(), [g5, g6].sort());
});

test('เรียงตามระยะเส้นตรงถึงประตูที่เลือก', () => {
  const results = search({ gate: String(gateId('ประตู 1')) });
  const d = results.map((r) => r.nearest_gate.straight_line_m);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
  assert.ok(results.every((r) => r.nearest_gate.gate_name === 'ประตู 1'));
});

test('แสดงเฉพาะที่พักที่อนุมัติแล้ว', () => {
  const total = search({}).length;
  db.prepare("UPDATE properties SET status = 'pending' WHERE id = (SELECT MIN(id) FROM properties)").run();
  assert.equal(search({}).length, total - 1);
  db.prepare("UPDATE properties SET status = 'published' WHERE id = (SELECT MIN(id) FROM properties)").run();
});

test('ค่าเงื่อนไขผิดรูปแบบถูกละเว้น', () => {
  const f = parseFilters({ gate: 'abc,-1,2', max_price: 'x', sort: 'drop table' });
  assert.deepEqual(f.gates, [2]);
  assert.equal(f.maxPrice, null);
  assert.equal(f.sort, null);
});

test('haversine: 0.001° ละติจูด ≈ 111 เมตร', () => {
  const m = haversineMeters(16.75, 100.19, 16.751, 100.19);
  assert.ok(Math.abs(m - 111) < 1);
});

// ---------------------------------------------------------------- Facet Counts
const { computeFacets } = require('../server/search');
const facets = (q) => computeFacets(db, parseFilters(q));
const count = (q) => search(q).length;
const GROUP_PARAM = { type: 'type', gate: 'gate', zone: 'zone', soi: 'soi' };

// ชุดตัวกรองหลายแบบ ใช้ตรวจว่าตัวเลขตรงกับผลลัพธ์จริงทุกกรณี
const scenarios = () => [
  {},
  { gate: String(gateId('ประตู 4')) },
  { gate: `${gateId('ประตู 4')},${gateId('ประตู 3')}`, max_price: '3000' },
  { type: 'dorm,apartment', amenity: 'aircon' },
  { amenity: 'aircon,parking_motorbike', max_price: '4000' },
  { soi: String(soiId('ซอยกระบอกวิศวะ')), available: '1' },
];

test('Facet: เลือกประตู 4 แล้ว ตัวเลขของประตู 3 ยังไม่เป็น 0 (disjunctive)', () => {
  const f = facets({ gate: String(gateId('ประตู 4')) });
  assert.ok(f.gate[gateId('ประตู 3')] > 0);
  assert.equal(f.gate[gateId('ประตู 3')], count({ gate: String(gateId('ประตู 3')) }));
});

test('Facet: ตัวเลขกลุ่ม OR = จำนวนผลลัพธ์จริงเมื่อเลือกค่านั้นในกลุ่ม ร่วมกับตัวกรองกลุ่มอื่น', () => {
  const meta = {
    type: db.prepare('SELECT code AS v FROM property_types').all().map((r) => r.v),
    gate: db.prepare('SELECT id AS v FROM gates').all().map((r) => String(r.v)),
    zone: db.prepare('SELECT id AS v FROM zones').all().map((r) => String(r.v)),
    soi: db.prepare('SELECT id AS v FROM sois').all().map((r) => String(r.v)),
  };
  for (const q of scenarios()) {
    const f = facets(q);
    for (const [group, values] of Object.entries(meta)) {
      for (const v of values) {
        const expected = count({ ...q, [GROUP_PARAM[group]]: v });
        assert.equal(f[group][v] ?? 0, expected, `${JSON.stringify(q)} → ${group}=${v}`);
      }
    }
  }
});

test('Facet: ตัวเลขสิ่งอำนวยความสะดวก (AND) = จำนวนที่เหลือถ้าติ๊กข้อนั้นเพิ่ม', () => {
  const codes = db.prepare('SELECT code FROM amenities').all().map((r) => r.code);
  for (const q of scenarios()) {
    const f = facets(q);
    const chosen = q.amenity ? q.amenity.split(',') : [];
    for (const code of codes) {
      const expected = count({ ...q, amenity: [...new Set([...chosen, code])].join(',') });
      assert.equal(f.amenity[code] ?? 0, expected, `${JSON.stringify(q)} → amenity=${code}`);
    }
  }
  // ข้อที่ติ๊กอยู่แล้วมีตัวเลขเท่าจำนวนผลลัพธ์ปัจจุบัน
  const q = { amenity: 'aircon' };
  assert.equal(facets(q).amenity.aircon, count(q));
});

test('Facet: ช่วงราคาสำเร็จรูป = จำนวนผลลัพธ์จริงเมื่อกดปุ่มช่วงนั้น (แทนช่วงราคาเดิม)', () => {
  for (const q of scenarios()) {
    const f = facets(q);
    const { max_price, min_price, ...rest } = q;
    assert.equal(f.price['0-2500'], count({ ...rest, max_price: '2500' }));
    assert.equal(f.price['0-3000'], count({ ...rest, max_price: '3000' }));
    assert.equal(f.price['0-4000'], count({ ...rest, max_price: '4000' }));
    assert.equal(f.price['0-5000'], count({ ...rest, max_price: '5000' }));
    assert.equal(f.price['5001-'], count({ ...rest, min_price: '5001' }));
  }
});

test('Facet: นับเฉพาะที่พักที่เผยแพร่แล้ว', () => {
  const before = facets({});
  const target = db.prepare("SELECT p.id, t.code FROM properties p JOIN property_types t ON t.id = p.type_id WHERE p.status = 'published' LIMIT 1").get();
  db.prepare("UPDATE properties SET status = 'pending' WHERE id = ?").run(target.id);
  try {
    const after = facets({});
    assert.equal((after.type[target.code] ?? 0), before.type[target.code] - 1);
    const total = (f) => Object.values(f.type).reduce((a, b) => a + b, 0);
    assert.equal(total(after), total(before) - 1);
  } finally {
    db.prepare("UPDATE properties SET status = 'published' WHERE id = ?").run(target.id);
  }
});
