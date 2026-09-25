/* ฟังก์ชันที่ใช้ร่วมกันทุกหน้า */
const NU_CENTER = [16.7520, 100.1850];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** ข้อความที่ผู้ดูแลพิมพ์ได้ โดยรองรับ **ตัวหนา** อย่างเดียว (escape ก่อนเสมอ) */
function richText(v) {
  return esc(v).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
    err.status = res.status;
    err.errors = data?.errors;
    throw err;
  }
  return data;
}

let metaPromise;
function getMeta() {
  metaPromise ||= api('/api/meta');
  return metaPromise;
}

const baht = (n) => (n == null ? '-' : Number(n).toLocaleString('th-TH'));
function priceRange(min, max) {
  if (min == null) return 'ยังไม่ระบุราคา';
  return min === max ? `${baht(min)} บาท/เดือน` : `${baht(min)}–${baht(max)} บาท/เดือน`;
}
function distanceText(m) {
  return m < 1000 ? `${m} ม.` : `${(m / 1000).toFixed(1)} กม.`;
}
function thaiDate(iso) {
  if (!iso) return 'ยังไม่ได้ตรวจสอบ';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function daysSince(iso) {
  if (!iso) return Infinity;
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Math.floor((Date.now() - d) / 86400000);
}
/** ป้ายบอกความใหม่ของข้อมูล */
function freshnessChip(iso) {
  const days = daysSince(iso);
  if (days === Infinity) return '<span class="chip bad">ยังไม่ได้ตรวจสอบ</span>';
  if (days <= 90) return `<span class="chip ok">ตรวจสอบ ${thaiDate(iso)}</span>`;
  if (days <= 180) return `<span class="chip warn">ตรวจสอบ ${thaiDate(iso)}</span>`;
  return `<span class="chip bad">ข้อมูลอาจไม่เป็นปัจจุบัน (${thaiDate(iso)})</span>`;
}

const STATUS_LABEL = {
  draft: ['ร่าง', ''],
  pending: ['รอตรวจสอบ', 'warn'],
  published: ['เผยแพร่แล้ว', 'ok'],
  rejected: ['ไม่อนุมัติ', 'bad'],
  hidden: ['ซ่อนอยู่', ''],
};
function statusChip(s) {
  const [label, cls] = STATUS_LABEL[s] || [s, ''];
  return `<span class="chip ${cls}">${label}</span>`;
}

function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------------------------------------------------------------- ส่วนหัวของเว็บ
function renderHeader(active) {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="inner">
    <a class="brand" href="/" aria-label="NU Dorm Finder หน้าแรก"><img class="brand-mark" src="/img/logo-mark.svg?v=2" alt="" width="76" height="41"><span>DORM FINDER</span></a>
    <button class="menu-btn" aria-label="เมนู" aria-expanded="false">☰</button>
    <nav class="site-nav">
      <a href="/" class="${active === 'home' ? 'active' : ''}">หน้าแรก</a>
      <span class="sep" aria-hidden="true"></span>
      <a href="/search" class="${active === 'search' ? 'active' : ''}">ค้นหาที่พัก</a>
      <a href="/#explore" class="pill">สำรวจโซนประตู</a>
      <a href="/provider?new=1" class="pill dark">ลงประกาศที่พัก</a>
      <a href="/provider" class="login ${active === 'provider' ? 'active' : ''}" id="navLogin">เข้าสู่ระบบ <span class="avatar">👤</span></a>
    </nav>
  </div>`;
  document.body.prepend(header);
  const menuBtn = header.querySelector('.menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = header.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open);
  });
  fetch('/api/auth/me').then((r) => r.json()).then((me) => {
    if (!me) return;
    const link = header.querySelector('#navLogin');
    link.href = me.role === 'admin' ? '/admin' : '/provider';
    link.firstChild.textContent = me.role === 'admin' ? 'ผู้ดูแลระบบ ' : 'ประกาศของฉัน ';
  }).catch(() => {});

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="inner">
    <div><b>NU Dorm Finder</b><br>ระบบค้นหาที่พักรอบมหาวิทยาลัยนเรศวร<br>
      <span class="small">ระยะทางที่แสดงเป็นระยะทางเส้นตรง ไม่ใช่ระยะเดินหรือขับรถ · แผนที่ © ผู้ร่วมสร้าง OpenStreetMap</span></div>
    <div><a href="/search">ค้นหาที่พัก</a><a href="/#explore">แผนที่หมุดประตู</a><a href="/provider">สำหรับผู้ประกอบการ</a><a href="/admin">ผู้ดูแลระบบ</a></div>
  </div>`;
  document.body.appendChild(footer);
}

// ---------------------------------------------------------------- แผนที่
function createMap(el, opts = {}) {
  const map = L.map(el, { scrollWheelZoom: opts.scrollWheelZoom ?? true }).setView(opts.center || NU_CENTER, opts.zoom || 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

/** fitBounds ที่รอให้แผนที่มีขนาดจริงก่อน (กันซูมเป็นระดับโลกเมื่อคอนเทนเนอร์ยังไม่ถูกจัดวาง) */
function fitTo(map, bounds, opts = {}) {
  const el = map.getContainer();
  const apply = () => {
    map.invalidateSize();
    map.fitBounds(bounds, opts);
  };
  if (el.clientWidth && el.clientHeight) return apply();
  const ro = new ResizeObserver(() => {
    if (!el.clientWidth || !el.clientHeight) return;
    ro.disconnect();
    apply();
  });
  ro.observe(el);
}

function gateIcon(gate, active = false) {
  const label = gate.short_name.replace(/[^\d]/g, '') || gate.short_name.slice(0, 2);
  // หมุดหยดน้ำพร้อมไอคอนประตู ตามต้นแบบหน้าจอ
  return L.divIcon({
    className: '',
    html: `<div class="gate-pin ${active ? 'active' : ''}" title="${esc(gate.name)}">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 21V9l9-6 9 6v12h-2v-9H5v9H3Zm4 0v-7h2v7H7Zm4 0v-7h2v7h-2Zm4 0v-7h2v7h-2Z"/></svg>
      <b>${esc(label)}</b></div>`,
    iconSize: [36, 46],
    iconAnchor: [18, 46],
    tooltipAnchor: [0, -40],
  });
}

function propIcon(p, highlight = false) {
  const price = p.price_min != null ? `฿${(p.price_min / 1000).toFixed(1).replace('.0', '')}k` : '?';
  return L.divIcon({
    className: '',
    html: `<div class="prop-pin ${highlight ? 'hl' : ''}" style="padding:2px 6px;height:24px">${price}</div>`,
    iconSize: null,
    iconAnchor: [20, 12],
  });
}

function addGateMarkers(map, gates, onClick) {
  const markers = new Map();
  for (const g of gates) {
    const m = L.marker([g.lat, g.lng], { icon: gateIcon(g), zIndexOffset: 500, title: g.name }).addTo(map);
    m.bindTooltip(g.name, { direction: 'top' });
    if (onClick) m.on('click', () => onClick(g));
    markers.set(g.id, m);
  }
  return markers;
}

function coverHtml(p) {
  return p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : esc(p.type_name);
}

function propertyCard(p, { compact = false } = {}) {
  const near = p.nearest_gate
    ? `ห่าง${esc(p.nearest_gate.gate_name)} ${distanceText(p.nearest_gate.straight_line_m)} (เส้นตรง)`
    : '';
  if (!compact) {
    // การ์ดแนะนำแบบกะทัดรัดตามต้นแบบ: รูป ชื่อ ประเภท โซน ราคาเริ่มต้น ป้าย และปุ่ม
    const tag = p.amenities?.[0];
    return `<a class="card pcard" href="/property?id=${p.id}" data-id="${p.id}">
      <div class="cover">${coverHtml(p)}</div>
      <div class="body">
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(p.type_name)}<br>โซน: ${esc((p.gates || []).map((g) => g.name).join(', ') || '-')}</div>
        <div class="price">${p.price_min != null ? `฿${baht(p.price_min)}+ <span>/เดือน</span>` : 'ยังไม่ระบุราคา'}</div>
        ${tag ? `<div class="tag">✓ ${esc(tag.name)}</div>` : ''}
        <div class="cta"><span>ดูรายละเอียด</span></div>
      </div>
    </a>`;
  }
  const amen = (p.amenities || []).slice(0, 4).map((a) => `<span class="chip">${esc(a.name)}</span>`).join('');
  return `<a class="card rcard" href="/property?id=${p.id}" data-id="${p.id}">
    <div class="cover">${coverHtml(p)}</div>
    <div class="body">
      <div class="chips"><span class="chip accent">${esc(p.type_name)}</span>${(p.gates || []).map((g) => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>
      <div class="name">${esc(p.name)}</div>
      <div class="price">${priceRange(p.price_min, p.price_max)}</div>
      <div class="meta">${esc(p.soi_name || 'ไม่ระบุซอย')}${p.zone_name ? ' · ' + esc(p.zone_name) : ''}<br>${near}</div>
      <div class="chips">${amen}</div>
      <div>${freshnessChip(p.verified_at)}</div>
    </div>
  </a>`;
}

// ---------------------------------------------------------------- บันทึกการใช้งาน (ไม่ระบุตัวตน)
function sessionId() {
  try {
    let id = sessionStorage.getItem('nudorm_sid');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      sessionStorage.setItem('nudorm_sid', id);
    }
    return id;
  } catch {
    return 'anonymous-session';
  }
}

function track(event, data) {
  const body = JSON.stringify({ session_id: sessionId(), event, data });
  if (navigator.sendBeacon) navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
  else fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}

function openModal(title, html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <header><h2 style="margin:0">${esc(title)}</h2><button class="btn small" data-close>ปิด</button></header>
    <div class="content">${html}</div></div>`;
  const close = () => back.remove();
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) close();
  });
  document.body.appendChild(back);
  return { el: back.querySelector('.content'), close };
}
