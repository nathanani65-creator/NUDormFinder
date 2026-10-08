'use strict';
// ฐานข้อมูลเก่าที่สร้างพร้อมที่พักสมมติ แล้วนำเข้าที่พักจริงจากชีตทีหลัง: ลบเฉพาะที่พักสมมติ
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const { findSamples, removeSamples } = require('../server/remove-samples');

const db = open(':memory:');
const log = console.log;
console.log = () => {};
seed(db, { samples: true });
console.log = log;

// ที่พักจริงจากชีต (มี import_key) และที่พักจริงที่ผู้ดูแลเพิ่มเอง
const typeId = db.prepare("SELECT id FROM property_types WHERE code = 'dorm'").get().id;
const insert = db.prepare(
  "INSERT INTO properties (name, type_id, address, status, import_key) VALUES (?, ?, 'ต.ท่าโพธิ์ อ.เมืองพิษณุโลก', 'published', ?) RETURNING id"
);
const imported = insert.get('หอจริงจากชีต', typeId, 'PROP-001').id;
const manual = insert.get('หอจริงที่ผู้ดูแลเพิ่ม', typeId, null).id;

test('ลบเฉพาะที่พักสมมติ บัญชีตัวอย่าง และซอยตัวอย่าง', () => {
  assert.equal(findSamples(db).length, 14);
  const r = removeSamples(db);
  assert.equal(r.properties.length, 14);
  assert.equal(r.users, 1);
  assert.ok(r.sois > 0);

  const left = db.prepare('SELECT id FROM properties ORDER BY id').all().map((p) => p.id);
  assert.deepEqual(left, [imported, manual]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'provider@nudorm.local'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sois WHERE name LIKE '%(ตัวอย่าง)%'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n, 1);
});

test('รันซ้ำได้ ไม่มีอะไรถูกลบเพิ่ม', () => {
  assert.equal(findSamples(db).length, 0);
  assert.equal(removeSamples(db).properties.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 2);
});
