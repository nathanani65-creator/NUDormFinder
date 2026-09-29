'use strict';
// การเตรียมเว็บจริง: ฐานข้อมูลตั้งต้นไม่มีที่พักสมมติ และผู้ดูแลนำเข้าที่พักจากไฟล์ชีตผ่านหน้าเว็บ
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
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

async function sheetBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ทะเบียนที่พัก');
  const headers = ['property_id', 'ชื่อที่พักในไฟล์ต้นฉบับ', 'เลขที่อยู่', 'ประตูที่ใกล้ที่สุด', 'ชื่อซอยหรือย่านที่นิสิตนิยมเรียก'];
  ws.addRow(headers);
  ws.addRow(['PROP-001', 'หอจริงหนึ่ง', '1/1', 'ประตู6', 'ซอยใหม่จากชีต']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(cookie, query = '') {
  const fd = new FormData();
  fd.append('file', new Blob([await sheetBuffer()]), 'sheet.xlsx');
  const res = await fetch(`${base}/api/admin/import${query}`, { method: 'POST', body: fd, headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, data: await res.json() };
}

test('ฐานข้อมูลตั้งต้นของเว็บจริง: ไม่มีที่พักสมมติ ซอยตัวอย่าง หรือบัญชีผู้ประกอบการตัวอย่าง', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sois WHERE name LIKE '%(ตัวอย่าง)%'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'provider'").get().n, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM gates').get().n > 0);
});

test('นำเข้าชีตผ่านหน้าผู้ดูแล: เฉพาะผู้ดูแล, ตรวจก่อนไม่บันทึก, นำเข้าจริงเผยแพร่และสร้างซอยใหม่', async () => {
  assert.equal((await upload('')).status, 401, 'ผู้ใช้ทั่วไปนำเข้าไม่ได้');

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@nudorm.local', password: 'admin1234' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const dry = await upload(cookie, '?dry_run=1');
  assert.equal(dry.status, 200);
  assert.equal(dry.data.created, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 0, 'ตรวจก่อนไม่บันทึก');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sois WHERE name = 'ซอยใหม่จากชีต'").get().n, 0, 'ตรวจก่อนไม่สร้างซอย');

  const run = await upload(cookie);
  assert.equal(run.status, 200);
  assert.equal(run.data.created, 1);
  const p = db.prepare("SELECT p.status, s.name AS soi, (SELECT g.short_name FROM soi_gates sg JOIN gates g ON g.id = sg.gate_id WHERE sg.soi_id = s.id) AS gate FROM properties p JOIN sois s ON s.id = p.soi_id WHERE p.import_key = 'PROP-001'").get();
  assert.deepEqual({ ...p }, { status: 'published', soi: 'ซอยใหม่จากชีต', gate: 'ประตู 6' });

  const again = await upload(cookie);
  assert.equal(again.data.updated, 1, 'อัปโหลดซ้ำเป็นการอัปเดต ไม่สร้างรายการซ้ำ');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sois WHERE name = 'ซอยใหม่จากชีต'").get().n, 1, 'ไม่สร้างซอยซ้ำ');
});
