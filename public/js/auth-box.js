/* กล่องเข้าสู่ระบบ / สมัครบัญชี
 * roles: ประเภทบัญชีที่สมัครได้จากกล่องนี้ ('member' = สมาชิก, 'provider' = ผู้ประกอบการ) */
const ROLE_INFO = {
  member: ['สมาชิก', 'ค้นหา บันทึกที่พักที่สนใจ และเก็บชุดเปรียบเทียบไว้ในบัญชี'],
  provider: ['ผู้ประกอบการ', 'ลงประกาศและจัดการข้อมูลที่พักของตนเอง'],
};

function renderAuthBox(host, { title, intro = '', allowRegister = false, roles = ['member', 'provider'], defaultRole = roles[0], startMode = 'login', onDone }) {
  host.innerHTML = `<div class="card auth-box"><div class="card-body">
    <img src="/img/logo.svg?v=2" alt="NU Dorm Finder" width="150" height="99" style="display:block;margin:4px auto 14px">
    <h1 style="font-size:1.4rem">${esc(title)}</h1>
    ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
    ${allowRegister ? `<div class="tabs" role="tablist">
      <button type="button" role="tab" data-mode="login">เข้าสู่ระบบ</button>
      <button type="button" role="tab" data-mode="register">สมัครบัญชี</button></div>` : ''}
    <form>
      <div class="notice error hidden" data-err role="alert"></div>
      ${allowRegister ? `<fieldset class="field reg hidden role-choice"><legend>ประเภทบัญชี</legend>
        ${roles.map((r) => `<label class="role-option"><input type="radio" name="role" value="${r}" ${r === defaultRole ? 'checked' : ''}>
          <span><b>${ROLE_INFO[r][0]}</b><span class="small muted">${ROLE_INFO[r][1]}</span></span></label>`).join('')}
      </fieldset>` : ''}
      <div class="field reg hidden"><label for="authName">ชื่อ-นามสกุล / ชื่อกิจการ</label><input id="authName" type="text" name="name" autocomplete="name"></div>
      <div class="field reg hidden"><label for="authPhone">เบอร์โทร</label><input id="authPhone" type="tel" name="phone" autocomplete="tel"></div>
      <div class="field"><label for="authEmail">อีเมล</label><input id="authEmail" type="email" name="email" required autocomplete="username"></div>
      <div class="field"><label for="authPassword">รหัสผ่าน</label><input id="authPassword" type="password" name="password" required autocomplete="current-password">
        <div class="hint reg hidden">อย่างน้อย 8 ตัวอักษร</div></div>
      <button class="btn primary" style="width:100%" data-submit>เข้าสู่ระบบ</button>
    </form>
  </div></div>`;

  const form = host.querySelector('form');
  let mode = 'login';
  function setMode(m) {
    mode = m;
    host.querySelectorAll('[data-mode]').forEach((x) => {
      x.classList.toggle('active', x.dataset.mode === m);
      x.setAttribute('aria-selected', x.dataset.mode === m);
    });
    form.querySelectorAll('.reg').forEach((el) => el.classList.toggle('hidden', m !== 'register'));
    form.querySelector('[data-submit]').textContent = m === 'register' ? 'สมัครบัญชี' : 'เข้าสู่ระบบ';
    form.elements.password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
  }
  host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode(allowRegister ? startMode : 'login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (mode !== 'register') delete body.role;
    const err = form.querySelector('[data-err]');
    try {
      const user = await api(mode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
      onDone(user);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });
}

/** ปลายทางหลังเข้าสู่ระบบตามบทบาท */
function homeForRole(role) {
  return { admin: '/admin', provider: '/provider', member: '/saved' }[role] || '/';
}
