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
    maxDistance: toPositiveInt(query.max_distance) || null,
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

// ช่วงระยะสำเร็จรูปของตัวกรองระยะทาง (เมตร, ระยะเส้นตรง)
const DISTANCE_BUCKETS = [500, 1000, 2000];

/**
 * ประตูที่ใช้วัดระยะของที่พัก: ถ้าผู้ใช้เลือกประตู ใช้ประตูที่เลือกซึ่งใกล้ที่สุด
 * ไม่เช่นนั้นใช้ประตูที่เกี่ยวข้องที่ใกล้ที่สุด (ไม่มีประตูที่เกี่ยวข้อง ใช้ทุกประตู)
 * ใช้ทั้งตอนกรองระยะทางและตอนแสดงระยะบนการ์ด เพื่อให้ตัวเลขตรงกัน
 */
function pickNearest(distances, selectedGates) {
  const pool = distances.filter((d) => (selectedGates.size ? selectedGates.has(d.gate_id) : d.related));
  return (pool.length ? pool : distances).reduce((a, b) => (a.straight_line_m <= b.straight_line_m ? a : b));
}

/** ระยะเส้นตรง (เมตร) จากที่พักที่เผยแพร่แล้วแต่ละแห่ง ถึงประตูอ้างอิงตาม pickNearest */
function referenceDistances(db, gateIds) {
  const gates = db.prepare('SELECT id, lat, lng FROM gates').all();
  if (!gates.length) return new Map();
  const related = new Map();
  for (const l of db.prepare('SELECT property_id, gate_id FROM property_gates').all()) {
    if (!related.has(l.property_id)) related.set(l.property_id, new Set());
    related.get(l.property_id).add(l.gate_id);
  }
  const selected = new Set(gateIds);
  const out = new Map();
  for (const p of db.prepare("SELECT id, lat, lng FROM properties WHERE status = 'published'").all()) {
    const rel = related.get(p.id) || new Set();
    const distances = gates.map((g) => ({
      gate_id: g.id,
      related: rel.has(g.id),
      straight_line_m: Math.round(haversineMeters(p.lat, p.lng, g.lat, g.lng)),
    }));
    out.set(p.id, pickNearest(distances, selected).straight_line_m);
  }
  return out;
}

/**
 * เตรียมข้อมูลที่ buildWhere ต้องใช้แต่คำนวณใน SQL ไม่ได้
 *  - soiGates: ซอยแต่ละซอยอยู่ใต้ประตูใด (ใช้จับคู่ซอยที่เลือกกับประตูที่เลือก)
 *  - nearIds: ที่พักที่อยู่ในระยะที่เลือก (ระยะคำนวณด้วย Haversine)
 */
function resolveFilters(db, filters) {
  const out = { ...filters };
  if (filters.sois.length) {
    out.soiGates = new Map();
    for (const r of db.prepare(`SELECT soi_id, gate_id FROM soi_gates WHERE soi_id IN (${placeholders(filters.sois)})`).all(...filters.sois)) {
      if (!out.soiGates.has(r.soi_id)) out.soiGates.set(r.soi_id, new Set());
      out.soiGates.get(r.soi_id).add(r.gate_id);
    }
  }
  if (filters.maxDistance) {
    out.nearIds = [];
    for (const [id, m] of referenceDistances(db, filters.gates)) if (m <= filters.maxDistance) out.nearIds.push(id);
  }
  return out;
}

/**
 * เงื่อนไขตำแหน่งแบบลำดับชั้น ประตู → ซอย
 *  - ประตูที่เลือกรวมกันด้วย OR
 *  - ซอยที่เลือกใต้ประตูใด จำกัดเฉพาะประตูนั้น ประตูที่ไม่ได้เลือกซอยได้ทุกซอย
 *    เช่น ประตู 3 (ทุกซอย) OR (ประตู 4 AND ซอยกระบอกวิศวะ)
 *  - ซอยที่ไม่อยู่ใต้ประตูที่เลือก (เช่น มาจากลิงก์) รวมเข้ามาด้วย OR, ไม่เลือกประตูเลย กรองตามซอยอย่างเดียว
 */
function locationClause(filters, params) {
  const { gates, sois } = filters;
  if (!gates.length) {
    if (!sois.length) return null;
    params.push(...sois);
    return `p.soi_id IN (${placeholders(sois)})`;
  }
  const parts = [];
  const claimed = new Set();
  for (const g of gates) {
    const own = sois.filter((s) => filters.soiGates?.get(s)?.has(g));
    own.forEach((s) => claimed.add(s));
    params.push(g);
    let part = 'p.id IN (SELECT property_id FROM property_gates WHERE gate_id = ?)';
    if (own.length) {
      part += ` AND p.soi_id IN (${placeholders(own)})`;
      params.push(...own);
    }
    parts.push(`(${part})`);
  }
  const orphan = sois.filter((s) => !claimed.has(s));
  if (orphan.length) {
    parts.push(`p.soi_id IN (${placeholders(orphan)})`);
    params.push(...orphan);
  }
  return `(${parts.join(' OR ')})`;
}

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
 * exclude: ชื่อกลุ่มที่ไม่ต้องใส่เงื่อนไข (type, zone, amenity, price, distance) ใช้ตอนนับจำนวนแบบ disjunctive
 * filters ต้องผ่าน resolveFilters ก่อน
 */
