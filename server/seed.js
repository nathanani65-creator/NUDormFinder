'use strict';
/**
 * ข้อมูลเริ่มต้นและข้อมูลตัวอย่าง
 *
 * ⚠ พิกัดประตูเป็นค่าประมาณเพื่อใช้พัฒนาระบบเท่านั้น ผู้ดูแลต้องตรวจสอบกับตำแหน่งจริง
 *   แล้วแก้ไขในหน้าผู้ดูแลระบบ (แท็บ "ประตู") ก่อนใช้งานจริง
 * ⚠ ที่พักทั้งหมดในไฟล์นี้เป็นข้อมูลสมมติสำหรับทดสอบ ไม่ใช่ที่พักจริง
 */
const fs = require('node:fs');
const { open, tx, DB_PATH } = require('./db');
const { hashPassword } = require('./auth');
const { createProperty } = require('./properties');

const SAMPLE_SOURCE = 'ข้อมูลสมมติสำหรับทดสอบระบบ';

const GATES = [
  { key: 1, name: 'ประตู 1 (ประตูหน้า)', short: 'ประตู 1', lat: 16.7499, lng: 100.1902, desc: 'ประตูหน้ามหาวิทยาลัย (พิกัดโดยประมาณ — รอผู้ดูแลตรวจสอบ)' },
  { key: 3, name: 'ประตู 3', short: 'ประตู 3', lat: 16.7569, lng: 100.1885, desc: 'พิกัดโดยประมาณ — รอผู้ดูแลตรวจสอบ' },
  { key: 4, name: 'ประตู 4 (หลังมอ)', short: 'ประตู 4', lat: 16.7589, lng: 100.1834, desc: 'ย่านหอพักที่นิสิตเรียกว่า "หลังมอ" (พิกัดโดยประมาณ)' },
  { key: 5, name: 'ประตู 5', short: 'ประตู 5', lat: 16.7532, lng: 100.1787, desc: 'พิกัดโดยประมาณ — รอผู้ดูแลตรวจสอบ' },
  { key: 6, name: 'ประตู 6', short: 'ประตู 6', lat: 16.7462, lng: 100.1798, desc: 'พิกัดโดยประมาณ — รอผู้ดูแลตรวจสอบ' },
];

// เนื้อหาโซนประตู 1, 4 และ 5–6 มาจากผู้พัฒนา ส่วนโซนประตู 3 ยังรอข้อมูลจริง
const ZONES = [
  {
    key: 'back', name: 'โซนหลังมหาวิทยาลัย', gates: [4], order: 1, color: 'amber', tagline: 'โซนยอดนิยมอันดับ 1',
    desc: 'ศูนย์รวมไลฟ์สไตล์ของนิสิต มีซอยดังอย่าง **ซอยเคียงคลอง** และ **ซอยคุณพุ่ม** ครบครันด้วยร้านอาหาร คาเฟ่ ร้านสะดวกซื้อ 24 ชม. และตลาดเดินเล่นตอนเย็น',
    keySois: 'เคียงคลอง, คุณพุ่ม, ซอยสุขสมบูรณ์',
    tips: 'เดินหรือปั่นจักรยานเข้าประตู 4 ได้',
  },
  {
    key: 'front', name: 'โซนถนนใหญ่ & คอนโด', gates: [1], order: 2, color: 'teal', tagline: 'โซนหน้า มน.',
    desc: 'อยู่ติดถนนสายหลักพิษณุโลก-นครสวรรค์ เดินทางสะดวก มีโครงการคอนโดมิเนียม และหอพักใหม่ขนาดใหญ่ ใกล้โรงพยาบาล ม.นเรศวร เหมาะกับผู้ชอบความสงบ',
    keySois: 'ถนนริมคลองชลประทาน, ฝั่ง รพ.มน.',
    tips: 'เดินทางเข้าเมืองสะดวก',
  },
  {
    key: 'west', name: 'โซนราคาย่อมเยา & ใกล้คณะวิทยาศาสตร์', gates: [5, 6], order: 3, color: 'violet', tagline: 'โซนฝั่งข้างมอ',
    desc: 'บรรยากาศเงียบสงบ หอพักมีราคาย่อมเยา ค่าเช่าเริ่มต้นสบายกระเป๋า เดินทางเข้าเรียนฝั่งคณะวิทยาศาสตร์ คณะเกษตรศาสตร์ ได้สะดวกมาก',
    keySois: 'ซอยข้างโรงเรียนสาธิต มน.',
    tips: 'บางซอยเชื่อมได้ทั้งประตู 5 และ 6 ควรดูระยะถึงประตูที่ใช้จริง',
  },
  {
    key: 'g3', name: 'โซนประตู 3', gates: [3], order: 4, color: 'blue', tagline: 'รอข้อมูลเพิ่มเติม',
    desc: 'กำลังรวบรวมข้อมูลสรุปทำเลของโซนนี้ ดูที่พักและซอยใกล้ประตู 3 ได้จากปุ่มด้านล่าง',
    keySois: '',
    tips: '',
  },
];

