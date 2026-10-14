'use strict';
// การเตรียมเว็บจริง: ฐานข้อมูลตั้งต้นไม่มีที่พักสมมติ และไม่มีการนำเข้าไฟล์ชีตผ่านหน้าเว็บ
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/index');

const db = open(':memory:');
const log = console.log;
console.log = () => {};
seed(db, { samples: false });
console.log = log;

let server;
let base;
test.before(async () => {
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('ฐานข้อมูลตั้งต้นของเว็บจริง: ไม่มีที่พักสมมติ ซอยตัวอย่าง หรือบัญชีผู้ประกอบการตัวอย่าง', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sois WHERE name LIKE '%(ตัวอย่าง)%'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'provider'").get().n, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n > 0);
});

test('ผู้ดูแลไม่มีหน้าอัปโหลดไฟล์ชีต: เพิ่มที่พักผ่านฟอร์มของผู้ดูแลแทน', async () => {
  const res = await fetch(`${base}/api/admin/import`, { method: 'POST' });
  assert.equal(res.status, 404);
});
