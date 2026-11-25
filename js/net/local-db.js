// Локальная «база данных» для разработки и проверки без Firebase.
// Открывается адресом ...?net=local. Все вкладки и окна одного браузера на этом же адресе
// видят одни и те же данные (синхронизация через BroadcastChannel).
// ?lag=120 — искусственная задержка сети в миллисекундах (с небольшим разбросом), чтобы проверить плавность.
// Повторяет только нужные игре функции Firebase: get/set/update/remove/listen/transaction/onDisconnect.

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const split = (p) => p.split('/').filter(Boolean);

function getAt(tree, path) {
  let n = tree;
  for (const k of split(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
  return n === undefined ? null : n;
}

function setAt(tree, path, value) {
  const keys = split(path);
  const stack = [];
  let n = tree;
  for (let i = 0; i < keys.length - 1; i++) {
    if (n[keys[i]] == null || typeof n[keys[i]] !== 'object') {
      if (value == null) return;
      n[keys[i]] = {};
    }
    stack.push([n, keys[i]]);
    n = n[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value == null) delete n[last]; else n[last] = value;
  // Пустые объекты удаляются, как в Firebase
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    if (parent[key] && typeof parent[key] === 'object' && !Object.keys(parent[key]).length) delete parent[key];
  }
}

const related = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

export class LocalBackend {
  constructor({ lag = 0 } = {}) {
    this.lag = lag;
    this.uid = 'L' + Math.random().toString(36).slice(2, 12);
    this.tree = {};
    this.listeners = new Set();
    this.disc = new Set();
    this.lastDelivery = 0;
    this.connected = true;
    this.onConnection = null;
  }

  async init() {
    this.ch = new BroadcastChannel('highway-rush-localdb');
    this.ch.onmessage = (e) => this.onMessage(e.data);
    this.ch.postMessage({ type: 'hello', from: this.uid });
    await new Promise((r) => setTimeout(r, 300));
    window.addEventListener('pagehide', () => this.runDisconnect());
  }

  onMessage(m) {
    if (m.type === 'hello') { this.ch.postMessage({ type: 'state', to: m.from, tree: this.tree }); return; }
    if (m.type === 'state') {
      if (m.to === this.uid && !this.synced) { this.synced = true; this.tree = m.tree || {}; this.notify(['']); }
      return;
    }
    if (m.type === 'ops') {
      if (!this.lag) return this.apply(m.ops);
      // Задержка с разбросом, но порядок сообщений сохраняется (как в настоящей базе)
      const now = performance.now();
      const at = Math.max(this.lastDelivery, now + this.lag * (0.6 + Math.random() * 0.8));
      this.lastDelivery = at;
      setTimeout(() => this.apply(m.ops), at - now);
    }
  }

  resolve(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      const o = Array.isArray(v) ? [] : {};
      for (const k in v) o[k] = this.resolve(v[k]);
      return o;
    }
    return v;
  }

  apply(ops) {
    for (const op of ops) setAt(this.tree, op.path, clone(op.value));
    this.notify(ops.map((o) => o.path));
  }

  write(ops) {
    ops = ops.map((o) => ({ path: split(o.path).join('/'), value: this.resolve(o.value) }));
    this.apply(ops);
    this.ch.postMessage({ type: 'ops', ops });
    return Promise.resolve();
  }

  notify(paths) {
    for (const l of this.listeners) {
      if (!paths.some((p) => p === '' || related(p, l.path))) continue;
      const json = JSON.stringify(getAt(this.tree, l.path));
      if (json === l.last) continue;
      l.last = json;
      queueMicrotask(() => { if (l.active) l.cb(JSON.parse(json)); });
    }
  }

  serverNow() { return Date.now(); }
  serverTimestamp() { return { '.sv': 'timestamp' }; }
  async get(path) { return clone(getAt(this.tree, path)); }
  set(path, v) { return this.write([{ path, value: v }]); }
  update(path, obj) { return this.write(Object.keys(obj).map((k) => ({ path: path + '/' + k, value: obj[k] }))); }
  remove(path) { return this.write([{ path, value: null }]); }
  listen(path, cb) {
    const l = { path: split(path).join('/'), cb, active: true, last: undefined };
    this.listeners.add(l);
    const json = JSON.stringify(getAt(this.tree, l.path));
    l.last = json;
    queueMicrotask(() => { if (l.active) cb(JSON.parse(json)); });
    return () => { l.active = false; this.listeners.delete(l); };
  }
  async transaction(path, fn) {
    const cur = clone(getAt(this.tree, path));
    const next = fn(cur);
    if (next === undefined) return { committed: false, value: cur };
    await this.set(path, next);
    return { committed: true, value: next };
  }
  onDisconnectRemove(path) { this.disc.add(path); return Promise.resolve(); }
  // Как в Firebase: отменяет действия для этого пути и всех вложенных
  cancelOnDisconnect(path) {
    for (const p of [...this.disc]) if (p === path || p.startsWith(path + '/')) this.disc.delete(p);
    return Promise.resolve();
  }
  runDisconnect() {
    if (!this.disc.size) return;
    this.write([...this.disc].map((path) => ({ path, value: null })));
    this.disc.clear();
  }
}
