/* หน้ารายละเอียดที่พัก
 * ทุกส่วนแสดงตามข้อมูลจริงของที่พัก ถ้าไม่มีข้อมูลให้แสดง "รอตรวจสอบ" หรือซ่อน ไม่ใส่ข้อมูลตัวอย่างแทน */
renderHeader('search');
const propertyId = Number(new URLSearchParams(location.search).get('id'));
const PENDING = (text = 'รอตรวจสอบ') => `<p class="pd-pending">${esc(text)}</p>`;
const isUrl = (s) => /^https?:\/\/\S+$/.test(String(s || ''));

// ---------------------------------------------------------------- สไลด์รูป (ใช้ทั้งแกลเลอรีอาคารและรูปในห้อง)
const carousels = new Map();

function carouselHtml(key, images, { emptyText, size = 'lg' }) {
  if (!images.length) return `<div class="carousel carousel-${size} is-empty"><span>${esc(emptyText)}</span></div>`;
  carousels.set(key, { images, index: 0 });
  const multi = images.length > 1;
  return `<div class="carousel carousel-${size}" data-carousel="${key}" tabindex="0" aria-roledescription="สไลด์รูปภาพ">
    <img class="carousel-img" src="${esc(images[0].url)}" alt="${esc(images[0].caption || images[0].category || '')}">
    <div class="carousel-caption" ${images[0].caption || images[0].category ? '' : 'hidden'}>${esc([images[0].category, images[0].caption].filter(Boolean).join(' · '))}</div>
    ${multi ? `<button type="button" class="carousel-nav prev" data-step="-1" aria-label="รูปก่อนหน้า">‹</button>
    <button type="button" class="carousel-nav next" data-step="1" aria-label="รูปถัดไป">›</button>
    <span class="carousel-count">1 / ${images.length}</span>` : ''}
  </div>`;
}

function showSlide(key, index) {
  const c = carousels.get(key);
  const el = document.querySelector(`[data-carousel="${key}"]`);
  if (!c || !el) return;
  c.index = (index + c.images.length) % c.images.length;
  const im = c.images[c.index];
  el.querySelector('.carousel-img').src = im.url;
  el.querySelector('.carousel-img').alt = im.caption || im.category || '';
  const cap = el.querySelector('.carousel-caption');
  const text = [im.category, im.caption].filter(Boolean).join(' · ');
  cap.textContent = text;
  cap.hidden = !text;
  const count = el.querySelector('.carousel-count');
  if (count) count.textContent = `${c.index + 1} / ${c.images.length}`;
  document.querySelectorAll(`[data-thumbs="${key}"] button`).forEach((b, i) => b.classList.toggle('active', i === c.index));
}

function bindCarousels(root) {
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('.carousel-nav');
    if (nav) {
      const key = nav.closest('[data-carousel]').dataset.carousel;
      showSlide(key, carousels.get(key).index + Number(nav.dataset.step));
      return;
    }
    const thumb = e.target.closest('[data-thumbs] button');
    if (thumb) showSlide(thumb.parentElement.dataset.thumbs, Number(thumb.dataset.i));
  });
  root.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('[data-carousel]');
    if (!el || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const key = el.dataset.carousel;
    showSlide(key, carousels.get(key).index + (e.key === 'ArrowRight' ? 1 : -1));
  });
}

