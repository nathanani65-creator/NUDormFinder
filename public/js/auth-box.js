/* กล่องเข้าสู่ระบบ / สมัครสมาชิก */
function renderAuthBox(host, { title, intro = '', allowRegister = false, onDone }) {
  host.innerHTML = `<div class="card auth-box"><div class="card-body">
    <img src="/img/logo.svg?v=2" alt="NU Dorm Finder" width="150" height="99" style="display:block;margin:4px auto 14px">
    <h1 style="font-size:1.4rem">${esc(title)}</h1>
    ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
    ${allowRegister ? '<div class="tabs"><button class="active" data-mode="login">เข้าสู่ระบบ</button><button data-mode="register">สมัครสมาชิก</button></div>' : ''}
    <form>
      <div class="notice error hidden" data-err></div>
      <div class="field reg hidden"><label>ชื่อ-นามสกุล / ชื่อกิจการ</label><input type="text" name="name"></div>
      <div class="field reg hidden"><label>เบอร์โทร</label><input type="tel" name="phone"></div>
      <div class="field"><label>อีเมล</label><input type="email" name="email" required autocomplete="username"></div>
      <div class="field"><label>รหัสผ่าน</label><input type="password" name="password" required autocomplete="current-password">
        <div class="hint reg hidden">อย่างน้อย 8 ตัวอักษร</div></div>
      <button class="btn primary" style="width:100%">เข้าสู่ระบบ</button>
    </form>
  </div></div>`;

  let mode = 'login';
  const form = host.querySelector('form');
  host.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      host.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
      form.querySelectorAll('.reg').forEach((el) => el.classList.toggle('hidden', mode !== 'register'));
      form.querySelector('button').textContent = mode === 'register' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
      form.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    })
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
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
