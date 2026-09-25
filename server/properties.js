'use strict';
const { tx } = require('./db');
const { haversineMeters, decorate } = require('./search');

// ขอบเขตพื้นที่รอบมหาวิทยาลัยนเรศวรโดยประมาณ ใช้กันพิกัดผิดพลาด (เช่น สลับ lat/lng)
const AREA = { minLat: 16.68, maxLat: 16.82, minLng: 100.12, maxLng: 100.28 };
const DUPLICATE_RADIUS_M = 40;

const TEXT_FIELDS = [
  'description', 'water_rate', 'electric_rate', 'other_fees', 'lease_terms',
  'contact_name', 'contact_phone', 'contact_line', 'contact_facebook', 'data_source',
];

function str(v, max = 2000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
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
    lat: Number(body.lat),
    lng: Number(body.lng),
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

  if (!data.contact_phone && !data.contact_line && !data.contact_facebook) {
    errors.push('กรุณาระบุช่องทางติดต่ออย่างน้อยหนึ่งช่องทาง');
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
    }))
    .filter((r) => r.name || Number.isFinite(r.price));
  if (!data.rooms.length) errors.push('กรุณาเพิ่มประเภทห้องอย่างน้อยหนึ่งประเภท');
  data.rooms.forEach((r, i) => {
    if (!r.name) errors.push(`ห้องที่ ${i + 1}: กรุณาระบุชื่อประเภทห้อง`);
    if (!Number.isInteger(r.price) || r.price <= 0) errors.push(`ห้องที่ ${i + 1}: ราคาต่อเดือนไม่ถูกต้อง`);
    if (r.size_sqm != null && !(r.size_sqm > 0)) r.size_sqm = null;
  });

  data.images = (Array.isArray(body.images) ? body.images : [])
    .map((u) => str(u, 500))
    .filter((u) => u.startsWith('/uploads/') || /^https?:\/\//.test(u))
    .slice(0, 12);

  return { data, errors };
}

function writeChildren(db, propertyId, data) {
  db.prepare('DELETE FROM property_gates WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM property_amenities WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM room_types WHERE property_id = ?').run(propertyId);
  db.prepare('DELETE FROM property_images WHERE property_id = ?').run(propertyId);

  const g = db.prepare('INSERT INTO property_gates (property_id, gate_id) VALUES (?, ?)');
  for (const id of data.gate_ids) g.run(propertyId, id);

  const a = db.prepare(
    'INSERT INTO property_amenities (property_id, amenity_id) SELECT ?, id FROM amenities WHERE code = ?'
  );
  for (const code of data.amenity_codes) a.run(propertyId, code);

  const r = db.prepare(
    'INSERT INTO room_types (property_id, name, price, size_sqm, available, note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const room of data.rooms) r.run(propertyId, room.name, room.price, room.size_sqm, room.available, room.note);

  const img = db.prepare('INSERT INTO property_images (property_id, url, sort_order) VALUES (?, ?, ?)');
  data.images.forEach((url, i) => img.run(propertyId, url, i));
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
  return {
    ...p,
    gates: decorated.gates,
    distances: decorated.distances,
    amenities: decorated.amenities,
    gate_ids: decorated.gates.map((g) => g.id),
    amenity_codes: decorated.amenities.map((a) => a.code),
    rooms: db
      .prepare('SELECT id, name, price, size_sqm, available, note FROM room_types WHERE property_id = ? ORDER BY price, id')
      .all(id),
    images: db
      .prepare('SELECT url FROM property_images WHERE property_id = ? ORDER BY sort_order, id')
      .all(id)
      .map((r) => r.url),
  };
}

/** รายการตรวจสอบสำหรับผู้ดูแล: ข้อมูลจำเป็นครบหรือไม่ และมีรายการที่อาจซ้ำหรือไม่ */
function reviewChecklist(db, p) {
  const checks = [
    { label: 'ชื่อที่พัก', ok: !!p.name },
    { label: 'ประเภท', ok: !!p.type_id },
    { label: 'ราคาห้องอย่างน้อย 1 ประเภท', ok: p.rooms.length > 0 },
    { label: 'ที่อยู่', ok: !!p.address },
    { label: 'พิกัด', ok: Number.isFinite(p.lat) && Number.isFinite(p.lng) },
    { label: 'ซอย', ok: !!p.soi_id },
    { label: 'รูปภาพ', ok: p.images.length > 0 },
    { label: 'ช่องทางติดต่อ', ok: !!(p.contact_phone || p.contact_line || p.contact_facebook) },
    { label: 'แหล่งข้อมูล', ok: !!p.data_source },
  ];

  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  const duplicates = db
    .prepare("SELECT id, name, lat, lng, status FROM properties WHERE id != ? AND status != 'rejected'")
    .all(p.id || 0)
    .map((o) => ({ ...o, distance_m: Math.round(haversineMeters(p.lat, p.lng, o.lat, o.lng)) }))
    .filter((o) => o.distance_m <= DUPLICATE_RADIUS_M || (norm(o.name) && norm(o.name) === norm(p.name)))
    .map(({ id, name, status, distance_m }) => ({ id, name, status, distance_m }));

  return { checks, duplicates };
}

module.exports = { validatePayload, createProperty, updateProperty, getProperty, reviewChecklist };
