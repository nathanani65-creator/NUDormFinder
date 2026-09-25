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
