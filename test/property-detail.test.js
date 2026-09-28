'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const props = require('../server/properties');

const db = open(':memory:');
const log = console.log;
console.log = () => {};
seed(db);
console.log = log;

const gateId = db.prepare("SELECT id FROM gates WHERE short_name = 'ประตู 4'").get().id;
const base = {
  name: 'หอทดสอบหลายห้อง', type_code: 'dorm', address: 'ที่อยู่ทดสอบ', lat: 16.759, lng: 100.184,
  contact_phone: '0800000000', gate_ids: [gateId],
};

function create(body) {
  const { data, errors } = props.validatePayload(db, { ...base, ...body });
  assert.deepEqual(errors, []);
  return props.getProperty(db, props.createProperty(db, data, { status: 'published' }));
}

test('รูปและรายละเอียดของแต่ละประเภทห้องแยกกัน ไม่ปะปนกับห้องราคาอื่นหรือรูปอาคาร', () => {
  const p = create({
    images: [{ url: '/uploads/front.jpg', category: 'ด้านหน้าอาคาร', caption: 'หน้าตึก' }, { url: '/uploads/lobby.jpg', category: 'พื้นที่ส่วนกลาง' }],
    rooms: [
      { name: 'ห้องแอร์ใหญ่', price: 3000, features: 'เตียง 6 ฟุต\nตู้เย็น', images: [{ url: '/uploads/r3000.jpg', caption: 'มุมเตียง' }] },
      { name: 'ห้องแอร์', price: 2800, features: 'เตียง 5 ฟุต, โต๊ะเขียนหนังสือ', images: [{ url: '/uploads/r2800a.jpg' }, { url: '/uploads/r2800b.jpg' }] },
    ],
  });
  assert.deepEqual(p.images.map((i) => i.url), ['/uploads/front.jpg', '/uploads/lobby.jpg']);
  assert.equal(p.images[0].category, 'ด้านหน้าอาคาร');
  const [cheap, big] = p.rooms; // เรียงตามราคา
  assert.equal(cheap.price, 2800);
  assert.deepEqual(cheap.images.map((i) => i.url), ['/uploads/r2800a.jpg', '/uploads/r2800b.jpg']);
  assert.deepEqual(cheap.features_list, ['เตียง 5 ฟุต', 'โต๊ะเขียนหนังสือ']);
  assert.deepEqual(big.images, [{ url: '/uploads/r3000.jpg', caption: 'มุมเตียง' }]);
  assert.deepEqual(big.features_list, ['เตียง 6 ฟุต', 'ตู้เย็น']);
});

test('ห้องแบบเดียวราคาเดียว เก็บเป็นประเภทห้องเดียว', () => {
  const p = create({ rooms: [{ name: 'ห้องมาตรฐาน', price: 2500 }] });
  assert.equal(p.rooms.length, 1);
  assert.deepEqual(p.rooms[0].images, []);
  assert.deepEqual(p.rooms[0].features_list, []);
});

test('ข้อกำหนดและสถานที่ใกล้เคียงบันทึกและคำนวณระยะเส้นตรงเมื่อไม่มีระยะที่วัดได้', () => {
  const p = create({
    rooms: [{ name: 'ห้อง', price: 2500 }],
    rules: [{ topic: 'สัตว์เลี้ยง', detail: 'ห้ามเลี้ยงสัตว์' }, { topic: 'เวลาเข้าออกอาคาร', detail: 'ประตูปิด 24.00 น.' }, { topic: 'อื่น ๆ', detail: '' }],
    nearby: [
      { name: 'ร้านทดสอบ ก', category: 'ร้านอาหาร', distance_m: '150', distance_type: 'เดิน', source: 'สำรวจพื้นที่' },
      { name: 'ร้านทดสอบ ข', category: 'ร้านสะดวกซื้อ', lat: 16.760, lng: 100.184, source: 'Google Maps' },
    ],
  });
  assert.deepEqual(p.rules.map((r) => r.topic), ['สัตว์เลี้ยง', 'เวลาเข้าออกอาคาร']);
  const byName = Object.fromEntries(p.nearby.map((n) => [n.name, n]));
  assert.equal(byName['ร้านทดสอบ ก'].display_distance_m, 150);
  assert.equal(byName['ร้านทดสอบ ก'].display_distance_type, 'เดิน');
  assert.ok(Math.abs(byName['ร้านทดสอบ ข'].display_distance_m - 111) <= 1);
  assert.equal(byName['ร้านทดสอบ ข'].display_distance_type, 'เส้นตรง');
  // เรียงจากใกล้ไปไกล
  assert.deepEqual(p.nearby.map((n) => n.name), ['ร้านทดสอบ ข', 'ร้านทดสอบ ก']);
});

test('ไม่รับสถานที่ใกล้เคียงที่ไม่มีแหล่งตรวจสอบ ระยะ หรือพิกัด และเว็บไซต์ต้องเป็นลิงก์เต็ม', () => {
  const { errors } = props.validatePayload(db, {
    ...base,
    rooms: [{ name: 'ห้อง', price: 2500 }],
    contact_website: 'www.example.com',
    nearby: [{ name: 'ร้านไม่มีข้อมูล', category: 'ร้านอาหาร' }, { name: 'ร้านไม่ระบุประเภทระยะ', distance_m: 100, source: 'x' }],
  });
  assert.ok(errors.some((e) => e.includes('ต้องมีระยะทางที่วัดได้หรือพิกัด')));
  assert.ok(errors.some((e) => e.includes('กรุณาระบุแหล่งที่ตรวจสอบ')));
  assert.ok(errors.some((e) => e.includes('กรุณาระบุประเภทระยะทาง')));
  assert.ok(errors.some((e) => e.includes('https://')));
});

test('สิ่งอำนวยความสะดวกแยกหมวด ของหอพัก / ภายในห้อง / เงื่อนไขผู้พัก', () => {
  const scope = Object.fromEntries(db.prepare('SELECT code, scope FROM amenities').all().map((a) => [a.code, a.scope]));
  assert.equal(scope.aircon, 'room');
  assert.equal(scope.parking_motorbike, 'building');
  assert.equal(scope.water_dispenser, 'building');
  assert.equal(scope.covered_parking, 'building');
  assert.equal(scope.pets, 'rule');
});

test('รูปแบบรูปภาพเดิม (string) ยังใช้ได้', () => {
  const p = create({ rooms: [{ name: 'ห้อง', price: 2500 }], images: ['/uploads/old.jpg', 'javascript:alert(1)'] });
  assert.deepEqual(p.images, [{ url: '/uploads/old.jpg', category: null, caption: null }]);
});
