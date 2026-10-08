'use strict';
/**
 * ลบที่พักสมมติ (ข้อมูลตัวอย่างจาก seed) ออกจากฐานข้อมูลที่มีอยู่แล้ว โดยไม่แตะที่พักจริง
 *
 *   npm run remove-samples              ลบจริง (สำรองฐานข้อมูลไว้ก่อน)
 *   npm run remove-samples -- --dry-run ดูรายการที่จะถูกลบโดยไม่ลบ
 *
 * ที่พักสมมติ = ชื่อมีคำว่า "(สมมติ)" หรือเป็นของบัญชีผู้ประกอบการตัวอย่าง provider@nudorm.local
 * ที่พักที่นำเข้าจากชีต (มี import_key) ไม่ถูกลบเสมอ
 */
const path = require('node:path');
const { open, tx, DB_PATH } = require('./db');

const DEMO_PROVIDER = 'provider@nudorm.local';

function findSamples(db) {
  return db
    .prepare(
      `SELECT p.id, p.name FROM properties p LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.import_key IS NULL AND (p.name LIKE '%(สมมติ)%' OR u.email = ?)
       ORDER BY p.id`
    )
    .all(DEMO_PROVIDER);
}

/** ลบที่พักสมมติ บัญชีผู้ประกอบการตัวอย่าง และซอยตัวอย่างที่ไม่มีที่พักใช้แล้ว */
function removeSamples(db) {
  const samples = findSamples(db);
  return tx(db, () => {
    const del = db.prepare('DELETE FROM properties WHERE id = ?');
    for (const p of samples) del.run(p.id);
    // บัญชีตัวอย่างลบได้เมื่อไม่เหลือที่พักของบัญชีนี้ (ที่พักจริงที่ผูกกับบัญชีนี้ทำให้ไม่ลบ)
    const users = db
      .prepare('DELETE FROM users WHERE email = ? AND NOT EXISTS (SELECT 1 FROM properties WHERE owner_id = users.id)')
      .run(DEMO_PROVIDER).changes;
    const sois = db
      .prepare("DELETE FROM sois WHERE name LIKE '%(ตัวอย่าง)%' AND NOT EXISTS (SELECT 1 FROM properties WHERE soi_id = sois.id)")
      .run().changes;
    return { properties: samples, users, sois };
  });
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = open();
  const samples = findSamples(db);
  if (!samples.length) {
    console.log('ไม่พบที่พักสมมติในฐานข้อมูล');
    db.close();
    return;
  }
  console.log(`พบที่พักสมมติ ${samples.length} รายการ:`);
  for (const p of samples) console.log(`  - ${p.name}`);
  if (dryRun) {
    console.log('\n(--dry-run ยังไม่ได้ลบ) รันอีกครั้งโดยไม่ใส่ --dry-run เพื่อลบจริง');
    db.close();
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const backup = path.join(path.dirname(DB_PATH), `nudorm-backup-${stamp}-before-remove-samples.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`\nสำรองฐานข้อมูลไว้ที่ ${backup}`);
  const r = removeSamples(db);
  console.log(`ลบที่พักสมมติ ${r.properties.length} รายการ, บัญชีตัวอย่าง ${r.users} บัญชี, ซอยตัวอย่าง ${r.sois} ซอย`);
  db.close();
}

if (require.main === module) main();

module.exports = { findSamples, removeSamples };
