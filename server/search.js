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

// ตารางหลักของการค้นหา (ใช้ร่วมกันระหว่างรายการผลลัพธ์และการนับจำนวน)
const BASE_FROM = `FROM properties p
       JOIN property_types t ON t.id = p.type_id
       LEFT JOIN sois s ON s.id = p.soi_id
       LEFT JOIN zones z ON z.id = s.zone_id`;

// ช่วงราคาสำเร็จรูปบนหน้าค้นหา (ตรงกับปุ่ม): key = "ต่ำสุด-สูงสุด"
const PRICE_BUCKETS = [
  { key: '0-2500', max: 2500 },
  { key: '0-3000', max: 3000 },
  { key: '0-4000', max: 4000 },
  { key: '0-5000', max: 5000 },
  { key: '5001-', min: 5001 },
];

/** เงื่อนไขห้องพัก: มีห้องอย่างน้อยหนึ่งประเภทที่ราคาอยู่ในช่วง (และว่าง ถ้าเลือก) */
function roomExists({ min = null, max = null, availableOnly = false }, params) {
  const conds = ['r.property_id = p.id'];
  if (min != null) { conds.push('r.price >= ?'); params.push(min); }
  if (max != null) { conds.push('r.price <= ?'); params.push(max); }
  if (availableOnly) conds.push('r.available = 1');
  return `EXISTS (SELECT 1 FROM room_types r WHERE ${conds.join(' AND ')})`;
}

/**
 * สร้างเงื่อนไข WHERE จากตัวกรอง
 * exclude: ชื่อกลุ่มที่ไม่ต้องใส่เงื่อนไข (type, gate, zone, soi, amenity, price) ใช้ตอนนับจำนวนแบบ disjunctive
 */
function buildWhere(filters, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  const where = ["p.status = 'published'"];
  const params = [];

  if (filters.types.length && !skip.has('type')) {
    where.push(`t.code IN (${placeholders(filters.types)})`);
    params.push(...filters.types);
  }
  if (filters.gates.length && !skip.has('gate')) {
    where.push(`p.id IN (SELECT property_id FROM property_gates WHERE gate_id IN (${placeholders(filters.gates)}))`);
    params.push(...filters.gates);
  }
  if (filters.zones.length && !skip.has('zone')) {
    where.push(`s.zone_id IN (${placeholders(filters.zones)})`);
    params.push(...filters.zones);
  }
  if (filters.sois.length && !skip.has('soi')) {
    where.push(`p.soi_id IN (${placeholders(filters.sois)})`);
    params.push(...filters.sois);
  }
  if (filters.amenities.length && !skip.has('amenity')) {
    // ต้องมีครบทุกข้อ: นับจำนวนที่ตรงแล้วเทียบกับจำนวนที่เลือก
    where.push(`(
      SELECT COUNT(*) FROM property_amenities pa
      JOIN amenities a ON a.id = pa.amenity_id
      WHERE pa.property_id = p.id AND a.code IN (${placeholders(filters.amenities)})
    ) = ?`);
    params.push(...filters.amenities, filters.amenities.length);
  }
  const price = skip.has('price') ? {} : { min: filters.minPrice, max: filters.maxPrice };
  if (price.min != null || price.max != null || filters.availableOnly) {
    where.push(roomExists({ ...price, availableOnly: filters.availableOnly }, params));
  }
  if (filters.q) {
    where.push('(p.name LIKE ? OR p.address LIKE ? OR s.name LIKE ?)');
    const like = `%${filters.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  return { sql: where.join(' AND '), params };
}

/**
 * นับจำนวนที่พักข้างตัวเลือกแต่ละตัว (Facet Counts)
 *  - ประเภท ประตู โซน ซอย (OR): นับโดยไม่ใส่เงื่อนไขของกลุ่มตัวเอง แต่ใส่กลุ่มอื่นครบ (Disjunctive Faceting)
 *    ตัวเลข = จำนวนที่พักถ้าเลือกค่านี้ในกลุ่มนั้น ร่วมกับตัวกรองกลุ่มอื่นที่เลือกอยู่
 *  - สิ่งอำนวยความสะดวก (AND): นับโดยใส่เงื่อนไขทุกกลุ่ม (Conjunctive Faceting)
 *    ตัวเลข = จำนวนที่พักที่จะเหลือถ้าติ๊กข้อนี้เพิ่ม
 *  - ราคา: นับตามช่วงราคาสำเร็จรูป โดยไม่ใส่เงื่อนไขราคาที่เลือกอยู่
 * นับจำนวนที่พัก (DISTINCT p.id) ไม่ใช่จำนวนห้อง และนับเฉพาะที่พักที่เผยแพร่แล้ว
 */
function computeFacets(db, filters) {
  const grouped = (exclude, keyExpr, join = '') => {
    const w = buildWhere(filters, { exclude });
    const rows = db
      .prepare(`SELECT ${keyExpr} AS k, COUNT(DISTINCT p.id) AS n ${BASE_FROM} ${join} WHERE ${w.sql} AND ${keyExpr} IS NOT NULL GROUP BY ${keyExpr}`)
      .all(...w.params);
    return Object.fromEntries(rows.map((r) => [String(r.k), r.n]));
  };

  const facets = {
    type: grouped(['type'], 't.code'),
    gate: grouped(['gate'], 'pg.gate_id', 'JOIN property_gates pg ON pg.property_id = p.id'),
    zone: grouped(['zone'], 's.zone_id'),
    soi: grouped(['soi'], 'p.soi_id'),
    amenity: grouped([], 'fa.code', 'JOIN property_amenities fpa ON fpa.property_id = p.id JOIN amenities fa ON fa.id = fpa.amenity_id'),
  };

  const w = buildWhere(filters, { exclude: ['price'] });
  const bucketParams = [];
  const cols = PRICE_BUCKETS.map((b, i) => `SUM(${roomExists({ min: b.min, max: b.max, availableOnly: filters.availableOnly }, bucketParams)}) AS b${i}`);
  const row = db.prepare(`SELECT ${cols.join(', ')} ${BASE_FROM} WHERE ${w.sql}`).get(...bucketParams, ...w.params);
  facets.price = Object.fromEntries(PRICE_BUCKETS.map((b, i) => [b.key, row[`b${i}`] || 0]));
  return facets;
}

/**
 * สร้าง SQL จากเงื่อนไข แล้วคืนรายการที่พักพร้อมระยะเส้นตรงถึงแต่ละประตู
 */
function searchProperties(db, filters) {
  const { sql, params } = buildWhere(filters);

  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.lat, p.lng, p.address, p.verified_at, p.data_source,
              t.code AS type_code, t.name AS type_name,
              s.id AS soi_id, s.name AS soi_name,
              z.id AS zone_id, z.name AS zone_name,
              (SELECT MIN(price) FROM room_types WHERE property_id = p.id) AS price_min,
              (SELECT MAX(price) FROM room_types WHERE property_id = p.id) AS price_max,
              (SELECT url FROM property_images WHERE property_id = p.id ORDER BY room_type_id IS NOT NULL, sort_order, id LIMIT 1) AS cover
       ${BASE_FROM}
       WHERE ${sql}`
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
      `SELECT pa.property_id, a.code, a.name, a.scope FROM property_amenities pa
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
    amenityMap.get(a.property_id).push({ code: a.code, name: a.name, scope: a.scope });
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

module.exports = { parseFilters, searchProperties, computeFacets, buildWhere, decorate, haversineMeters, PRICE_BUCKETS };
