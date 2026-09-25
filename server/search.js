'use strict';
/**
 * การค้นหาแบบใช้ตัวกรองตามเงื่อนไข (Filter-based / Faceted Search)
 *
 * กติกาการรวมเงื่อนไข:
 *   - เงื่อนไข "ต่างกลุ่ม" ต้องตรงพร้อมกัน (AND)
 *   - ตัวเลือก "ในกลุ่มเดียวกัน" ของ ประเภท / ประตู / โซน / ซอย ตรงค่าใดค่าหนึ่งก็ได้ (OR)
 *   - สิ่งอำนวยความสะดวก ต้องมี "ครบทุกข้อ" ที่เลือก (AND) เพราะผู้ใช้เลือกสิ่งที่ต้องการจริง
 *   - ราคา: ที่พักผ่านเงื่อนไขเมื่อมี "ห้องอย่างน้อยหนึ่งประเภท" ราคาอยู่ในช่วงที่กำหนด
 *
 * ตัวอย่าง: ประตู 4 AND ซอยกระบอกวิศวะ AND ราคา ≤ 3,000 AND มีแอร์
 *           (หอพัก OR คอนโด) AND (แอร์ AND ที่จอดรถ)
 *
 * ระยะทางที่คำนวณเป็น "ระยะทางเส้นตรง" (Haversine) ไม่ใช่ระยะเดินหรือขับรถ
 */

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function toIdList(value) {
  if (value == null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(raw.map((v) => parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

function toCodeList(value) {
  if (value == null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
}

function toPositiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** แปลง query string ให้เป็นเงื่อนไขค้นหาที่ตรวจแล้ว */
function parseFilters(query = {}) {
  const sort = ['distance', 'price_asc', 'price_desc', 'verified'].includes(query.sort)
    ? query.sort
    : null;
  return {
    types: toCodeList(query.type),
    gates: toIdList(query.gate),
    zones: toIdList(query.zone),
    sois: toIdList(query.soi),
    amenities: toCodeList(query.amenity),
    minPrice: toPositiveInt(query.min_price),
    maxPrice: toPositiveInt(query.max_price),
    availableOnly: query.available === '1' || query.available === 'true',
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '',
    sort,
  };
}

function placeholders(list) {
  return list.map(() => '?').join(',');
}

/**
 * สร้าง SQL จากเงื่อนไข แล้วคืนรายการที่พักพร้อมระยะเส้นตรงถึงแต่ละประตู
 */
function searchProperties(db, filters) {
  const where = ["p.status = 'published'"];
  const params = [];

  if (filters.types.length) {
    where.push(`t.code IN (${placeholders(filters.types)})`);
    params.push(...filters.types);
  }
  if (filters.gates.length) {
    where.push(
      `p.id IN (SELECT property_id FROM property_gates WHERE gate_id IN (${placeholders(filters.gates)}))`
    );
    params.push(...filters.gates);
  }
  if (filters.zones.length) {
    where.push(`s.zone_id IN (${placeholders(filters.zones)})`);
    params.push(...filters.zones);
  }
  if (filters.sois.length) {
    where.push(`p.soi_id IN (${placeholders(filters.sois)})`);
    params.push(...filters.sois);
  }
  if (filters.amenities.length) {
    // ต้องมีครบทุกข้อ: นับจำนวนที่ตรงแล้วเทียบกับจำนวนที่เลือก
    where.push(`(
      SELECT COUNT(*) FROM property_amenities pa
      JOIN amenities a ON a.id = pa.amenity_id
      WHERE pa.property_id = p.id AND a.code IN (${placeholders(filters.amenities)})
    ) = ?`);
    params.push(...filters.amenities, filters.amenities.length);
  }
  if (filters.minPrice != null || filters.maxPrice != null || filters.availableOnly) {
    const roomConds = ['r.property_id = p.id'];
    if (filters.minPrice != null) {
      roomConds.push('r.price >= ?');
      params.push(filters.minPrice);
    }
    if (filters.maxPrice != null) {
      roomConds.push('r.price <= ?');
      params.push(filters.maxPrice);
    }
    if (filters.availableOnly) roomConds.push('r.available = 1');
    where.push(`EXISTS (SELECT 1 FROM room_types r WHERE ${roomConds.join(' AND ')})`);
  }
  if (filters.q) {
    where.push('(p.name LIKE ? OR p.address LIKE ? OR s.name LIKE ?)');
    const like = `%${filters.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }

  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.lat, p.lng, p.address, p.verified_at, p.data_source,
              t.code AS type_code, t.name AS type_name,
              s.id AS soi_id, s.name AS soi_name,
              z.id AS zone_id, z.name AS zone_name,
              (SELECT MIN(price) FROM room_types WHERE property_id = p.id) AS price_min,
              (SELECT MAX(price) FROM room_types WHERE property_id = p.id) AS price_max,
              (SELECT url FROM property_images WHERE property_id = p.id ORDER BY sort_order, id LIMIT 1) AS cover
       FROM properties p
       JOIN property_types t ON t.id = p.type_id
       LEFT JOIN sois s ON s.id = p.soi_id
       LEFT JOIN zones z ON z.id = s.zone_id
       WHERE ${where.join(' AND ')}`
    )
    .all(...params);

  if (!rows.length) return [];
  return decorate(db, rows, filters);
}

/** เติมข้อมูลประตูที่เกี่ยวข้อง สิ่งอำนวยความสะดวก และระยะเส้นตรง แล้วเรียงลำดับ */
function decorate(db, rows, filters = { gates: [], sort: null }) {
  const ids = rows.map((r) => r.id);
  const gates = db.prepare('SELECT id, name, short_name, lat, lng FROM gates ORDER BY sort_order, id').all();

  const linkRows = db
    .prepare(`SELECT property_id, gate_id FROM property_gates WHERE property_id IN (${placeholders(ids)})`)
    .all(...ids);
  const amenityRows = db
    .prepare(
      `SELECT pa.property_id, a.code, a.name FROM property_amenities pa
       JOIN amenities a ON a.id = pa.amenity_id
       WHERE pa.property_id IN (${placeholders(ids)}) ORDER BY a.id`
    )
    .all(...ids);

  const linked = new Map();
  for (const l of linkRows) {
    if (!linked.has(l.property_id)) linked.set(l.property_id, new Set());
    linked.get(l.property_id).add(l.gate_id);
  }
  const amenityMap = new Map();
  for (const a of amenityRows) {
    if (!amenityMap.has(a.property_id)) amenityMap.set(a.property_id, []);
    amenityMap.get(a.property_id).push({ code: a.code, name: a.name });
  }

  // ระยะที่ใช้เรียง: ถ้าผู้ใช้เลือกประตู ใช้ระยะถึงประตูที่เลือกซึ่งใกล้ที่สุด ไม่เช่นนั้นใช้ประตูที่เกี่ยวข้องที่ใกล้ที่สุด
  const selectedGates = new Set(filters.gates || []);

  const results = rows.map((r) => {
    const related = linked.get(r.id) || new Set();
    const distances = gates.map((g) => ({
      gate_id: g.id,
      gate_name: g.short_name,
      related: related.has(g.id),
      straight_line_m: Math.round(haversineMeters(r.lat, r.lng, g.lat, g.lng)),
    }));
    const pool = distances.filter((d) =>
      selectedGates.size ? selectedGates.has(d.gate_id) : d.related
    );
    const nearest = (pool.length ? pool : distances).reduce((a, b) =>
      a.straight_line_m <= b.straight_line_m ? a : b
    );
    return {
      ...r,
      gates: distances.filter((d) => d.related).map((d) => ({ id: d.gate_id, name: d.gate_name })),
      distances,
      nearest_gate: nearest,
      amenities: amenityMap.get(r.id) || [],
    };
  });

  const sort = filters.sort || 'distance';
  const byNum = (key, dir = 1) => (a, b) => ((a[key] ?? Infinity) - (b[key] ?? Infinity)) * dir;
  if (sort === 'price_asc') results.sort(byNum('price_min'));
  else if (sort === 'price_desc') results.sort((a, b) => (b.price_max ?? -1) - (a.price_max ?? -1));
  else if (sort === 'verified') results.sort((a, b) => String(b.verified_at || '').localeCompare(String(a.verified_at || '')));
  else results.sort((a, b) => a.nearest_gate.straight_line_m - b.nearest_gate.straight_line_m);

  return results;
}

module.exports = { parseFilters, searchProperties, decorate, haversineMeters };