function buildWhere(filters, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  const where = ["p.status = 'published'"];
  const params = [];

  if (filters.types.length && !skip.has('type')) {
    where.push(`t.code IN (${placeholders(filters.types)})`);
    params.push(...filters.types);
  }
  const location = locationClause(filters, params);
  if (location) where.push(location);
  if (filters.zones.length && !skip.has('zone')) {
    where.push(`s.zone_id IN (${placeholders(filters.zones)})`);
    params.push(...filters.zones);
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
  if (filters.nearIds && !skip.has('distance')) {
    where.push(filters.nearIds.length ? `p.id IN (${placeholders(filters.nearIds)})` : '0');
    params.push(...filters.nearIds);
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
 *  - ประเภท โซน (OR): นับโดยไม่ใส่เงื่อนไขของกลุ่มตัวเอง แต่ใส่กลุ่มอื่นครบ (Disjunctive Faceting)
 *    ตัวเลข = จำนวนที่พักถ้าเลือกค่านี้ในกลุ่มนั้น ร่วมกับตัวกรองกลุ่มอื่นที่เลือกอยู่
 *  - ประตู: จำนวนที่พักของประตูนั้นทุกซอย ร่วมกับตัวกรองอื่น (ระยะทางวัดจากประตูนั้นเอง)
 *  - ซอยใต้ประตูที่เลือก (soi_by_gate): จำนวนที่พักของประตูนั้นในซอยนั้น ร่วมกับตัวกรองอื่น
 *  - สิ่งอำนวยความสะดวก (AND): นับโดยใส่เงื่อนไขทุกกลุ่ม (Conjunctive Faceting)
 *    ตัวเลข = จำนวนที่พักที่จะเหลือถ้าติ๊กข้อนี้เพิ่ม
 *  - ราคา: นับตามช่วงราคาสำเร็จรูป โดยไม่ใส่เงื่อนไขราคาที่เลือกอยู่
 *  - ระยะทาง: นับตามช่วงระยะสำเร็จรูป โดยไม่ใส่เงื่อนไขระยะที่เลือกอยู่
 * นับจำนวนที่พัก (DISTINCT p.id) ไม่ใช่จำนวนห้อง และนับเฉพาะที่พักที่เผยแพร่แล้ว
 */
function computeFacets(db, rawFilters) {
  const filters = resolveFilters(db, rawFilters);
  const countOf = (f) => {
    const w = buildWhere(resolveFilters(db, f));
    return db.prepare(`SELECT COUNT(*) AS n ${BASE_FROM} WHERE ${w.sql}`).get(...w.params).n;
  };
  const grouped = (exclude, keyExpr, join = '') => {
    const w = buildWhere(filters, { exclude });
    const rows = db
      .prepare(`SELECT ${keyExpr} AS k, COUNT(DISTINCT p.id) AS n ${BASE_FROM} ${join} WHERE ${w.sql} AND ${keyExpr} IS NOT NULL GROUP BY ${keyExpr}`)
      .all(...w.params);
    return Object.fromEntries(rows.map((r) => [String(r.k), r.n]));
  };

  const facets = {
    type: grouped(['type'], 't.code'),
    zone: grouped(['zone'], 's.zone_id'),
    amenity: grouped([], 'fa.code', 'JOIN property_amenities fpa ON fpa.property_id = p.id JOIN amenities fa ON fa.id = fpa.amenity_id'),
  };

  const w = buildWhere(filters, { exclude: ['price'] });
  const bucketParams = [];
  const cols = PRICE_BUCKETS.map((b, i) => `SUM(${roomExists({ min: b.min, max: b.max, availableOnly: filters.availableOnly }, bucketParams)}) AS b${i}`);
  const row = db.prepare(`SELECT ${cols.join(', ')} ${BASE_FROM} WHERE ${w.sql}`).get(...bucketParams, ...w.params);
  facets.price = Object.fromEntries(PRICE_BUCKETS.map((b, i) => [b.key, row[`b${i}`] || 0]));

  // ประตูและซอยนับทีละค่า เพราะซอยขึ้นกับประตู และระยะทางวัดจากประตูที่เลือก
  facets.gate = {};
  for (const { id } of db.prepare('SELECT id FROM gates').all()) {
    const n = countOf({ ...rawFilters, gates: [id], sois: [] });
    if (n) facets.gate[id] = n;
  }
  facets.soi_by_gate = {};
  for (const g of rawFilters.gates) {
    facets.soi_by_gate[g] = {};
    for (const { soi_id } of db.prepare('SELECT soi_id FROM soi_gates WHERE gate_id = ?').all(g)) {
      const n = countOf({ ...rawFilters, gates: [g], sois: [soi_id] });
      if (n) facets.soi_by_gate[g][soi_id] = n;
    }
  }

  const base = buildWhere(filters, { exclude: ['distance'] });
  const ids = db.prepare(`SELECT p.id ${BASE_FROM} WHERE ${base.sql}`).all(...base.params).map((r) => r.id);
  const ref = referenceDistances(db, filters.gates);
  facets.distance = Object.fromEntries(DISTANCE_BUCKETS.map((m) => [String(m), ids.filter((id) => ref.get(id) <= m).length]));
  return facets;
}

/**
 * สร้าง SQL จากเงื่อนไข แล้วคืนรายการที่พักพร้อมระยะเส้นตรงถึงแต่ละประตู
 */
function searchProperties(db, filters) {
  const { sql, params } = buildWhere(resolveFilters(db, filters));

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
    const nearest = pickNearest(distances, selectedGates);
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

module.exports = { parseFilters, searchProperties, computeFacets, buildWhere, decorate, haversineMeters, PRICE_BUCKETS, DISTANCE_BUCKETS };
