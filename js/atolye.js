'use strict';

// Atölye: oyuncuların bölümleri ve paketleri. Gezmek ve oynamak hesapsız; kaydetmek, yayınlamak,
// beğenmek ve bildirmek için Google ile giriş. Sunucu tarafı: server/atolye.js

// Google'ın renkli "G" logosu (giriş düğmeleri için)
const GOOGLE_G = '<svg class="gIcon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';
const googleButton = (id, text = 'Google ile giriş yap') => `<button id="${id}" class="google">${GOOGLE_G}<span>${text}</span></button>`;

const VIS_LABELS = { private: 'Gizli', link: 'Linkle', public: 'Herkese açık' };
const VIS_ICONS = { private: 'lock', link: 'link', public: 'globe' };
const visOptions = cur => Object.entries(VIS_LABELS).map(([k, v]) => `<option value="${k}" data-ic="${VIS_ICONS[k]}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
const visBadge = v => `<span class="vis">${icon(VIS_ICONS[v])}${VIS_LABELS[v]}</span>`;
const likeLabel = (liked, long) => liked ? `${icon('heartFill')}Beğendin` : `${icon('heart')}${long ? 'Bu bölümü beğen' : 'Beğen'}`;
const emptyBox = (ic, text, action = '') => `<div class="emptyBox">${icon(ic)}<p>${text}</p>${action}</div>`;
const secHead = (title, n, extra = '') => `<div class="secHead"><h3>${title}<span class="count">${n}</span></h3>${extra}</div>`;
const counts = (likes, plays, likeId) => `<span class="cnt">${icon('heart')}<span${likeId ? ` id="${likeId}"` : ''}>${likes}</span></span><span class="cnt">${icon('play')}${plays}</span>`;

// Küçük önizleme: bölümün haritası karolar hâlinde
function drawLevelThumb(canvas, map) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#24234f';
  ctx.fillRect(0, 0, w, h);
  if (!map || !map.length) return;
  const rows = map.length, cols = map[0].length;
  const s = Math.min(w / cols, h / rows), ox = (w - cols * s) / 2, oy = (h - rows * s) / 2;
  const colors = { '#': '#5a60b8', D: '#e8b04e', K: '#ffd43b', E: '#69db7c', H: '#b8794a', S: '#ff6b6b' };
  map.forEach((row, r) => [...row].forEach((ch, c) => {
    let col = colors[ch];
    if ('123abc'.includes(ch)) col = CHANNEL_COLORS['123abc'.indexOf(ch) % 3 + 1];
    if (!col) return;
    ctx.fillStyle = col;
    if (ch === 'H') ctx.fillRect(ox + c * s, oy + r * s, s * 2 - 0.5, s * 2 - 0.5);
    else if ('SKE'.includes(ch)) { ctx.beginPath(); ctx.arc(ox + (c + 0.5) * s, oy + (r + 0.5) * s, s * 0.45, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(ox + c * s, oy + r * s, s - 0.5, s - 0.5);
  }));
}

const Atolye = {
  me: null,
  stats: null,
  loginEnabled: false,
  tab: 'new',
  q: '',
  play: null,          // oynanan Atölye bölümü/paketi: { level, pack, index }

  // ---------- Sunucu ----------

  async api(method, path, body) {
    try {
      const r = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let json = {};
      try { json = await r.json(); } catch (e) { /* boş */ }
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      return { ok: false, status: 0, json: { error: 'Sunucuya ulaşılamadı.' } };
    }
  },

  available() { return Net.available(); },

  async loadMe() {
    if (!this.available()) return;
    const r = await this.api('GET', '/api/me');
    if (r.ok) { this.me = r.json.user; this.stats = r.json.stats; this.loginEnabled = r.json.loginEnabled; }
    this.renderAccount();
    if (this.me) syncProgress();
  },

  // Google'a gidip geri dönünce kaldığın yere döner (editördeki taslak tarayıcıda saklı kalır)
  login(next) {
    location.href = '/auth/google?next=' + encodeURIComponent(next || location.pathname + location.search);
  },

  async logout() {
    await this.api('POST', '/auth/logout', {});
    this.me = null;
    this.stats = null;
    this.renderAccount();
    if (state === 'atolye') this.render();
  },

  avatar(cls = '') {
    const m = this.me;
    return m.avatar ? `<img class="${cls}" src="${esc(m.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="noav ${cls}">${esc((m.name[0] || '?').toUpperCase())}</span>`;
  },

  async rename() {
    const name = prompt('Atölye\'de görünecek adın:', this.me.name);
    if (!name) return;
    const r = await this.api('POST', '/api/me', { name });
    if (r.ok) { this.me = r.json.user; this.renderAccount(); } else alert(r.json.error);
  },

  // Hesap her yerde güncel: ana menüde profil kartı, diğer menülerde sol üstte küçük düğme, editörde kaydetme kutusu
  renderAccount() {
    this.renderProfile();
    this.renderEditorAccount();
    const el = $('account');
    const visible = this.loginEnabled && state !== 'home' && (MENU_STATES.has(state) || state === 'atolye');
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (!this.me) {
      el.innerHTML = googleButton('loginBtn', 'Giriş yap');
      $('loginBtn').onclick = () => this.login();
      return;
    }
    el.innerHTML = `<button id="meBtn">${this.avatar()}<span>${esc(this.me.name)}</span>${icon('chevron')}</button>
      <div id="meMenu" class="panel hidden"><button id="mineBtn">${icon('folder')}Bölümlerim</button><button id="renameBtn">${icon('pencil')}Adımı değiştir</button><button id="logoutBtn">${icon('logout')}Çıkış yap</button></div>`;
    $('meBtn').onclick = () => $('meMenu').classList.toggle('hidden');
    $('mineBtn').onclick = () => this.open('mine');
    $('renameBtn').onclick = () => this.rename();
    $('logoutBtn').onclick = () => this.logout();
  },

  // Ana menünün sağındaki profil kartı
  renderProfile() {
    const el = $('profile');
    el.classList.toggle('hidden', !this.loginEnabled);
    if (!this.loginEnabled) return;
    if (!this.me) {
      el.innerHTML = `
        <div class="guestBall"><span></span><span></span></div>
        <h3>Misafir oyuncu</h3>
        <p class="small">Oynamak için hesap gerekmez. Giriş yaparsan:</p>
        <ul class="perks">
          <li>${icon('cloud')}Bölümlerin kaydedilir, her cihazdan açarsın</li>
          <li>${icon('globe')}Atölye'de herkesle paylaşırsın</li>
          <li>${icon('heart')}Bölüm beğenir, paket kurarsın</li>
        </ul>
        ${googleButton('profileLogin')}
        <p class="tiny">Yalnızca adın ve profil resmin kullanılır.</p>`;
      $('profileLogin').onclick = () => this.login();
      return;
    }
    const st = this.stats || { levels: 0, likes: 0, plays: 0 };
    el.innerHTML = `
      <div class="profTop">${this.avatar('big')}
        <div><small>Hoş geldin</small><h3>${esc(this.me.name)}</h3><button id="profRename" class="link">${icon('pencil')}Adını değiştir</button></div>
      </div>
      <div class="profStats">
        <div><b>${st.levels}</b><span>Bölüm</span></div>
        <div><b>${st.likes}</b><span>Beğeni</span></div>
        <div><b>${st.plays}</b><span>Oynanma</span></div>
      </div>
      <button id="profMine">${icon('folder')}Bölümlerim ve paketlerim</button>
      <button id="profNew">${icon('pencil')}Yeni bölüm yap</button>
      <button id="profLogout" class="link">${icon('logout')}Çıkış yap</button>`;
    $('profRename').onclick = () => this.rename();
    $('profMine').onclick = () => this.open('mine');
    $('profNew').onclick = () => toEditor();
    $('profLogout').onclick = () => this.logout();
  },

  // Editörde Kaydet'in altında: kimin adına kaydedileceği ya da giriş düğmesi
  renderEditorAccount() {
    const el = $('edAccount');
    if (!el) return;
    if (!this.available()) { el.innerHTML = ''; return; }
    if (!this.me) {
      el.innerHTML = this.loginEnabled ? `<p class="small">Kaydetmek için giriş yap:</p>${googleButton('edLogin')}` : '';
      if (this.loginEnabled) $('edLogin').onclick = () => this.login('/?editor=1');
      return;
    }
    el.innerHTML = `<div class="edMe">${this.avatar()}<span>${esc(this.me.name)}</span></div>`;
  },

  // ---------- Atölye ekranı ----------

  open(tab) {
    Net.close();
    mode = 'local';
    if (tab) this.tab = tab;
    state = 'atolye';
    game = menuGame();
    show('atolye');
    this.renderAccount();
    this.render();
  },

  setTab(tab) { this.tab = tab; this.render(); },

  async render() {
    for (const b of document.querySelectorAll('#atTabs button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    $('atSearch').classList.toggle('hidden', this.tab === 'mine');
    const body = $('atBody');
    if (!this.available()) { body.innerHTML = '<p class="note">Atölye için oyunu sunucudan aç (npm start ya da canlı site).</p>'; return; }
    body.innerHTML = '<p class="small">Yükleniyor…</p>';
    if (this.tab === 'mine') return this.renderMine();
    const packs = this.tab === 'packs';
    const sort = this.tab === 'popular' ? 'popular' : 'new';
    const r = await this.api('GET', `/api/${packs ? 'packs' : 'levels'}?sort=${sort}&q=${encodeURIComponent(this.q)}`);
    if (!r.ok) { body.innerHTML = `<p class="error">${esc(r.json.error || 'Yüklenemedi.')}</p>`; return; }
    if (!r.json.items.length) {
      body.innerHTML = emptyBox(this.q ? 'search' : packs ? 'pack' : 'grid', this.q ? 'Aramana uyan bir şey bulamadım.' : packs ? 'Henüz paylaşılmış paket yok. İlk paketi sen yap!' : 'Henüz paylaşılmış bölüm yok. Editörde bir bölüm yapıp herkese açık kaydet!');
      return;
    }
    body.innerHTML = '<div class="atGrid"></div>';
    for (const it of r.json.items) body.firstChild.appendChild(this.card(it, packs));
  },

  card(it, isPack) {
    const el = document.createElement('button');
    el.className = 'atCard';
    el.innerHTML = `<canvas width="240" height="110"></canvas>
      <b>${it.magnet ? icon('magnet', 'mag') : ''}${isPack ? icon('pack') : ''}${esc(it.name)}</b>
      <span class="by">${esc(it.author.name)}${isPack ? ` · ${it.count} bölüm` : ''}</span>
      <span class="stats">${counts(it.likes, it.plays)}${it.mine ? visBadge(it.visibility) : ''}</span>`;
    drawLevelThumb(el.querySelector('canvas'), isPack ? it.cover : it.map);
    el.onclick = () => (isPack ? this.openPack(it.id) : this.openLevel(it.id));
    return el;
  },

  async renderMine() {
    const body = $('atBody');
    if (!this.me) {
      body.innerHTML = emptyBox('user', 'Bölümlerini kaydetmek ve her cihazdan görmek için giriş yap.',
        this.loginEnabled ? googleButton('mineLogin') : '<p class="note">Bu sunucuda giriş kapalı.</p>');
      if ($('mineLogin')) $('mineLogin').onclick = () => this.login('/?atolye=mine');
      return;
    }
    const [lv, pk] = await Promise.all([this.api('GET', '/api/levels/mine'), this.api('GET', '/api/packs/mine')]);
    const levels = lv.json.items || [], packs = pk.json.items || [];
    body.innerHTML = `<section>${secHead('Bölümlerim', levels.length, `<button id="newLevel" class="small primary">${icon('plus')}Yeni bölüm</button>`)}<div class="atGrid" id="mineLevels"></div></section>
      <section>${secHead('Paketlerim', packs.length, `<button id="newPack" class="small">${icon('plus')}Paket oluştur</button>`)}<div class="atGrid" id="minePacks"></div></section>`;
    $('newLevel').onclick = () => { Editor.load(blankLevel(), null); Editor.refresh(); toEditor(); };
    $('newPack').onclick = () => this.packBuilder(null, levels);
    for (const it of levels) $('mineLevels').appendChild(this.card(it, false));
    for (const it of packs) $('minePacks').appendChild(this.card(it, true));
    if (!levels.length) $('mineLevels').innerHTML = emptyBox('pencil', 'Henüz kayıtlı bölümün yok. Editörde bir bölüm yapıp <b>Kaydet</b>\'e bas.');
    if (!packs.length) $('minePacks').innerHTML = emptyBox('pack', 'Paket, bölümlerini sırayla oynatan küçük bir macera. Birkaç bölüm kaydedince paket kurabilirsin.');
  },

  // ---------- Bölüm sayfası ----------

  async openLevel(id) {
    if (state !== 'atolye') this.open();
    const body = $('atBody');
    body.innerHTML = '<p class="small">Yükleniyor…</p>';
    const r = await this.api('GET', `/api/levels/${id}`);
    if (!r.ok) { body.innerHTML = `<p class="error">${esc(r.json.error || 'Bölüm açılamadı.')}</p>`; return; }
    const l = r.json;
    body.innerHTML = `<button class="link back">${icon('back')}Geri</button>
      <div class="atDetail">
        <canvas width="520" height="240"></canvas>
        <div class="atInfo">
          <h3>${l.magnet ? icon('magnet', 'mag') : ''}${esc(l.name)}</h3>
          <p class="by">${icon('user')}${esc(l.author.name)} ${counts(l.likes, l.plays, 'lk')}${l.hidden ? ' · <span class="error">bildirildiği için listeden kaldırıldı</span>' : ''}</p>
          <button id="playLocal" class="primary">AYNI KLAVYEDE OYNA</button>
          <button id="playOnline">Online odada oyna</button>
          <div class="row">
            <button id="likeLv" class="${l.liked ? 'on' : ''}">${likeLabel(l.liked)}</button>
            <button id="shareLv">${icon('link')}Linki kopyala</button>
          </div>
          <div class="row">
            <button id="copyLv">${icon('copy')}Editörde kopyasını aç</button>
            ${l.mine ? '' : `<button id="reportLv" class="link">${icon('flag')}Bildir</button>`}
          </div>
          ${l.mine ? `<div class="mineBox"><b>Senin bölümün</b>
            <select id="visLv">${visOptions(l.visibility)}</select>
            <div class="row"><button id="editLv">${icon('pencil')}Düzenle</button><button id="delLv" class="danger">${icon('trash')}Sil</button></div></div>` : ''}
          <p id="lvMsg" class="note"></p>
        </div>
      </div>`;
    drawLevelThumb(body.querySelector('canvas'), l.map);
    enhanceSelects(body);
    const def = { name: l.name, magnet: l.magnet, map: l.map };
    body.querySelector('.back').onclick = () => this.render();
    $('playLocal').onclick = () => this.playLevel(l, null, 0, 'local');
    $('playOnline').onclick = () => this.playLevel(l, null, 0, 'online');
    $('likeLv').onclick = async () => {
      if (!this.me) return this.needLogin(`/?b=${l.id}`);
      const x = await this.api('POST', `/api/levels/${l.id}/like`, {});
      if (x.ok) { $('lk').textContent = x.json.likes; $('likeLv').innerHTML = likeLabel(x.json.liked); $('likeLv').classList.toggle('on', x.json.liked); }
    };
    $('shareLv').onclick = () => this.copy(`${location.origin}/?b=${l.id}`, $('shareLv'));
    $('copyLv').onclick = () => { Editor.load({ name: (l.name + ' (kopya)').slice(0, 24), magnet: l.magnet, map: l.map }, null); Editor.refresh(); toEditor('Kopya açıldı. Kendi adınla kaydedebilirsin.'); };
    if ($('reportLv')) $('reportLv').onclick = () => this.report(`/api/levels/${l.id}/report`, `/?b=${l.id}`);
    if (l.mine) {
      $('visLv').onchange = async () => {
        const x = await this.api('PUT', `/api/levels/${l.id}`, Object.assign({}, def, { visibility: $('visLv').value }));
        $('lvMsg').textContent = x.ok ? 'Görünürlük güncellendi.' : x.json.error;
      };
      $('editLv').onclick = () => { Editor.load(def, { id: l.id, visibility: l.visibility }); toEditor(); };
      $('delLv').onclick = async () => {
        if (!confirm(`"${l.name}" silinsin mi? Bu geri alınamaz.`)) return;
        const x = await this.api('DELETE', `/api/levels/${l.id}`, {});
        if (x.ok) { if (Editor.remote && Editor.remote.id === l.id) Editor.setRemote(null); this.setTab('mine'); } else $('lvMsg').textContent = x.json.error;
      };
    }
  },

  // ---------- Paket sayfası ----------

  async openPack(id) {
    if (state !== 'atolye') this.open();
    const body = $('atBody');
    body.innerHTML = '<p class="small">Yükleniyor…</p>';
    const r = await this.api('GET', `/api/packs/${id}`);
    if (!r.ok) { body.innerHTML = `<p class="error">${esc(r.json.error || 'Paket açılamadı.')}</p>`; return; }
    const pk = r.json;
    body.innerHTML = `<button class="link back">${icon('back')}Geri</button>
      <div class="atDetail">
        <div class="packList">${pk.levels.map((l, i) => `<div class="packItem"><span class="num">${i + 1}</span><canvas width="120" height="54"></canvas><span>${l.magnet ? icon('magnet', 'mag') : ''}${esc(l.name)}</span></div>`).join('')}</div>
        <div class="atInfo">
          <h3>${icon('pack')}${esc(pk.name)}</h3>
          <p class="by">${icon('user')}${esc(pk.author.name)} · ${pk.levels.length} bölüm ${counts(pk.likes, pk.plays, 'lk')}</p>
          ${pk.about ? `<p>${esc(pk.about)}</p>` : ''}
          <button id="playLocal" class="primary" ${pk.levels.length ? '' : 'disabled'}>AYNI KLAVYEDE OYNA</button>
          <button id="playOnline" ${pk.levels.length ? '' : 'disabled'}>Online odada oyna</button>
          <div class="row">
            <button id="likePk" class="${pk.liked ? 'on' : ''}">${likeLabel(pk.liked)}</button>
            <button id="sharePk">${icon('link')}Linki kopyala</button>
          </div>
          ${pk.mine ? `<div class="mineBox"><b>Senin paketin</b> ${visBadge(pk.visibility)}
            <div class="row"><button id="editPk">${icon('pencil')}Düzenle</button><button id="delPk" class="danger">${icon('trash')}Sil</button></div></div>`
          : `<button id="reportPk" class="link">${icon('flag')}Bildir</button>`}
          <p id="pkMsg" class="note"></p>
        </div>
      </div>`;
    body.querySelectorAll('.packItem canvas').forEach((c, i) => drawLevelThumb(c, pk.levels[i].map));
    body.querySelector('.back').onclick = () => this.render();
    $('playLocal').onclick = () => this.playLevel(pk.levels[0], pk, 0, 'local');
    $('playOnline').onclick = () => this.playLevel(pk.levels[0], pk, 0, 'online');
    $('likePk').onclick = async () => {
      if (!this.me) return this.needLogin(`/?p=${pk.id}`);
      const x = await this.api('POST', `/api/packs/${pk.id}/like`, {});
      if (x.ok) { $('lk').textContent = x.json.likes; $('likePk').innerHTML = likeLabel(x.json.liked); $('likePk').classList.toggle('on', x.json.liked); }
    };
    $('sharePk').onclick = () => this.copy(`${location.origin}/?p=${pk.id}`, $('sharePk'));
    if ($('reportPk')) $('reportPk').onclick = () => this.report(`/api/packs/${pk.id}/report`, `/?p=${pk.id}`);
    if (pk.mine) {
      $('editPk').onclick = async () => {
        const lv = await this.api('GET', '/api/levels/mine');
        this.packBuilder(pk, lv.json.items || []);
      };
      $('delPk').onclick = async () => {
        if (!confirm(`"${pk.name}" paketi silinsin mi? Bölümler silinmez.`)) return;
        const x = await this.api('DELETE', `/api/packs/${pk.id}`, {});
        if (x.ok) this.setTab('mine'); else $('pkMsg').textContent = x.json.error;
      };
    }
  },

  // Kendi bölümlerinden sırayla seçerek paket oluştur ya da düzenle
  packBuilder(pk, myLevels) {
    const body = $('atBody');
    let order = pk ? pk.levels.map(l => l.id).filter(id => myLevels.some(l => l.id === id)) : [];
    body.innerHTML = `<button class="link back">${icon('back')}Geri</button>
      <h3 class="pageTitle">${icon('pack')}${pk ? 'Paketi düzenle' : 'Yeni paket'}</h3>
      <div class="packForm">
        <label class="field"><span>Paketin adı</span><input id="pkName" maxlength="24" placeholder="Örn. Hurdalık macerası" value="${pk ? esc(pk.name) : ''}"></label>
        <label class="field"><span>Kısa açıklama <em>isteğe bağlı</em></span><input id="pkAbout" maxlength="140" placeholder="Oyunculara ne bekliyor?" value="${pk ? esc(pk.about || '') : ''}"></label>
        <div class="field"><span>Kimler görebilir?</span><select id="pkVis">${visOptions(pk ? pk.visibility : 'private')}</select></div>
      </div>
      <section>
        ${secHead('Bölümleri seç', `<span id="pkCount">0</span> / 30`)}
        <p class="small">Oynanma sırasına göre tıkla; tekrar tıklayınca çıkar. Gizli bölümler de pakette oynanabilir.</p>
        <div class="atGrid" id="pkPick"></div>
      </section>
      <div class="formFoot"><p id="pkMsg" class="error"></p><button id="pkSave" class="primary small">${icon('check')}${pk ? 'Kaydet' : 'Paketi oluştur'}</button></div>`;
    enhanceSelects(body);
    body.querySelector('.back').onclick = () => (pk ? this.openPack(pk.id) : this.setTab('mine'));
    const draw = () => {
      const grid = $('pkPick');
      grid.innerHTML = '';
      $('pkCount').textContent = order.length;
      if (!myLevels.length) grid.innerHTML = emptyBox('pencil', 'Pakete koyacak bölümün yok. Önce editörde bölüm yapıp kaydet.', `<button id="pkToEditor" class="small">${icon('pencil')}Editörü aç</button>`);
      if ($('pkToEditor')) $('pkToEditor').onclick = () => toEditor();
      for (const l of myLevels) {
        const el = this.card(l, false), at = order.indexOf(l.id);
        el.classList.toggle('picked', at >= 0);
        if (at >= 0) el.insertAdjacentHTML('afterbegin', `<span class="pickNum">${at + 1}</span>`);
        el.onclick = () => { order = at >= 0 ? order.filter(x => x !== l.id) : order.concat(l.id); draw(); };
        grid.appendChild(el);
      }
    };
    draw();
    $('pkSave').onclick = async () => {
      const payload = { name: $('pkName').value, about: $('pkAbout').value, visibility: $('pkVis').value, levelIds: order };
      const x = pk ? await this.api('PUT', `/api/packs/${pk.id}`, payload) : await this.api('POST', '/api/packs', payload);
      if (x.ok) this.openPack(x.json.id); else $('pkMsg').textContent = x.json.error;
    };
  },

  // ---------- Oynama ----------

  defOf(l) { return { name: l.name, magnet: l.magnet, map: l.map }; },

  playLevel(level, pack, index, how) {
    this.play = { level, pack, index };
    if (how === 'online') {
      // Paket online'da sırayla oynanır: sunucuya bütün bölümler kuyruk olarak gider
      const queue = pack ? pack.levels.map(l => this.defOf(l)) : [this.defOf(level)];
      pendingCustom = { def: queue[0], queue, packName: pack ? pack.name : null };
      customSent = false;
      toOnlineForm();
      $('onlineError').textContent = pack ? `Oda kur: "${pack.name}" paketi odada yıldızla işaretli çıkacak.` : 'Oda kur: bölüm odada yıldızla işaretli çıkacak.';
      return;
    }
    startCustom(this.defOf(level), this.play);
  },

  // Bölüm bitince: oynanma sayısını bildir, beğeni düğmesini göster
  onComplete() {
    const p = this.play;
    if (!p) return;
    this.api('POST', `/api/levels/${p.level.id}/play`, {});
    if (p.pack && p.index === p.pack.levels.length - 1) this.api('POST', `/api/packs/${p.pack.id}/play`, {});
    const btn = $('likeBtn');
    btn.classList.remove('hidden');
    btn.innerHTML = likeLabel(p.level.liked, true);
    btn.onclick = async () => {
      if (!this.me) return this.needLogin(p.pack ? `/?p=${p.pack.id}` : `/?b=${p.level.id}`);
      const x = await this.api('POST', `/api/levels/${p.level.id}/like`, {});
      if (x.ok) { p.level.liked = x.json.liked; btn.innerHTML = likeLabel(x.json.liked, true); }
    };
  },

  hasNext() { const p = this.play; return !!(p && p.pack && p.index < p.pack.levels.length - 1); },

  next() {
    const p = this.play;
    if (this.hasNext()) this.playLevel(p.pack.levels[p.index + 1], p.pack, p.index + 1, 'local');
    else this.back();
  },

  back() {
    const p = this.play;
    this.play = null;
    if (p && p.pack) this.openPack(p.pack.id); else if (p) this.openLevel(p.level.id); else this.open();
  },

  // ---------- Küçük yardımcılar ----------

  async needLogin(next) {
    if (!this.loginEnabled) await this.loadMe();   // sayfa, giriş açılmadan önce yüklenmiş olabilir
    if (this.me) return;
    if (!this.loginEnabled) { alert('Bu sunucuda giriş kapalı.'); return; }
    if (confirm('Bunun için Google ile giriş yapman gerekiyor. Şimdi giriş yapılsın mı?')) this.login(next);
  },

  async report(path, next) {
    if (!this.me) return this.needLogin(next);
    if (!confirm('Bu içeriği uygunsuz olarak bildirmek istiyor musun?')) return;
    const x = await this.api('POST', path, {});
    alert(x.ok ? 'Teşekkürler, bildirimin alındı.' : x.json.error);
  },

  async copy(text, btn) {
    try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = 'Kopyalandı!'; setTimeout(() => { btn.textContent = t; }, 1500); }
    catch (e) { prompt('Link:', text); }
  },

  // ---------- Editörden kaydetme ----------

  async saveFromEditor() {
    const msg = $('edSaveMsg');
    if (!this.available()) { msg.textContent = 'Kaydetmek için oyunu sunucudan aç.'; return; }
    if (!this.me) { await this.needLogin('/?editor=1'); if (!this.me) return; }
    const body = Object.assign(Editor.def(), { visibility: $('edVis').value });
    msg.textContent = 'Kaydediliyor…';
    const r = Editor.remote
      ? await this.api('PUT', `/api/levels/${Editor.remote.id}`, body)
      : await this.api('POST', '/api/levels', body);
    if (r.status === 404 && Editor.remote) { Editor.setRemote(null); return this.saveFromEditor(); }   // silinmişse yeniden oluştur
    if (!r.ok) { msg.textContent = r.json.error || 'Kaydedilemedi.'; return; }
    Editor.setRemote({ id: r.json.id, visibility: r.json.visibility });
    msg.innerHTML = `${icon('check')}Kaydedildi · ${visBadge(r.json.visibility)}`;
  },
};

// ---------- Bağlantılar ----------

$('homeAtolye').addEventListener('click', () => Atolye.open('new'));
$('atClose').addEventListener('click', () => toHome());
for (const b of document.querySelectorAll('#atTabs button')) b.addEventListener('click', () => Atolye.setTab(b.dataset.tab));
let atSearchT = null;
$('atSearch').addEventListener('input', () => {
  clearTimeout(atSearchT);
  atSearchT = setTimeout(() => { Atolye.q = $('atSearch').value.trim(); Atolye.render(); }, 300);
});
$('edSave').addEventListener('click', () => Atolye.saveFromEditor());
document.addEventListener('click', e => {
  const menu = $('meMenu');
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('#account')) menu.classList.add('hidden');
});
