'use strict';
const { tx } = require('./db');
const { haversineMeters, decorate } = require('./search');

// ขอบเขตพื้นที่รอบมหาวิทยาลัยนเรศวรโดยประมาณ ใช้กันพิกัดผิดพลาด (เช่น สลับ lat/lng)
const AREA = { minLat: 16.68, maxLat: 16.82, minLng: 100.12, maxLng: 100.28 };
const DUPLICATE_RADIUS_M = 40;

const TEXT_FIELDS = [
  'description', 'water_rate', 'electric_rate', 'other_fees', 'lease_terms',
  'contact_name', 'contact_phone', 'contact_line', 'contact_facebook', 'contact_website', 'data_source', 'map_url',
];

// ลิงก์ Google Maps ที่รับ: ลิงก์แชร์ (maps.app.goo.gl, goo.gl/maps) หรือ google.com/maps
const MAP_URL = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\/\S*$/;

const IMAGE_CATEGORIES = ['ด้านหน้าอาคาร', 'รอบอาคาร', 'ทางเข้า', 'พื้นที่ส่วนกลาง', 'ที่จอดรถ', 'อื่น ๆ'];
const RULE_TOPICS = ['สัตว์เลี้ยง', 'เสียงและความสงบ', 'เวลาเข้าออกอาคาร', 'ผู้มาเยี่ยม', 'การสูบบุหรี่', 'การทำอาหาร', 'สัญญาเช่า', 'อื่น ๆ'];
const NEARBY_CATEGORIES = ['ร้านอาหาร', 'ร้านสะดวกซื้อ', 'ร้านซักรีด', 'ตลาด', 'ร้านถ่ายเอกสาร', 'ร้านค้า', 'สถานพยาบาล', 'จุดรับส่ง/ป้ายรถ', 'อื่น ๆ'];
const DISTANCE_TYPES = ['เส้นตรง', 'เดิน', 'ขับรถ'];

