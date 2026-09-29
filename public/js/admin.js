/* หน้าผู้ดูแลระบบ: ตรวจสอบ อนุมัติ และจัดการข้อมูลอ้างอิง */
renderHeader('admin');
const page = document.getElementById('page');
let currentTab = 'queue';

const TABS = [
  ['queue', 'รอตรวจสอบ'],
  ['properties', 'ที่พักทั้งหมด'],
  ['gates', 'ประตู'],
  ['zones', 'โซน'],
  ['sois', 'ซอย'],
  ['types', 'ประเภท / สิ่งอำนวยความสะดวก'],
  ['import', 'นำเข้าจากชีต'],
  ['usage', 'ข้อมูลการใช้งาน'],
];

async function shell(me) {
  const queue = await api('/api/admin/queue');
  const pendingCount = queue.pending.length + queue.edits.length + queue.reports.length;
  page.innerHTML = `
    <div class="results-head"><h1 style="margin:0">ผู้ดูแลระบบ</h1>
      <span class="muted small">${esc(me.name)} · <a href="#" id="logout">ออกจากระบบ</a></span></div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === currentTab ? 'active' : ''}">${l}${k === 'queue' && pendingCount ? `<span class="count">${pendingCount}</span>` : ''}</button>`).join('')}</div>
    <div id="tab"></div>`;
  page.querySelector('#logout').onclick = async (e) => {
    e.preventDefault();
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  };
  page.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      currentTab = b.dataset.tab;
      page.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      renderTab();
    })
  );
  renderTab(queue);
}

async function refresh() {
  metaPromise = null; // ข้อมูลอ้างอิงอาจเปลี่ยน
  const me = await api('/api/auth/me');
  await shell(me);
}

function renderTab(queue) {
  const host = document.getElementById('tab');
  host.innerHTML = '<p class="muted">กำลังโหลด…</p>';
  const fn = { queue: tabQueue, properties: tabProperties, gates: tabGates, zones: tabZones, sois: tabSois, types: tabTypes, import: tabImport, usage: tabUsage }[currentTab];
  fn(host, queue).catch((err) => (host.innerHTML = `<div class="notice error">${esc(err.message)}</div>`));
}

// ================================================================ คิวตรวจสอบ
async function tabQueue(host, queue) {
  queue ||= await api('/api/admin/queue');
  host.innerHTML = `
    <h2>ประกาศใหม่รออนุมัติ (${queue.pending.length})</h2>
    ${queue.pending.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>ผู้ส่ง</th><th>ส่งเมื่อ</th><th></th></tr></thead><tbody>
      ${queue.pending.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.type_name)}</td><td>${esc(p.owner_name || '-')}</td><td class="small">${thaiDate(p.updated_at)}</td>
        <td><button class="btn small primary" data-review="${p.id}">ตรวจสอบ</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">ไม่มีรายการ</p>'}

    <h2 style="margin-top:26px">คำขอแก้ไขข้อมูล (${queue.edits.length})</h2>
    ${queue.edits.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>ที่พัก</th><th>ผู้ส่ง</th><th>ส่งเมื่อ</th><th></th></tr></thead><tbody>
      ${queue.edits.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.owner_name || '-')}</td><td class="small">${thaiDate(e.created_at)}</td>
        <td><button class="btn small primary" data-edit-req="${e.id}">เปรียบเทียบ</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">ไม่มีรายการ</p>'}

    <h2 style="margin-top:26px">รายงานข้อมูลไม่ถูกต้อง (${queue.reports.length})</h2>
    ${queue.reports.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>ที่พัก</th><th>เหตุผล</th><th>รายละเอียด</th><th>แจ้งเมื่อ</th><th></th></tr></thead><tbody>
      ${queue.reports.map((r) => `<tr><td><a href="/property?id=${r.property_id}" target="_blank">${esc(r.name)}</a></td><td>${esc(r.reason)}</td><td class="small">${esc(r.detail || '-')}</td><td class="small">${thaiDate(r.created_at)}</td>
        <td style="white-space:nowrap"><button class="btn small" data-review="${r.property_id}">แก้ไขที่พัก</button>
        <button class="btn small ok" data-report="${r.id}" data-status="resolved">แก้แล้ว</button>
        <button class="btn small" data-report="${r.id}" data-status="dismissed">ไม่ต้องแก้</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">ไม่มีรายการ</p>'}`;

  host.querySelectorAll('[data-review]').forEach((b) => (b.onclick = () => reviewProperty(Number(b.dataset.review))));
  host.querySelectorAll('[data-edit-req]').forEach((b) => (b.onclick = () => reviewEdit(Number(b.dataset.editReq))));
  host.querySelectorAll('[data-report]').forEach((b) => (b.onclick = async () => {
    await api(`/api/admin/reports/${b.dataset.report}`, { method: 'POST', body: { status: b.dataset.status } });
    toast('บันทึกแล้ว');
    refresh();
  }));
}

/** หน้าตรวจสอบที่พัก: รายการตรวจ + รายการที่อาจซ้ำ + ปุ่มอนุมัติ + ฟอร์มแก้ไข */
async function reviewProperty(id) {
  const p = await api(`/api/admin/properties/${id}`);
  const { checks, duplicates } = p.review;
  const m = openModal(`ตรวจสอบ: ${p.name}`, `
    <div class="chips" style="margin-bottom:12px">${statusChip(p.status)} ${freshnessChip(p.verified_at)} <a class="chip" href="/property?id=${p.id}" target="_blank">เปิดหน้ารายละเอียด ↗</a></div>
    <div class="grid-2">
      <div class="card"><div class="card-body"><h3>ข้อมูลจำเป็น</h3>
        <ul class="checklist">${checks.map((c) => `<li class="${c.ok ? '' : 'fail'}">${esc(c.label)}</li>`).join('')}</ul></div></div>
      <div class="card"><div class="card-body"><h3>รายการที่อาจซ้ำ</h3>
        ${duplicates.length ? duplicates.map((d) => `<div class="small"><a href="/property?id=${d.id}" target="_blank">${esc(d.name)}</a> ${statusChip(d.status)} ห่าง ${d.distance_m} ม.</div>`).join('') : '<p class="small muted" style="margin:0">ไม่พบชื่อซ้ำหรือที่พักในรัศมี 40 ม.</p>'}</div></div>
    </div>
    <div class="field" style="margin-top:14px"><label>หมายเหตุถึงผู้ประกอบการ (จำเป็นเมื่อไม่อนุมัติ)</label><input type="text" id="reviewNote" value="${esc(p.review_note || '')}"></div>
    <div class="chips" style="margin-bottom:18px">
      ${p.status !== 'published' ? '<button class="btn primary" data-status="published">อนุมัติและเผยแพร่</button>' : '<button class="btn ok" data-verify>ยืนยันว่าข้อมูลยังถูกต้อง</button>'}
      ${p.status !== 'rejected' ? '<button class="btn danger" data-status="rejected">ไม่อนุมัติ</button>' : ''}
      ${p.status === 'published' ? '<button class="btn" data-status="hidden">ซ่อนประกาศ</button>' : ''}
      ${p.status === 'hidden' ? '' : ''}
    </div>
    <details><summary style="cursor:pointer;font-weight:600;margin-bottom:12px">แก้ไขข้อมูลโดยผู้ดูแล</summary><div id="adminForm"></div></details>`);

  m.el.querySelectorAll('[data-status]').forEach((b) => (b.onclick = async () => {
    try {
      await api(`/api/admin/properties/${id}/status`, { method: 'POST', body: { status: b.dataset.status, note: m.el.querySelector('#reviewNote').value } });
      m.close();
      toast('บันทึกสถานะแล้ว');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }));
  m.el.querySelector('[data-verify]')?.addEventListener('click', async () => {
    await api(`/api/admin/properties/${id}/verify`, { method: 'POST' });
    m.close();
    toast('อัปเดตวันที่ตรวจสอบแล้ว');
    refresh();
  });
  m.el.querySelector('details').addEventListener('toggle', function once(e) {
    e.target.removeEventListener('toggle', once);
    mountPropertyForm(m.el.querySelector('#adminForm'), {
      initial: p,
      submitLabel: 'บันทึกการแก้ไข',
      onSubmit: async (body) => {
        await api(`/api/admin/properties/${id}`, { method: 'PUT', body });
        m.close();
        toast('บันทึกแล้ว');
        refresh();
      },
    });
  });
}

/** เทียบข้อมูลปัจจุบันกับคำขอแก้ไข */
async function reviewEdit(id) {
  const e = await api(`/api/admin/edit-requests/${id}`);
  const meta = await getMeta();
  const cur = e.current;
  const next = e.payload;
  const typeName = (tid) => meta.types.find((t) => t.id === tid)?.name;
  const soiName = (sid) => meta.sois.find((s) => s.id === sid)?.name || '-';
  const gateNames = (ids) => meta.gates.filter((g) => ids.includes(g.id)).map((g) => g.short_name).join(', ');
  const amenNames = (codes) => meta.amenities.filter((a) => codes.includes(a.code)).map((a) => a.name).join(', ');
  const rooms = (rs) => rs.map((r) => `${r.name} ${baht(r.price)}฿${r.available ? '' : ' (เต็ม)'}`).join('<br>');
  const rows = [
    ['ชื่อ', cur.name, next.name],
    ['ประเภท', cur.type_name, typeName(next.type_id)],
    ['ซอย', cur.soi_name || '-', soiName(next.soi_id)],
    ['ประตู', gateNames(cur.gate_ids), gateNames(next.gate_ids)],
    ['ที่อยู่', cur.address, next.address],
    ['พิกัด', `${cur.lat}, ${cur.lng}`, `${next.lat}, ${next.lng}`],
    ['ห้อง/ราคา', rooms(cur.rooms), rooms(next.rooms)],
    ['เงินประกัน', cur.deposit ?? '-', next.deposit ?? '-'],
    ['ค่าน้ำ', cur.water_rate, next.water_rate],
    ['ค่าไฟ', cur.electric_rate, next.electric_rate],
    ['ค่าใช้จ่ายอื่น', cur.other_fees, next.other_fees],
    ['เงื่อนไข', cur.lease_terms, next.lease_terms],
    ['สิ่งอำนวยความสะดวก', amenNames(cur.amenity_codes), amenNames(next.amenity_codes)],
    ['รูปภาพ', `${cur.images.length} รูป`, `${next.images.length} รูป`],
    ['โทร', cur.contact_phone, next.contact_phone],
    ['LINE', cur.contact_line, next.contact_line],
    ['Facebook', cur.contact_facebook, next.contact_facebook],
    ['รายละเอียด', cur.description, next.description],
  ];
  // ค่าที่เป็น HTML (ห้อง) สร้างจากข้อมูลที่ esc แล้วไม่ได้ จึง esc เฉพาะข้อความทั่วไป
  const cell = (label, v) => (label === 'ห้อง/ราคา' ? String(v).split('<br>').map(esc).join('<br>') : esc(v ?? ''));
  const m = openModal(`คำขอแก้ไข: ${cur.name}`, `
    <div class="table-wrap"><table class="list diff"><thead><tr><th></th><th>ข้อมูลปัจจุบัน</th><th>ข้อมูลที่เสนอ</th></tr></thead><tbody>
      ${rows.map(([label, a, b]) => {
        const changed = String(a ?? '') !== String(b ?? '');
        return `<tr><th>${label}</th><td>${cell(label, a)}</td><td class="${changed ? 'changed' : ''}">${cell(label, b)}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <div class="field" style="margin-top:14px"><label>หมายเหตุ (จำเป็นเมื่อไม่อนุมัติ)</label><input type="text" id="editNote"></div>
    <div class="chips"><button class="btn primary" data-act="approve">อนุมัติการแก้ไข</button><button class="btn danger" data-act="reject">ไม่อนุมัติ</button></div>`);
  m.el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    try {
      await api(`/api/admin/edit-requests/${id}`, { method: 'POST', body: { action: b.dataset.act, note: m.el.querySelector('#editNote').value } });
      m.close();
      toast('บันทึกแล้ว');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }));
}

// ================================================================ ที่พักทั้งหมด
async function tabProperties(host) {
  host.innerHTML = `<div class="results-head">
      <select id="statusFilter" style="width:auto"><option value="">ทุกสถานะ</option>
        ${Object.entries(STATUS_LABEL).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="btn primary" id="addProp">+ เพิ่มที่พัก (ผู้ดูแล)</button></div>
    <div id="propTable"></div>`;
  async function load() {
    const rows = await api(`/api/admin/properties?status=${host.querySelector('#statusFilter').value}`);
    host.querySelector('#propTable').innerHTML = `<div class="table-wrap"><table class="list"><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>ซอย</th><th>เจ้าของ</th><th>สถานะ</th><th>เหตุผล / หมายเหตุ</th><th>ตรวจสอบล่าสุด</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.type_name)}</td><td>${esc(r.soi_name || '-')}</td><td>${esc(r.owner_name || '-')}</td>
        <td>${statusChip(r.status)}${r.pending_edits ? '<div><span class="chip warn">มีคำขอแก้ไขรอตรวจสอบ</span></div>' : ''}</td>
        <td class="small">${r.status === 'rejected' ? `<span style="color:var(--bad)">${esc(r.review_note || '-')}</span>` : esc(r.review_note || '')}</td>
        <td>${freshnessChip(r.verified_at)}</td>
        <td><button class="btn small" data-review="${r.id}">จัดการ</button></td></tr>`).join('')}
    </tbody></table></div>`;
    host.querySelectorAll('[data-review]').forEach((b) => (b.onclick = () => reviewProperty(Number(b.dataset.review))));
  }
  host.querySelector('#statusFilter').onchange = load;
  host.querySelector('#addProp').onclick = () => {
    const m = openModal('เพิ่มที่พัก (เผยแพร่ทันที)', '<div id="newForm"></div>');
    mountPropertyForm(m.el.querySelector('#newForm'), {
      submitLabel: 'บันทึกและเผยแพร่',
      onSubmit: async (body) => {
        await api('/api/admin/properties', { method: 'POST', body });
        m.close();
        toast('เพิ่มที่พักแล้ว');
        load();
      },
    });
  };
  await load();
}

// ================================================================ ข้อมูลอ้างอิง
/** ตารางแก้ไขข้อมูลอ้างอิงแบบทั่วไป */
function refEditor(host, { endpoint, rows, fields, title, extra }) {
  host.innerHTML = `<h2>${title}</h2>
    <div class="table-wrap"><table class="list"><thead><tr>${fields.map((f) => `<th>${f.label}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}">${fields.map((f) => `<td>${f.render ? f.render(r) : esc(r[f.key] ?? '')}</td>`).join('')}
      <td style="white-space:nowrap"><button class="btn small" data-edit="${r.id}">แก้ไข</button> <button class="btn small danger" data-del="${r.id}">ลบ</button></td></tr>`).join('')}</tbody></table></div>
    <button class="btn primary" style="margin-top:12px" data-add>+ เพิ่ม</button>
    ${extra || ''}`;

  function edit(row = {}) {
    const m = openModal(row.id ? `แก้ไข${title}` : `เพิ่ม${title}`, `<form>
      ${fields.filter((f) => f.input !== false).map((f) => `<div class="field"><label>${f.label}</label>${f.input ? f.input(row) : `<input type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} name="${f.key}" value="${esc(row[f.key] ?? '')}">`}</div>`).join('')}
      <button class="btn primary">บันทึก</button></form>`);
    m.el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries([...fd.keys()].filter((k) => k !== 'gate_ids').map((k) => [k, fd.get(k)]));
      if (fields.some((f) => f.key === 'gate_ids')) body.gate_ids = fd.getAll('gate_ids');
      try {
        await api(row.id ? `/api/admin/${endpoint}/${row.id}` : `/api/admin/${endpoint}`, { method: row.id ? 'PUT' : 'POST', body });
        m.close();
        toast('บันทึกแล้ว');
        refresh();
      } catch (err) {
        toast(err.message);
      }
    });
    return m;
  }
  host.querySelector('[data-add]').onclick = () => edit();
  host.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(rows.find((r) => r.id === Number(b.dataset.edit)))));
  host.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('ยืนยันการลบ?')) return;
    try {
      await api(`/api/admin/${endpoint}/${b.dataset.del}`, { method: 'DELETE' });
      toast('ลบแล้ว');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }));
  return { edit };
}

