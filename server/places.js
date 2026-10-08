'use strict';
/**
 * ตัวกรอง "ใกล้สถานที่" (Nearby-place facet)
 *
 * ใช้ข้อมูลสถานที่ใกล้เคียงที่บันทึกไว้กับที่พักแต่ละแห่ง (ตาราง nearby_places จากชีต/ฟอร์ม)
 * แล้วจัดกลุ่มเป็นสถานที่ที่นิสิตนิยมอยู่ใกล้ โดยจับจากประเภทสถานที่หรือคำในชื่อ
 * เช่น ชื่อมีคำว่า "เซเว่น" → เซเว่นอีเลฟเว่น ไม่ต้องแก้ข้อมูลในชีต
 *
 * ระยะใช้ค่า distance_m ที่บันทึกไว้ ถ้าไม่มีแต่มีพิกัด คำนวณระยะเส้นตรงจากพิกัดที่พัก
 * เลือกหลายสถานที่ = ต้องใกล้ครบทุกที่ที่เลือก (AND) เหมือนสิ่งอำนวยความสะดวก
 */

// ลำดับในรายการ = ลำดับที่แสดงบนหน้าค้นหา
const PLACE_FACETS = [
  { code: 'seven', name: 'เซเว่นอีเลฟเว่น', match: /เซเว่น|7-?eleven|7-11/i },
  { code: 'lotus', name: 'โลตัส', match: /โลตัส|lotus/i },
  { code: 'cjmore', name: 'ซีเจ มอร์ (CJ MORE)', match: /cj\s*more|ซีเจ/i },
  { code: 'laundry', name: 'ร้านซักผ้า / สะดวกซัก', categories: ['ร้านซักรีด'], match: /ซัก|laundry|wash/i },
  { code: 'market', name: 'ตลาด', categories: ['ตลาด'], match: /ตลาด|market/i },
  { code: 'fresh', name: 'ร้านขายผัก', match: /ผัก/ },
  { code: 'niceplaza', name: 'ตลาดไนซ์พลาซ่า', match: /ไนซ์|nice\s*plaza/i },
  { code: 'finly', name: 'ฟินลี่แลนด์ พลาซ่า', match: /ฟินลี่|finly/i },
  { code: 'pharmacy', name: 'ร้านขายยา / คลินิก', categories: ['สถานพยาบาล'], match: /เภสัช|ร้านยา|ขายยา|คลินิก|clinic|โรงพยาบาล/i },
  { code: 'copy', name: 'ร้านถ่ายเอกสาร', categories: ['ร้านถ่ายเอกสาร'], match: /ถ่ายเอกสาร|ปริ้น|print/i },
  { code: 'keroh', name: 'เคโระ บิวตี้', match: /เคโระ|เคโร๊ะ|kero/i },
  { code: 'priew', name: 'เปรียว คอสเมติกส์', match: /เปรียว|priew/i },
  { code: 'watsons', name: 'วัตสัน', match: /วัตสัน|watsons?/i },
  { code: 'fitness', name: 'ฟิตเนส', match: /ฟิตเนส|fitness|ยิม|gym/i },
];

// ช่วงระยะที่เลือกได้ (เมตร) และค่าเริ่มต้น
const PLACE_RADII = [300, 500, 1000];
const DEFAULT_PLACE_RADIUS = 1000;

function placeCodesOf(row) {
  return PLACE_FACETS.filter((f) => f.categories?.includes(row.category) || f.match?.test(row.name || '')).map((f) => f.code);
}

/**
 * ระยะที่ใกล้ที่สุดจากที่พักถึงสถานที่แต่ละกลุ่ม
 * คืน Map(code → Map(property_id → { m, name }))
 */
function placeDistances(db, haversineMeters) {
  const out = new Map(PLACE_FACETS.map((f) => [f.code, new Map()]));
  const rows = db
    .prepare(
      `SELECT n.property_id, n.name, n.category, n.distance_m, n.lat, n.lng, p.lat AS plat, p.lng AS plng
       FROM nearby_places n JOIN properties p ON p.id = n.property_id`
    )
    .all();
  for (const r of rows) {
    let m = r.distance_m;
    if (m == null && r.lat != null && r.lng != null && r.plat != null && r.plng != null) {
      m = Math.round(haversineMeters(r.plat, r.plng, r.lat, r.lng));
    }
    if (m == null) continue;
    for (const code of placeCodesOf(r)) {
      const byProp = out.get(code);
      const cur = byProp.get(r.property_id);
      if (!cur || m < cur.m) byProp.set(r.property_id, { m, name: r.name });
    }
  }
  return out;
}

module.exports = { PLACE_FACETS, PLACE_RADII, DEFAULT_PLACE_RADIUS, placeCodesOf, placeDistances };
