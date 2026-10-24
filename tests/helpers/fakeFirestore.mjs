/* In-memory stand-in for the slice of the Firestore Admin API the server
   code uses: doc refs, equality/range queries with orderBy/startAfter/limit/count(),
   set(merge) deep merges, increments, batches and runTransaction with
   writes buffered until commit (as Firestore does). Not a general emulator. */
/* FieldValue.increment stand-in for tests that need real counters: mock
   FieldValue.increment as (n) => ({ [INC]: n }) and the fake adds it. */
export const INC = '__fakeInc';
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const isInc = (v) => isPlain(v) && Object.keys(v).length === 1 && INC in v;

/* Firestore semantics: set() replaces; set(merge) deep-merges maps; an
   increment adds to the current number (or starts from 0). */
function resolveIncrements(next, cur) {
  if (isInc(next)) return (typeof cur === 'number' ? cur : 0) + next[INC];
  if (!isPlain(next)) return next;
  const out = {};
  for (const [k, v] of Object.entries(next)) out[k] = resolveIncrements(v, isPlain(cur) ? cur[k] : undefined);
  return out;
}
function deepMerge(cur, next) {
  if (isInc(next)) return (typeof cur === 'number' ? cur : 0) + next[INC];
  if (!isPlain(next) || !isPlain(cur)) return resolveIncrements(next, cur);
  const out = { ...cur };
  for (const [k, v] of Object.entries(next)) out[k] = deepMerge(cur[k], v);
  return out;
}

export function fakeFirestore(seed = {}) {
  const store = new Map();
  for (const [col, docs] of Object.entries(seed)) store.set(col, new Map(Object.entries(docs).map(([id, d]) => [id, { ...d }])));
  let autoId = 0;
  const colMap = (col) => (store.has(col) ? store.get(col) : store.set(col, new Map()).get(col));

  const snapOf = (col, id) => {
    const data = colMap(col).get(id);
    return { id, exists: data !== undefined, ref: docRef(col, id), data: () => (data === undefined ? undefined : structuredClone(data)) };
  };

  function docRef(col, id) {
    return {
      kind: 'doc', col, id,
      get: async () => snapOf(col, id),
      set: async (d, opts) => { writeDoc(col, id, d, opts); },
      update: async (d) => applyUpdate(col, id, d),
      delete: async () => { colMap(col).delete(id); },
    };
  }

  function writeDoc(col, id, d, opts) {
    const cur = colMap(col).get(id);
    colMap(col).set(id, structuredClone(opts?.merge ? deepMerge(cur || {}, d) : resolveIncrements(d, undefined)));
  }

  function applyUpdate(col, id, d) {
    if (!colMap(col).has(id)) throw new Error(`NOT_FOUND ${col}/${id}`);
    const cur = colMap(col).get(id);
    for (const [k, v] of Object.entries(d)) {
      if (k.includes('.')) {
        const [a, b] = k.split('.');
        cur[a] = { ...(cur[a] || {}), [b]: resolveIncrements(v, cur[a]?.[b]) };
      } else cur[k] = resolveIncrements(v, cur[k]);
    }
  }

  /* orderBy('__name__') orders by document id (Firestore's FieldPath.documentId());
     startAfter(value) takes the orderBy field's value (the id for '__name__'). */
  function query(col, filters = [], order = null, max = Infinity, after = undefined) {
    return {
      kind: 'query',
      where: (f, op, v) => {
        if (!['==', 'array-contains', '>', '>=', '<', '<='].includes(op)) throw new Error(`fake: unsupported op ${op}`);
        return query(col, [...filters, [f, op, v]], order, max, after);
      },
      orderBy: (field, dir = 'asc') => query(col, filters, [field, dir], max, after),
      startAfter: (value) => {
        if (!order) throw new Error('fake: startAfter needs an orderBy');
        return query(col, filters, order, max, value);
      },
      select: () => query(col, filters, order, max, after),
      limit: (n) => query(col, filters, order, Number.isFinite(n) ? n : max, after),
      count: () => ({ get: async () => { const { size } = runQuery(col, filters, order, max, after); return { data: () => ({ count: size }) }; } }),
      get: async () => runQuery(col, filters, order, max, after),
    };
  }

  const matches = (d, [f, op, v]) => {
    if (op === '==') return d[f] === v;
    if (op === 'array-contains') return Array.isArray(d[f]) && d[f].includes(v);
    if (op === '>') return d[f] > v;
    if (op === '>=') return d[f] >= v;
    if (op === '<') return d[f] < v;
    return d[f] <= v;
  };

  function runQuery(col, filters, order, max = Infinity, after = undefined) {
    let entries = [...colMap(col).entries()].filter(([, d]) => filters.every((flt) => matches(d, flt)));
    if (order && order[0] === '__name__') {
      const desc = order[1] === 'desc';
      entries = entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0) * (desc ? -1 : 1));
      if (after !== undefined) entries = entries.filter(([id]) => (desc ? id < String(after) : id > String(after)));
    } else if (order) {
      const [field, dir] = order;
      entries = entries.sort(([, a], [, b]) => (String(a[field] ?? '') < String(b[field] ?? '') ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      if (after !== undefined) {
        const past = (v) => (dir === 'desc' ? String(v ?? '') < String(after) : String(v ?? '') > String(after));
        entries = entries.filter(([, d]) => past(d[field]));
      }
    }
    const docs = entries.slice(0, max).map(([id]) => snapOf(col, id));
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  return {
    store,
    collection: (col) => ({
      ...query(col),
      doc: (id = `auto${++autoId}`) => docRef(col, id),
      add: async (d) => { const ref = docRef(col, `auto${++autoId}`); await ref.set(d); return ref; },
    }),
    batch() {
      const writes = [];
      return {
        set: (ref, d, opts) => { writes.push(() => writeDoc(ref.col, ref.id, d, opts)); },
        update: (ref, d) => { writes.push(() => applyUpdate(ref.col, ref.id, d)); },
        delete: (ref) => { writes.push(() => colMap(ref.col).delete(ref.id)); },
        commit: async () => { for (const w of writes) w(); },
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (target) => (target.kind === 'doc' ? target.get() : target.get()),
        set: (ref, d, opts) => { writes.push(() => writeDoc(ref.col, ref.id, d, opts)); },
        update: (ref, d) => { writes.push(() => applyUpdate(ref.col, ref.id, d)); },
        delete: (ref) => { writes.push(() => colMap(ref.col).delete(ref.id)); },
      };
      const result = await fn(tx);
      for (const w of writes) w();
      return result;
    },
  };
}
