'use strict';
// ทดสอบบทบาทผู้ใช้ผ่าน API จริง: สมัคร/เข้าสู่ระบบ รายการโปรด การเปรียบเทียบ สิทธิ์ และขั้นตอนอนุมัติประกาศ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/index');

const db = open(':memory:');
const log = console.log;
console.log = () => {};
seed(db);
console.log = log;

let server;
let base;
test.before(async () => {
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** ผู้ใช้จำลองที่เก็บคุกกี้ของตัวเอง */
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const gate4 = () => db.prepare("SELECT id FROM gates WHERE short_name = 'ประตู 4'").get().id;
const listing = (name) => ({
  name, type_code: 'dorm', address: 'ที่อยู่ทดสอบ', lat: 16.7601, lng: 100.184, gate_ids: [gate4()],
  contact_phone: '0800000000', rooms: [{ name: 'ห้องแอร์', price: 2800 }, { name: 'ห้องใหญ่', price: 3500, features: 'ตู้เย็น' }],
});
const publishedIds = () => db.prepare("SELECT id FROM properties WHERE status = 'published' ORDER BY id").all().map((r) => r.id);

test('ผู้ใช้ทั่วไป: ค้นหาได้ แต่บันทึกที่พัก ส่งประกาศ และบันทึกชุดเปรียบเทียบในบัญชีไม่ได้', async () => {
  const guest = client();
  assert.equal((await guest('GET', '/api/properties')).status, 200);
  assert.equal((await guest('PUT', `/api/me/favorites/${publishedIds()[0]}`)).status, 401);
  assert.equal((await guest('PUT', '/api/me/compare', { ids: publishedIds().slice(0, 2) })).status, 401);
  assert.equal((await guest('POST', '/api/my/properties', listing('หอผี'))).status, 401);
  // เปรียบเทียบแบบไม่ต้องเข้าสู่ระบบได้ สูงสุด 3 แห่ง
  const [a, b, c, d] = publishedIds();
  const ok = await guest('GET', `/api/compare?ids=${a},${b},${c}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.length, 3);
  assert.equal((await guest('GET', `/api/compare?ids=${a},${b},${c},${d}`)).status, 400);
});

test('สมัครสมาชิกไม่สามารถตั้งตัวเองเป็นผู้ดูแลระบบได้', async () => {
  const x = client();
  const r = await x('POST', '/api/auth/register', { email: 'hack@test.local', name: 'x', password: 'password123', role: 'admin' });
  assert.equal(r.status, 400);
});

test('สมาชิก: รายการโปรดและชุดเปรียบเทียบยังอยู่หลังออกจากระบบแล้วเข้าใหม่', async () => {
  const m = client();
  const reg = await m('POST', '/api/auth/register', { email: 'member@test.local', name: 'สมาชิกทดสอบ', password: 'password123' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.role, 'member');
  const [a, b, c, d] = publishedIds();

  assert.equal((await m('PUT', `/api/me/favorites/${a}`)).status, 200);
  assert.equal((await m('PUT', `/api/me/favorites/${b}`)).status, 200);
  assert.equal((await m('PUT', `/api/me/favorites/${a}`)).status, 200); // กดซ้ำไม่เกิดรายการซ้ำ
  assert.equal((await m('PUT', '/api/me/compare', { ids: [a, b, c] })).status, 200);
  assert.equal((await m('PUT', '/api/me/compare', { ids: [a, b, c, d] })).status, 400); // รายการที่ 4

  await m('POST', '/api/auth/logout');
  assert.equal((await m('GET', '/api/me/favorites')).status, 401);
  const login = await m('POST', '/api/auth/login', { email: 'member@test.local', password: 'password123' });
  assert.equal(login.status, 200);

  const fav = await m('GET', '/api/me/favorites');
  assert.deepEqual(fav.data.items.map((p) => p.id).sort(), [a, b].sort());
  assert.deepEqual((await m('GET', '/api/me/compare')).data, [a, b, c]);

  // นำออกจากรายการโปรด
  await m('DELETE', `/api/me/favorites/${a}`);
  assert.deepEqual((await m('GET', '/api/me/favorite-ids')).data, [b]);

  // สมาชิกส่งประกาศหรืออัปโหลดรูปไม่ได้
  assert.equal((await m('POST', '/api/my/properties', listing('หอของสมาชิก'))).status, 403);
  assert.equal((await m('GET', '/api/admin/queue')).status, 403);
});

test('ผู้ประกอบการ: ประกาศใหม่รอตรวจสอบ ไม่ปรากฏในค้นหา แก้ของคนอื่นไม่ได้ ผู้ดูแลอนุมัติ/ปฏิเสธพร้อมเหตุผล', async () => {
  const p1 = client();
  const p2 = client();
  const adm = client();
  assert.equal((await p1('POST', '/api/auth/register', { email: 'owner1@test.local', name: 'เจ้าของ 1', password: 'password123', role: 'provider' })).data.role, 'provider');
  await p2('POST', '/api/auth/register', { email: 'owner2@test.local', name: 'เจ้าของ 2', password: 'password123', role: 'provider' });
  await adm('POST', '/api/auth/login', { email: 'admin@nudorm.local', password: 'admin1234' });

  const created = await p1('POST', '/api/my/properties', listing('หอทดสอบอนุมัติ'));
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'pending');
  const id = created.data.id;

  // ยังไม่เผยแพร่: ไม่อยู่ในผลค้นหา หน้ารายละเอียด หรือการเปรียบเทียบสาธารณะ
  const guest = client();
  const search = await guest('GET', '/api/properties?q=' + encodeURIComponent('หอทดสอบอนุมัติ'));
  assert.equal(search.data.count, 0);
  assert.equal((await guest('GET', `/api/properties/${id}`)).status, 404);
  assert.equal((await guest('GET', `/api/compare?ids=${id}`)).data.length, 0);

  // ผู้ประกอบการคนอื่นดู/แก้ไม่ได้
  assert.equal((await p2('GET', `/api/my/properties/${id}`)).status, 404);
  assert.equal((await p2('PUT', `/api/my/properties/${id}`, listing('ยึดประกาศ'))).status, 404);

  // ปฏิเสธต้องมีเหตุผล
  assert.equal((await adm('POST', `/api/admin/properties/${id}/status`, { status: 'rejected' })).status, 400);
  assert.equal((await adm('POST', `/api/admin/properties/${id}/status`, { status: 'rejected', note: 'รูปไม่ชัด' })).status, 200);
  const mine = (await p1('GET', '/api/my/properties')).data.find((r) => r.id === id);
  assert.equal(mine.status, 'rejected');
  assert.equal(mine.review_note, 'รูปไม่ชัด');

  // แก้แล้วส่งใหม่ → กลับเป็นรอตรวจสอบ → อนุมัติ → ปรากฏในค้นหา
  assert.equal((await p1('PUT', `/api/my/properties/${id}`, listing('หอทดสอบอนุมัติ'))).data.status, 'pending');
  assert.equal((await adm('POST', `/api/admin/properties/${id}/status`, { status: 'published' })).status, 200);
  assert.equal((await guest('GET', '/api/properties?q=' + encodeURIComponent('หอทดสอบอนุมัติ'))).data.count, 1);

  // เสนอแก้ไขประกาศที่เผยแพร่แล้ว: ข้อมูลสาธารณะยังเป็นค่าเดิมจนกว่าจะอนุมัติ
  const edit = await p1('PUT', `/api/my/properties/${id}`, { ...listing('หอทดสอบอนุมัติ'), rooms: [{ name: 'ห้องแอร์', price: 2500 }] });
  assert.equal(edit.data.edit_request, 'pending');
  assert.equal((await guest('GET', `/api/properties/${id}`)).data.rooms[0].price, 2800);
  const queue = (await adm('GET', '/api/admin/queue')).data;
  const req = queue.edits.find((e) => e.property_id === id);
  assert.ok(req);
  assert.equal((await adm('POST', `/api/admin/edit-requests/${req.id}`, { action: 'approve' })).status, 200);
  assert.equal((await guest('GET', `/api/properties/${id}`)).data.rooms[0].price, 2500);

  // ผู้ประกอบการใช้ API ผู้ดูแลไม่ได้
  assert.equal((await p1('POST', `/api/admin/properties/${id}/status`, { status: 'published' })).status, 403);
});

test('การเปรียบเทียบแสดงราคาแยกตามประเภทห้อง พร้อมของในห้องของห้องนั้นเท่านั้น', async () => {
  const p = client();
  await p('POST', '/api/auth/login', { email: 'owner1@test.local', password: 'password123' });
  const id = db.prepare("SELECT id FROM properties WHERE name = 'หอทดสอบอนุมัติ'").get().id;
  const guest = client();
  const [item] = (await guest('GET', `/api/compare?ids=${id}`)).data;
  assert.deepEqual(item.rooms.map((r) => [r.name, r.price, r.features_list]), [['ห้องแอร์', 2500, []]]);
});

test('ย้ายฐานข้อมูลเดิมที่ยังไม่มีบทบาทสมาชิกได้โดยข้อมูลผู้ใช้ไม่หาย', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nudorm-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT,
            password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('provider', 'admin')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')));
            INSERT INTO users (email, name, password_hash, role) VALUES ('old@test.local', 'เดิม', 'x', 'provider');
            PRAGMA user_version = 2;`);
  old.close();
  const migrated = open(file);
  migrated.prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('new@test.local', 'ใหม่', 'x', 'member')").run();
  assert.deepEqual(migrated.prepare('SELECT email, role FROM users ORDER BY id').all().map((r) => [r.email, r.role]),
    [['old@test.local', 'provider'], ['new@test.local', 'member']]);
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 4);
  migrated.close();
});
