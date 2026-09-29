'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ExcelJS = require('exceljs');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const props = require('../server/properties');
const { searchProperties, parseFilters } = require('../server/search');
const { importWorkbook } = require('../server/import-sheet');

const db = open(':memory:');
const log = console.log;
console.log = () => {};
seed(db);
console.log = log;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nudorm-import-'));

/** สร้างไฟล์ xlsx ตามโครงสร้างชีตฐานข้อมูล (เฉพาะคอลัมน์ที่ใช้) */
async function workbook(file, { registry, rooms = [], images = [], amenities = [], rules = [], nearby = [], contacts = [] }) {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, headers, rows) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers);
    for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? null));
  };
  sheet('ทะเบียนที่พัก', ['property_id', 'source_id', 'ชื่อที่พักในไฟล์ต้นฉบับ', 'ชื่อที่พักที่ใช้แสดงบนเว็บ', 'ประเภทที่พัก',
    'แหล่งข้อมูลของรายการ', 'เลขที่อยู่', 'หมู่', 'ตำบล', 'อำเภอ', 'จังหวัด', 'ที่อยู่ฉบับเต็ม', 'ละติจูด', 'ลองจิจูด',
    'ประตูที่ใกล้ที่สุด', 'เงินประกัน (บาท)', 'ค่าน้ำและวิธีคิด', 'ค่าไฟและวิธีคิด', 'สถานะการคัดเลือก'], registry);
  sheet('ห้องและราคา', ['unit_id', 'property_id', 'ชื่อประเภทห้อง/ยูนิต', 'ราคาเช่าต่อเดือน (บาท)',
    'สิ่งของ/อุปกรณ์ในห้อง (บรรทัดละรายการ)', 'สถานะห้องว่าง'], rooms);
  sheet('รูปภาพ', ['image_id', 'property_id', 'ภาพของ', 'unit_id (เฉพาะภาพห้อง)', 'หมวดภาพ', 'ลำดับการแสดง', 'URL หรือที่เก็บไฟล์ภาพ'], images);
  sheet('สิ่งอำนวยความสะดวก', ['property_id', 'หอพัก: Wi-Fi', 'ในห้อง: เครื่องปรับอากาศ', 'เงื่อนไข: ผู้พัก', 'เงื่อนไข: อนุญาตให้ทำอาหารหรือไม่'], amenities);
  sheet('เงื่อนไขและข้อกำหนด', ['rule_id', 'property_id', 'หัวข้อ', 'รายละเอียด'], rules);
  sheet('สถานที่ใกล้เคียง', ['place_id', 'property_id', 'ชื่อที่พักในไฟล์ต้นฉบับ', 'ชื่อสถานที่', 'ประเภทสถานที่',
    'ระยะทางที่วัดได้ (เมตร)', 'ประเภทระยะทาง', 'แหล่งที่ตรวจสอบ'], nearby);
  sheet('ช่องทางติดต่อ', ['property_id', 'โทรศัพท์', 'LINE', 'Facebook (ลิงก์เต็ม)'], contacts);
  await wb.xlsx.writeFile(file);
  return file;
}

const byKey = (key) => db.prepare('SELECT * FROM properties WHERE import_key = ?').get(key);

