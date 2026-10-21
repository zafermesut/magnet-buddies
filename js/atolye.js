'use strict';

// Atölye: oyuncuların bölümleri ve paketleri. Gezmek ve oynamak hesapsız; kaydetmek, yayınlamak,
// beğenmek ve bildirmek için Google ile giriş. Sunucu tarafı: server/atolye.js

const VIS_LABELS = { private: '🔒 Gizli', link: '🔗 Linkle', public: '🌍 Herkese açık' };

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
    if (r.ok) { this.me = r.json.user; this.loginEnabled = r.json.loginEnabled; }
    this.renderAccount();
  },

  // Google'a gidip geri dönünce kaldığın yere döner (editördeki taslak tarayıcıda saklı kalır)
  login(next) {
    location.href = '/auth/google?next=' + encodeURIComponent(next || location.pathname + location.search);
  },

  async logout() {
    await this.api('POST', '/auth/logout', {});
    this.me = null;
    this.renderAccount();
    if (state === 'atolye') this.render();
  },

  // Menülerde sol üstte: giriş düğmesi ya da ad + resim
  renderAccount() {
    const el = $('account');
    const visible = this.loginEnabled && (MENU_STATES.has(state) || state === 'atolye');
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (!this.me) {
      el.innerHTML = '<button id="loginBtn" class="google">G&nbsp; Google ile giriş</button>';
      $('loginBtn').onclick = () => this.login();
      return;
    }
    const av = this.me.avatar ? `<img src="${esc(this.me.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="noav">${esc(this.me.name[0] || '?')}</span>`;
    el.innerHTML = `<button id="meBtn">${av}<span>${esc(this.me.name)}</span> ▾</button>
      <div id="meMenu" class="panel hidden"><button id="renameBtn">Adımı değiştir</button><button id="logoutBtn">Çıkış yap</button></div>`;
    $('meBtn').onclick = () => $('meMenu').classList.toggle('hidden');
    $('renameBtn').onclick = async () => {
      const name = prompt('Atölye\'de görünecek adın:', this.me.name);
      if (!name) return;
      const r = await this.api('POST', '/api/me', { name });
      if (r.ok) { this.me = r.json.user; this.renderAccount(); } else alert(r.json.error);
    };
    $('logoutBtn').onclick = () => this.logout();
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
      body.innerHTML = `<p class="small">${this.q ? 'Aramana uyan bir şey bulamadım.' : packs ? 'Henüz paylaşılmış paket yok. İlk paketi sen yap!' : 'Henüz paylaşılmış bölüm yok. Editörde bir bölüm yapıp herkese açık kaydet!'}</p>`;
      return;
    }
    body.innerHTML = '<div class="atGrid"></div>';
    for (const it of r.json.items) body.firstChild.appendChild(this.card(it, packs));
  },

  card(it, isPack) {
    const el = document.createElement('button');
    el.className = 'atCard';
    el.innerHTML = `<canvas width="240" height="110"></canvas>
      <b>${it.magnet ? '🧲 ' : ''}${isPack ? '📦 ' : ''}${esc(it.name)}</b>
      <span class="by">${esc(it.author.name)}${isPack ? ` · ${it.count} bölüm` : ''}</span>
      <span class="stats">❤ ${it.likes} · ▶ ${it.plays}${it.mine ? ` · ${VIS_LABELS[it.visibility]}` : ''}</span>`;
    drawLevelThumb(el.querySelector('canvas'), isPack ? it.cover : it.map);
    el.onclick = () => (isPack ? this.openPack(it.id) : this.openLevel(it.id));
    return el;
  },

  async renderMine() {
    const body = $('atBody');
    if (!this.me) {
      body.innerHTML = `<div class="atEmpty"><p>Bölümlerini kaydetmek ve her cihazdan görmek için giriş yap.</p>
        ${this.loginEnabled ? '<button id="mineLogin" class="google">G&nbsp; Google ile giriş</button>' : '<p class="note">Bu sunucuda giriş kapalı.</p>'}</div>`;
      if ($('mineLogin')) $('mineLogin').onclick = () => this.login('/?atolye=mine');
      return;
    }
    const [lv, pk] = await Promise.all([this.api('GET', '/api/levels/mine'), this.api('GET', '/api/packs/mine')]);
    body.innerHTML = `<div class="atActions"><button id="newLevel" class="primary">+ YENİ BÖLÜM</button><button id="newPack">📦 Paket oluştur</button></div>
      <h3>Bölümlerim (${lv.json.items ? lv.json.items.length : 0})</h3><div class="atGrid" id="mineLevels"></div>
      <h3>Paketlerim (${pk.json.items ? pk.json.items.length : 0})</h3><div class="atGrid" id="minePacks"></div>`;
    $('newLevel').onclick = () => { Editor.load(blankLevel(), null); Editor.refresh(); toEditor(); };
    $('newPack').onclick = () => this.packBuilder(null, lv.json.items || []);
    for (const it of lv.json.items || []) $('mineLevels').appendChild(this.card(it, false));
    for (const it of pk.json.items || []) $('minePacks').appendChild(this.card(it, true));
    if (!(lv.json.items || []).length) $('mineLevels').innerHTML = '<p class="small">Henüz kayıtlı bölümün yok. Editörde yapıp "Kaydet"e bas.</p>';
  },

  // ---------- Bölüm sayfası ----------

  async openLevel(id) {
    if (state !== 'atolye') this.open();
    const body = $('atBody');
    body.innerHTML = '<p class="small">Yükleniyor…</p>';
    const r = await this.api('GET', `/api/levels/${id}`);
    if (!r.ok) { body.innerHTML = `<p class="error">${esc(r.json.error || 'Bölüm açılamadı.')}</p>`; return; }
    const l = r.json;
    body.innerHTML = `<button class="link back">← Geri</button>
      <div class="atDetail">
        <canvas width="520" height="240"></canvas>
        <div class="atInfo">
          <h3>${l.magnet ? '🧲 ' : ''}${esc(l.name)}</h3>
          <p class="by">${esc(l.author.name)} · ❤ <span id="lk">${l.likes}</span> · ▶ ${l.plays}${l.hidden ? ' · <span class="error">bildirildiği için listeden kaldırıldı</span>' : ''}</p>
          <button id="playLocal" class="primary">AYNI KLAVYEDE OYNA</button>
          <button id="playOnline">Online odada oyna</button>
          <div class="row">
            <button id="likeLv" class="${l.liked ? 'on' : ''}">${l.liked ? '❤ Beğendin' : '♡ Beğen'}</button>
            <button id="shareLv">🔗 Linki kopyala</button>
          </div>
          <div class="row">
            <button id="copyLv">Editörde kopyasını aç</button>
            ${l.mine ? '' : '<button id="reportLv" class="link">Bildir</button>'}
          </div>
          ${l.mine ? `<div class="mineBox"><b>Senin bölümün</b>
            <select id="visLv">${Object.entries(VIS_LABELS).map(([k, v]) => `<option value="${k}" ${k === l.visibility ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <div class="row"><button id="editLv">✏️ Düzenle</button><button id="delLv" class="danger">Sil</button></div></div>` : ''}
          <p id="lvMsg" class="note"></p>
        </div>
      </div>`;
    drawLevelThumb(body.querySelector('canvas'), l.map);
    const def = { name: l.name, magnet: l.magnet, map: l.map };
    body.querySelector('.back').onclick = () => this.render();
    $('playLocal').onclick = () => this.playLevel(l, null, 0, 'local');
    $('playOnline').onclick = () => this.playLevel(l, null, 0, 'online');
    $('likeLv').onclick = async () => {
      if (!this.me) return this.needLogin(`/?b=${l.id}`);
      const x = await this.api('POST', `/api/levels/${l.id}/like`, {});
      if (x.ok) { $('lk').textContent = x.json.likes; $('likeLv').textContent = x.json.liked ? '❤ Beğendin' : '♡ Beğen'; $('likeLv').classList.toggle('on', x.json.liked); }
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
    body.innerHTML = `<button class="link back">← Geri</button>
      <div class="atDetail">
        <div class="packList">${pk.levels.map((l, i) => `<div class="packItem"><span class="num">${i + 1}</span><canvas width="120" height="54"></canvas><span>${l.magnet ? '🧲 ' : ''}${esc(l.name)}</span></div>`).join('')}</div>
        <div class="atInfo">
          <h3>📦 ${esc(pk.name)}</h3>
          <p class="by">${esc(pk.author.name)} · ${pk.levels.length} bölüm · ❤ <span id="lk">${pk.likes}</span> · ▶ ${pk.plays}</p>
          ${pk.about ? `<p>${esc(pk.about)}</p>` : ''}
          <button id="playLocal" class="primary" ${pk.levels.length ? '' : 'disabled'}>AYNI KLAVYEDE OYNA</button>
          <button id="playOnline" ${pk.levels.length ? '' : 'disabled'}>Online odada oyna</button>
          <div class="row">
            <button id="likePk" class="${pk.liked ? 'on' : ''}">${pk.liked ? '❤ Beğendin' : '♡ Beğen'}</button>
            <button id="sharePk">🔗 Linki kopyala</button>
          </div>
          ${pk.mine ? `<div class="mineBox"><b>Senin paketin</b> · ${VIS_LABELS[pk.visibility]}
            <div class="row"><button id="editPk">✏️ Düzenle</button><button id="delPk" class="danger">Sil</button></div></div>`
          : '<button id="reportPk" class="link">Bildir</button>'}
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
      if (x.ok) { $('lk').textContent = x.json.likes; $('likePk').textContent = x.json.liked ? '❤ Beğendin' : '♡ Beğen'; $('likePk').classList.toggle('on', x.json.liked); }
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
    body.innerHTML = `<button class="link back">← Geri</button>
      <h3>${pk ? 'Paketi düzenle' : 'Yeni paket'}</h3>
      <div class="packForm">
        <input id="pkName" maxlength="24" placeholder="Paketin adı" value="${pk ? esc(pk.name) : ''}">
        <input id="pkAbout" maxlength="140" placeholder="Kısa açıklama (isteğe bağlı)" value="${pk ? esc(pk.about || '') : ''}">
        <select id="pkVis">${Object.entries(VIS_LABELS).map(([k, v]) => `<option value="${k}" ${pk && pk.visibility === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <p class="small">Bölümlere tıklayarak oynanma sırasına göre seç (en fazla 30). Gizli bölümler de pakette oynanabilir.</p>
      <div class="atGrid" id="pkPick"></div>
      <button id="pkSave" class="primary">${pk ? 'KAYDET' : 'PAKETİ OLUŞTUR'}</button>
      <p id="pkMsg" class="error"></p>`;
    body.querySelector('.back').onclick = () => (pk ? this.openPack(pk.id) : this.setTab('mine'));
    const draw = () => {
      const grid = $('pkPick');
      grid.innerHTML = '';
      if (!myLevels.length) grid.innerHTML = '<p class="small">Önce editörde bölüm yapıp kaydetmelisin.</p>';
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
      $('onlineError').textContent = pack ? `Oda kur: "${pack.name}" paketi odada ★ ile çıkacak.` : 'Oda kur: bölüm odada ★ ile çıkacak.';
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
    btn.textContent = p.level.liked ? '❤ Beğendin' : '♡ Bu bölümü beğen';
    btn.onclick = async () => {
      if (!this.me) return this.needLogin(p.pack ? `/?p=${p.pack.id}` : `/?b=${p.level.id}`);
      const x = await this.api('POST', `/api/levels/${p.level.id}/like`, {});
      if (x.ok) { p.level.liked = x.json.liked; btn.textContent = x.json.liked ? '❤ Beğendin' : '♡ Bu bölümü beğen'; }
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

  needLogin(next) {
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
    if (!this.me) return this.needLogin('/?editor=1');
    const body = Object.assign(Editor.def(), { visibility: $('edVis').value });
    msg.textContent = 'Kaydediliyor…';
    const r = Editor.remote
      ? await this.api('PUT', `/api/levels/${Editor.remote.id}`, body)
      : await this.api('POST', '/api/levels', body);
    if (r.status === 404 && Editor.remote) { Editor.setRemote(null); return this.saveFromEditor(); }   // silinmişse yeniden oluştur
    if (!r.ok) { msg.textContent = r.json.error || 'Kaydedilemedi.'; return; }
    Editor.setRemote({ id: r.json.id, visibility: r.json.visibility });
    msg.textContent = `Kaydedildi ✓ (${VIS_LABELS[r.json.visibility]})`;
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