function str(v, max = 2000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function optNumber(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** รูปภาพจากฟอร์ม: รับทั้ง string (รูปแบบเดิม) และ { url, category, caption } */
function cleanImages(list, { withCategory }) {
  return (Array.isArray(list) ? list : [])
    .map((item) => (typeof item === 'string' ? { url: item } : item || {}))
    .map((item) => ({
      url: str(item.url, 500),
      category: withCategory && IMAGE_CATEGORIES.includes(item.category) ? item.category : null,
      caption: str(item.caption, 200),
    }))
    .filter((img) => img.url.startsWith('/uploads/') || /^https?:\/\//.test(img.url))
    .slice(0, 20);
}

/**
 * ตรวจและทำความสะอาดข้อมูลที่พักจากฟอร์ม
 * คืน { data, errors } — errors เป็นข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้เลย
 */
function validatePayload(db, body = {}) {
  const errors = [];
  const data = {
    name: str(body.name, 150),
    address: str(body.address, 500),
    soi_id: body.soi_id ? parseInt(body.soi_id, 10) : null,
    lat: body.lat === '' || body.lat == null ? NaN : Number(body.lat),
    lng: body.lng === '' || body.lng == null ? NaN : Number(body.lng),
    deposit: body.deposit === '' || body.deposit == null ? null : parseInt(body.deposit, 10),
  };
  for (const f of TEXT_FIELDS) data[f] = str(body[f]);

  if (!data.name) errors.push('กรุณาระบุชื่อที่พัก');
  if (!data.address) errors.push('กรุณาระบุที่อยู่');

  const type = db.prepare('SELECT id FROM property_types WHERE code = ? OR id = ?').get(
    String(body.type_code ?? ''),
    parseInt(body.type_id, 10) || -1
  );
  if (!type) errors.push('กรุณาเลือกประเภทที่พัก');
  data.type_id = type ? type.id : null;

  if (data.soi_id && !db.prepare('SELECT 1 FROM sois WHERE id = ?').get(data.soi_id)) {
    errors.push('ไม่พบซอยที่เลือก');
  }

  if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
    errors.push('กรุณาปักหมุดตำแหน่งที่พักบนแผนที่');
  } else if (data.lat < AREA.minLat || data.lat > AREA.maxLat || data.lng < AREA.minLng || data.lng > AREA.maxLng) {
    errors.push('พิกัดอยู่นอกพื้นที่รอบมหาวิทยาลัยนเรศวร');
  }

  if (data.deposit != null && (!Number.isInteger(data.deposit) || data.deposit < 0)) {
    errors.push('เงินประกันต้องเป็นจำนวนเต็มไม่ติดลบ');
  }

  if (!data.contact_phone && !data.contact_line && !data.contact_facebook && !data.contact_website) {
    errors.push('กรุณาระบุช่องทางติดต่ออย่างน้อยหนึ่งช่องทาง');
  }
  if (data.map_url && !MAP_URL.test(data.map_url)) {
    errors.push('ลิงก์ Google Maps ต้องเป็นลิงก์จาก Google Maps เช่น https://maps.app.goo.gl/...');
  }
  if (data.contact_website && !/^https?:\/\/\S+$/.test(data.contact_website)) {
    errors.push('เว็บไซต์ต้องเป็นลิงก์เต็มที่ขึ้นต้นด้วย https://');
  }

  const validGates = new Set(db.prepare('SELECT id FROM gates').all().map((g) => g.id));
  data.gate_ids = [...new Set((body.gate_ids || []).map(Number))].filter((id) => validGates.has(id));
  if (!data.gate_ids.length) errors.push('กรุณาเลือกประตูที่เกี่ยวข้องอย่างน้อยหนึ่งประตู');

  const validAmenities = new Set(db.prepare('SELECT code FROM amenities').all().map((a) => a.code));
  data.amenity_codes = [...new Set(body.amenity_codes || [])].filter((c) => validAmenities.has(c));

  data.rooms = (Array.isArray(body.rooms) ? body.rooms : [])
    .map((r) => ({
      name: str(r.name, 100),
      price: parseInt(r.price, 10),
      size_sqm: r.size_sqm === '' || r.size_sqm == null ? null : Number(r.size_sqm),
      available: r.available === false || r.available === 0 || r.available === '0' ? 0 : 1,
      note: str(r.note, 300),
      // แต่ละประเภทห้องเก็บรูปและรายละเอียดของตัวเอง ไม่ปะปนกับห้องราคาอื่น
      features: str(r.features, 1000),
      images: cleanImages(r.images, { withCategory: false }),
    }))
    .filter((r) => r.name || Number.isFinite(r.price));
  if (!data.rooms.length) errors.push('กรุณาเพิ่มประเภทห้องอย่างน้อยหนึ่งประเภท');
  data.rooms.forEach((r, i) => {
    if (!r.name) errors.push(`ห้องที่ ${i + 1}: กรุณาระบุชื่อประเภทห้อง`);
    if (!Number.isInteger(r.price) || r.price <= 0) errors.push(`ห้องที่ ${i + 1}: ราคาต่อเดือนไม่ถูกต้อง`);
    if (r.size_sqm != null && !(r.size_sqm > 0)) r.size_sqm = null;
  });

  // ภาพอาคาร (ไม่รวมภาพภายในห้อง)
  data.images = cleanImages(body.images, { withCategory: true });

  data.rules = (Array.isArray(body.rules) ? body.rules : [])
    .map((r) => ({ topic: RULE_TOPICS.includes(r?.topic) ? r.topic : 'อื่น ๆ', detail: str(r?.detail, 500) }))
    .filter((r) => r.detail)
    .slice(0, 30);

  data.nearby = (Array.isArray(body.nearby) ? body.nearby : [])
    .map((n) => ({
      name: str(n?.name, 120),
      category: NEARBY_CATEGORIES.includes(n?.category) ? n.category : 'อื่น ๆ',
      distance_m: optNumber(n?.distance_m),
      distance_type: DISTANCE_TYPES.includes(n?.distance_type) ? n.distance_type : null,
      lat: optNumber(n?.lat),
      lng: optNumber(n?.lng),
      source: str(n?.source, 300),
      checked_at: str(n?.checked_at, 10),
    }))
    .filter((n) => n.name)
    .slice(0, 30);
  for (const n of data.nearby) {
    const label = `สถานที่ใกล้เคียง "${n.name}"`;
    const hasCoords = Number.isFinite(n.lat) && Number.isFinite(n.lng);
    if (Number.isNaN(n.distance_m) || (n.distance_m != null && n.distance_m < 0)) errors.push(`${label}: ระยะทางไม่ถูกต้อง`);
    if (Number.isNaN(n.lat) || Number.isNaN(n.lng)) errors.push(`${label}: พิกัดไม่ถูกต้อง`);
    if (n.distance_m == null && !hasCoords) errors.push(`${label}: ต้องมีระยะทางที่วัดได้หรือพิกัดของสถานที่`);
    if (n.distance_m != null && !n.distance_type) errors.push(`${label}: กรุณาระบุประเภทระยะทาง (เส้นตรง/เดิน/ขับรถ)`);
    if (!n.source) errors.push(`${label}: กรุณาระบุแหล่งที่ตรวจสอบ`);
    if (Number.isFinite(n.distance_m)) n.distance_m = Math.round(n.distance_m);
    if (!hasCoords) { n.lat = null; n.lng = null; }
  }

  return { data, errors };
}

function writeChildren(db, propertyId, data) {
  db.prepare('DELETE FROM property_gates WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM property_amenities WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM room_types WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM property_images WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM property_rules WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM nearby_places WHERE property_id = ?').run(propertyId);

  const g = db.prepare('INSERT INTO property_gates (property_id, gate_id) VALUES (?, ?)');
  for (const id of data.gate_ids) g.run(propertyId, id);

  const a = db.prepare(
    'INSERT INTO property_amenities (property_id, amenity_id) SELECT ?, id FROM amenities WHERE code = ?'
  );
  for (const code of data.amenity_codes) a.run(propertyId, code);

  const img = db.prepare(
    'INSERT INTO property_images (property_id, room_type_id, url, category, caption, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const r = db.prepare(
    'INSERT INTO room_types (property_id, name, price, size_sqm, available, note, features) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const room of data.rooms) {
    const roomId = Number(
      r.run(propertyId, room.name, room.price, room.size_sqm, room.available, room.note, room.features || null).lastInsertRowid
    );
    (room.images || []).forEach((im, i) => img.run(propertyId, roomId, im.url, null, im.caption || null, i));
  }

  (data.images || []).forEach((im, i) => img.run(propertyId, null, im.url, im.category || null, im.caption || null, i));

  const rule = db.prepare('INSERT INTO property_rules (property_id, topic, detail, sort_order) VALUES (?, ?, ?, ?)');
  (data.rules || []).forEach((x, i) => rule.run(propertyId, x.topic, x.detail, i));

  const near = db.prepare(
    `INSERT INTO nearby_places (property_id, name, category, distance_m, distance_type, lat, lng, source, checked_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  (data.nearby || []).forEach((n, i) =>
    near.run(propertyId, n.name, n.category, n.distance_m, n.distance_type, n.lat, n.lng, n.source || null, n.checked_at || null, i)
  );
}

const COLUMNS = ['name', 'type_id', 'soi_id', 'address', 'lat', 'lng', 'deposit', ...TEXT_FIELDS];

function createProperty(db, data, { ownerId = null, status = 'pending', verifiedBy = null } = {}) {
  return tx(db, () => {
    const cols = [...COLUMNS, 'owner_id', 'status'];
    const values = [...COLUMNS.map((c) => data[c] ?? null), ownerId, status];
    if (status === 'published') {
      cols.push('verified_at', 'verified_by');
      values.push(new Date().toISOString(), verifiedBy);
    }
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO properties (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...values);
    const id = Number(lastInsertRowid);
    writeChildren(db, id, data);
    return id;
  });
}

function updateProperty(db, id, data, extra = {}) {
  return tx(db, () => {
    const sets = COLUMNS.map((c) => `${c} = ?`);
    const values = COLUMNS.map((c) => data[c] ?? null);
    for (const [k, v] of Object.entries(extra)) {
      sets.push(`${k} = ?`);
      values.push(v);
    }
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    writeChildren(db, id, data);
  });
}

/** ข้อมูลที่พักฉบับเต็มสำหรับหน้ารายละเอียดและฟอร์มแก้ไข */
function getProperty(db, id) {
  const p = db
    .prepare(
      `SELECT p.*, t.code AS type_code, t.name AS type_name,
              s.name AS soi_name, z.id AS zone_id, z.name AS zone_name,
              u.name AS verified_by_name
       FROM properties p
       JOIN property_types t ON t.id = p.type_id
       LEFT JOIN sois s ON s.id = p.soi_id
       LEFT JOIN zones z ON z.id = s.zone_id
       LEFT JOIN users u ON u.id = p.verified_by
       WHERE p.id = ?`
    )
    .get(id);
  if (!p) return null;

  const [decorated] = decorate(db, [{ ...p }]);
  const allImages = db
    .prepare('SELECT url, category, caption, room_type_id FROM property_images WHERE property_id = ? ORDER BY sort_order, id')
    .all(id);
  const rooms = db
    .prepare('SELECT id, name, price, size_sqm, available, note, features FROM room_types WHERE property_id = ? ORDER BY price, id')
    .all(id)
    .map((room) => ({
      ...room,
      features_list: String(room.features || '').split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean),
      images: allImages.filter((im) => im.room_type_id === room.id).map(({ url, caption }) => ({ url, caption })),
    }));

  // ระยะสถานที่ใกล้เคียง: ใช้ค่าที่วัดได้จริงก่อน ถ้าไม่มีจึงคำนวณระยะเส้นตรงจากพิกัด
  const nearby = db
    .prepare('SELECT name, category, distance_m, distance_type, lat, lng, source, checked_at FROM nearby_places WHERE property_id = ? ORDER BY sort_order, id')
    .all(id)
    .map((n) => {
      const computed = n.lat != null && n.lng != null ? Math.round(haversineMeters(p.lat, p.lng, n.lat, n.lng)) : null;
      return {
        ...n,
        display_distance_m: n.distance_m ?? computed,
        display_distance_type: n.distance_m != null ? n.distance_type : computed != null ? 'เส้นตรง' : null,
      };
    })
    .sort((a, b) => (a.display_distance_m ?? Infinity) - (b.display_distance_m ?? Infinity)); // ใกล้ที่สุดก่อน

  return {
    ...p,
    gates: decorated.gates,
    distances: decorated.distances,
    nearest_gate: decorated.nearest_gate,
    amenities: decorated.amenities,
    gate_ids: decorated.gates.map((g) => g.id),
    amenity_codes: decorated.amenities.map((a) => a.code),
    rooms,
    images: allImages.filter((im) => im.room_type_id == null).map(({ url, category, caption }) => ({ url, category, caption })),
    rules: db.prepare('SELECT topic, detail FROM property_rules WHERE property_id = ? ORDER BY sort_order, id').all(id),
    nearby,
  };
}

/** รายการตรวจสอบสำหรับผู้ดูแล: ข้อมูลจำเป็นครบหรือไม่ และมีรายการที่อาจซ้ำหรือไม่ */
function reviewChecklist(db, p) {
  const checks = [
    { label: 'ชื่อที่พัก', ok: !!p.name },
    { label: 'ประเภท', ok: !!p.type_id },
    { label: 'ราคาห้องอย่างน้อย 1 ประเภท', ok: p.rooms.length > 0 },
    { label: 'ที่อยู่', ok: !!p.address },
    { label: 'พิกัด', ok: p.lat != null && p.lng != null },
    { label: 'ซอย', ok: !!p.soi_id },
    { label: 'รูปภาพอาคาร', ok: p.images.length > 0 },
    { label: 'รูปภายในห้องครบทุกประเภท', ok: p.rooms.length > 0 && p.rooms.every((r) => r.images.length > 0) },
    { label: 'รายละเอียดภายในห้องครบทุกประเภท', ok: p.rooms.length > 0 && p.rooms.every((r) => r.features_list.length > 0) },
    { label: 'ช่องทางติดต่อ', ok: !!(p.contact_phone || p.contact_line || p.contact_facebook || p.contact_website) },
    { label: 'แหล่งข้อมูล', ok: !!p.data_source },
  ];

  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  const duplicates = db
    .prepare("SELECT id, name, lat, lng, status FROM properties WHERE id != ? AND status != 'rejected'")
    .all(p.id || 0)
    .map((o) => ({
      ...o,
      distance_m: p.lat != null && o.lat != null ? Math.round(haversineMeters(p.lat, p.lng, o.lat, o.lng)) : null,
    }))
    .filter((o) => (o.distance_m != null && o.distance_m <= DUPLICATE_RADIUS_M) || (norm(o.name) && norm(o.name) === norm(p.name)))
    .map(({ id, name, status, distance_m }) => ({ id, name, status, distance_m }));

  return { checks, duplicates };
}

module.exports = {
  MAP_URL,
  validatePayload, createProperty, updateProperty, getProperty, reviewChecklist,
  IMAGE_CATEGORIES, RULE_TOPICS, NEARBY_CATEGORIES, DISTANCE_TYPES,
};
