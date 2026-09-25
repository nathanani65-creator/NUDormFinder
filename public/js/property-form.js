/* ฟอร์มข้อมูลที่พัก ใช้ร่วมกันระหว่างหน้าผู้ประกอบการและผู้ดูแลระบบ */
async function mountPropertyForm(container, { initial = {}, submitLabel = 'ส่งข้อมูลให้ผู้ดูแลตรวจสอบ', onSubmit, onCancel }) {
  const meta = await getMeta();
  const v = (k) => esc(initial[k] ?? '');
  const gateIds = new Set(initial.gate_ids || []);
  const amenityCodes = new Set(initial.amenity_codes || []);
  let images = [...(initial.images || [])];

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
      <div class="field"><label>รายละเอียด</label><textarea name="description" rows="3">${v('description')}</textarea></div>
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
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ประเภทห้องและราคา *</h3>
      <div class="room-row small muted"><span>ชื่อประเภทห้อง</span><span>ราคา/เดือน (บาท)</span><span>ขนาด (ตร.ม.)</span><span>ว่าง</span><span></span></div>
      <div data-rooms></div>
      <button type="button" class="btn small" data-add-room>+ เพิ่มประเภทห้อง</button>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ค่าใช้จ่ายอื่นและเงื่อนไข</h3>
      <div class="grid-3">
        <div class="field"><label>เงินประกัน (บาท)</label><input type="number" min="0" name="deposit" value="${v('deposit')}"></div>
        <div class="field"><label>ค่าน้ำ</label><input type="text" name="water_rate" value="${v('water_rate')}" placeholder="เช่น ยูนิตละ 18 บาท"></div>
        <div class="field"><label>ค่าไฟ</label><input type="text" name="electric_rate" value="${v('electric_rate')}" placeholder="เช่น ยูนิตละ 7 บาท"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>ค่าใช้จ่ายอื่น</label><input type="text" name="other_fees" value="${v('other_fees')}"></div>
        <div class="field"><label>เงื่อนไขการเช่า</label><input type="text" name="lease_terms" value="${v('lease_terms')}" placeholder="เช่น สัญญาขั้นต่ำ 6 เดือน"></div>
      </div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>สิ่งอำนวยความสะดวก</h3>
      <div class="amenity-grid">${meta.amenities.map((a) => `<label class="check"><input type="checkbox" name="amenity_codes" value="${esc(a.code)}" ${amenityCodes.has(a.code) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>รูปภาพ</h3>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload>
      <div class="hint small muted">JPG / PNG / WebP ไม่เกิน 5MB ต่อรูป รูปแรกจะเป็นรูปหน้าปก</div>
      <div class="img-list" data-images></div>
    </div></div>

    <div class="card form-section"><div class="card-body">
      <h3>ช่องทางติดต่อ * <span class="muted small">(อย่างน้อย 1 ช่องทาง)</span></h3>
      <div class="grid-2">
        <div class="field"><label>ชื่อผู้ติดต่อ</label><input type="text" name="contact_name" value="${v('contact_name')}"></div>
        <div class="field"><label>เบอร์โทร</label><input type="tel" name="contact_phone" value="${v('contact_phone')}"></div>
        <div class="field"><label>LINE ID</label><input type="text" name="contact_line" value="${v('contact_line')}" placeholder="@ชื่อไลน์ หรือ ID"></div>
        <div class="field"><label>Facebook (ลิงก์หรือชื่อเพจ)</label><input type="text" name="contact_facebook" value="${v('contact_facebook')}"></div>
      </div>
      <div class="field"><label>แหล่งข้อมูล</label><input type="text" name="data_source" value="${v('data_source')}" placeholder="เช่น ผู้ประกอบการ, ทีมงานสำรวจภาคสนาม"></div>
    </div></div>

    <div class="form-actions">
      ${onCancel ? '<button type="button" class="btn" data-cancel>ยกเลิก</button>' : ''}
      <button class="btn primary">${esc(submitLabel)}</button>
    </div>
  </form>`;

  const form = container.querySelector('form');

  // ---------- ห้อง
  const roomsEl = form.querySelector('[data-rooms]');
  function addRoom(r = {}) {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.innerHTML = `
      <input type="text" data-r="name" value="${esc(r.name ?? '')}" placeholder="เช่น ห้องแอร์">
      <input type="number" data-r="price" min="0" step="100" value="${esc(r.price ?? '')}">
      <input type="number" data-r="size_sqm" min="0" step="0.5" value="${esc(r.size_sqm ?? '')}">
      <input type="checkbox" data-r="available" ${r.available === 0 ? '' : 'checked'} style="width:18px;height:18px;accent-color:var(--accent)">
      <button type="button" class="btn small danger" data-remove>ลบ</button>`;
    row.querySelector('[data-remove]').onclick = () => row.remove();
    roomsEl.appendChild(row);
  }
  (initial.rooms?.length ? initial.rooms : [{}]).forEach(addRoom);
  form.querySelector('[data-add-room]').onclick = () => addRoom();

  // ---------- ซอย → ติ๊กประตูอัตโนมัติ
  form.elements.soi_id.addEventListener('change', () => {
    const soi = meta.sois.find((s) => s.id === Number(form.elements.soi_id.value));
    if (!soi) return;
    form.querySelectorAll('input[name=gate_ids]').forEach((i) => (i.checked = soi.gate_ids.includes(Number(i.value))));
  });

  // ---------- แผนที่เลือกพิกัด
  const hasPos = Number.isFinite(Number(initial.lat)) && initial.lat !== undefined && initial.lat !== '';
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

  // ---------- รูปภาพ
  const imgEl = form.querySelector('[data-images]');
  function renderImages() {
    imgEl.innerHTML = images
      .map((u, i) => `<div class="thumb"><img src="${esc(u)}" alt=""><button type="button" data-i="${i}">ลบ</button></div>`)
      .join('');
  }
  imgEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    images.splice(Number(b.dataset.i), 1);
    renderImages();
  });
  form.querySelector('[data-upload]').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    try {
      const { urls } = await api('/api/uploads', { method: 'POST', form: fd });
      images.push(...urls);
      renderImages();
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });
  renderImages();

  // ---------- ส่งฟอร์ม
  form.querySelector('[data-cancel]')?.addEventListener('click', onCancel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {};
    for (const k of ['name', 'type_code', 'soi_id', 'address', 'lat', 'lng', 'description', 'deposit', 'water_rate',
      'electric_rate', 'other_fees', 'lease_terms', 'contact_name', 'contact_phone', 'contact_line', 'contact_facebook', 'data_source']) {
      body[k] = fd.get(k);
    }
    body.gate_ids = fd.getAll('gate_ids').map(Number);
    body.amenity_codes = fd.getAll('amenity_codes');
    body.rooms = [...roomsEl.querySelectorAll('.room-row')].map((row) => ({
      name: row.querySelector('[data-r=name]').value,
      price: row.querySelector('[data-r=price]').value,
      size_sqm: row.querySelector('[data-r=size_sqm]').value,
      available: row.querySelector('[data-r=available]').checked ? 1 : 0,
    }));
    body.images = images;

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
