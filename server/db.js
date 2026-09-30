'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nudorm.db');

const SCHEMA = `
PRAGMA foreign_keys = ON;

-- ผู้ใช้ที่มีบัญชี: สมาชิก (member) ผู้ประกอบการ (provider) และผู้ดูแลระบบ (admin)
-- ผู้ใช้ทั่วไปค้นหาและเปรียบเทียบได้โดยไม่ต้องมีบัญชี
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('member', 'provider', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- รายการโปรดของสมาชิก
CREATE TABLE IF NOT EXISTS favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, property_id)
);

-- ชุดเปรียบเทียบของสมาชิก (สูงสุด 3 แห่ง ตรวจที่ API)
CREATE TABLE IF NOT EXISTS compare_items (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (user_id, property_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- ประตู: จุดอ้างอิงที่นิสิตใช้ค้นหา
CREATE TABLE IF NOT EXISTS gates (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- โซน: พื้นที่สำหรับจัดกลุ่มที่พัก
CREATE TABLE IF NOT EXISTS zones (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  travel_tips TEXT
);

-- ประตูที่เป็นทางเข้าหลักของแต่ละโซน (โซนหนึ่งอาจใช้ได้หลายประตู)
CREATE TABLE IF NOT EXISTS zone_gates (
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  gate_id INTEGER NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  PRIMARY KEY (zone_id, gate_id)
);

-- ซอย: รายละเอียดทำเลที่เฉพาะเจาะจง
CREATE TABLE IF NOT EXISTS sois (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  zone_id     INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  description TEXT
);

-- ซอยหนึ่งอาจเชื่อมได้มากกว่าหนึ่งประตู
CREATE TABLE IF NOT EXISTS soi_gates (
  soi_id  INTEGER NOT NULL REFERENCES sois(id) ON DELETE CASCADE,
  gate_id INTEGER NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  PRIMARY KEY (soi_id, gate_id)
);

CREATE TABLE IF NOT EXISTS property_types (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS amenities (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- ที่พัก: เก็บเพียงรายการเดียว แม้อยู่ใกล้หลายประตู
CREATE TABLE IF NOT EXISTS properties (
  id               INTEGER PRIMARY KEY,
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  type_id          INTEGER NOT NULL REFERENCES property_types(id),
  soi_id           INTEGER REFERENCES sois(id) ON DELETE SET NULL,
  address          TEXT NOT NULL,
  lat              REAL,          -- ว่างได้เฉพาะรายการที่ยังไม่เผยแพร่ (เช่น นำเข้าจากชีตแต่ยังไม่ปักหมุด)
  lng              REAL,
  description      TEXT,
  deposit          INTEGER,
  water_rate       TEXT,
  electric_rate    TEXT,
  other_fees       TEXT,
  lease_terms      TEXT,
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_line     TEXT,
  contact_facebook TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'hidden')),
  review_note      TEXT,
  data_source      TEXT,          -- แหล่งข้อมูล เช่น "ผู้ประกอบการ", "ทีมงานสำรวจภาคสนาม"
  verified_at      TEXT,          -- วันที่ผู้ดูแลตรวจสอบข้อมูลล่าสุด
  verified_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ประตูที่เกี่ยวข้องกับที่พัก (ใช้กรองตามประตู)
CREATE TABLE IF NOT EXISTS property_gates (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  gate_id     INTEGER NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, gate_id)
);

CREATE TABLE IF NOT EXISTS property_amenities (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  amenity_id  INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, amenity_id)
);

CREATE TABLE IF NOT EXISTS room_types (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price       INTEGER NOT NULL,        -- ค่าเช่าต่อเดือน (บาท)
  size_sqm    REAL,
  available   INTEGER NOT NULL DEFAULT 1,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS property_images (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ข้อกำหนดของหอพัก แยกตามหัวข้อ เช่น สัตว์เลี้ยง เสียง เวลาเข้าออกอาคาร
CREATE TABLE IF NOT EXISTS property_rules (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- สถานที่ใกล้เคียงที่ตรวจสอบแล้ว (ห้ามสร้างชื่อร้านหรือระยะทางขึ้นเอง)
CREATE TABLE IF NOT EXISTS nearby_places (
  id            INTEGER PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  distance_m    INTEGER,           -- ระยะที่วัดได้จริง (ถ้ามี)
  distance_type TEXT,              -- เส้นตรง / เดิน / ขับรถ
  lat           REAL,
  lng           REAL,
  source        TEXT,
  checked_at    TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- คำขอแก้ไขข้อมูลที่พักที่เผยแพร่แล้ว รอผู้ดูแลอนุมัติ
CREATE TABLE IF NOT EXISTS edit_requests (
  id           INTEGER PRIMARY KEY,
  property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload      TEXT NOT NULL,           -- JSON ของข้อมูลใหม่ทั้งชุด
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT
);

-- ผู้ใช้ทั่วไปแจ้งข้อมูลไม่ถูกต้อง
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- บันทึกการใช้งานแบบไม่ระบุตัวตน สำหรับประเมินผลงานวิจัย
CREATE TABLE IF NOT EXISTS usage_events (
  id          INTEGER PRIMARY KEY,
  session_id  TEXT NOT NULL,
  event       TEXT NOT NULL,     -- search, view_property, contact_click, gate_select
  data        TEXT,              -- JSON
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_room_types_property ON room_types(property_id);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);
`;

