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
// ผู้ใช้ปัจจุบัน (null = ผู้ใช้ทั่วไป) ขอครั้งเดียวต่อหน้า
let mePromise;
function getMe() {
  mePromise ||= api('/api/auth/me').catch(() => null);
  return mePromise;
}

const ROLE_LABEL = { member: 'สมาชิก', provider: 'ผู้ประกอบการ', admin: 'ผู้ดูแลระบบ' };

function renderHeader(active) {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="inner">
    <a class="brand" href="/" aria-label="NU Dorm Finder หน้าแรก"><img class="brand-mark" src="/img/logo-mark.svg?v=2" alt="" width="76" height="41"><span>DORM FINDER</span></a>
    <button class="menu-btn" aria-label="เมนู" aria-expanded="false">☰</button>
    <nav class="site-nav" aria-label="เมนูหลัก">
      <a href="/" class="${active === 'home' ? 'active' : ''}">หน้าแรก</a>
      <span class="sep" aria-hidden="true"></span>
      <a href="/search" class="${active === 'search' ? 'active' : ''}">ค้นหาที่พัก</a>
      <a href="/compare" class="${active === 'compare' ? 'active' : ''}">เปรียบเทียบ <span class="nav-count" data-compare-count>0/3</span></a>
      <span data-role-links></span>
    </nav>
  </div>`;
  document.body.prepend(header);
  const menuBtn = header.querySelector('.menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = header.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open);
  });

  // เมนูตามสิทธิ์ของผู้ใช้แต่ละบทบาท
  getMe().then((me) => {
    const slot = header.querySelector('[data-role-links]');
    const link = (href, label, key, cls = '') => `<a href="${href}" class="${cls} ${active === key ? 'active' : ''}">${label}</a>`;
    let html = link('/#explore', 'สำรวจโซนประตู', '', 'pill');
    if (!me) {
      html += link('/login?type=provider&mode=register', 'ลงประกาศที่พัก', '', 'pill dark');
      html += `<a href="/login?next=${encodeURIComponent(location.pathname + location.search)}" class="login ${active === 'login' ? 'active' : ''}">เข้าสู่ระบบ <span class="avatar">👤</span></a>`;
    } else {
      if (me.role === 'member') html += link('/saved', '♥ ที่พักที่บันทึกไว้', 'saved');
      if (me.role === 'provider') html += link('/provider', 'จัดการประกาศของฉัน', 'provider', 'pill dark');
      if (me.role === 'admin') html += link('/admin', 'ผู้ดูแลระบบ', 'admin', 'pill dark');
      html += `<span class="nav-user" title="${esc(me.email)}"><span class="avatar">👤</span>${esc(me.name)} <span class="chip">${ROLE_LABEL[me.role]}</span></span>
        <a href="#" data-logout>ออกจากระบบ</a>`;
    }
    slot.outerHTML = html;
    header.querySelector('[data-logout]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    });
  });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="inner">
    <div><b>NU Dorm Finder</b><br>ระบบค้นหาที่พักรอบมหาวิทยาลัยนเรศวร<br>
      <span class="small">ระยะทางที่แสดงเป็นระยะทางเส้นตรง ไม่ใช่ระยะเดินหรือขับรถ · แผนที่ © ผู้ร่วมสร้าง OpenStreetMap</span></div>
    <div><a href="/search">ค้นหาที่พัก</a><a href="/compare">เปรียบเทียบ</a><a href="/#explore">แผนที่หมุดประตู</a><a href="/provider">สำหรับผู้ประกอบการ</a><a href="/admin">ผู้ดูแลระบบ</a></div>
  </div>`;
  document.body.appendChild(footer);
  Compare.load();
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

function propertyCard(p, { compact = false, actions = true } = {}) {
  const near = p.nearest_gate
    ? `ห่าง${esc(p.nearest_gate.gate_name)} ${distanceText(p.nearest_gate.straight_line_m)} (เส้นตรง)`
    : '';
  const acts = actions ? actionButtons(p.id, { small: true }) : '';
  if (!compact) {
    // การ์ดแนะนำแบบกะทัดรัด: รูป ชื่อ ประเภท โซน ราคาเริ่มต้น ป้าย และปุ่ม
    const tag = p.amenities?.[0];
    return `<div class="card pcard-wrap" data-card="${p.id}">
      <a class="pcard" href="/property?id=${p.id}" data-id="${p.id}">
        <div class="cover">${coverHtml(p)}</div>
        <div class="body">
          <div class="name">${esc(p.name)}</div>
          <div class="meta">${esc(p.type_name)}<br>โซน: ${esc((p.gates || []).map((g) => g.name).join(', ') || '-')}</div>
          <div class="price">${p.price_min != null ? `฿${baht(p.price_min)}+ <span>/เดือน</span>` : 'ยังไม่ระบุราคา'}</div>
          ${tag ? `<div class="tag">✓ ${esc(tag.name)}</div>` : ''}
          <div class="cta"><span>ดูรายละเอียด</span></div>
        </div>
      </a>${acts}
    </div>`;
  }
  const amen = (p.amenities || []).filter((a) => (a.scope || 'building') !== 'rule').slice(0, 4).map((a) => `<span class="chip">${esc(a.name)}</span>`).join('');
  return `<div class="card rcard-wrap" data-card="${p.id}">
    <a class="rcard" href="/property?id=${p.id}" data-id="${p.id}">
      <div class="cover">${coverHtml(p)}</div>
      <div class="body">
        <div class="chips"><span class="chip accent">${esc(p.type_name)}</span>${(p.gates || []).map((g) => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>
        <div class="name">${esc(p.name)}</div>
        <div class="price">${priceRange(p.price_min, p.price_max)}</div>
        <div class="meta">${esc(p.soi_name || 'ไม่ระบุซอย')}${p.zone_name ? ' · ' + esc(p.zone_name) : ''}<br>${near}</div>
        <div class="chips">${amen}</div>
        <div>${freshnessChip(p.verified_at)}</div>
      </div>
    </a>${acts}
  </div>`;
}

// ================================================================ บันทึกที่พัก (สมาชิก) และเปรียบเทียบ (ทุกคน)
const MAX_COMPARE = 3;

/** ปุ่ม "บันทึกที่พัก" และ "เพิ่มไปเปรียบเทียบ" — ผู้ประกอบการ/ผู้ดูแลไม่เห็นปุ่มบันทึก */
function actionButtons(id, { small = false } = {}) {
  return `<div class="card-actions${small ? ' small' : ''}" data-actions="${id}">
    <button type="button" class="act-btn" data-save="${id}" aria-pressed="false"><span aria-hidden="true">♡</span> <span>บันทึกที่พัก</span></button>
    <button type="button" class="act-btn" data-compare="${id}" aria-pressed="false"><span aria-hidden="true">⇄</span> <span>เพิ่มไปเปรียบเทียบ</span></button>
  </div>`;
}

const Favorites = {
  ids: new Set(),
  ready: null,
  load() {
    this.ready ||= getMe().then(async (me) => {
      if (me?.role === 'member') this.ids = new Set(await api('/api/me/favorite-ids'));
      return me;
    });
    return this.ready;
  },
  async toggle(id) {
    const me = await this.load();
    if (!me) return askToSignIn();
    if (me.role !== 'member') return toast('การบันทึกที่พักใช้ได้กับบัญชีสมาชิก');
    const saved = this.ids.has(id);
    await api(`/api/me/favorites/${id}`, { method: saved ? 'DELETE' : 'PUT' });
    saved ? this.ids.delete(id) : this.ids.add(id);
    toast(saved ? 'นำออกจากที่พักที่บันทึกไว้แล้ว' : 'บันทึกที่พักแล้ว ดูได้ที่เมนู "ที่พักที่บันทึกไว้"');
    refreshActions();
    document.dispatchEvent(new CustomEvent('favorites-changed', { detail: { id, saved: !saved } }));
  },
};

function askToSignIn() {
  const next = encodeURIComponent(location.pathname + location.search);
  openModal('บันทึกที่พัก', `
    <p style="margin-top:0">การบันทึกที่พักเป็นรายการโปรดใช้ได้สำหรับ <b>สมาชิก</b> เพื่อให้รายการยังอยู่แม้ออกจากเว็บไซต์แล้วกลับมาใหม่</p>
    <p class="muted small">ระหว่างนี้คุณยังค้นหาและเปรียบเทียบที่พักได้โดยไม่ต้องเข้าสู่ระบบ</p>
    <div class="chips" style="margin-top:14px">
      <a class="btn primary" href="/login?mode=register&type=member&next=${next}">สมัครสมาชิก</a>
      <a class="btn" href="/login?next=${next}">เข้าสู่ระบบ</a>
    </div>`);
}

/** ชุดเปรียบเทียบ: ผู้ใช้ทั่วไปเก็บใน sessionStorage (หายเมื่อปิดเว็บไซต์) สมาชิกเก็บในบัญชี */
const Compare = {
  ids: [],
  names: {},
  member: false,
  ready: null,
  key: 'nudorm_compare',
  load() {
    this.ready ||= getMe().then(async (me) => {
      this.member = me?.role === 'member';
      let local = [];
      try { local = JSON.parse(sessionStorage.getItem(this.key) || '[]'); } catch { local = []; }
      if (this.member) {
        this.ids = await api('/api/me/compare');
        // รายการที่เลือกไว้ก่อนเข้าสู่ระบบ นำเข้าบัญชีเท่าที่ยังมีที่ว่าง
        const extra = local.filter((id) => !this.ids.includes(id));
        if (extra.length && this.ids.length < MAX_COMPARE) {
          this.ids = await api('/api/me/compare', { method: 'PUT', body: { ids: [...this.ids, ...extra].slice(0, MAX_COMPARE) } });
        }
        try { sessionStorage.removeItem(this.key); } catch {}
      } else {
        this.ids = local.slice(0, MAX_COMPARE);
      }
      this.changed();
    });
    return this.ready;
  },
  has(id) { return this.ids.includes(id); },
  full() { return this.ids.length >= MAX_COMPARE; },
  async save() {
    if (this.member) this.ids = await api('/api/me/compare', { method: 'PUT', body: { ids: this.ids } });
    else try { sessionStorage.setItem(this.key, JSON.stringify(this.ids)); } catch {}
    this.changed();
  },
  async add(id) {
    await this.load();
    if (this.has(id)) return;
    if (this.full()) {
      toast(`เปรียบเทียบได้สูงสุด ${MAX_COMPARE} แห่งต่อครั้ง ลบรายการเดิมก่อนเพื่อเลือกแห่งใหม่`, 3500);
      return;
    }
    this.ids.push(id);
    await this.save();
  },
  async remove(id) {
    await this.load();
    this.ids = this.ids.filter((x) => x !== id);
    await this.save();
  },
  async clear() {
    this.ids = [];
    await this.save();
  },
  async toggle(id) { return this.has(id) ? this.remove(id) : this.add(id); },
  changed() {
    document.querySelectorAll('[data-compare-count]').forEach((el) => (el.textContent = `${this.ids.length}/${MAX_COMPARE}`));
    refreshActions();
    renderCompareBar();
    document.dispatchEvent(new CustomEvent('compare-changed'));
  },
};

/** อัปเดตสถานะปุ่มทุกปุ่มในหน้าให้ตรงกับรายการโปรด/ชุดเปรียบเทียบ */
function refreshActions() {
  getMe().then((me) => {
    const canSave = !me || me.role === 'member';
    document.querySelectorAll('[data-save]').forEach((b) => {
      b.hidden = !canSave;
      const saved = Favorites.ids.has(Number(b.dataset.save));
      b.classList.toggle('on', saved);
      b.setAttribute('aria-pressed', saved);
      b.firstElementChild.textContent = saved ? '♥' : '♡';
      b.lastElementChild.textContent = saved ? 'บันทึกแล้ว' : 'บันทึกที่พัก';
    });
    document.querySelectorAll('[data-compare]').forEach((b) => {
      const id = Number(b.dataset.compare);
      const on = Compare.has(id);
      const blocked = !on && Compare.full();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.disabled = blocked;
      b.title = blocked ? `เปรียบเทียบได้สูงสุด ${MAX_COMPARE} แห่งต่อครั้ง` : '';
      b.firstElementChild.textContent = on ? '✓' : '⇄';
      b.lastElementChild.textContent = on ? 'อยู่ในการเปรียบเทียบ' : blocked ? `ครบ ${MAX_COMPARE} แห่งแล้ว` : 'เพิ่มไปเปรียบเทียบ';
    });
  });
}

// ปุ่มที่สร้างภายหลังในหน้า ใช้ตัวจับเหตุการณ์เดียว
document.addEventListener('click', (e) => {
  const save = e.target.closest('[data-save]');
  const cmp = e.target.closest('[data-compare]');
  if (save) {
    e.preventDefault();
    Favorites.toggle(Number(save.dataset.save)).catch((err) => toast(err.message));
  } else if (cmp) {
    e.preventDefault();
    Compare.toggle(Number(cmp.dataset.compare)).catch((err) => toast(err.message));
  }
});

/** แถบรายการที่เลือกเปรียบเทียบ (ด้านล่างจอ) — แสดงในหน้าที่เรียก enableCompareBar() */
let compareBarEnabled = false;
function enableCompareBar() {
  compareBarEnabled = true;
  Favorites.load().then(refreshActions);
  renderCompareBar();
}

async function renderCompareBar() {
  if (!compareBarEnabled) return;
  let bar = document.querySelector('.compare-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'compare-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'รายการที่เลือกเปรียบเทียบ');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-compare]');
      if (rm) Compare.remove(Number(rm.dataset.removeCompare));
      if (e.target.closest('[data-clear-compare]')) Compare.clear();
    });
  }
  const ids = [...Compare.ids];
  const missing = ids.filter((id) => !Compare.names[id]);
  if (missing.length) {
    try {
      (await api(`/api/compare?ids=${missing.join(',')}`)).forEach((p) => (Compare.names[p.id] = p.name));
    } catch {}
  }
  if (ids.join() !== Compare.ids.join()) return; // มีการเปลี่ยนระหว่างรอ รอบถัดไปจะวาดใหม่
  document.body.classList.toggle('has-compare-bar', ids.length > 0);
  bar.hidden = ids.length === 0;
  bar.innerHTML = `
    <div class="cb-count"><b>เปรียบเทียบ ${ids.length}/${MAX_COMPARE}</b>
      ${ids.length >= MAX_COMPARE ? `<span class="small">เปรียบเทียบได้สูงสุด ${MAX_COMPARE} แห่งต่อครั้ง</span>` : '<span class="small">เลือกได้อีก ' + (MAX_COMPARE - ids.length) + ' แห่ง</span>'}</div>
    <ul class="cb-items">${ids.map((id) => `<li><a href="/property?id=${id}">${esc(Compare.names[id] || 'ที่พัก #' + id)}</a>
      <button type="button" data-remove-compare="${id}" aria-label="ลบ ${esc(Compare.names[id] || '')} ออกจากการเปรียบเทียบ">×</button></li>`).join('')}
      ${Array.from({ length: MAX_COMPARE - ids.length }, () => '<li class="empty-slot">ว่าง</li>').join('')}</ul>
    <div class="cb-actions">
      <a class="btn primary ${ids.length < 2 ? 'disabled' : ''}" href="/compare" ${ids.length < 2 ? 'aria-disabled="true" tabindex="-1"' : ''}>ดูการเปรียบเทียบ</a>
      <button type="button" class="btn small" data-clear-compare>ล้าง</button>
    </div>`;
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