test('นำเข้าจากชีต: เผยแพร่ทันทีโดยไม่ต้องรออนุมัติ แม้ยังไม่มีพิกัด และค้นหาได้', async () => {
  const before = searchProperties(db, parseFilters({})).length;
  const file = await workbook(path.join(dir, 'a.xlsx'), {
    registry: [
      { property_id: 'PROP-001', source_id: 'SRC-001', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'หอชีตหนึ่ง', 'ชื่อที่พักที่ใช้แสดงบนเว็บ': 'https://example.com/x',
        'ประเภทที่พัก': 'หอพัก/อพาร์ตเมนต์', 'แหล่งข้อมูลของรายการ': 'ไฟล์ อบต.', 'เลขที่อยู่': '12/3', 'หมู่': 7, 'ตำบล': 'ท่าโพธิ์',
        'อำเภอ': 'เมืองพิษณุโลก', 'จังหวัด': 'พิษณุโลก', 'ประตูที่ใกล้ที่สุด': 'ประตู 4', 'เงินประกัน (บาท)': 3000,
        'ค่าน้ำและวิธีคิด': '100 บาทต่อคน/เดือน', 'สถานะการคัดเลือก': 'รอตรวจสอบ' },
      { property_id: 'PROP-002', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'หอนอกขอบเขต', 'เลขที่อยู่': '1', 'สถานะการคัดเลือก': 'ไม่อยู่ในขอบเขต' },
      { property_id: 'PROP-003', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'คอนโดชีต', 'ประเภทที่พัก': 'คอนโด', 'ที่อยู่ฉบับเต็ม': '99 ถนนทดสอบ',
        'ละติจูด': 16.7588, 'ลองจิจูด': 100.1851, 'ประตูที่ใกล้ที่สุด': 'ประตู 4' },
    ],
    rooms: [
      { unit_id: 'unit001', property_id: 'PROP-001', 'ชื่อประเภทห้อง/ยูนิต': 'ห้องแอร์', 'ราคาเช่าต่อเดือน (บาท)': '2,800',
        'สิ่งของ/อุปกรณ์ในห้อง (บรรทัดละรายการ)': 'เครื่องปรับอากาศ\nตู้เย็น          เตียง', 'สถานะห้องว่าง': 'เต็ม' },
      { unit_id: 'unit002', property_id: 'PROP-001', 'ชื่อประเภทห้อง/ยูนิต': 'ห้องพัดลม' }, // ไม่มีราคา → ไม่นำเข้า
    ],
    images: [
      { image_id: 'image001', property_id: 'PROP-001', 'ภาพของ': 'อาคาร', 'หมวดภาพ': 'ด้านหน้าอาคาร', 'URL หรือที่เก็บไฟล์ภาพ': 'https://img.test/front.jpg  https://img.test/side.jpg\nhttps://img.test/gate.jpg' },
      { image_id: 'image002', property_id: 'PROP-001', 'ภาพของ': 'ห้องพัก', 'unit_id (เฉพาะภาพห้อง)': 'unit001', 'URL หรือที่เก็บไฟล์ภาพ': 'https://img.test/room.jpg' },
    ],
    amenities: [{ property_id: 'PROP-001', 'หอพัก: Wi-Fi': 'มี', 'ในห้อง: เครื่องปรับอากาศ': 'ไม่มี', 'เงื่อนไข: ผู้พัก': 'หญิงล้วน', 'เงื่อนไข: อนุญาตให้ทำอาหารหรือไม่': 'ไม่ได้' }],
    rules: [{ rule_id: 'r1', property_id: 'PROP-001', 'รายละเอียด': '1.ห้ามเลี้ยงสัตว์\n2.ปิดประตู 23.00 น.' }],
    nearby: [
      { place_id: 'p1', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'หอชีตหนึ่ง', 'ชื่อสถานที่': 'ร้านทดสอบ', 'ประเภทสถานที่': 'ร้านสะดวกซื้อ', 'ระยะทางที่วัดได้ (เมตร)': 50, 'ประเภทระยะทาง': 'เดิน' },
      { place_id: 'p2', property_id: 'PROP-001', 'ชื่อสถานที่': 'ไม่มีระยะ', 'ประเภทสถานที่': 'ตลาด' },
    ],
    contacts: [{ property_id: 'PROP-001', 'โทรศัพท์': 812345678, LINE: 'line-id' }],
  });

  const report = await importWorkbook(db, file);
  assert.deepEqual(report.created.map((r) => r.key), ['PROP-001', 'PROP-003']);
  assert.deepEqual(report.skippedOutOfScope, ['PROP-002']);

  const row = byKey('PROP-001');
  assert.equal(row.status, 'published');
  assert.equal(row.verified_at, null, 'ไม่มีวันที่ตรวจสอบในชีต จึงไม่ใส่วันที่นำเข้าแทน');
  assert.equal(row.lat, null);
  assert.equal(row.name, 'หอชีตหนึ่ง', 'ช่องชื่อที่เป็นลิงก์ ใช้ชื่อต้นฉบับแทน');
  assert.equal(row.address, '12/3 หมู่ 7 ต.ท่าโพธิ์ อ.เมืองพิษณุโลก จ.พิษณุโลก');
  assert.equal(row.contact_phone, '0812345678', 'เบอร์ที่เก็บเป็นตัวเลขได้ 0 ด้านหน้าคืน');

  const p = props.getProperty(db, row.id);
  assert.deepEqual(p.gates.map((g) => g.name), ['ประตู 4'], 'ประตูที่เกี่ยวข้องยังแสดงแม้ไม่มีพิกัด');
  assert.deepEqual(p.distances, []);
  assert.deepEqual(p.rooms.map((r) => [r.name, r.price, r.available, r.features_list, r.images.length]),
    [['ห้องแอร์', 2800, 0, ['เครื่องปรับอากาศ', 'ตู้เย็น', 'เตียง'], 1]]);
  assert.deepEqual(p.images.map((i) => [i.url, i.category]), [
    ['https://img.test/front.jpg', 'ด้านหน้าอาคาร'], ['https://img.test/side.jpg', 'ด้านหน้าอาคาร'], ['https://img.test/gate.jpg', 'ด้านหน้าอาคาร'],
  ], 'หลายลิงก์ในเซลล์เดียวแยกเป็นหลายรูป');
  assert.deepEqual(p.amenity_codes.sort(), ['wifi', 'women_only']);
  assert.deepEqual(p.rules.map((r) => r.detail), ['ห้ามเลี้ยงสัตว์', 'ปิดประตู 23.00 น.', 'ไม่อนุญาตให้ทำอาหารในห้อง']);
  assert.deepEqual(p.nearby.map((n) => [n.name, n.display_distance_m]), [['ร้านทดสอบ', 50]], 'จับคู่ด้วยชื่อหอ และข้ามรายการที่ไม่มีระยะ');
  assert.equal(props.getProperty(db, byKey('PROP-003').id).type_code, 'condo');

  const all = searchProperties(db, parseFilters({}));
  assert.equal(all.length, before + 1, 'แสดงเฉพาะหอที่มีราคาหรือรูปแล้ว');
  assert.ok(!all.some((r) => r.id === byKey('PROP-003').id), 'หอที่ยังไม่มีราคาและรูปไม่แสดงต่อผู้ใช้ทั่วไป');
  assert.equal(all.at(-1).id, row.id, 'รายการที่ไม่มีพิกัดเรียงไว้ท้ายสุดเมื่อเรียงตามระยะ');
  assert.ok(searchProperties(db, parseFilters({ gate: String(p.gates[0].id) })).some((r) => r.id === row.id), 'กรองตามประตูได้');
  assert.ok(!searchProperties(db, parseFilters({ max_distance: '5000' })).some((r) => r.id === row.id), 'ไม่มีพิกัดจึงไม่ผ่านตัวกรองระยะทาง');
});