function gateCheckboxes(meta, selected = []) {
  return meta.gates.map((g) => `<label class="check" style="display:inline-flex;margin-right:12px"><input type="checkbox" name="gate_ids" value="${g.id}" ${selected.includes(g.id) ? 'checked' : ''}> ${esc(g.short_name)}</label>`).join('');
}

async function tabGates(host) {
  const meta = await getMeta();
  const { edit } = refEditor(host, {
    endpoint: 'gates',
    title: 'ประตู',
    rows: meta.gates,
    fields: [
      { key: 'sort_order', label: 'ลำดับ', type: 'number' },
      { key: 'name', label: 'ชื่อเต็ม' },
      { key: 'short_name', label: 'ชื่อสั้น' },
      { key: 'lat', label: 'ละติจูด', type: 'number', step: '0.000001' },
      { key: 'lng', label: 'ลองจิจูด', type: 'number', step: '0.000001' },
      { key: 'description', label: 'คำอธิบาย' },
    ],
    extra: `<h3 style="margin-top:22px">ตรวจตำแหน่งประตูบนแผนที่</h3>
      <p class="small muted">ลากหมุดไปยังตำแหน่งจริงของประตู แล้วระบบจะเปิดหน้าต่างแก้ไขพร้อมพิกัดใหม่</p>
      <div id="gateMap" class="map"></div>`,
  });
  const map = createMap('gateMap');
  for (const g of meta.gates) {
    const mk = L.marker([g.lat, g.lng], { icon: gateIcon(g), draggable: true }).addTo(map).bindTooltip(g.name);
    mk.on('dragend', () => {
      const { lat, lng } = mk.getLatLng();
      edit({ ...g, lat: lat.toFixed(6), lng: lng.toFixed(6) });
    });
  }
  fitTo(map, L.latLngBounds(meta.gates.map((g) => [g.lat, g.lng])).pad(0.3));
}