function openAllImages(title, images) {
  const groups = new Map();
  for (const im of images) {
    const k = im.category || 'รูปภาพ';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(im);
  }
  const m = openModal(title, [...groups].map(([k, list]) => `
    <h3 style="margin:4px 0 10px">${esc(k)} <span class="muted small">(${list.length})</span></h3>
    <div class="all-images">${list.map((im) => `<figure><button type="button" class="all-img-btn" data-idx="${images.indexOf(im)}"><img src="${esc(im.url)}" alt="${esc(im.caption || k)}" loading="lazy"></button>${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`).join(''));
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('.all-img-btn');
    if (b) openViewer(images, Number(b.dataset.idx));
  });
}

// ---------------------------------------------------------------- ส่วนต่าง ๆ ของหน้า
const MOSAIC_MAX = 5;

function galleryHtml(p) {
  const imgs = p.images;
  if (!imgs.length) {
    return `<section class="pd-gallery" aria-label="ภาพอาคาร">
      <div class="carousel carousel-lg is-empty"><span>ยังไม่มีรูปภาพอาคาร (รอตรวจสอบ)</span></div></section>`;
  }
  const shown = imgs.slice(0, MOSAIC_MAX);
  const rest = imgs.length - shown.length;
  return `<section class="pd-gallery" aria-label="ภาพอาคาร">
    <div class="mosaic n${Math.min(imgs.length, MOSAIC_MAX)}">
      ${shown.map((im, i) => `<button type="button" class="mosaic-item" data-view="${i}" aria-label="เปิดดูรูปที่ ${i + 1}${im.category ? ` (${esc(im.category)})` : ''}">
        <img src="${esc(im.url)}" alt="${esc(im.caption || im.category || '')}" loading="${i ? 'lazy' : 'eager'}">
        ${im.category ? `<span class="mosaic-tag">${esc(im.category)}</span>` : ''}
        ${i === shown.length - 1 && rest > 0 ? `<span class="mosaic-more">+${rest} รูป</span>` : ''}
      </button>`).join('')}
      <button type="button" class="btn small mosaic-all" id="allImagesBtn">ดูรูปทั้งหมด (${imgs.length})</button>
    </div>
    <div class="gallery-mobile">
      ${carouselHtml('building', imgs, { emptyText: '' })}
      ${imgs.length > 1 ? `<div class="thumbs" data-thumbs="building">${imgs.map((im, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'active' : ''}" aria-label="ดูรูปที่ ${i + 1}"><img src="${esc(im.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
  </section>`;
}

/** ตัวดูรูปเต็มจอ: ปุ่มก่อน/ถัดไป ปุ่มลูกศรบนแป้นพิมพ์ และ Esc เพื่อปิด */
function openViewer(images, start = 0) {
  let i = start;
  const back = document.createElement('div');
  back.className = 'viewer';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-label', 'ดูรูปภาพ');
  back.innerHTML = `
    <button type="button" class="viewer-close" aria-label="ปิด">✕</button>
    <button type="button" class="viewer-nav prev" aria-label="รูปก่อนหน้า">‹</button>
    <figure><img alt=""><figcaption></figcaption></figure>
    <button type="button" class="viewer-nav next" aria-label="รูปถัดไป">›</button>`;
  const img = back.querySelector('img');
  const cap = back.querySelector('figcaption');
  const multi = images.length > 1;
  back.querySelectorAll('.viewer-nav').forEach((b) => (b.hidden = !multi));
  function show(n) {
    i = (n + images.length) % images.length;
    const im = images[i];
    img.src = im.url;
    img.alt = im.caption || im.category || '';
    cap.textContent = [`${i + 1} / ${images.length}`, im.category, im.caption].filter(Boolean).join(' · ');
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    back.remove();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (multi && e.key === 'ArrowRight') show(i + 1);
    if (multi && e.key === 'ArrowLeft') show(i - 1);
  }
  back.addEventListener('click', (e) => {
    if (e.target.closest('.viewer-close') || e.target === back) close();
    else if (e.target.closest('.viewer-nav.prev')) show(i - 1);
    else if (e.target.closest('.viewer-nav.next')) show(i + 1);
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  show(start);
  back.querySelector('.viewer-close').focus();
}

function roomDetails(r) {
  return `
    <div class="room-price">${baht(r.price)} <span>บาท/เดือน</span></div>
    <div class="chips" style="margin:6px 0 12px">
      ${r.size_sqm ? `<span class="chip">${r.size_sqm} ตร.ม.</span>` : ''}
      ${r.available ? '<span class="chip ok">มีห้องว่าง</span>' : '<span class="chip">ห้องเต็ม</span>'}
    </div>
    <h4 class="pd-subhead">สิ่งของและอุปกรณ์ภายในห้อง</h4>
    ${r.features_list.length ? `<ul class="feature-list">${r.features_list.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : PENDING('รอตรวจสอบรายละเอียดภายในห้อง')}
    ${r.note ? `<p class="small muted" style="margin:10px 0 0">หมายเหตุ: ${esc(r.note)}</p>` : ''}`;
}

function roomsHtml(p) {
  const rooms = p.rooms;
  // ห้องแบบเดียวราคาเดียว: แสดงรูปและรายละเอียดทันที ไม่ต้องทำรายการประเภทห้อง
  if (rooms.length === 1) {
    const r = rooms[0];
    return `<section class="pd-section" id="rooms">
      <h2>ห้องพักและราคา</h2>
      <article class="room-card single">
        ${carouselHtml(`room-${r.id}`, r.images, { emptyText: 'ยังไม่มีรูปภายในห้อง (รอตรวจสอบ)', size: 'md' })}
        <div class="room-info"><h3>${esc(r.name)}</h3>${roomDetails(r)}</div>
      </article>
    </section>`;
  }
  return `<section class="pd-section" id="rooms">
    <h2>ห้องพักและราคา</h2>
    <p class="muted" style="margin-top:-4px">มี ${rooms.length} ประเภทห้อง แต่ละประเภทแสดงรูปและรายละเอียดของห้องนั้นเท่านั้น</p>
    <nav class="room-jump" aria-label="ประเภทห้อง">${rooms.map((r) => `<a href="#room-${r.id}" class="chip accent">${esc(r.name)} · ${baht(r.price)} บาท</a>`).join('')}</nav>
    ${rooms.map((r) => `
      <article class="room-card" id="room-${r.id}">
        ${carouselHtml(`room-${r.id}`, r.images, { emptyText: 'ยังไม่มีรูปภายในห้องนี้ (รอตรวจสอบ)', size: 'md' })}
        <div class="room-info"><h3>${esc(r.name)}</h3>${roomDetails(r)}</div>
      </article>`).join('')}
  </section>`;
}

function facilitiesHtml(p) {
  const list = p.amenities.filter((a) => (a.scope || 'building') === 'building');
  return `<section class="pd-section">
    <h2>สิ่งอำนวยความสะดวกของหอพัก</h2>
    ${list.length ? `<ul class="facility-grid">${list.map((a) => `<li>${esc(a.name)}</li>`).join('')}</ul>` : PENDING()}
  </section>`;
}

function costsHtml(p) {
  const rows = [
    ['เงินประกัน', p.deposit != null ? `${baht(p.deposit)} บาท` : ''],
    ['ค่าน้ำ', p.water_rate],
    ['ค่าไฟ', p.electric_rate],
    ['ค่าใช้จ่ายอื่น', p.other_fees],
  ].filter(([, v]) => v);
  return `<section class="pd-section">
    <h2>ค่าใช้จ่ายอื่น</h2>
    ${rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : PENDING()}
  </section>`;
}

function rulesHtml(p) {
  const groups = new Map();
  const add = (topic, text) => {
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(text);
  };
  for (const r of p.rules) add(r.topic, r.detail);
  // เงื่อนไขผู้พักที่ติ๊กไว้ ใช้เมื่อยังไม่มีข้อกำหนดหัวข้อนั้นโดยตรง
  const codes = new Set(p.amenities.map((a) => a.code));
  if (codes.has('women_only')) add('ผู้พัก', 'รับเฉพาะผู้หญิง');
  if (codes.has('men_only')) add('ผู้พัก', 'รับเฉพาะผู้ชาย');
  if (codes.has('pets') && !groups.has('สัตว์เลี้ยง')) add('สัตว์เลี้ยง', 'อนุญาตให้เลี้ยงสัตว์');
  if (p.lease_terms) add('สัญญาเช่า', p.lease_terms);
  return `<section class="pd-section">
    <h2>เงื่อนไขและข้อกำหนด</h2>
    ${groups.size ? `<div class="rule-groups">${[...groups].map(([topic, items]) => `
      <div class="rule-group"><h3>${esc(topic)}</h3><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>` : PENDING()}
  </section>`;
}

const NEARBY_ICON = {
  'ร้านอาหาร': '🍜', 'ร้านสะดวกซื้อ': '🏪', 'ร้านซักรีด': '🧺', 'ตลาด': '🛒', 'ร้านถ่ายเอกสาร': '🖨️',
  'ร้านค้า': '🛍️', 'สถานพยาบาล': '🏥', 'จุดรับส่ง/ป้ายรถ': '🚏',
};
const NEARBY_SHOWN = 5;

/** ส่วนราคาและช่องทางติดต่อ (บนสุดของแถบข้าง) */
function sideContactHtml(p) {
  const prices = p.rooms.map((r) => r.price);
  const min = Math.min(...prices);
  const multiPrice = new Set(prices).size > 1;
  const row = (label, value) => `<div class="contact-row"><span class="muted">${label}</span><span>${value}</span></div>`;
  const notFound = '<span class="muted">ยังไม่พบข้อมูล</span>';
  const tel = p.contact_phone ? `tel:${esc(p.contact_phone.replace(/[^\d+]/g, ''))}` : '';
  const phone = p.contact_phone ? `<a data-ch="phone" href="${tel}">${esc(p.contact_phone)}</a>` : notFound;
  const website = isUrl(p.contact_website) ? `<a data-ch="website" target="_blank" rel="noopener" href="${esc(p.contact_website)}">เปิดเว็บไซต์</a>` : notFound;
  const facebook = isUrl(p.contact_facebook) ? `<a data-ch="facebook" target="_blank" rel="noopener" href="${esc(p.contact_facebook)}">เปิดเพจ Facebook</a>` : notFound;
  return `<div class="side-part side-contact" id="contact">
    <div class="price-line"><span class="muted">${multiPrice ? 'ราคาเริ่มต้น' : 'ค่าเช่า'}</span>
      <span class="box-price">฿${baht(min)}</span><span class="muted">/ เดือน</span></div>
    ${multiPrice ? `<div class="small muted">มี ${p.rooms.length} ประเภทห้อง ราคาต่างกันตามประเภท</div>` : ''}
    <div class="side-actions">
      <a class="btn primary" href="#rooms">ดูห้องพัก</a>
      ${tel ? `<a class="btn" data-ch="phone" href="${tel}">โทรติดต่อ</a>` : '<a class="btn" href="#contacts">ติดต่อที่พัก</a>'}
    </div>
    <div class="contact-rows" id="contacts">
      ${row('โทรศัพท์', phone)}
      ${p.contact_line ? row('LINE', `<span data-ch="line">${esc(p.contact_line)}</span>`) : ''}
      ${row('Facebook', facebook)}
      ${row('เว็บไซต์', website)}
      ${p.contact_name ? row('ผู้ติดต่อ', esc(p.contact_name)) : ''}
    </div>
    <div class="side-verify small">
      <span class="muted">ตรวจสอบล่าสุด</span> ${freshnessChip(p.verified_at)}
      <div class="muted" style="margin-top:4px">แหล่งข้อมูล: ${esc(p.data_source || '-')}</div>
    </div>
    <button class="btn small danger" id="reportBtn" style="margin-top:10px;width:100%">แจ้งข้อมูลไม่ถูกต้อง</button>
  </div>`;
}

/** ส่วนแผนที่ → ระยะห่างจากประตู → สถานที่ใกล้เคียง (ต่อจากราคาและช่องทางติดต่อ) */
function sideLocationHtml(p) {
  // ประตูที่ใกล้ที่สุดในทุกประตู (ไม่จำกัดเฉพาะประตูที่เกี่ยวข้อง)
  const gates = [...p.distances].sort((a, b) => a.straight_line_m - b.straight_line_m);
  const nearbyItem = (n, i) => `
    <li data-nearby="${i}" class="${i >= NEARBY_SHOWN ? 'more hidden' : ''}">
      <span class="nb-icon" aria-hidden="true">${NEARBY_ICON[n.category] || '📍'}</span>
      <span class="nb-name">${esc(n.name)}<span class="small muted">${esc(n.category)}${n.source ? ` · ตรวจสอบจาก ${esc(n.source)}` : ''}</span></span>
      <span class="nb-dist">${n.display_distance_m != null ? `${distanceText(n.display_distance_m)}<span class="small muted">${esc(n.display_distance_type || '')}</span>` : '<span class="small muted">รอตรวจสอบ</span>'}</span>
    </li>`;
  return `<div class="side-part side-location" id="location">
    <div id="map" class="map side-map"></div>
    <div class="side-address">
      <span>${esc(p.address)}</span>
      <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}">Google Maps</a>
    </div>
    <a class="btn small" style="width:100%" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">เปิดเส้นทางใน Google Maps</a>

    <h3 class="side-title">ระยะห่างจากประตู ม.นเรศวร</h3>
    <ul class="gate-list">${gates.map((d, i) => `
      <li class="${i === 0 ? 'nearest' : ''}"><span>${esc(d.gate_name)}${i === 0 ? ' <span class="chip ok">ใกล้ที่สุด</span>' : ''}${d.related ? ' <span class="chip accent">ประตูที่เกี่ยวข้อง</span>' : ''}</span><b>${distanceText(d.straight_line_m)}</b></li>`).join('')}
    </ul>
    <p class="small muted" style="margin:6px 0 0">ระยะทางเส้นตรงจากพิกัด ระยะเดินหรือขับรถจริงจะมากกว่านี้</p>

    <h3 class="side-title">สถานที่ใกล้เคียง</h3>
    ${p.nearby.length ? `<ul class="nearby-list">${p.nearby.map(nearbyItem).join('')}</ul>
      ${p.nearby.length > NEARBY_SHOWN ? `<button type="button" class="link-btn" id="moreNearby">ดูสถานที่ใกล้เคียงทั้งหมด (${p.nearby.length})</button>` : ''}`
      : PENDING('รอตรวจสอบสถานที่ใกล้เคียง')}
  </div>`;
}

// ---------------------------------------------------------------- ประกอบหน้า
function render(p) {
  document.title = `${p.name} — NU Dorm Finder`;
  const prices = p.rooms.map((r) => r.price);
  const page = document.getElementById('page');
  page.innerHTML = `
    <p class="small"><a href="javascript:history.back()">← กลับไปผลการค้นหา</a></p>
    ${p.status !== 'published' ? `<div class="notice">ที่พักนี้ยังไม่เผยแพร่ (สถานะ: ${statusChip(p.status)}) — เห็นได้เฉพาะเจ้าของและผู้ดูแลระบบ</div>` : ''}
    <div class="chips" style="margin-bottom:10px">
      <span class="chip accent">${esc(p.type_name)}</span>
      ${p.gates.map((g) => `<a class="chip" href="/search?gate=${g.id}">${esc(g.name)}</a>`).join('')}
      ${p.zone_name ? `<a class="chip" href="/search?zone=${p.zone_id}">${esc(p.zone_name)}</a>` : ''}
    </div>
    <div class="pd">
      <header class="pd-head">
        <h1>${esc(p.name)}</h1>
        <p class="muted" style="margin:-4px 0 0">${esc(p.address)}${p.soi_name && !p.address.includes(p.soi_name) ? ` · ${esc(p.soi_name)}` : ''}</p>
        ${actionButtons(p.id)}
      </header>
      ${galleryHtml(p)}
      <aside class="pd-side">${sideContactHtml(p)}${sideLocationHtml(p)}</aside>
      <div class="pd-main">
        ${roomsHtml(p)}
        ${facilitiesHtml(p)}
        ${costsHtml(p)}
        ${rulesHtml(p)}
        ${p.description ? `<section class="pd-section"><h2>รายละเอียดเพิ่มเติม</h2><p style="white-space:pre-line;margin:0">${esc(p.description)}</p></section>` : ''}
      </div>
    </div>
    <div class="mobile-bar">
      <div><div class="small muted">${new Set(prices).size > 1 ? 'ราคาเริ่มต้น' : 'ค่าเช่า'}</div><b>${baht(Math.min(...prices))} บาท/เดือน</b></div>
      ${p.contact_phone ? `<a class="btn primary" data-ch="phone" href="tel:${esc(p.contact_phone.replace(/[^\d+]/g, ''))}">โทร</a>` : ''}
      <a class="btn" href="#contact">ช่องทางติดต่อ</a>
    </div>`;
  document.body.classList.add('has-mobile-bar');

  bindCarousels(page);
  enableCompareBar();
  document.getElementById('allImagesBtn')?.addEventListener('click', () => openAllImages('ภาพอาคารทั้งหมด', p.images));
  page.querySelectorAll('.mosaic-item').forEach((b) => b.addEventListener('click', () => openViewer(p.images, Number(b.dataset.view))));
  page.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ch]');
    if (a) track('contact_click', { property_id: p.id, channel: a.dataset.ch });
  });
  document.getElementById('reportBtn').addEventListener('click', () => reportDialog(p));
  document.getElementById('moreNearby')?.addEventListener('click', (e) => {
    document.querySelectorAll('.nearby-list li.more').forEach((li) => li.classList.remove('hidden'));
    e.target.remove();
  });
  renderMap(p);
}

function renderMap(p) {
  const map = createMap('map', { center: [p.lat, p.lng], zoom: 16, scrollWheelZoom: false });
  const home = L.marker([p.lat, p.lng], { icon: propIcon({ price_min: Math.min(...p.rooms.map((r) => r.price)) }, true), zIndexOffset: 800 })
    .addTo(map).bindTooltip(p.name);
  const points = [[p.lat, p.lng]];
  const placeIcon = L.divIcon({ className: '', html: '<div class="place-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
  const markers = new Map();
  p.nearby.forEach((n, i) => {
    if (n.lat == null || n.lng == null) return;
    const m = L.marker([n.lat, n.lng], { icon: placeIcon }).addTo(map)
      .bindTooltip(`${n.name}${n.display_distance_m != null ? ` · ${distanceText(n.display_distance_m)}` : ''}`);
    markers.set(i, m);
    points.push([n.lat, n.lng]);
  });
  getMeta().then((meta) => {
    addGateMarkers(map, meta.gates);
    const nearestId = [...p.distances].sort((a, b) => a.straight_line_m - b.straight_line_m)[0].gate_id;
    const gate = meta.gates.find((g) => g.id === nearestId);
    if (gate) {
      L.polyline([[p.lat, p.lng], [gate.lat, gate.lng]], { color: '#e0701b', weight: 2, dashArray: '6 6' }).addTo(map);
      points.push([gate.lat, gate.lng]);
    }
    fitTo(map, L.latLngBounds(points).pad(0.2), { maxZoom: 17 });
  });
  // ชี้รายการสถานที่ใกล้เคียงแล้วไฮไลต์หมุด
  document.querySelectorAll('[data-nearby]').forEach((li) => {
    const m = markers.get(Number(li.dataset.nearby));
    if (!m) return;
    li.classList.add('has-pin');
    li.addEventListener('mouseenter', () => m.openTooltip());
    li.addEventListener('mouseleave', () => m.closeTooltip());
    li.addEventListener('click', () => { map.panTo(m.getLatLng()); m.openTooltip(); });
  });
  home.openTooltip();
}

function reportDialog(p) {
  const reasons = ['ราคาไม่ถูกต้อง', 'ห้องเต็ม/ปิดกิจการแล้ว', 'ตำแหน่งบนแผนที่ผิด', 'ช่องทางติดต่อใช้ไม่ได้', 'รูปภาพไม่ตรงกับความจริง', 'อื่น ๆ'];
  const m = openModal('แจ้งข้อมูลไม่ถูกต้อง', `
    <form id="reportForm">
      <p class="muted small" style="margin-top:0">ผู้ดูแลระบบจะตรวจสอบและแก้ไขข้อมูลของ "${esc(p.name)}"</p>
      <div class="field"><label>เหตุผล</label>${reasons.map((r) => `<label class="check"><input type="radio" name="reason" value="${r}" required> ${r}</label>`).join('')}</div>
      <div class="field"><label for="detail">รายละเอียดเพิ่มเติม</label><textarea id="detail" name="detail" rows="3"></textarea></div>
      <button class="btn primary">ส่งรายงาน</button>
    </form>`);
  m.el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/reports', { method: 'POST', body: { property_id: p.id, reason: fd.get('reason'), detail: fd.get('detail') } });
      m.close();
      toast('ขอบคุณ ส่งรายงานเรียบร้อยแล้ว');
    } catch (err) {
      toast(err.message);
    }
  });
}

api(`/api/properties/${propertyId}`)
  .then((p) => {
    render(p);
    track('view_property', { property_id: p.id });
  })
  .catch((err) => {
    document.getElementById('page').innerHTML = `<div class="card empty"><h2>${esc(err.message)}</h2><a href="/search">กลับไปหน้าค้นหา</a></div>`;
  });