test('นำเข้าซ้ำ: ข้ามรายการเดิม, --update อัปเดตจากชีต ยกเว้นที่ผู้ดูแลซ่อนไว้, --dry-run ไม่บันทึก', async () => {
  const registry = [
    { property_id: 'PROP-001', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'หอชีตหนึ่ง (แก้ชื่อ)', 'เลขที่อยู่': '12/3' },
    { property_id: 'PROP-003', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'คอนโดชีต (แก้ชื่อ)', 'เลขที่อยู่': '99' },
    { property_id: 'PROP-009', 'ชื่อที่พักในไฟล์ต้นฉบับ': 'หอใหม่', 'เลขที่อยู่': '5' },
  ];
  const file = await workbook(path.join(dir, 'b.xlsx'), { registry });
  db.prepare("UPDATE properties SET status = 'hidden' WHERE import_key = 'PROP-003'").run();
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM properties').get().n;

  const n0 = count();
  const dry = await importWorkbook(db, file, { update: true, dryRun: true });
  assert.equal(dry.created.length, 1);
  assert.equal(count(), n0, 'dry-run ไม่บันทึก');
  assert.equal(byKey('PROP-001').name, 'หอชีตหนึ่ง');

  const plain = await importWorkbook(db, file);
  assert.deepEqual([plain.created.length, plain.skippedExisting.length, plain.skippedHidden.length], [1, 1, 1]);
  assert.equal(byKey('PROP-001').name, 'หอชีตหนึ่ง', 'ไม่ใส่ --update ไม่แก้รายการเดิม');

  const upd = await importWorkbook(db, file, { update: true });
  assert.deepEqual(upd.updated.map((r) => r.key), ['PROP-001', 'PROP-009']);
  assert.equal(byKey('PROP-001').name, 'หอชีตหนึ่ง (แก้ชื่อ)');
  assert.equal(byKey('PROP-003').name, 'คอนโดชีต', 'รายการที่ผู้ดูแลซ่อนไว้ไม่ถูกเขียนทับหรือเปิดกลับ');
  assert.equal(byKey('PROP-003').status, 'hidden');
});

