'use strict';
/**
 * นำเข้าข้อมูลที่พักจากไฟล์ Excel ของชีตฐานข้อมูล (NU Dorm Finder - ฐานข้อมูลที่พัก)
 *
 *   npm run import -- "ไฟล์.xlsx"             นำเข้าเฉพาะรายการใหม่ (property_id ที่ยังไม่มีในเว็บ)
 *   npm run import -- "ไฟล์.xlsx" --update    อัปเดตรายการที่เคยนำเข้าด้วยข้อมูลล่าสุดจากชีต
 *   npm run import -- "ไฟล์.xlsx" --dry-run   ตรวจอย่างเดียว ไม่บันทึก
 *
 * ข้อมูลจากชีตเป็นข้อมูลที่ทีมงานรวบรวมเอง จึงเผยแพร่ทันทีโดยไม่ต้องรอผู้ดูแลอนุมัติ
 * (ต่างจากประกาศที่ผู้ประกอบการส่งเองบนเว็บ ซึ่งต้องรออนุมัติเสมอ)
 * ชีตเป็นต้นฉบับ: --update จะเขียนทับการแก้ไขบนเว็บของรายการที่มาจากชีต
 * ยกเว้นรายการที่ผู้ดูแลซ่อนหรือไม่อนุมัติไว้ ซึ่งจะไม่ถูกเปิดกลับขึ้นมา
 */
const path = require('node:path');
const ExcelJS = require('exceljs');
const { open, tx, DB_PATH } = require('./db');
const { createProperty, updateProperty, MAP_URL, IMAGE_CATEGORIES, RULE_TOPICS, NEARBY_CATEGORIES, DISTANCE_TYPES } = require('./properties');

// ขอบเขตพิกัดเดียวกับ validatePayload
const AREA = { minLat: 16.68, maxLat: 16.82, minLng: 100.12, maxLng: 100.28 };

const SHEETS = {
  registry: 'ทะเบียนที่พัก',
  rooms: 'ห้องและราคา',
  images: 'รูปภาพ',
  amenities: 'สิ่งอำนวยความสะดวก',
  rules: 'เงื่อนไขและข้อกำหนด',
  nearby: 'สถานที่ใกล้เคียง',
  contacts: 'ช่องทางติดต่อ',
};

// หัวคอลัมน์ในชีตสิ่งอำนวยความสะดวก → รหัสบนเว็บ (db.js AMENITY_CATALOG)
const AMENITY_COLUMNS = {
  'หอพัก: Wi-Fi': 'wifi',
  'หอพัก: ที่จอดรถจักรยานยนต์': 'parking_motorbike',
  'หอพัก: ที่จอดรถยนต์': 'parking_car',
  'หอพัก: โรงจอดรถ (มีหลังคา)': 'covered_parking',
  'หอพัก: ตู้กดน้ำดื่ม': 'water_dispenser',
  'หอพัก: เครื่องซักผ้าหยอดเหรียญ': 'laundry',
  'หอพัก: ระบบคีย์การ์ด': 'keycard',
  'หอพัก: กล้องวงจรปิด': 'cctv',
  'หอพัก: รปภ.': 'security_guard',
  'หอพัก: ลิฟต์': 'elevator',
  'หอพัก: พื้นที่ส่วนกลาง': 'common_area',
  'ในห้อง: เครื่องปรับอากาศ': 'aircon',
  'ในห้อง: พัดลม': 'fan',
  'ในห้อง: เครื่องทำน้ำอุ่น': 'water_heater',
  'ในห้อง: เฟอร์นิเจอร์': 'furnished',
  'ในห้อง: ตู้เย็น': 'fridge',
};

// สถานะในชีตที่ไม่นำขึ้นเว็บ
const SKIP_STATUSES = new Set(['ไม่อยู่ในขอบเขต']);

// ---------------------------------------------------------------- อ่านไฟล์
/** แปลงค่าเซลล์ของ exceljs เป็นข้อความ/ตัวเลขธรรมดา (สูตรใช้ผลลัพธ์ที่คำนวณไว้) */
function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellValue(v.result);
    // ลิงก์: ใช้ข้อความในเซลล์ (อาจมีหลายลิงก์ในเซลล์เดียว) ถ้าไม่มีจึงใช้ปลายทางของลิงก์
    if ('text' in v && cellValue(v.text) !== '') return cellValue(v.text);
    if (v.hyperlink) return String(v.hyperlink);
    return '';
  }
  return v;
}