const SOIS = [
  { key: 'krabok', name: 'ซอยกระบอกวิศวะ', zone: 'back', gates: [4], desc: 'ซอยหอพักด้านหลังมหาวิทยาลัย' },
  { key: 'back2', name: 'ซอยหลังมอ 2 (ตัวอย่าง)', zone: 'back', gates: [4, 3], desc: 'ซอยสมมติ เชื่อมประตู 3 และ 4' },
  { key: 'front1', name: 'ซอยหน้ามอ 1 (ตัวอย่าง)', zone: 'front', gates: [1], desc: 'ซอยสมมติ' },
  { key: 'g3a', name: 'ซอยประตู 3 (ตัวอย่าง)', zone: 'g3', gates: [3], desc: 'ซอยสมมติ' },
  { key: 'west1', name: 'ซอยเชื่อมประตู 5–6 (ตัวอย่าง)', zone: 'west', gates: [5, 6], desc: 'ซอยสมมติที่เดินได้ทั้งสองประตู' },
  { key: 'g5a', name: 'ซอยประตู 5 (ตัวอย่าง)', zone: 'west', gates: [5], desc: 'ซอยสมมติ' },
];

const TYPES = [
  ['dorm', 'หอพัก'],
  ['apartment', 'อพาร์ตเมนต์'],
  ['condo', 'คอนโด'],
  ['house', 'บ้านเช่า'],
];

const AMENITIES = [
  ['aircon', 'เครื่องปรับอากาศ'],
  ['fan', 'พัดลม'],
  ['wifi', 'อินเทอร์เน็ต Wi-Fi'],
  ['parking_motorbike', 'ที่จอดรถจักรยานยนต์'],
  ['parking_car', 'ที่จอดรถยนต์'],
  ['water_heater', 'เครื่องทำน้ำอุ่น'],
  ['furnished', 'เฟอร์นิเจอร์'],
  ['fridge', 'ตู้เย็น'],
  ['cctv', 'กล้องวงจรปิด'],
  ['keycard', 'คีย์การ์ด'],
  ['laundry', 'เครื่องซักผ้าหยอดเหรียญ'],
  ['pets', 'เลี้ยงสัตว์ได้'],
  ['women_only', 'หญิงล้วน'],
  ['men_only', 'ชายล้วน'],
];

