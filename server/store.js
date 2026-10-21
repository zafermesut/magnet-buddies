'use strict';

// Atölye veri deposu: tek bir JSON dosyası, bellekte tutulur, değişince güvenle diske yazılır.
// Yazma önce geçici dosyaya yapılır, sonra adı değiştirilir: elektrik kesilse bile dosya yarım kalmaz.
// Binlerce bölüme kadar yeter; büyürse aynı arayüzle gerçek bir veritabanına geçilir.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = () => ({ version: 1, users: {}, sessions: {}, levels: {}, packs: {}, likes: {}, reports: {} });

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'atolye.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = EMPTY();
    if (fs.existsSync(this.file)) {
      this.data = Object.assign(EMPTY(), JSON.parse(fs.readFileSync(this.file, 'utf8')));
    }
    this.timer = null;
    this.backupDaily();
  }

  // Değişiklikler toplanıp kısa aralıkla tek seferde yazılır
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // Günde bir kez yedek: atolye-YYYY-MM-DD.json (son 14 gün tutulur)
  backupDaily() {
    const tick = () => {
      if (!fs.existsSync(this.file)) return;
      const day = new Date().toISOString().slice(0, 10);
      const dest = path.join(this.dir, `atolye-${day}.json`);
      if (!fs.existsSync(dest)) fs.copyFileSync(this.file, dest);
      const old = fs.readdirSync(this.dir).filter(f => /^atolye-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
      for (const f of old) fs.unlinkSync(path.join(this.dir, f));
    };
    tick();
    setInterval(tick, 3600 * 1000).unref();
  }

  static id(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(len);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  static hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
}

module.exports = { Store };
