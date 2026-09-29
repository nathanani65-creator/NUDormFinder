/* ฟอร์มข้อมูลที่พัก ใช้ร่วมกันระหว่างหน้าผู้ประกอบการและผู้ดูแลระบบ */

async function uploadImages(files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('images', f));
  const { urls } = await api('/api/uploads', { method: 'POST', form: fd });
  return urls;
}

function optionTags(list, selected) {
  return list.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('');
}

/** รายการรูปที่แก้คำบรรยาย/หมวด เรียงลำดับ และลบได้ */
function imageEditor(host, { images, categories = null, emptyText }) {
  const list = images.map((im) => (typeof im === 'string' ? { url: im } : { ...im }));
  function render() {
    host.innerHTML = list.length
      ? list.map((im, i) => `<div class="img-edit" data-i="${i}">
          <img referrerpolicy="no-referrer" src="${esc(im.url)}" alt="">
          <div class="img-edit-fields">
            ${categories ? `<select data-k="category" aria-label="หมวดภาพ"><option value="">— หมวดภาพ —</option>${optionTags(categories, im.category)}</select>` : ''}
            <input type="text" data-k="caption" value="${esc(im.caption || '')}" placeholder="คำบรรยายภาพ" aria-label="คำบรรยายภาพ">
            <div class="img-edit-actions">
              <button type="button" class="btn small" data-act="left" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้นก่อน">←</button>
              <button type="button" class="btn small danger" data-act="remove">ลบ</button>
              ${i === 0 ? '<span class="chip accent">รูปแรก</span>' : ''}
            </div>
          </div>
        </div>`).join('')
      : `<p class="small muted" style="margin:6px 0 0">${esc(emptyText)}</p>`;
  }
  host.addEventListener('input', (e) => {
    const box = e.target.closest('.img-edit');
    if (box && e.target.dataset.k) list[Number(box.dataset.i)][e.target.dataset.k] = e.target.value;
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = Number(b.closest('.img-edit').dataset.i);
    if (b.dataset.act === 'remove') list.splice(i, 1);
    if (b.dataset.act === 'left' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    render();
  });
  render();
  return {
    add(urls) { urls.forEach((url) => list.push({ url })); render(); },
    value() { return list.map((im) => ({ url: im.url, category: im.category || '', caption: im.caption || '' })); },
  };
}

async function mountPropertyForm(container, { initial = {}, submitLabel = 'ส่งข้อมูลให้ผู้ดูแลตรวจสอบ', onSubmit, onCancel }) {
  const meta = await getMeta();
  const opt = meta.options;
  const v = (k) => esc(initial[k] ?? '');
  const gateIds = new Set(initial.gate_ids || []);
  const amenityCodes = new Set(initial.amenity_codes || []);
  const amenityGroup = (scope, title, hint) => {
    const items = meta.amenities.filter((a) => (a.scope || 'building') === scope);
    if (!items.length) return '';
    return `<h4 class="form-subhead">${title}</h4>${hint ? `<p class="hint small muted" style="margin:-4px 0 8px">${hint}</p>` : ''}
      <div class="amenity-grid">${items.map((a) => `<label class="check"><input type="checkbox" name="amenity_codes" value="${esc(a.code)}" ${amenityCodes.has(a.code) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>`;
  };

  container.innerHTML = `
  <form class="pform" novalidate>
    <div class="notice error hidden" data-errors></div>

    <div class="card form-section"><div class="card-body">
      <h3>ข้อมูลทั่วไป</h3>
      <div class="grid-2">
        <div class="field"><label>ชื่อที่พัก *</label><input type="text" name="name" value="${v('name')}" required></div>
        <div class="field"><label>ประเภทที่พัก *</label>
          <select name="type_code" required><option value="">— เลือก —</option>
            ${meta.types.map((t) => `<option value="${esc(t.code)}" ${initial.type_code === t.code ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select></div>
      </div>
      <div class="field"><label>รายละเอียดเพิ่มเติม</label><textarea name="description" rows="3">${v('description')}</textarea></div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ทำเลและพิกัด</h3>
      <div class="grid-2">
        <div class="field"><label>ซอย</label>
          <select name="soi_id"><option value="">— ไม่ระบุ —</option>
            ${meta.zones.map((z) => `<optgroup label="${esc(z.name)}">${meta.sois.filter((s) => s.zone_id === z.id).map((s) => `<option value="${s.id}" ${initial.soi_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
            ${meta.sois.filter((s) => !s.zone_id).map((s) => `<option value="${s.id}" ${initial.soi_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
          <div class="hint">เลือกซอยแล้วระบบจะติ๊กประตูที่ซอยนั้นเชื่อมให้อัตโนมัติ</div></div>
        <div class="field"><label>ประตูที่เกี่ยวข้อง *</label>
          <div class="chips">${meta.gates.map((g) => `<label class="check" style="margin-right:10px"><input type="checkbox" name="gate_ids" value="${g.id}" ${gateIds.has(g.id) ? 'checked' : ''}> ${esc(g.short_name)}</label>`).join('')}</div>
          <div class="hint">ที่พักที่อยู่ในซอยเชื่อมสองประตู เลือกได้ทั้งสองประตู (ไม่ต้องสร้างประกาศซ้ำ)</div></div>
      </div>
      <div class="field"><label>ที่อยู่ *</label><input type="text" name="address" value="${v('address')}"></div>
      <label>ตำแหน่งบนแผนที่ * <span class="muted small">(คลิกหรือลากหมุดเพื่อกำหนดพิกัด)</span></label>
      <div class="map picker-map" data-map></div>
      <div class="grid-2" style="margin-top:8px">
        <div class="field"><label>ละติจูด</label><input type="number" step="0.000001" name="lat" value="${v('lat')}"></div>
        <div class="field"><label>ลองจิจูด</label><input type="number" step="0.000001" name="lng" value="${v('lng')}"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>ลิงก์ Google Maps ของที่พัก <span class="muted small">(ไม่บังคับ — เปิดแล้วเห็นชื่อหอ)</span></label>
        <input type="url" name="map_url" value="${v('map_url')}" placeholder="https://maps.app.goo.gl/..."></div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>รูปภาพอาคาร</h3>
      <p class="hint small muted" style="margin-top:-6px">ด้านหน้าอาคาร รอบอาคาร ทางเข้า และพื้นที่ส่วนกลาง รูปแรกจะเป็นรูปหน้าปก (รูปภายในห้องให้เพิ่มในแต่ละประเภทห้องด้านล่าง)</p>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload-building>
      <div data-building-images></div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ห้องพักและราคา *</h3>
      <p class="hint small muted" style="margin-top:-6px">ถ้ามีห้องแบบเดียวราคาเดียว เพิ่มเพียงรายการเดียว ถ้ามีหลายราคา ให้แยกแต่ละประเภทพร้อมรูปและรายละเอียดของห้องนั้นเท่านั้น</p>
      <div data-rooms></div>
      <button type="button" class="btn small" data-add-room>+ เพิ่มประเภทห้อง</button>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ค่าใช้จ่ายอื่น</h3>
      <div class="grid-3">
        <div class="field"><label>เงินประกัน (บาท)</label><input type="number" min="0" name="deposit" value="${v('deposit')}"></div>
        <div class="field"><label>ค่าน้ำ</label><input type="text" name="water_rate" value="${v('water_rate')}" placeholder="เช่น ยูนิตละ 18 บาท"></div>
        <div class="field"><label>ค่าไฟ</label><input type="text" name="electric_rate" value="${v('electric_rate')}" placeholder="เช่น ยูนิตละ 7 บาท"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>ค่าใช้จ่ายอื่น</label><input type="text" name="other_fees" value="${v('other_fees')}"></div>
        <div class="field"><label>เงื่อนไขสัญญาเช่า</label><input type="text" name="lease_terms" value="${v('lease_terms')}" placeholder="เช่น สัญญาขั้นต่ำ 6 เดือน"></div>
      </div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>สิ่งอำนวยความสะดวก</h3>
      <p class="hint small muted" style="margin-top:-6px">ติ๊กเฉพาะรายการที่มีจริง รายการที่ไม่ได้ติ๊กจะไม่แสดงบนหน้าเว็บ</p>
      ${amenityGroup('building', 'ของหอพัก (แสดงในหมวดสิ่งอำนวยความสะดวก)')}
      ${amenityGroup('room', 'ภายในห้อง', 'ใช้สำหรับตัวกรองการค้นหา ส่วนหน้ารายละเอียดจะแสดงของในห้องจากช่อง "สิ่งของ/อุปกรณ์ในห้อง" ของแต่ละประเภทห้อง')}
      ${amenityGroup('rule', 'เงื่อนไขผู้พัก')}
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ข้อกำหนดของหอพัก</h3>
      <p class="hint small muted" style="margin-top:-6px">เช่น ห้ามเลี้ยงสัตว์ ห้ามส่งเสียงดังหลัง 22.00 น. ประตูปิด 24.00 น.</p>
      <div data-rules></div>
      <button type="button" class="btn small" data-add-rule>+ เพิ่มข้อกำหนด</button>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>สถานที่ใกล้เคียง</h3>
      <p class="hint small muted" style="margin-top:-6px">ใส่เฉพาะสถานที่ที่ตรวจสอบแล้ว ต้องมีระยะทางที่วัดได้ (พร้อมประเภทระยะทาง) หรือพิกัดของสถานที่ และระบุแหล่งที่ตรวจสอบ ห้ามเดาชื่อร้านหรือระยะทาง</p>
      <div data-nearby></div>
      <button type="button" class="btn small" data-add-nearby>+ เพิ่มสถานที่</button>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ช่องทางติดต่อ * <span class="muted small">(อย่างน้อย 1 ช่องทาง)</span></h3>
      <div class="grid-2">
        <div class="field"><label>ชื่อผู้ติดต่อ</label><input type="text" name="contact_name" value="${v('contact_name')}"></div>
        <div class="field"><label>เบอร์โทร</label><input type="tel" name="contact_phone" value="${v('contact_phone')}"></div>
        <div class="field"><label>LINE ID</label><input type="text" name="contact_line" value="${v('contact_line')}" placeholder="@ชื่อไลน์ หรือ ID"></div>
        <div class="field"><label>Facebook (ลิงก์เต็มของเพจ)</label><input type="text" name="contact_facebook" value="${v('contact_facebook')}" placeholder="https://www.facebook.com/..."></div>
        <div class="field"><label>เว็บไซต์ทางการ</label><input type="url" name="contact_website" value="${v('contact_website')}" placeholder="https://..."></div>
        <div class="field"><label>แหล่งข้อมูล</label><input type="text" name="data_source" value="${v('data_source')}" placeholder="เช่น ผู้ประกอบการ, ทีมงานสำรวจภาคสนาม"></div>
      </div>
      <div class="hint">ลิงก์ Facebook และเว็บไซต์จะแสดงเป็นลิงก์เฉพาะเมื่อเป็นลิงก์เต็มที่ตรวจสอบแล้ว</div>
    </div></div>

    <div class="form-actions">
      ${onCancel ? '<button type="button" class="btn" data-cancel>ยกเลิก</button>' : ''}
      <button class="btn primary">${esc(submitLabel)}</button>
    </div>
  </form>`;

  const form = container.querySelector('form');
  const withUpload = (input, onUrls) =>
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      try {
        onUrls(await uploadImages(input.files));
      } catch (err) {
        toast(err.message);
      }
      input.value = '';
    });

  // ---------- รูปอาคาร
  const buildingImages = imageEditor(form.querySelector('[data-building-images]'), {
    images: initial.images || [], categories: opt.image_categories, emptyText: 'ยังไม่มีรูปอาคาร',
  });
  withUpload(form.querySelector('[data-upload-building]'), (urls) => buildingImages.add(urls));

  // ---------- ห้อง (แต่ละประเภทมีรูปของตัวเอง)
  const roomsEl = form.querySelector('[data-rooms]');
  const roomEditors = new Map();
  function addRoom(r = {}) {
    const box = document.createElement('div');
    box.className = 'room-block';
    box.innerHTML = `
      <div class="room-block-head"><b data-room-title></b><button type="button" class="btn small danger" data-remove>ลบประเภทห้องนี้</button></div>
      <div class="grid-3">
        <div class="field"><label>ชื่อประเภทห้อง *</label><input type="text" data-r="name" value="${esc(r.name ?? '')}" placeholder="เช่น ห้องแอร์ เตียงเดี่ยว"></div>
        <div class="field"><label>ราคา/เดือน (บาท) *</label><input type="number" data-r="price" min="0" step="100" value="${esc(r.price ?? '')}"></div>
        <div class="field"><label>ขนาด (ตร.ม.)</label><input type="number" data-r="size_sqm" min="0" step="0.5" value="${esc(r.size_sqm ?? '')}"></div>
      </div>
      <div class="field"><label>สิ่งของ/อุปกรณ์ในห้อง <span class="muted small">(บรรทัดละรายการ)</span></label>
        <textarea data-r="features" rows="3" placeholder="เตียง 5 ฟุต\nตู้เสื้อผ้า\nโต๊ะเขียนหนังสือ\nเครื่องปรับอากาศ">${esc(r.features ?? '')}</textarea></div>
      <div class="grid-2">
        <div class="field"><label>หมายเหตุ</label><input type="text" data-r="note" value="${esc(r.note ?? '')}"></div>
        <div class="field"><label>สถานะ</label><label class="check"><input type="checkbox" data-r="available" ${r.available === 0 ? '' : 'checked'}> ยังมีห้องว่าง</label></div>
      </div>
      <label>รูปภายในห้องประเภทนี้</label>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-room-upload>
      <div data-room-images></div>`;
    const editor = imageEditor(box.querySelector('[data-room-images]'), { images: r.images || [], emptyText: 'ยังไม่มีรูปภายในห้องนี้' });
    roomEditors.set(box, editor);
    withUpload(box.querySelector('[data-room-upload]'), (urls) => editor.add(urls));
    box.querySelector('[data-remove]').onclick = () => { roomEditors.delete(box); box.remove(); numberRooms(); };
    roomsEl.appendChild(box);
    numberRooms();
  }
  function numberRooms() {
    roomsEl.querySelectorAll('[data-room-title]').forEach((el, i) => (el.textContent = `ประเภทห้องที่ ${i + 1}`));
  }
  (initial.rooms?.length ? initial.rooms : [{}]).forEach(addRoom);
  form.querySelector('[data-add-room]').onclick = () => addRoom();

  // ---------- ข้อกำหนด
  const rulesEl = form.querySelector('[data-rules]');
  function addRule(x = {}) {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `<select data-k="topic" aria-label="หัวข้อ">${optionTags(opt.rule_topics, x.topic)}</select>
      <input type="text" data-k="detail" value="${esc(x.detail ?? '')}" placeholder="รายละเอียด" aria-label="รายละเอียดข้อกำหนด">
      <button type="button" class="btn small danger" data-remove>ลบ</button>`;
    row.querySelector('[data-remove]').onclick = () => row.remove();
    rulesEl.appendChild(row);
  }
  (initial.rules || []).forEach(addRule);
  form.querySelector('[data-add-rule]').onclick = () => addRule();

  // ---------- สถานที่ใกล้เคียง
  const nearbyEl = form.querySelector('[data-nearby]');
  function addNearby(n = {}) {
    const row = document.createElement('div');
    row.className = 'nearby-row';
    row.innerHTML = `
      <input type="text" data-k="name" value="${esc(n.name ?? '')}" placeholder="ชื่อสถานที่ *" aria-label="ชื่อสถานที่">
      <select data-k="category" aria-label="ประเภทสถานที่">${optionTags(opt.nearby_categories, n.category)}</select>
      <input type="number" data-k="distance_m" min="0" value="${esc(n.distance_m ?? '')}" placeholder="ระยะ (ม.)" aria-label="ระยะทาง (เมตร)">
      <select data-k="distance_type" aria-label="ประเภทระยะทาง"><option value="">ประเภทระยะ</option>${optionTags(opt.distance_types, n.distance_type)}</select>
      <input type="number" step="0.000001" data-k="lat" value="${esc(n.lat ?? '')}" placeholder="ละติจูด" aria-label="ละติจูดของสถานที่">
      <input type="number" step="0.000001" data-k="lng" value="${esc(n.lng ?? '')}" placeholder="ลองจิจูด" aria-label="ลองจิจูดของสถานที่">
      <input type="text" data-k="source" value="${esc(n.source ?? '')}" placeholder="แหล่งที่ตรวจสอบ *" aria-label="แหล่งที่ตรวจสอบ">
      <input type="date" data-k="checked_at" value="${esc(n.checked_at ?? '')}" aria-label="วันที่ตรวจสอบ">
      <button type="button" class="btn small danger" data-remove>ลบ</button>`;
    row.querySelector('[data-remove]').onclick = () => row.remove();
    nearbyEl.appendChild(row);
  }
  (initial.nearby || []).forEach(addNearby);
  form.querySelector('[data-add-nearby]').onclick = () => addNearby();

  // ---------- ซอย → ติ๊กประตูอัตโนมัติ
  form.elements.soi_id.addEventListener('change', () => {
    const soi = meta.sois.find((s) => s.id === Number(form.elements.soi_id.value));
    if (!soi) return;
    form.querySelectorAll('input[name=gate_ids]').forEach((i) => (i.checked = soi.gate_ids.includes(Number(i.value))));
  });

  // ---------- แผนที่เลือกพิกัด
  const hasPos = initial.lat != null && initial.lat !== '' && Number.isFinite(Number(initial.lat));
  const map = createMap(form.querySelector('[data-map]'), { center: hasPos ? [initial.lat, initial.lng] : NU_CENTER, zoom: hasPos ? 17 : 15 });
  addGateMarkers(map, meta.gates);
  let marker = null;
  function setPos(lat, lng, pan = false) {
    lat = +Number(lat).toFixed(6);
    lng = +Number(lng).toFixed(6);
    form.elements.lat.value = lat;
    form.elements.lng.value = lng;
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        setPos(p.lat, p.lng);
      });
    } else marker.setLatLng([lat, lng]);
    if (pan) map.panTo([lat, lng]);
  }
  if (hasPos) setPos(initial.lat, initial.lng);
  map.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng));
  for (const k of ['lat', 'lng']) {
    form.elements[k].addEventListener('change', () => {
      const lat = Number(form.elements.lat.value);
      const lng = Number(form.elements.lng.value);
      if (lat && lng) setPos(lat, lng, true);
    });
  }
  // แผนที่ในแท็บ/โมดัลที่เพิ่งแสดงต้องคำนวณขนาดใหม่
  setTimeout(() => map.invalidateSize(), 50);

  // ---------- ส่งฟอร์ม
  const rowValues = (el, selector) =>
    [...el.querySelectorAll(selector)].map((row) =>
      Object.fromEntries([...row.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value]))
    );

  form.querySelector('[data-cancel]')?.addEventListener('click', onCancel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {};
    for (const k of ['name', 'type_code', 'soi_id', 'address', 'lat', 'lng', 'description', 'deposit', 'water_rate',
      'electric_rate', 'other_fees', 'lease_terms', 'contact_name', 'contact_phone', 'contact_line', 'contact_facebook',
      'contact_website', 'data_source', 'map_url']) {
      body[k] = fd.get(k);
    }
    body.gate_ids = fd.getAll('gate_ids').map(Number);
    body.amenity_codes = fd.getAll('amenity_codes');
    body.images = buildingImages.value();
    body.rooms = [...roomsEl.querySelectorAll('.room-block')].map((box) => ({
      name: box.querySelector('[data-r=name]').value,
      price: box.querySelector('[data-r=price]').value,
      size_sqm: box.querySelector('[data-r=size_sqm]').value,
      features: box.querySelector('[data-r=features]').value,
      note: box.querySelector('[data-r=note]').value,
      available: box.querySelector('[data-r=available]').checked ? 1 : 0,
      images: roomEditors.get(box).value(),
    }));
    body.rules = rowValues(rulesEl, '.rule-row');
    body.nearby = rowValues(nearbyEl, '.nearby-row');

    const errBox = form.querySelector('[data-errors]');
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    try {
      errBox.classList.add('hidden');
      await onSubmit(body);
    } catch (err) {
      errBox.innerHTML = (err.errors || [err.message]).map(esc).join('<br>');
      errBox.classList.remove('hidden');
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      btn.disabled = false;
    }
  });
}
