'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const { open, tx } = require('./db');
const { parseFilters, searchProperties, decorate } = require('./search');
const props = require('./properties');
const auth = require('./auth');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(auth.loadUser(db));

  const provider = auth.requireRole('provider', 'admin');
  const admin = auth.requireRole('admin');
  const idParam = (req) => parseInt(req.params.id, 10);

  // ---------------------------------------------------------------- ข้อมูลอ้างอิง
  app.get('/api/meta', (_req, res) => {
    const gates = db.prepare('SELECT * FROM gates ORDER BY sort_order, id').all();
    const zoneGates = db.prepare('SELECT zone_id, gate_id FROM zone_gates').all();
    const soiGates = db.prepare('SELECT soi_id, gate_id FROM soi_gates').all();
    const counts = db
      .prepare(
        `SELECT pg.gate_id, COUNT(*) AS n FROM property_gates pg
         JOIN properties p ON p.id = pg.property_id AND p.status = 'published' GROUP BY pg.gate_id`
      )
      .all();
    const countMap = new Map(counts.map((c) => [c.gate_id, c.n]));

    res.json({
      gates: gates.map((g) => ({ ...g, property_count: countMap.get(g.id) || 0 })),
      zones: db.prepare('SELECT * FROM zones ORDER BY sort_order, id').all().map((z) => ({
        ...z,
        gate_ids: zoneGates.filter((x) => x.zone_id === z.id).map((x) => x.gate_id),
      })),
      sois: db.prepare('SELECT * FROM sois ORDER BY zone_id, name').all().map((s) => ({
        ...s,
        gate_ids: soiGates.filter((x) => x.soi_id === s.id).map((x) => x.gate_id),
      })),
      types: db.prepare('SELECT * FROM property_types ORDER BY id').all(),
      amenities: db.prepare('SELECT * FROM amenities ORDER BY id').all(),
      options: {
        image_categories: props.IMAGE_CATEGORIES,
        rule_topics: props.RULE_TOPICS,
        nearby_categories: props.NEARBY_CATEGORIES,
        distance_types: props.DISTANCE_TYPES,
      },
    });
  });

  // ---------------------------------------------------------------- ค้นหา (สาธารณะ)
  app.get('/api/properties', (req, res) => {
    const filters = parseFilters(req.query);
    const results = searchProperties(db, filters);
    res.json({ count: results.length, filters, results });
  });

  app.get('/api/featured', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.lat, p.lng, p.address, p.verified_at, p.data_source,
                t.code AS type_code, t.name AS type_name, s.id AS soi_id, s.name AS soi_name,
                z.id AS zone_id, z.name AS zone_name,
                (SELECT MIN(price) FROM room_types WHERE property_id = p.id) AS price_min,
                (SELECT MAX(price) FROM room_types WHERE property_id = p.id) AS price_max,
                (SELECT url FROM property_images WHERE property_id = p.id ORDER BY room_type_id IS NOT NULL, sort_order, id LIMIT 1) AS cover
         FROM properties p JOIN property_types t ON t.id = p.type_id
         LEFT JOIN sois s ON s.id = p.soi_id LEFT JOIN zones z ON z.id = s.zone_id
         WHERE p.status = 'published' ORDER BY p.verified_at DESC LIMIT 6`
      )
      .all();
    res.json(rows.length ? decorate(db, rows, { gates: [], sort: 'verified' }) : []);
  });

  app.get('/api/properties/:id', (req, res) => {
    const p = props.getProperty(db, idParam(req));
    const canSee =
      p && (p.status === 'published' || req.user?.role === 'admin' || (req.user && req.user.id === p.owner_id));
    if (!canSee) return res.status(404).json({ error: 'ไม่พบที่พัก' });
    delete p.owner_id;
    delete p.verified_by;
    res.json(p);
  });

  app.post('/api/reports', (req, res) => {
    const propertyId = parseInt(req.body.property_id, 10);
    const reason = String(req.body.reason || '').trim().slice(0, 100);
    const detail = String(req.body.detail || '').trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ error: 'กรุณาเลือกเหตุผล' });
    if (!db.prepare("SELECT 1 FROM properties WHERE id = ? AND status = 'published'").get(propertyId)) {
      return res.status(404).json({ error: 'ไม่พบที่พัก' });
    }
    db.prepare('INSERT INTO reports (property_id, reason, detail) VALUES (?, ?, ?)').run(propertyId, reason, detail);
    res.status(201).json({ ok: true });
  });

  // บันทึกการใช้งานแบบไม่ระบุตัวตน สำหรับประเมินผลวิจัย
  const EVENTS = new Set(['search', 'gate_select', 'view_property', 'contact_click', 'task_start', 'task_end']);
  app.post('/api/events', (req, res) => {
    const { session_id: sid, event, data } = req.body || {};
    if (typeof sid !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(sid) || !EVENTS.has(event)) {
      return res.status(400).json({ error: 'invalid event' });
    }
    const json = data == null ? null : JSON.stringify(data).slice(0, 2000);
    db.prepare('INSERT INTO usage_events (session_id, event, data) VALUES (?, ?, ?)').run(sid, event, json);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- บัญชีผู้ใช้
  app.post('/api/auth/register', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 100);
    const phone = String(req.body.phone || '').trim().slice(0, 30);
    const password = String(req.body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
    if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อ' });
    if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
    }
    // สมัครผ่านหน้าเว็บได้เฉพาะผู้ประกอบการ ผู้ดูแลระบบสร้างด้วยสคริปต์ seed เท่านั้น
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (email, name, phone, password_hash, role) VALUES (?, ?, ?, ?, 'provider')")
      .run(email, name, phone, auth.hashPassword(password));
    auth.createSession(db, res, Number(lastInsertRowid));
    res.status(201).json({ id: Number(lastInsertRowid), email, name, role: 'provider' });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    auth.createSession(db, res, user.id);
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  app.post('/api/auth/logout', (req, res) => {
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => res.json(req.user || null));

  // ---------------------------------------------------------------- อัปโหลดรูป
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => {
        const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
  });

  app.post('/api/uploads', provider, upload.array('images', 10), (req, res) => {
    res.status(201).json({ urls: (req.files || []).map((f) => `/uploads/${f.filename}`) });
  });

  // ---------------------------------------------------------------- ผู้ประกอบการ
  app.get('/api/my/properties', provider, (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.status, p.review_note, p.verified_at, p.updated_at, t.name AS type_name,
                (SELECT MIN(price) FROM room_types WHERE property_id = p.id) AS price_min,
                (SELECT status FROM edit_requests WHERE property_id = p.id ORDER BY id DESC LIMIT 1) AS edit_status,
                (SELECT review_note FROM edit_requests WHERE property_id = p.id ORDER BY id DESC LIMIT 1) AS edit_note
         FROM properties p JOIN property_types t ON t.id = p.type_id
         WHERE p.owner_id = ? ORDER BY p.updated_at DESC`
      )
      .all(req.user.id);
    res.json(rows);
  });

  app.post('/api/my/properties', provider, (req, res) => {
    const { data, errors } = props.validatePayload(db, req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    data.data_source = data.data_source || 'ผู้ประกอบการ';
    const id = props.createProperty(db, data, { ownerId: req.user.id, status: 'pending' });
    res.status(201).json({ id, status: 'pending' });
  });

  function ownProperty(req, res) {
    const p = db.prepare('SELECT id, owner_id, status FROM properties WHERE id = ?').get(idParam(req));
    if (!p || p.owner_id !== req.user.id) {
      res.status(404).json({ error: 'ไม่พบที่พัก' });
      return null;
    }
    return p;
  }

  app.get('/api/my/properties/:id', provider, (req, res) => {
    if (!ownProperty(req, res)) return;
    const p = props.getProperty(db, idParam(req));
    const pendingEdit = db
      .prepare("SELECT id, payload, created_at FROM edit_requests WHERE property_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
      .get(p.id);
    res.json({ ...p, pending_edit: pendingEdit ? { ...pendingEdit, payload: JSON.parse(pendingEdit.payload) } : null });
  });

  app.put('/api/my/properties/:id', provider, (req, res) => {
    const own = ownProperty(req, res);
    if (!own) return;
    const { data, errors } = props.validatePayload(db, req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    data.data_source = data.data_source || 'ผู้ประกอบการ';

    if (own.status === 'published' || own.status === 'hidden') {
      // ที่พักที่เผยแพร่แล้ว: เก็บเป็นคำขอแก้ไข ข้อมูลเดิมยังแสดงอยู่จนกว่าผู้ดูแลจะอนุมัติ
      tx(db, () => {
        db.prepare("UPDATE edit_requests SET status = 'rejected', review_note = 'ถูกแทนที่ด้วยคำขอใหม่', reviewed_at = datetime('now') WHERE property_id = ? AND status = 'pending'").run(own.id);
        db.prepare('INSERT INTO edit_requests (property_id, submitted_by, payload) VALUES (?, ?, ?)').run(
          own.id,
          req.user.id,
          JSON.stringify(data)
        );
      });
      return res.json({ id: own.id, status: own.status, edit_request: 'pending' });
    }
    props.updateProperty(db, own.id, data, { status: 'pending', review_note: null });
    res.json({ id: own.id, status: 'pending' });
  });

  // ---------------------------------------------------------------- ผู้ดูแลระบบ
  app.get('/api/admin/queue', admin, (_req, res) => {
    res.json({
      pending: db
        .prepare(
          `SELECT p.id, p.name, p.created_at, p.updated_at, t.name AS type_name, u.name AS owner_name
           FROM properties p JOIN property_types t ON t.id = p.type_id LEFT JOIN users u ON u.id = p.owner_id
           WHERE p.status = 'pending' ORDER BY p.updated_at`
        )
        .all(),
      edits: db
        .prepare(
          `SELECT e.id, e.property_id, e.created_at, p.name, u.name AS owner_name
           FROM edit_requests e JOIN properties p ON p.id = e.property_id LEFT JOIN users u ON u.id = e.submitted_by
           WHERE e.status = 'pending' ORDER BY e.created_at`
        )
        .all(),
      reports: db
        .prepare(
          `SELECT r.*, p.name FROM reports r JOIN properties p ON p.id = r.property_id
           WHERE r.status = 'open' ORDER BY r.created_at`
        )
        .all(),
    });
  });

  app.get('/api/admin/properties', admin, (req, res) => {
    const status = String(req.query.status || '');
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.status, p.verified_at, p.updated_at, t.name AS type_name, s.name AS soi_name,
                u.name AS owner_name
         FROM properties p JOIN property_types t ON t.id = p.type_id LEFT JOIN sois s ON s.id = p.soi_id
         LEFT JOIN users u ON u.id = p.owner_id
         WHERE (? = '' OR p.status = ?) ORDER BY p.updated_at DESC`
      )
      .all(status, status);
    res.json(rows);
  });

  app.get('/api/admin/properties/:id', admin, (req, res) => {
    const p = props.getProperty(db, idParam(req));
    if (!p) return res.status(404).json({ error: 'ไม่พบที่พัก' });
    res.json({ ...p, review: props.reviewChecklist(db, p) });
  });

  app.post('/api/admin/properties', admin, (req, res) => {
    const { data, errors } = props.validatePayload(db, req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    data.data_source = data.data_source || 'ผู้ดูแลระบบ';
    const id = props.createProperty(db, data, { status: 'published', verifiedBy: req.user.id });
    res.status(201).json({ id });
  });

  app.put('/api/admin/properties/:id', admin, (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT 1 FROM properties WHERE id = ?').get(id)) return res.status(404).json({ error: 'ไม่พบที่พัก' });
    const { data, errors } = props.validatePayload(db, req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    props.updateProperty(db, id, data, { verified_at: new Date().toISOString(), verified_by: req.user.id });
    res.json({ id });
  });

  app.post('/api/admin/properties/:id/status', admin, (req, res) => {
    const id = idParam(req);
    const status = req.body.status;
    const note = String(req.body.note || '').trim().slice(0, 500) || null;
    if (!['published', 'rejected', 'hidden'].includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    if (status === 'rejected' && !note) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
    const extra = status === 'published' ? ", verified_at = ?, verified_by = ?" : '';
    const params = status === 'published' ? [new Date().toISOString(), req.user.id] : [];
    const r = db
      .prepare(`UPDATE properties SET status = ?, review_note = ?, updated_at = datetime('now')${extra} WHERE id = ?`)
      .run(status, note, ...params, id);
    if (!r.changes) return res.status(404).json({ error: 'ไม่พบที่พัก' });
    res.json({ id, status });
  });

  // ยืนยันว่าข้อมูลยังถูกต้อง (อัปเดตวันที่ตรวจสอบล่าสุด)
  app.post('/api/admin/properties/:id/verify', admin, (req, res) => {
    const r = db
      .prepare('UPDATE properties SET verified_at = ?, verified_by = ? WHERE id = ?')
      .run(new Date().toISOString(), req.user.id, idParam(req));
    if (!r.changes) return res.status(404).json({ error: 'ไม่พบที่พัก' });
    res.json({ ok: true });
  });

  app.get('/api/admin/edit-requests/:id', admin, (req, res) => {
    const e = db.prepare('SELECT * FROM edit_requests WHERE id = ?').get(idParam(req));
    if (!e) return res.status(404).json({ error: 'ไม่พบคำขอแก้ไข' });
    res.json({ ...e, payload: JSON.parse(e.payload), current: props.getProperty(db, e.property_id) });
  });

  app.post('/api/admin/edit-requests/:id', admin, (req, res) => {
    const e = db.prepare("SELECT * FROM edit_requests WHERE id = ? AND status = 'pending'").get(idParam(req));
    if (!e) return res.status(404).json({ error: 'ไม่พบคำขอแก้ไขที่รอตรวจสอบ' });
    const note = String(req.body.note || '').trim().slice(0, 500) || null;
    if (req.body.action === 'approve') {
      // ตรวจซ้ำอีกครั้ง เพราะข้อมูลอ้างอิง (ประตู/ซอย) อาจเปลี่ยนไปหลังส่งคำขอ
      const { data, errors } = props.validatePayload(db, JSON.parse(e.payload));
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      props.updateProperty(db, e.property_id, data, { verified_at: new Date().toISOString(), verified_by: req.user.id });
      db.prepare("UPDATE edit_requests SET status = 'approved', review_note = ?, reviewed_at = datetime('now') WHERE id = ?").run(note, e.id);
    } else if (req.body.action === 'reject') {
      if (!note) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
      db.prepare("UPDATE edit_requests SET status = 'rejected', review_note = ?, reviewed_at = datetime('now') WHERE id = ?").run(note, e.id);
    } else {
      return res.status(400).json({ error: 'action ไม่ถูกต้อง' });
    }
    res.json({ ok: true });
  });

  app.post('/api/admin/reports/:id', admin, (req, res) => {
    if (!['resolved', 'dismissed'].includes(req.body.status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    const r = db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(req.body.status, idParam(req));
    if (!r.changes) return res.status(404).json({ error: 'ไม่พบรายงาน' });
    res.json({ ok: true });
  });

  // ---- จัดการข้อมูลอ้างอิง: ประตู โซน ซอย ประเภทที่พัก สิ่งอำนวยความสะดวก
  const REF = {
    gates: { cols: ['name', 'short_name', 'lat', 'lng', 'description', 'sort_order'], required: ['name', 'short_name', 'lat', 'lng'] },
    zones: { cols: ['name', 'tagline', 'description', 'key_sois', 'travel_tips', 'color', 'sort_order'], required: ['name'], links: { table: 'zone_gates', key: 'zone_id' } },
    sois: { cols: ['name', 'zone_id', 'description'], required: ['name'], links: { table: 'soi_gates', key: 'soi_id' } },
    property_types: { cols: ['code', 'name'], required: ['code', 'name'] },
    amenities: { cols: ['code', 'name', 'scope'], required: ['code', 'name', 'scope'] },
  };

  function refValues(def, body) {
    const values = def.cols.map((c) => {
      const v = body[c];
      if (v === '' || v === undefined) return c === 'sort_order' ? 0 : null;
      if (['lat', 'lng'].includes(c)) return Number(v);
      if (['zone_id', 'sort_order'].includes(c)) return parseInt(v, 10);
      return String(v).trim();
    });
    const missing = def.required.find((c) => {
      const v = values[def.cols.indexOf(c)];
      return v == null || v === '' || Number.isNaN(v);
    });
    return { values, missing };
  }

  function writeLinks(def, id, gateIds) {
    if (!def.links || !Array.isArray(gateIds)) return;
    db.prepare(`DELETE FROM ${def.links.table} WHERE ${def.links.key} = ?`).run(id);
    const ins = db.prepare(`INSERT OR IGNORE INTO ${def.links.table} (${def.links.key}, gate_id) SELECT ?, id FROM gates WHERE id = ?`);
    for (const g of gateIds) ins.run(id, parseInt(g, 10));
  }

  for (const [table, def] of Object.entries(REF)) {
    app.post(`/api/admin/${table}`, admin, (req, res) => {
      const { values, missing } = refValues(def, req.body);
      if (missing) return res.status(400).json({ error: `กรุณาระบุ ${missing}` });
      try {
        const id = tx(db, () => {
          const { lastInsertRowid } = db
            .prepare(`INSERT INTO ${table} (${def.cols.join(',')}) VALUES (${def.cols.map(() => '?').join(',')})`)
            .run(...values);
          writeLinks(def, Number(lastInsertRowid), req.body.gate_ids);
          return Number(lastInsertRowid);
        });
        res.status(201).json({ id });
      } catch (err) {
        res.status(400).json({ error: err.message.includes('UNIQUE') ? 'รหัสนี้มีอยู่แล้ว' : 'บันทึกไม่สำเร็จ' });
      }
    });

    app.put(`/api/admin/${table}/:id`, admin, (req, res) => {
      const { values, missing } = refValues(def, req.body);
      if (missing) return res.status(400).json({ error: `กรุณาระบุ ${missing}` });
      try {
        const changes = tx(db, () => {
          const r = db
            .prepare(`UPDATE ${table} SET ${def.cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
            .run(...values, idParam(req));
          if (r.changes) writeLinks(def, idParam(req), req.body.gate_ids);
          return r.changes;
        });
        if (!changes) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
        res.json({ id: idParam(req) });
      } catch (err) {
        res.status(400).json({ error: err.message.includes('UNIQUE') ? 'รหัสนี้มีอยู่แล้ว' : 'บันทึกไม่สำเร็จ' });
      }
    });

    app.delete(`/api/admin/${table}/:id`, admin, (req, res) => {
      try {
        const r = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(idParam(req));
        if (!r.changes) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
        res.json({ ok: true });
      } catch {
        res.status(409).json({ error: 'ลบไม่ได้ เพราะยังมีที่พักใช้ข้อมูลนี้อยู่' });
      }
    });
  }

  app.get('/api/admin/events.csv', admin, (_req, res) => {
    const rows = db.prepare('SELECT id, session_id, event, data, created_at FROM usage_events ORDER BY id').all();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['id,session_id,event,data,created_at', ...rows.map((r) => [r.id, r.session_id, r.event, r.data, r.created_at].map(esc).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nudorm-usage-events.csv"');
    res.send('﻿' + csv); // BOM ให้ Excel อ่านภาษาไทยถูก
  });

  // ---------------------------------------------------------------- ไฟล์หน้าเว็บ
  app.use('/uploads', express.static(UPLOAD_DIR));
  // no-cache: เบราว์เซอร์ต้องถามเซิร์ฟเวอร์ก่อนใช้ไฟล์ในแคช จึงเห็นการแก้ CSS/JS ทันทีโดยไม่ต้องกด Ctrl+F5
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    extensions: ['html'],
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'ไม่พบ API' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'ไฟล์รูปใหญ่เกิน 5MB หรือจำนวนเกินกำหนด' });
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
  });

  return app;
}

if (require.main === module) {
  const db = open();
  if (!db.prepare('SELECT COUNT(*) AS n FROM gates').get().n) {
    console.log('ฐานข้อมูลว่าง — กำลังใส่ข้อมูลตัวอย่าง...');
    seed(db);
  }
  // Express 5 เรียก callback นี้ทั้งตอนสำเร็จและตอนเกิดข้อผิดพลาด
  createApp(db).listen(PORT, (err) => {
    if (err) {
      console.error(
        err.code === 'EADDRINUSE'
          ? `พอร์ต ${PORT} ถูกใช้งานอยู่ (อาจมี server เปิดค้างไว้) ปิดตัวเดิมก่อน หรือรันด้วยพอร์ตอื่น เช่น $env:PORT=3001; npm start`
          : err
      );
      process.exit(1);
    }
    console.log(`NU Dorm Finder: http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