// [ชื่อ, ประเภท, ซอย, ประตูที่เกี่ยวข้อง, dLat, dLng จากประตูแรก, ห้อง[[ชื่อ, ราคา, ขนาด]], สิ่งอำนวยความสะดวก]
const SAMPLES = [
  ['หอพักบ้านกระบอก (สมมติ)', 'dorm', 'krabok', [4], 0.0014, 0.0006, [['ห้องพัดลม', 2200, 20], ['ห้องแอร์', 2900, 22]], ['aircon', 'fan', 'wifi', 'parking_motorbike', 'cctv']],
  ['วิศวะเพลส (สมมติ)', 'dorm', 'krabok', [4], 0.0019, -0.0004, [['ห้องแอร์มาตรฐาน', 3200, 24]], ['aircon', 'wifi', 'parking_motorbike', 'parking_car', 'water_heater', 'keycard']],
  ['หอพักหญิงร่มไม้ (สมมติ)', 'dorm', 'krabok', [4], 0.0011, 0.0012, [['ห้องแอร์', 2800, 21]], ['aircon', 'wifi', 'parking_motorbike', 'women_only', 'cctv', 'laundry']],
  ['เดอะหลังมอ อพาร์ตเมนต์ (สมมติ)', 'apartment', 'back2', [4, 3], 0.0006, 0.0034, [['สตูดิโอ', 3500, 28], ['ห้องใหญ่', 4200, 34]], ['aircon', 'wifi', 'parking_motorbike', 'parking_car', 'furnished', 'fridge', 'water_heater', 'keycard']],
  ['หอพักประหยัดหลังมอ (สมมติ)', 'dorm', 'back2', [4, 3], 0.0003, 0.0022, [['ห้องพัดลม', 1800, 18]], ['fan', 'wifi', 'parking_motorbike']],
  ['หน้ามอ เรสซิเดนซ์ (สมมติ)', 'apartment', 'front1', [1], 0.0008, 0.0015, [['ห้องแอร์', 3800, 26], ['ห้องแอร์ มีระเบียง', 4300, 30]], ['aircon', 'wifi', 'parking_car', 'parking_motorbike', 'furnished', 'fridge', 'cctv']],
  ['คอนโดหน้ามหาวิทยาลัย (สมมติ)', 'condo', 'front1', [1], -0.0012, 0.0021, [['1 ห้องนอน', 6500, 32]], ['aircon', 'wifi', 'parking_car', 'furnished', 'fridge', 'water_heater', 'keycard', 'cctv']],
  ['หอพักชายหน้ามอ (สมมติ)', 'dorm', 'front1', [1], 0.0017, 0.0009, [['ห้องพัดลม', 2000, 18], ['ห้องแอร์', 2700, 20]], ['aircon', 'fan', 'parking_motorbike', 'men_only', 'laundry']],
  ['บ้านสวนประตูสาม (สมมติ)', 'dorm', 'g3a', [3], 0.0012, 0.0010, [['ห้องแอร์', 3000, 22]], ['aircon', 'wifi', 'parking_motorbike', 'parking_car', 'cctv']],
  ['ประตูสาม คอนโดมิเนียม (สมมติ)', 'condo', 'g3a', [3], 0.0021, 0.0004, [['สตูดิโอ', 5500, 27]], ['aircon', 'wifi', 'parking_car', 'furnished', 'fridge', 'water_heater', 'keycard']],
  ['บ้านเช่าเรือนไม้ (สมมติ)', 'house', 'west1', [5, 6], -0.0040, -0.0010, [['บ้านทั้งหลัง 2 ห้องนอน', 5000, 80]], ['fan', 'parking_car', 'parking_motorbike', 'pets']],
  ['อพาร์ตเมนต์สองประตู (สมมติ)', 'apartment', 'west1', [5, 6], -0.0045, -0.0022, [['ห้องแอร์', 2900, 24], ['ห้องแอร์ ชั้นบน', 3100, 24]], ['aircon', 'wifi', 'parking_car', 'parking_motorbike', 'water_heater']],
  ['หอพักร่มรื่นประตูห้า (สมมติ)', 'dorm', 'g5a', [5], 0.0008, -0.0014, [['ห้องพัดลม', 1900, 18], ['ห้องแอร์', 2500, 20]], ['aircon', 'fan', 'wifi', 'parking_motorbike']],
  ['บ้านเช่าประตูหก (สมมติ)', 'house', 'west1', [6], -0.0010, -0.0016, [['ทาวน์เฮาส์ 2 ชั้น', 7000, 110]], ['aircon', 'parking_car', 'parking_motorbike', 'furnished', 'pets']],
];