// คอลัมน์ที่เพิ่มภายหลัง: เพิ่มให้ฐานข้อมูลเดิมโดยไม่ต้องล้างข้อมูล
const MIGRATIONS = {
  zones: {
    tagline: 'TEXT',      // ป้ายสั้นมุมขวาของการ์ด เช่น "โซนยอดนิยมอันดับ 1"
    key_sois: 'TEXT',     // ซอยสำคัญ (ข้อความ)
    color: 'TEXT',        // สีป้ายประตู: amber, teal, violet, blue, rose
    sort_order: 'INTEGER NOT NULL DEFAULT 0',
  },
  properties: {
    contact_website: 'TEXT',
    import_key: 'TEXT',
    map_url: 'TEXT',      // ลิงก์สถานที่บน Google Maps (แสดงชื่อหอ) ถ้าไม่มีจะเปิดจากพิกัด   // รหัสจากชีตฐานข้อมูล (property_id เช่น PROP-001) ใช้ตอนนำเข้าซ้ำ
  },
  room_types: {
    features: 'TEXT',     // สิ่งของ/อุปกรณ์ภายในห้องประเภทนี้ บรรทัดละรายการ
  },
  property_images: {
    category: 'TEXT',     // ด้านหน้าอาคาร, รอบอาคาร, ทางเข้า, พื้นที่ส่วนกลาง, อื่น ๆ (ภาพอาคาร)
    caption: 'TEXT',
    room_type_id: 'INTEGER REFERENCES room_types(id) ON DELETE CASCADE', // มีค่า = ภาพภายในห้องประเภทนั้น
  },
  amenities: {
    scope: "TEXT NOT NULL DEFAULT 'building'", // building = ของหอพัก, room = ภายในห้อง, rule = เงื่อนไขผู้พัก
  },
};

// รายการสิ่งอำนวยความสะดวกตั้งต้น แยกของหอพักกับของภายในห้องให้ชัด
const AMENITY_CATALOG = [
  ['aircon', 'เครื่องปรับอากาศ', 'room'],
  ['fan', 'พัดลม', 'room'],
  ['water_heater', 'เครื่องทำน้ำอุ่น', 'room'],
  ['furnished', 'เฟอร์นิเจอร์', 'room'],
  ['fridge', 'ตู้เย็น', 'room'],
  ['wifi', 'อินเทอร์เน็ต Wi-Fi', 'building'],
  ['parking_motorbike', 'ที่จอดรถจักรยานยนต์', 'building'],
  ['parking_car', 'ที่จอดรถยนต์', 'building'],
  ['covered_parking', 'โรงจอดรถ (มีหลังคา)', 'building'],
  ['water_dispenser', 'ตู้กดน้ำดื่ม', 'building'],
  ['laundry', 'เครื่องซักผ้าหยอดเหรียญ', 'building'],
  ['keycard', 'ระบบคีย์การ์ด', 'building'],
  ['cctv', 'กล้องวงจรปิด', 'building'],
  ['security_guard', 'รปภ.', 'building'],
  ['elevator', 'ลิฟต์', 'building'],
  ['common_area', 'พื้นที่ส่วนกลาง', 'building'],
  ['pets', 'เลี้ยงสัตว์ได้', 'rule'],
  ['women_only', 'หญิงล้วน', 'rule'],
  ['men_only', 'ชายล้วน', 'rule'],
];

