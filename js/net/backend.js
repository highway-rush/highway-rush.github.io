// Подключение к базе данных для онлайна.
// Firebase (Realtime Database + Anonymous Auth) загружается из CDN только при входе в «Онлайн»,
// поэтому одиночные режимы работают без интернета.
// Для разработки есть локальный вариант: адрес ...?net=local (вкладки одного браузера играют друг с другом).
import { firebaseConfig } from '../firebase-config.js';

const FB_VERSION = '10.14.1';
const FB = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;

export class NetError extends Error {
  constructor(code, cause) { super(code); this.code = code; this.cause = cause; }
}

export function withTimeout(promise, ms, code = 'offline') {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new NetError(code)), ms); }),
  ]);
}

// Перевести любую ошибку в понятный код: offline | denied | notConfigured | ...
export function errorCode(e) {
  if (e instanceof NetError) return e.code;
  const s = String((e && (e.code || e.message)) || e).toLowerCase();
  if (s.includes('permission') || s.includes('denied')) return 'denied';
  if (s.includes('network') || s.includes('offline') || s.includes('unavailable')) return 'offline';
  return 'unknown';
}

let cached = null;

export async function getBackend() {
  if (cached) return cached;
  const params = new URLSearchParams(location.search);
  let backend;
  if (params.get('net') === 'local') {
    const { LocalBackend } = await import('./local-db.js');
    backend = new LocalBackend({ lag: Number(params.get('lag')) || 0 });
  } else {
    if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) throw new NetError('notConfigured');
    if (navigator.onLine === false) throw new NetError('offline');
    backend = new FirebaseBackend();
  }
  await withTimeout(backend.init(), 15000);
  cached = backend;
  return backend;
}

class FirebaseBackend {
  async init() {
    let appM, authM, dbM;
    try {
      [appM, authM, dbM] = await Promise.all([
        import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-database.js'),
      ]);
    } catch (e) { throw new NetError('offline', e); }
    this.m = dbM;
    const app = appM.getApps().find((a) => a.name === 'hr-online') || appM.initializeApp(firebaseConfig, 'hr-online');
    // Вход в памяти: у каждой вкладки свой анонимный игрок (удобно играть в двух вкладках)
    let auth;
    try { auth = authM.initializeAuth(app, { persistence: authM.inMemoryPersistence }); } catch (_) { auth = authM.getAuth(app); }
    try {
      const cred = auth.currentUser ? { user: auth.currentUser } : await authM.signInAnonymously(auth);
      this.uid = cred.user.uid;
    } catch (e) {
      const c = String(e && e.code);
      throw new NetError(c.includes('network') ? 'offline' : c.includes('operation-not-allowed') || c.includes('admin-restricted') ? 'authDisabled' : 'authFailed', e);
    }
    this.db = dbM.getDatabase(app);
    this.offset = 0;
    this.connected = true;
    this.onConnection = null;
    dbM.onValue(dbM.ref(this.db, '.info/serverTimeOffset'), (s) => { this.offset = s.val() || 0; });
    let first = true;
    dbM.onValue(dbM.ref(this.db, '.info/connected'), (s) => {
      const c = !!s.val();
      if (first && !c) { first = false; return; } // в самом начале всегда приходит false
      first = false;
      this.connected = c;
      if (this.onConnection) this.onConnection(c);
    });
  }

  serverNow() { return Date.now() + this.offset; }
  serverTimestamp() { return this.m.serverTimestamp(); }
  r(path) { return this.m.ref(this.db, path); }
  async get(path) { return (await this.m.get(this.r(path))).val(); }
  set(path, v) { return this.m.set(this.r(path), v); }
  update(path, obj) { return this.m.update(this.r(path), obj); }
  remove(path) { return this.m.remove(this.r(path)); }
  listen(path, cb, onError) {
    return this.m.onValue(this.r(path), (s) => cb(s.val()), (err) => onError && onError(err));
  }
  async transaction(path, fn) {
    const res = await this.m.runTransaction(this.r(path), fn, { applyLocally: false });
    return { committed: res.committed, value: res.snapshot.val() };
  }
  onDisconnectRemove(path) { return this.m.onDisconnect(this.r(path)).remove(); }
  cancelOnDisconnect(path) { return this.m.onDisconnect(this.r(path)).cancel(); }
}
