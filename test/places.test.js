'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { placeCodesOf } = require('../server/places');
const { searchProperties, computeFacets, parseFilters } = require('../server/search');

const db = open(':memory:');
const typeId = db.prepare("INSERT INTO property_types (code, name) VALUES ('dorm', 'หอพัก/อพาร์ตเมนต์') RETURNING id").get().id;
const gateId = db.prepare("INSERT INTO gates (name, short_name, lat, lng) VALUES ('ประตู 4', 'ประตู 4', 16.746, 100.198) RETURNING id").get().id;
const amenityId = db.prepare('SELECT id FROM amenities LIMIT 1').get().id; // สร้างไว้พร้อมโครงสร้างฐานข้อมูล

/** ที่พักที่เผยแพร่แล้วและข้อมูลครบ (แสดงบนเว็บ) พร้อมสถานที่ใกล้เคียงตามที่กำหนด */
function dorm(name, nearby) {
  const id = db.prepare("INSERT INTO properties (name, type_id, address, lat, lng, contact_phone, status) VALUES (?, ?, 'พิษณุโลก', 16.745, 100.199, '080-000-0000', 'published') RETURNING id").get(name, typeId).id;
  db.prepare("INSERT INTO room_types (property_id, name, price) VALUES (?, 'ห้องพัดลม', 2500)").run(id);
  db.prepare('INSERT INTO property_gates (property_id, gate_id) VALUES (?, ?)').run(id, gateId);
  db.prepare("INSERT INTO property_images (property_id, url) VALUES (?, '/img/hero.webp')").run(id);
  db.prepare('INSERT INTO property_amenities (property_id, amenity_id) VALUES (?, ?)').run(id, amenityId);
  for (const [placeName, category, m] of nearby) {
    db.prepare('INSERT INTO nearby_places (property_id, name, category, distance_m) VALUES (?, ?, ?, ?)').run(id, placeName, category, m);
  }
  return id;
}

const a = dorm('หอ A', [['เซเว่นอีเลฟเว่น', 'ร้านสะดวกซื้อ', 80], ['MARU Laundry', 'ร้านซักรีด', 200]]);
const b = dorm('หอ B', [['เซเว่นอีเลฟเว่น', 'ร้านสะดวกซื้อ', 700]]);
dorm('หอ C', [['ตลาดกลางคืน night market', 'ตลาด', 300]]);

const ids = (q) => searchProperties(db, parseFilters(q)).map((p) => p.id).sort();

test('จับกลุ่มสถานที่จากชื่อหรือประเภท', () => {
  assert.deepEqual(placeCodesOf({ name: 'เซเว่นอีเลฟเว่น', category: 'ร้านสะดวกซื้อ' }), ['seven']);
  assert.deepEqual(placeCodesOf({ name: 'โลตัส โกเฟรช มินิประตู6', category: 'ร้านสะดวกซื้อ' }), ['lotus']);
  assert.deepEqual(placeCodesOf({ name: 'ร้านอะไรก็ได้', category: 'ร้านซักรีด' }), ['laundry']);
  assert.deepEqual(placeCodesOf({ name: '7-Eleven สาขา ตลาดเมืองทอง', category: 'ร้านสะดวกซื้อ' }), ['seven']);
  assert.deepEqual(placeCodesOf({ name: 'ตลาดกลางคืน night market', category: 'ตลาด' }), ['market']);
  assert.deepEqual(placeCodesOf({ name: 'Hair nice By พี่แขก', category: 'อื่น ๆ' }), []);
});

test('กรองใกล้สถานที่ตามระยะที่เลือก และต้องใกล้ครบทุกที่ (AND)', () => {
  assert.deepEqual(ids({ place: 'seven' }), [a, b]); // ค่าเริ่มต้นภายใน 1 กม.
  assert.deepEqual(ids({ place: 'seven', place_within: '300' }), [a]);
  assert.deepEqual(ids({ place: 'seven,laundry' }), [a]);
  assert.deepEqual(ids({ place: 'fitness' }), []);
  assert.deepEqual(ids({ place: 'unknown' }).length, 3); // รหัสที่ไม่รู้จักถูกตัดทิ้ง
});

test('จำนวนข้างตัวเลือกสถานที่ และระยะที่แนบไปกับผลค้นหา', () => {
  const f = computeFacets(db, parseFilters({ place: 'seven' }));
  assert.equal(f.place.seven, 2);
  assert.equal(f.place.laundry, 1);
  assert.equal(f.place.market, 0);
  const [first] = searchProperties(db, parseFilters({ place: 'seven', place_within: '300' }));
  assert.deepEqual(first.near_places, [{ code: 'seven', label: 'เซเว่นอีเลฟเว่น', m: 80, name: 'เซเว่นอีเลฟเว่น' }]);
});