function seed(db) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nudorm.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  const demoProviderPassword = 'provider1234';

  const ids = tx(db, () => {
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'ผู้ดูแลระบบ', ?, 'admin')").run(adminEmail, hashPassword(adminPassword));
    db.prepare("INSERT INTO users (email, name, phone, password_hash, role) VALUES ('provider@nudorm.local', 'ผู้ประกอบการตัวอย่าง', '080-000-0000', ?, 'provider')").run(hashPassword(demoProviderPassword));

    const gateId = {};
    GATES.forEach((g, i) => {
      gateId[g.key] = Number(
        db.prepare('INSERT INTO gates (name, short_name, lat, lng, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(g.name, g.short, g.lat, g.lng, g.desc, i).lastInsertRowid
      );
    });
    const zoneId = {};
    for (const z of ZONES) {
      zoneId[z.key] = Number(
        db.prepare('INSERT INTO zones (name, description, travel_tips, tagline, key_sois, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(z.name, z.desc, z.tips, z.tagline, z.keySois, z.color, z.order).lastInsertRowid
      );
      for (const g of z.gates) db.prepare('INSERT INTO zone_gates (zone_id, gate_id) VALUES (?, ?)').run(zoneId[z.key], gateId[g]);
    }
    const soiId = {};
    for (const s of SOIS) {
      soiId[s.key] = Number(db.prepare('INSERT INTO sois (name, zone_id, description) VALUES (?, ?, ?)').run(s.name, zoneId[s.zone], s.desc).lastInsertRowid);
      for (const g of s.gates) db.prepare('INSERT INTO soi_gates (soi_id, gate_id) VALUES (?, ?)').run(soiId[s.key], gateId[g]);
    }
    for (const [code, name] of TYPES) db.prepare('INSERT INTO property_types (code, name) VALUES (?, ?)').run(code, name);
    for (const [code, name] of AMENITIES) db.prepare('INSERT INTO amenities (code, name) VALUES (?, ?)').run(code, name);

    const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail).id;
    const typeId = Object.fromEntries(db.prepare('SELECT code, id FROM property_types').all().map((t) => [t.code, t.id]));
    return { gateId, soiId, typeId, adminId };
  });

  // createProperty เปิด transaction ของตัวเอง จึงเรียกหลังจากข้อมูลอ้างอิงถูก COMMIT แล้ว
  const byGate = Object.fromEntries(GATES.map((g) => [g.key, g]));
  SAMPLES.forEach(([name, type, soi, gates, dLat, dLng, rooms, amenities], i) => {
    const data = {
      name,
      type_id: ids.typeId[type],
      soi_id: ids.soiId[soi],
      address: `${SOIS.find((s) => s.key === soi).name} ต.ท่าโพธิ์ อ.เมืองพิษณุโลก จ.พิษณุโลก 65000`,
      lat: +(byGate[gates[0]].lat + dLat).toFixed(6),
      lng: +(byGate[gates[0]].lng + dLng).toFixed(6),
      description: 'ที่พักสมมติสำหรับทดสอบการค้นหาและการแสดงผลบนแผนที่',
      deposit: rooms[0][1] * 2,
      water_rate: 'ยูนิตละ 18 บาท',
      electric_rate: 'ยูนิตละ 7 บาท',
      other_fees: 'ค่าส่วนกลาง 100 บาท/เดือน',
      lease_terms: 'สัญญาขั้นต่ำ 1 ภาคการศึกษา',
      contact_name: 'ผู้ดูแลหอ (สมมติ)',
      contact_phone: `080-000-${String(1000 + i).slice(-4)}`,
      contact_line: '',
      contact_facebook: '',
      data_source: SAMPLE_SOURCE,
      gate_ids: gates.map((k) => ids.gateId[k]),
      amenity_codes: amenities,
      rooms: rooms.map(([rName, price, size]) => ({ name: rName, price, size_sqm: size, available: 1, note: '' })),
      images: [],
    };
    createProperty(db, data, { status: 'published', verifiedBy: ids.adminId });
  });

  console.log(`ผู้ดูแลระบบ: ${adminEmail} / ${adminPassword}`);
  console.log(`ผู้ประกอบการตัวอย่าง: provider@nudorm.local / ${demoProviderPassword}`);
  console.log(`ที่พักตัวอย่าง: ${SAMPLES.length} รายการ`);
}

if (require.main === module) {
  // npm run seed: ล้างฐานข้อมูลแล้วสร้างใหม่
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true });
  seed(open());
}

module.exports = { seed };
