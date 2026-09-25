'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nudorm.db');

const SCHEMA = `
PRAGMA foreign_keys = ON;

-- ผู้ใช้ที่ต้องล็อกอิน: ผู้ประกอบการ (provider) และผู้ดูแลระบบ (admin)
-- ผู้ค้นหาที่พักไม่ต้องมีบัญชี
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('provider', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
  lat              REAL NOT NULL,
  lng              REAL NOT NULL,
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
};

function migrate(db) {
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, type] of Object.entries(cols)) {
      if (!existing.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  }
}

function open(file = DB_PATH) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// รันหลายคำสั่งใน transaction เดียว
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, tx, DB_PATH };