test('ย้ายฐานข้อมูลเดิมที่บังคับพิกัด (NOT NULL) โดยข้อมูลและตารางลูกไม่หาย', () => {
  const file = path.join(dir, 'old-props.db');
  const fresh = open(file);
  fresh.close();
  // จำลองฐานข้อมูลก่อนเวอร์ชัน 4: ตาราง properties ที่ lat/lng เป็น NOT NULL
  const old = new DatabaseSync(file);
  const sql = old.prepare("SELECT sql FROM sqlite_master WHERE name = 'properties'").get().sql;
  old.exec('PRAGMA foreign_keys = OFF');
  old.exec(sql.replace('CREATE TABLE properties', 'CREATE TABLE p_old').replace(/\b(lat|lng)(\s+)REAL/g, '$1$2REAL NOT NULL'));
  old.exec('DROP TABLE properties; ALTER TABLE p_old RENAME TO properties; PRAGMA user_version = 3;');
  old.exec("INSERT INTO property_types (code, name) VALUES ('dorm', 'หอพัก')");
  old.exec("INSERT INTO properties (id, name, type_id, address, lat, lng) VALUES (1, 'หอเดิม', 1, 'ที่อยู่', 16.75, 100.18)");
  old.exec("INSERT INTO room_types (property_id, name, price) VALUES (1, 'ห้อง', 2500)");
  old.close();

  const migrated = open(file);
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 4);
  assert.equal(migrated.prepare('SELECT name FROM properties WHERE id = 1').get().name, 'หอเดิม');
  assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM room_types WHERE property_id = 1').get().n, 1);
  migrated.prepare("INSERT INTO properties (name, type_id, address) VALUES ('ไม่มีพิกัด', 1, 'ที่อยู่')").run();
  migrated.prepare('DELETE FROM properties WHERE id = 1').run();
  assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM room_types').get().n, 0, 'foreign key ยังลบตารางลูกตามได้');
  migrated.close();
});

test('ลิงก์แชร์ Google Drive แปลงเป็นลิงก์รูปภาพ ส่วนลิงก์อื่นคงเดิม', () => {
  const { driveImageUrl } = require('../server/import-sheet');
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const want = `https://lh3.googleusercontent.com/d/${id}=w1600`;
  assert.equal(driveImageUrl(`https://drive.google.com/file/d/${id}/view?usp=sharing`), want);
  assert.equal(driveImageUrl(`https://drive.google.com/open?id=${id}`), want);
  assert.equal(driveImageUrl(`https://drive.google.com/uc?export=view&id=${id}`), want);
  assert.equal(driveImageUrl('https://drive.google.com/drive/folders/abc'), 'https://drive.google.com/drive/folders/abc');
  assert.equal(driveImageUrl('https://img.test/a.jpg'), 'https://img.test/a.jpg');
});