function migrate(db) {
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, type] of Object.entries(cols)) {
      if (!existing.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  }
  // ย้ายข้อมูลครั้งเดียวตามเลขเวอร์ชัน เพื่อไม่ให้ทับการแก้ไขของผู้ดูแลในภายหลัง
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 2) {
    tx(db, () => {
      const insert = db.prepare('INSERT OR IGNORE INTO amenities (code, name, scope) VALUES (?, ?, ?)');
      const setScope = db.prepare('UPDATE amenities SET scope = ? WHERE code = ?');
      for (const [code, name, scope] of AMENITY_CATALOG) {
        insert.run(code, name, scope);
        setScope.run(scope, code);
      }
      db.exec('PRAGMA user_version = 2');
    });
  }
  if (version < 3) {
    // ฐานข้อมูลเดิมจำกัดบทบาทไว้แค่ provider/admin ต้องสร้างตาราง users ใหม่เพื่อเพิ่ม member
    // (SQLite แก้ CHECK ของตารางเดิมไม่ได้) ปิด foreign key ระหว่างย้ายตามขั้นตอนของ SQLite
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
    if (!sql.includes("'member'")) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        tx(db, () => {
          db.exec(`CREATE TABLE users_v3 (
            id            INTEGER PRIMARY KEY,
            email         TEXT NOT NULL UNIQUE,
            name          TEXT NOT NULL,
            phone         TEXT,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL CHECK (role IN ('member', 'provider', 'admin')),
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
          )`);
          db.exec('INSERT INTO users_v3 (id, email, name, phone, password_hash, role, created_at) SELECT id, email, name, phone, password_hash, role, created_at FROM users');
          db.exec('DROP TABLE users');
          db.exec('ALTER TABLE users_v3 RENAME TO users');
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error('foreign key check failed after users migration');
        });
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
    db.exec('PRAGMA user_version = 3');
  }
  {
    // ตรวจจากโครงสร้างตารางทุกครั้ง (ไม่ดูเลขเวอร์ชัน) จึงซ่อมฐานข้อมูลที่ขึ้นเวอร์ชัน 4 แล้วแต่ยังไม่ได้สร้างตารางใหม่ได้
    // เดิมบังคับพิกัด (NOT NULL) ทำให้นำเข้าที่พักที่ยังไม่ได้ปักหมุดไม่ได้
    // สร้างตารางใหม่จากคำสั่งเดิมโดยเอา NOT NULL ของ lat/lng ออก (การเผยแพร่ยังบังคับพิกัดที่ API)
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'properties'").get().sql;
    const next = sql.replace(/\b(lat|lng)(\s+)REAL NOT NULL/g, '$1$2REAL');
    if (next !== sql) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        tx(db, () => {
          const cols = db.prepare('PRAGMA table_info(properties)').all().map((c) => c.name).join(', ');
          db.exec(next.replace(/CREATE TABLE (IF NOT EXISTS )?"?properties"?/, 'CREATE TABLE properties_v4'));
          db.exec(`INSERT INTO properties_v4 (${cols}) SELECT ${cols} FROM properties`);
          db.exec('DROP TABLE properties');
          db.exec('ALTER TABLE properties_v4 RENAME TO properties');
          db.exec('CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status)');
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error('foreign key check failed after properties migration');
        });
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
    if (version < 4) db.exec('PRAGMA user_version = 4');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_import_key ON properties(import_key)');
  // รวม "อพาร์ตเมนต์" เข้ากับ "หอพัก" เป็นประเภทเดียว "หอพัก/อพาร์ตเมนต์" (ตรวจทุกครั้ง ทำซ้ำได้)
  const dorm = db.prepare("SELECT id, name FROM property_types WHERE code = 'dorm'").get();
  const apt = db.prepare("SELECT id FROM property_types WHERE code = 'apartment'").get();
  if (dorm && (apt || dorm.name === 'หอพัก')) {
    tx(db, () => {
      if (apt) {
        db.prepare('UPDATE properties SET type_id = ? WHERE type_id = ?').run(dorm.id, apt.id);
        db.prepare('DELETE FROM property_types WHERE id = ?').run(apt.id);
      }
      db.prepare("UPDATE property_types SET name = 'หอพัก/อพาร์ตเมนต์' WHERE id = ? AND name = 'หอพัก'").run(dorm.id);
    });
  }
}

function open(file = DB_PATH) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// รันหลายคำสั่งใน transaction เดียว (ใช้ SAVEPOINT จึงซ้อนกันได้ เช่น นำเข้าหลายที่พักใน transaction เดียว)
let txDepth = 0;
function tx(db, fn) {
  const name = `tx_${++txDepth}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  } finally {
    txDepth--;
  }
}

module.exports = { open, tx, DB_PATH, AMENITY_CATALOG };