/** แถวของชีตเป็น object โดยใช้บรรทัดแรกของหัวคอลัมน์เป็นชื่อ */
/**
 * อ่านชีตเป็นรายการ object ตามหัวคอลัมน์แถวแรก
 * expected: { ลำดับคอลัมน์: ชื่อหัวคอลัมน์ } ถ้าชีตไม่มีหัวคอลัมน์ชื่อนี้เลย (เช่น ช่องหัวถูกพิมพ์ทับ)
 * ใช้คอลัมน์ตามลำดับนั้นแทน และบันทึกลง notes
 */
function readSheet(wb, name, { expected = {}, notes = [] } = {}) {
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cellValue(cell.value)).split('\n')[0].trim();
  });
  for (const [col, header] of Object.entries(expected)) {
    if (headers.includes(header)) continue;
    notes.push(`ชีต "${name}" ไม่มีหัวคอลัมน์ "${header}" (ช่องหัวคอลัมน์ลำดับที่ ${col} เป็น "${headers[col] || ''}") จึงใช้คอลัมน์นี้แทน ควรแก้หัวคอลัมน์ในชีตให้ถูกต้อง`);
    headers[col] = header;
  }
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {};
    headers.forEach((h, col) => {
      if (!h) return;
      const v = cellValue(row.getCell(col).value);
      obj[h] = typeof v === 'string' ? v.trim() : v;
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

// ---------------------------------------------------------------- แปลงค่า
const text = (v) => (v == null ? '' : String(v).trim());
const isUrl = (v) => /^https?:\/\/\S+$/.test(text(v));

function num(v) {
  if (typeof v === 'number') return v;
  const s = text(v).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** เบอร์โทรที่ถูกเก็บเป็นตัวเลข (เลข 0 ด้านหน้าหาย) */
function phone(v) {
  if (typeof v === 'number') {
    const s = String(Math.round(v));
    return s.length === 9 ? `0${s}` : s;
  }
  return text(v).replace(/\.0$/, '');
}

function lines(v) {
  // บรรทัดละรายการ (บางแถวในชีตคั่นด้วยช่องว่างยาวแทนการขึ้นบรรทัด)
  return text(v).split(/\r?\n|\s{3,}/).map((x) => x.replace(/^\s*\d+\s*[.)]\s*/, '').trim()).filter(Boolean);
}

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = text(r[key]);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/**
 * ลิงก์แชร์ของ Google Drive (หน้าเปิดไฟล์) ใช้เป็นรูปบนเว็บโดยตรงไม่ได้ → แปลงเป็นลิงก์รูปภาพของไฟล์นั้น
 * ไฟล์ต้องแชร์แบบ "ทุกคนที่มีลิงก์" ส่วนลิงก์โฟลเดอร์ใช้ไม่ได้ ต้องเป็นลิงก์ของรูปทีละไฟล์
 */
function driveImageUrl(url) {
  const m = url.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/([\w-]{20,})|(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([\w-]{20,}))/);
  return m ? `https://lh3.googleusercontent.com/d/${m[1] || m[2]}=w1600` : url;
}

// ชื่อประตูไม่สนช่องว่าง: "ประตู6" = "ประตู 6"
const gateKey = (s) => text(s).replace(/\s+/g, '');

function typeCode(v) {
  const s = text(v);
  if (s.includes('คอนโด')) return 'condo';
  if (s.includes('บ้าน')) return 'house';
  return 'dorm';
}

function address(r) {
  const full = text(r['ที่อยู่ฉบับเต็ม']).replace(/\s+/g, ' ');
  if (full) return full;
  const moo = num(r['หมู่']);
  return [
    text(r['เลขที่อยู่']),
    moo != null ? `หมู่ ${moo}` : text(r['หมู่']) && `หมู่ ${text(r['หมู่'])}`,
    text(r['ตำบล']) && `ต.${text(r['ตำบล'])}`,
    text(r['อำเภอ']) && `อ.${text(r['อำเภอ'])}`,
    text(r['จังหวัด']) && `จ.${text(r['จังหวัด'])}`,
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- ประกอบข้อมูลหนึ่งที่พัก
function buildProperty(db, reg, related, lookups) {
  const warnings = [];
  const key = text(reg.property_id);
  const originalName = text(reg['ชื่อที่พักในไฟล์ต้นฉบับ']);
  const displayName = text(reg['ชื่อที่พักที่ใช้แสดงบนเว็บ']);
  if (isUrl(displayName) || /https?:\/\//.test(displayName)) warnings.push('ช่องชื่อแสดงบนเว็บเป็นลิงก์ ใช้ชื่อต้นฉบับแทน');
  const name = displayName && !/https?:\/\//.test(displayName) ? displayName : originalName;

  const lat = num(reg['ละติจูด']);
  const lng = num(reg['ลองจิจูด']);
  let coords = lat != null && lng != null ? { lat, lng } : { lat: null, lng: null };
  if (coords.lat != null && (lat < AREA.minLat || lat > AREA.maxLat || lng < AREA.minLng || lng > AREA.maxLng)) {
    warnings.push(`พิกัด ${lat}, ${lng} อยู่นอกพื้นที่ (สลับละติจูด/ลองจิจูดหรือไม่) ไม่ได้นำเข้าพิกัด`);
    coords = { lat: null, lng: null };
  }

  const gateNames = [text(reg['ประตูที่ใกล้ที่สุด']), ...text(reg['ประตูอื่นที่เดินทางสะดวก (ถ้าตรวจสอบแล้ว)']).split(/[,，/]|และ/)]
    .map((g) => g.trim())
    .filter((g) => g && g !== 'ยังไม่ทราบ');
  const gate_ids = [...new Set(gateNames.map((g) => lookups.gates.get(gateKey(g))).filter(Boolean))];
  gateNames.filter((g) => !lookups.gates.has(gateKey(g))).forEach((g) => warnings.push(`ไม่พบประตู "${g}" บนเว็บ`));

  const soiName = text(reg['ชื่อซอยทางการ']) || text(reg['ชื่อซอยหรือย่านที่นิสิตนิยมเรียก']);
  let soi_id = soiName ? lookups.sois.get(soiName) || null : null;
  if (soiName && !soi_id && gate_ids.length) {
    // ซอยใหม่จากชีต: สร้างให้อัตโนมัติ ผูกกับประตูแรกของหอและโซนของประตูนั้น
    const zone = db.prepare('SELECT zone_id FROM zone_gates WHERE gate_id = ? ORDER BY zone_id LIMIT 1').get(gate_ids[0]);
    soi_id = Number(db.prepare('INSERT INTO sois (name, zone_id, description) VALUES (?, ?, ?)')
      .run(soiName, zone?.zone_id ?? null, `เพิ่มอัตโนมัติจากชีตฐานข้อมูล (${text(reg.property_id)})`).lastInsertRowid);
    db.prepare('INSERT INTO soi_gates (soi_id, gate_id) VALUES (?, ?)').run(soi_id, gate_ids[0]);
    lookups.sois.set(soiName, soi_id);
    warnings.push(`เพิ่มซอยใหม่ "${soiName}" ใต้ประตูที่ใกล้ที่สุดของหอนี้ (แก้ได้ที่หน้าผู้ดูแล → ซอย)`);
  } else if (soiName && !soi_id) {
    warnings.push(`ไม่พบซอย "${soiName}" บนเว็บ และหอยังไม่มีประตู จึงยังสร้างซอยให้ไม่ได้`);
  }

  // ค่าใช้จ่าย: เงินประกันที่เป็นตัวเลขเก็บเป็นตัวเลข ถ้าเป็นข้อความเก็บในค่าใช้จ่ายอื่น
  const depositNum = num(reg['เงินประกัน (บาท)']);
  const depositText = depositNum == null ? text(reg['เงินประกัน (บาท)']) : '';
  const advance = text(reg['ค่าเช่าล่วงหน้า (บาท)']);
  const otherFees = [
    text(reg['ค่าใช้จ่ายอื่น (ส่วนกลาง/อินเทอร์เน็ต)']),
    depositText && `เงินประกัน: ${depositText}`,
  ].filter(Boolean).join('\n');

  // ห้องและราคา (ห้องที่ยังไม่มีราคาไม่นำเข้า เพราะบนเว็บต้องมีราคา)
  const images = related.images.slice().sort((a, b) => (num(a['ลำดับการแสดง']) ?? 999) - (num(b['ลำดับการแสดง']) ?? 999));
  const rooms = [];
  let roomsWithoutPrice = 0;
  for (const r of related.rooms) {
    const price = num(r['ราคาเช่าต่อเดือน (บาท)']);
    const hasInfo = text(r['ชื่อประเภทห้อง/ยูนิต']) || text(r['สิ่งของ/อุปกรณ์ในห้อง (บรรทัดละรายการ)']);
    if (!(price > 0)) {
      if (hasInfo) roomsWithoutPrice++;
      continue;
    }
    const features = lines(r['สิ่งของ/อุปกรณ์ในห้อง (บรรทัดละรายการ)']);
    const bed = text(r['ประเภทเตียง (ถ้ามี)']);
    if (bed) features.push(`เตียง: ${bed}`);
    const note = [
      num(r['จำนวนห้องนอน']) != null && `${num(r['จำนวนห้องนอน'])} ห้องนอน`,
      num(r['จำนวนห้องน้ำ']) != null && `${num(r['จำนวนห้องน้ำ'])} ห้องน้ำ`,
      num(r['จำนวนผู้พักสูงสุด']) != null && `พักได้สูงสุด ${num(r['จำนวนผู้พักสูงสุด'])} คน`,
      text(r['มีเฟอร์นิเจอร์หรือไม่']) && `เฟอร์นิเจอร์${text(r['มีเฟอร์นิเจอร์หรือไม่'])}`,
      text(r['หมายเหตุ']),
    ].filter(Boolean).join(' · ');
    const unit = text(r.unit_id);
    rooms.push({
      name: text(r['ชื่อประเภทห้อง/ยูนิต']) || text(r['ประเภท']) || 'ห้องพัก',
      price: Math.round(price),
      size_sqm: num(r['ขนาดพื้นที่ (ตารางเมตร)']),
      available: text(r['สถานะห้องว่าง']) === 'เต็ม' ? 0 : 1,
      note: note.slice(0, 300),
      features: features.join('\n'),
      images: images
        .filter((im) => unit && text(im['unit_id (เฉพาะภาพห้อง)']) === unit && isUrl(im['URL หรือที่เก็บไฟล์ภาพ']))
        .map((im) => ({ url: text(im['URL หรือที่เก็บไฟล์ภาพ']), caption: text(im['คำบรรยายภาพ']) })),
    });
  }
  if (roomsWithoutPrice) warnings.push(`ห้อง ${roomsWithoutPrice} ประเภทยังไม่มีราคา ไม่ได้นำเข้า`);

  const buildingImages = images
    .filter((im) => !text(im['unit_id (เฉพาะภาพห้อง)']) && text(im['ภาพของ']) !== 'ห้องพัก' && isUrl(im['URL หรือที่เก็บไฟล์ภาพ']))
    .map((im) => ({
      url: text(im['URL หรือที่เก็บไฟล์ภาพ']),
      category: IMAGE_CATEGORIES.includes(text(im['หมวดภาพ'])) ? text(im['หมวดภาพ']) : null,
      caption: text(im['คำบรรยายภาพ']),
    }));
  // รูปห้องที่ไม่ได้ระบุ unit_id: ถ้าหอมีห้องประเภทเดียว ถือเป็นรูปของห้องนั้น (ไม่ต้องเดาถ้ามีหลายประเภท)
  const unitless = images.filter((im) => !text(im['unit_id (เฉพาะภาพห้อง)']) && text(im['ภาพของ']) === 'ห้องพัก' && isUrl(im['URL หรือที่เก็บไฟล์ภาพ']));
  if (unitless.length && rooms.length === 1) {
    rooms[0].images.push(...unitless.map((im) => ({ url: text(im['URL หรือที่เก็บไฟล์ภาพ']), caption: text(im['คำบรรยายภาพ']) })));
  } else if (unitless.length) {
    warnings.push(`รูปห้อง ${unitless.length} รูปไม่ได้ระบุ unit_id และหอมี${rooms.length ? 'หลายประเภทห้อง' : 'ห้องที่ยังไม่มีราคา'} ไม่ได้นำเข้า`);
  }
  const orphanImages = images.filter((im) => text(im['unit_id (เฉพาะภาพห้อง)']) && !rooms.some((r) => r.images.some((x) => x.url === text(im['URL หรือที่เก็บไฟล์ภาพ']))));
  if (orphanImages.length) warnings.push(`รูปห้อง ${orphanImages.length} รูปไม่ได้นำเข้า (ห้องนั้นยังไม่มีราคา หรือ unit_id ไม่ตรง)`);

  // สิ่งอำนวยความสะดวก: นำเข้าเฉพาะข้อที่ระบุว่า "มี"
  const am = related.amenities[0] || {};
  const amenity_codes = Object.entries(AMENITY_COLUMNS).filter(([col]) => text(am[col]) === 'มี').map(([, code]) => code);
  if (text(am['เงื่อนไข: เลี้ยงสัตว์ได้หรือไม่']) === 'ได้') amenity_codes.push('pets');
  if (text(am['เงื่อนไข: ผู้พัก']) === 'หญิงล้วน') amenity_codes.push('women_only');
  if (text(am['เงื่อนไข: ผู้พัก']) === 'ชายล้วน') amenity_codes.push('men_only');

  const rules = [];
  for (const r of related.rules) {
    const topic = RULE_TOPICS.includes(text(r['หัวข้อ'])) ? text(r['หัวข้อ']) : 'อื่น ๆ';
    for (const detail of lines(r['รายละเอียด'])) rules.push({ topic, detail: detail.slice(0, 500) });
  }
  const cooking = text(am['เงื่อนไข: อนุญาตให้ทำอาหารหรือไม่']);
  if ((cooking === 'ได้' || cooking === 'ไม่ได้') && !rules.some((r) => r.topic === 'การทำอาหาร')) {
    rules.push({ topic: 'การทำอาหาร', detail: cooking === 'ได้' ? 'ทำอาหารในห้องได้' : 'ไม่อนุญาตให้ทำอาหารในห้อง' });
  }

  // สถานที่ใกล้เคียง: ต้องมีระยะที่วัดได้หรือพิกัด ไม่คำนวณหรือเดาระยะเอง
  const nearby = [];
  for (const n of related.nearby) {
    const placeName = text(n['ชื่อสถานที่']);
    if (!placeName) continue;
    const distance = num(n['ระยะทางที่วัดได้ (เมตร)']);
    const nLat = num(n['ละติจูด']);
    const nLng = num(n['ลองจิจูด']);
    if (distance == null && (nLat == null || nLng == null)) {
      warnings.push(`สถานที่ใกล้เคียง "${placeName}" ไม่มีระยะหรือพิกัด ไม่ได้นำเข้า`);
      continue;
    }
    nearby.push({
      name: placeName.slice(0, 120),
      category: NEARBY_CATEGORIES.includes(text(n['ประเภทสถานที่'])) ? text(n['ประเภทสถานที่']) : 'อื่น ๆ',
      distance_m: distance != null ? Math.round(distance) : null,
      distance_type: DISTANCE_TYPES.includes(text(n['ประเภทระยะทาง'])) ? text(n['ประเภทระยะทาง']) : null,
      lat: nLat,
      lng: nLng,
      source: text(n['แหล่งที่ตรวจสอบ']) || text(n['URL หรือรายละเอียดหลักฐาน']),
      checked_at: text(n['วันที่ตรวจสอบ']).slice(0, 10),
    });
  }
  if (nearby.some((n) => !n.source)) warnings.push('สถานที่ใกล้เคียงบางรายการยังไม่มีแหล่งที่ตรวจสอบ (ต้องเติมก่อนเผยแพร่)');

  const c = related.contacts[0] || {};
  const facebook = text(c['Facebook (ลิงก์เต็ม)']);
  const website = text(c['เว็บไซต์ทางการ (ลิงก์เต็ม)']);
  const showName = /^(ได้|เปิดเผยได้|ใช่)$/.test(text(c['เปิดเผยชื่อบนเว็บได้']));

  const mapUrl = text(reg['ลิงก์ Google Maps']);
  if (mapUrl && !MAP_URL.test(mapUrl)) warnings.push('ลิงก์ Google Maps ไม่ใช่ลิงก์จาก Google Maps ไม่ได้นำเข้า');

  const source = text(reg['แหล่งข้อมูลของรายการ']) || 'ชีตฐานข้อมูล';
  const sourceIds = text(reg.source_id);

  return {
    key,
    sheetStatus: text(reg['สถานะการคัดเลือก']),
    verifiedAt: /^\d{4}-\d{2}-\d{2}/.test(text(reg['วันที่ตรวจสอบล่าสุด'])) ? text(reg['วันที่ตรวจสอบล่าสุด']).slice(0, 10) : null,
    warnings,
    data: {
      name: name.slice(0, 150),
      type_id: lookups.types.get(typeCode(reg['ประเภทที่พัก'])),
      soi_id,
      address: address(reg).slice(0, 500),
      ...coords,
      deposit: depositNum != null ? Math.round(depositNum) : null,
      description: text(reg['รายละเอียดเพิ่มเติม (แสดงบนเว็บ)']),
      water_rate: text(reg['ค่าน้ำและวิธีคิด']),
      electric_rate: text(reg['ค่าไฟและวิธีคิด']),
      other_fees: otherFees,
      lease_terms: advance ? `ค่าเช่าล่วงหน้า: ${/^\d[\d,]*$/.test(advance) ? `${advance} บาท` : advance}` : '',
      contact_name: showName ? text(c['ชื่อผู้ประกอบการ/ผู้ดูแล (ถ้าเปิดเผยได้)']) : '',
      contact_phone: phone(c['โทรศัพท์']),
      contact_line: phone(c.LINE),
      contact_facebook: isUrl(facebook) ? facebook : '',
      contact_website: isUrl(website) ? website : '',
      map_url: MAP_URL.test(mapUrl) ? mapUrl : '',
      data_source: `${source}${sourceIds ? ` (${sourceIds})` : ''} — นำเข้าจากชีตฐานข้อมูล ${key}`,
      gate_ids,
      amenity_codes: [...new Set(amenity_codes)],
      rooms,
      images: buildingImages,
      rules: rules.slice(0, 30),
      nearby: nearby.slice(0, 30),
    },
  };
}

/** สิ่งที่ยังขาดก่อนผู้ดูแลจะกดเผยแพร่ได้ (ตรงกับการตรวจใน validatePayload) */
function missingForPublish(d) {
  const miss = [];
  if (d.lat == null) miss.push('พิกัด');
  if (!d.gate_ids.length) miss.push('ประตู');
  if (!d.rooms.length) miss.push('ห้อง+ราคา');
  if (!d.contact_phone && !d.contact_line && !d.contact_facebook && !d.contact_website) miss.push('ช่องทางติดต่อ');
  if (d.nearby.some((n) => !n.source)) miss.push('แหล่งตรวจสอบของสถานที่ใกล้เคียง');
  return miss;
}

// ---------------------------------------------------------------- นำเข้า
/** source = ที่อยู่ไฟล์ .xlsx หรือ Buffer ของไฟล์ (จากหน้าอัปโหลดของผู้ดูแล) */
async function importWorkbook(db, source, { update = false, dryRun = false } = {}) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(source)) await wb.xlsx.load(source);
  else await wb.xlsx.readFile(source);
  if (!wb.getWorksheet(SHEETS.registry)) throw new Error(`ไม่พบชีต "${SHEETS.registry}" ในไฟล์`);

  const lookups = {
    gates: new Map(db.prepare('SELECT id, name, short_name FROM gates').all().flatMap((g) => [[gateKey(g.short_name), g.id], [gateKey(g.name), g.id]])),
    sois: new Map(db.prepare('SELECT id, name FROM sois').all().map((s) => [s.name, s.id])),
    types: new Map(db.prepare('SELECT id, code FROM property_types').all().map((t) => [t.code, t.id])),
  };
  if (!lookups.gates.size || !lookups.types.size) {
    throw new Error('ฐานข้อมูลยังไม่มีประตูหรือประเภทที่พัก — รัน npm start หนึ่งครั้งก่อนนำเข้า');
  }

  const notes = [];
  // คอลัมน์ C ของทะเบียนคือชื่อที่พักต้นฉบับ (เคยถูกพิมพ์ทับหัวคอลัมน์ด้วยชื่อหอ ทำให้อ่านชื่อไม่ได้ทั้งชีต)
  const registry = readSheet(wb, SHEETS.registry, { expected: { 3: 'ชื่อที่พักในไฟล์ต้นฉบับ' }, notes }).filter((r) => text(r.property_id));
  // สถานที่ใกล้เคียงบางแถวไม่มี property_id แต่มีชื่อที่พัก: จับคู่ด้วยชื่อ ถ้าชื่อไม่ซ้ำกับหออื่น
  const byName = groupBy(registry, 'ชื่อที่พักในไฟล์ต้นฉบับ');
  const nearbyRows = readSheet(wb, SHEETS.nearby).map((n) => {
    if (text(n.property_id)) return n;
    const same = byName.get(text(n['ชื่อที่พักในไฟล์ต้นฉบับ'])) || [];
    return same.length === 1 ? { ...n, property_id: same[0].property_id } : n;
  });
  const related = {
    rooms: groupBy(readSheet(wb, SHEETS.rooms), 'property_id'),
    // เซลล์ URL หนึ่งเซลล์ใส่ได้หลายรูป (คั่นด้วยช่องว่างหรือขึ้นบรรทัด) → แยกเป็นหนึ่งรูปต่อแถว
    images: groupBy(readSheet(wb, SHEETS.images).flatMap((im) => {
      const urls = (text(im['URL หรือที่เก็บไฟล์ภาพ']).match(/https?:\/\/\S+/g) || []).map(driveImageUrl);
      return urls.length ? urls.map((url) => ({ ...im, 'URL หรือที่เก็บไฟล์ภาพ': url })) : [im];
    }), 'property_id'),
    amenities: groupBy(readSheet(wb, SHEETS.amenities), 'property_id'),
    rules: groupBy(readSheet(wb, SHEETS.rules), 'property_id'),
    nearby: groupBy(nearbyRows, 'property_id'),
    contacts: groupBy(readSheet(wb, SHEETS.contacts), 'property_id'),
  };
  const pick = (map, key) => map.get(key) || [];

  const report = { created: [], updated: [], skippedExisting: [], skippedHidden: [], skippedOutOfScope: [], errors: [], notes };
  // วันที่ตรวจสอบมาจากชีต ถ้าไม่มี เว็บจะแสดง "ยังไม่ได้ตรวจสอบ" (ไม่ใส่วันที่นำเข้าแทน)
  const published = (item) => ({ status: 'published', review_note: null, verified_at: item.verifiedAt, verified_by: null });
  const findExisting = db.prepare('SELECT id, status FROM properties WHERE import_key = ?');
  const setKey = db.prepare('UPDATE properties SET import_key = ? WHERE id = ?');

  const run = () => {
    for (const reg of registry) {
      const key = text(reg.property_id);
      const item = buildProperty(db, reg, Object.fromEntries(Object.entries(related).map(([k, m]) => [k, pick(m, key)])), lookups);
      if (SKIP_STATUSES.has(item.sheetStatus)) { report.skippedOutOfScope.push(key); continue; }
      if (!item.data.name || !item.data.address) { report.errors.push({ key, error: 'ไม่มีชื่อหรือที่อยู่' }); continue; }
      const row = { key, name: item.data.name, missing: missingForPublish(item.data), warnings: item.warnings };

      const existing = findExisting.get(key);
      if (!existing) {
        const id = createProperty(db, item.data, { status: 'published' });
        setKey.run(key, id);
        updateProperty(db, id, item.data, published(item));
        report.created.push({ ...row, id });
      } else if (existing.status === 'hidden' || existing.status === 'rejected') {
        report.skippedHidden.push(row);
      } else if (update) {
        updateProperty(db, existing.id, item.data, published(item));
        report.updated.push({ ...row, id: existing.id });
      } else {
        report.skippedExisting.push(row);
      }
    }
  };

  if (dryRun) {
    // จำลองการนำเข้าใน transaction แล้วยกเลิก เพื่อให้รายงานตรงกับการนำเข้าจริง
    db.exec('SAVEPOINT import_dry_run');
    try { run(); } finally { db.exec('ROLLBACK TO import_dry_run'); db.exec('RELEASE import_dry_run'); }
  } else {
    tx(db, run);
  }
  return report;
}

function printReport(report, { dryRun }) {
  const line = (r) => `  ${r.key.padEnd(9)} ${r.name}${r.missing.length ? `  [ยังขาด: ${r.missing.join(', ')}]` : '  [ข้อมูลจำเป็นครบ]'}`;
  console.log(dryRun ? '\n(ตรวจอย่างเดียว ยังไม่ได้บันทึก)\n' : '');
  report.notes.forEach((n) => console.log(`⚠ ${n}\n`));
  console.log(`นำเข้าใหม่และเผยแพร่     ${report.created.length} รายการ`);
  console.log(`อัปเดตรายการเดิม       ${report.updated.length} รายการ`);
  console.log(`มีอยู่แล้ว ข้าม          ${report.skippedExisting.length} รายการ (ใช้ --update เพื่ออัปเดต)`);
  console.log(`ผู้ดูแลซ่อน/ไม่อนุมัติไว้ ข้าม ${report.skippedHidden.length} รายการ`);
  console.log(`ไม่อยู่ในขอบเขต ข้าม     ${report.skippedOutOfScope.length} รายการ`);
  if (report.errors.length) console.log(`ผิดพลาด              ${report.errors.length} รายการ: ${report.errors.map((e) => `${e.key} (${e.error})`).join(', ')}`);

  const done = [...report.created, ...report.updated];
  const ready = done.filter((r) => !r.missing.length);
  console.log(`\nข้อมูลครบ (มีพิกัด ประตู ราคา ช่องทางติดต่อ): ${ready.length} รายการ`);
  ready.forEach((r) => console.log(line(r)));
  const withData = done.filter((r) => r.missing.length && r.missing.length < 4);
  if (withData.length) {
    console.log('\nมีข้อมูลบางส่วนแล้ว:');
    withData.forEach((r) => console.log(line(r)));
  }
  const bare = done.length - ready.length - withData.length;
  if (bare) console.log(`\nอีก ${bare} รายการมีแค่ชื่อและที่อยู่ (ยังขาดพิกัด ประตู ราคา ช่องทางติดต่อ)`);
  console.log('\nรายการที่ยังไม่มีพิกัดแสดงในรายการผลค้นหาได้ แต่ไม่มีหมุดบนแผนที่และไม่ถูกนับในตัวกรองระยะทาง');

  const warned = done.filter((r) => r.warnings.length);
  if (warned.length) {
    console.log('\nข้อสังเกต:');
    warned.forEach((r) => r.warnings.forEach((w) => console.log(`  ${r.key}: ${w}`)));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.log('วิธีใช้: npm run import -- "ไฟล์.xlsx" [--update] [--dry-run]');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const db = open();
  if (!dryRun && DB_PATH !== ':memory:') {
    // สำรองฐานข้อมูลก่อนนำเข้า
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const backup = path.join(path.dirname(DB_PATH), `nudorm-backup-${stamp}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`สำรองฐานข้อมูลไว้ที่ ${backup}`);
  }
  const report = await importWorkbook(db, path.resolve(file), { update: args.includes('--update'), dryRun });
  printReport(report, { dryRun });
  if (!dryRun && (report.created.length || report.updated.length)) {
    console.log('\nเผยแพร่บนเว็บแล้ว เติมข้อมูลที่ขาดในชีตแล้วรันซ้ำด้วย --update');
  }
  db.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`นำเข้าไม่สำเร็จ: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { importWorkbook, readSheet, cellValue, driveImageUrl, missingForPublish };