async function tabZones(host) {
  const meta = await getMeta();
  refEditor(host, {
    endpoint: 'zones',
    title: 'โซน',
    rows: meta.zones,
    fields: [
      { key: 'sort_order', label: 'ลำดับ', type: 'number' },
      { key: 'name', label: 'ชื่อโซน' },
      { key: 'tagline', label: 'ป้ายมุมการ์ด (เช่น โซนยอดนิยมอันดับ 1)' },
      {
        key: 'description', label: 'จุดเด่น (ใช้ **ข้อความ** เพื่อทำตัวหนา)',
        render: (r) => richText(r.description || ''),
        input: (r) => `<textarea name="description" rows="4">${esc(r.description || '')}</textarea>`,
      },
      { key: 'key_sois', label: 'ซอยสำคัญ' },
      { key: 'travel_tips', label: 'การเดินทาง' },
      {
        key: 'color', label: 'สีป้ายประตู',
        render: (r) => `<span class="zc-badge c-${esc(r.color || 'teal')}">${esc(r.color || 'teal')}</span>`,
        input: (r) => `<select name="color">${['amber', 'teal', 'violet', 'blue', 'rose'].map((c) => `<option value="${c}" ${(r.color || 'teal') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`,
      },
      { key: 'gate_ids', label: 'ประตูหลักของโซน', render: (r) => esc(meta.gates.filter((g) => r.gate_ids.includes(g.id)).map((g) => g.short_name).join(', ')), input: (r) => gateCheckboxes(meta, r.gate_ids || []) },
    ],
  });
}

async function tabSois(host) {
  const meta = await getMeta();
  refEditor(host, {
    endpoint: 'sois',
    title: 'ซอย',
    rows: meta.sois,
    fields: [
      { key: 'name', label: 'ชื่อซอย' },
      {
        key: 'zone_id', label: 'โซน',
        render: (r) => esc(meta.zones.find((z) => z.id === r.zone_id)?.name || '-'),
        input: (r) => `<select name="zone_id"><option value="">— ไม่ระบุ —</option>${meta.zones.map((z) => `<option value="${z.id}" ${r.zone_id === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select>`,
      },
      { key: 'gate_ids', label: 'ประตูที่ซอยเชื่อม', render: (r) => esc(meta.gates.filter((g) => r.gate_ids.includes(g.id)).map((g) => g.short_name).join(', ')), input: (r) => gateCheckboxes(meta, r.gate_ids || []) },
      { key: 'description', label: 'คำอธิบาย' },
    ],
  });
}

async function tabTypes(host) {
  const meta = await getMeta();
  host.innerHTML = '<div id="t1"></div><div id="t2" style="margin-top:30px"></div>';
  const fields = [{ key: 'code', label: 'รหัส (ภาษาอังกฤษ ใช้ใน URL)' }, { key: 'name', label: 'ชื่อที่แสดง' }];
  refEditor(host.querySelector('#t1'), { endpoint: 'property_types', title: 'ประเภทที่พัก', rows: meta.types, fields });
  const scopes = { building: 'ของหอพัก (แสดงในหมวดสิ่งอำนวยความสะดวก)', room: 'ภายในห้อง (ใช้กรองการค้นหา)', rule: 'เงื่อนไขผู้พัก' };
  refEditor(host.querySelector('#t2'), {
    endpoint: 'amenities', title: 'สิ่งอำนวยความสะดวก', rows: meta.amenities,
    fields: [...fields, {
      key: 'scope', label: 'หมวด',
      render: (r) => esc(scopes[r.scope] || r.scope),
      input: (r) => `<select name="scope">${Object.entries(scopes).map(([k, l]) => `<option value="${k}" ${(r.scope || 'building') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`,
    }],
  });
}

async function tabUsage(host) {
  host.innerHTML = `<h2>ข้อมูลการใช้งานสำหรับประเมินผลวิจัย</h2>
    <p>ระบบบันทึกเหตุการณ์แบบไม่ระบุตัวตน (รหัสเซสชันสุ่มต่อแท็บเบราว์เซอร์) ได้แก่ <code>gate_select</code>, <code>search</code> (เงื่อนไข + จำนวนผลลัพธ์),
    <code>view_property</code> และ <code>contact_click</code> พร้อมเวลาระดับมิลลิวินาที ใช้คำนวณระยะเวลาทำภารกิจและอัตราความสำเร็จ เช่น
    เวลาจากการค้นหาครั้งแรกจนถึงการเปิดดูที่พักที่ตรงเงื่อนไข</p>
    <a class="btn primary" href="/api/admin/events.csv">ดาวน์โหลด CSV</a>`;
}

// ================================================================ นำเข้าจากชีต
async function tabImport(host) {
  host.innerHTML = `<h2>นำเข้าที่พักจากชีตฐานข้อมูล</h2>
    <p>ใน Google Sheets เลือก <b>ไฟล์ → ดาวน์โหลด → Microsoft Excel (.xlsx)</b> แล้วอัปโหลดที่นี่
    ที่พักจากชีตเผยแพร่ทันที รายการเดิมอัปเดตตามชีต (ยกเว้นที่ซ่อนหรือไม่อนุมัติไว้) และสำรองฐานข้อมูลก่อนนำเข้าทุกครั้ง</p>
    <form id="importForm" class="card" style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input type="file" name="file" accept=".xlsx" required>
      <button type="button" class="btn" data-mode="dry">ตรวจก่อน (ยังไม่บันทึก)</button>
      <button type="button" class="btn primary" data-mode="run">นำเข้าและเผยแพร่</button>
    </form>
    <div id="importResult" style="margin-top:16px"></div>`;
  const form = host.querySelector('#importForm');
  const out = host.querySelector('#importResult');
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    const file = form.elements.file.files[0];
    if (!file) return toast('กรุณาเลือกไฟล์ .xlsx');
    const dry = b.dataset.mode === 'dry';
    if (!dry && !confirm('นำเข้าและเผยแพร่ข้อมูลจากไฟล์นี้?')) return;
    form.querySelectorAll('button').forEach((x) => (x.disabled = true));
    out.innerHTML = '<p class="muted">กำลังอ่านไฟล์…</p>';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/import${dry ? '?dry_run=1' : ''}`, { method: 'POST', body: fd });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'นำเข้าไม่สำเร็จ');
      const list = (items, fn) => (items.length ? `<ul>${items.map((x) => `<li>${fn(x)}</li>`).join('')}</ul>` : '<p class="muted small">-</p>');
      out.innerHTML = `<div class="notice ${dry ? '' : 'ok'}">${dry ? 'ผลการตรวจ (ยังไม่ได้บันทึก)' : `นำเข้าเรียบร้อย — สำรองฐานข้อมูลไว้ที่ ${esc(r.backup || '-')}`}</div>
        <p>ใหม่ <b>${r.created}</b> · อัปเดต <b>${r.updated}</b> · ข้ามเพราะซ่อน/ไม่อนุมัติ ${r.skipped_hidden} · ไม่อยู่ในขอบเขต ${r.out_of_scope}
        ${r.errors.length ? ` · <span class="bad">ผิดพลาด ${r.errors.length}</span>` : ''}</p>
        <h3>ข้อมูลครบ (${r.complete.length})</h3>${list(r.complete, (x) => `${esc(x.key)} ${esc(x.name)}`)}
        <h3>มีข้อมูลบางส่วน (${r.partial.length})</h3>${list(r.partial, (x) => `${esc(x.key)} ${esc(x.name)} <span class="muted small">ยังขาด: ${esc(x.missing.join(', '))}</span>`)}
        <p class="muted">อีก ${r.bare} รายการมีแค่ชื่อและที่อยู่</p>
        <h3>ข้อสังเกต (${r.warnings.length})</h3>${list(r.warnings, esc)}
        ${r.errors.length ? `<h3>ผิดพลาด</h3>${list(r.errors, (x) => `${esc(x.key)}: ${esc(x.error)}`)}` : ''}`;
    } catch (err) {
      out.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
    } finally {
      form.querySelectorAll('button').forEach((x) => (x.disabled = false));
    }
  });
}

// ================================================================ เริ่มต้น
(async () => {
  const me = await api('/api/auth/me');
  if (!me || me.role !== 'admin') {
    return renderAuthBox(page, {
      title: 'เข้าสู่ระบบผู้ดูแล',
      intro: me ? 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแล' : '',
      onDone: () => location.reload(),
    });
  }
  await shell(me);
})().catch((err) => toast(err.message));
