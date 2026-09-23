/* In-memory stand-in for the slice of the Firestore Admin API the ledger
   code uses: doc refs, equality queries, and runTransaction with writes
   buffered until commit (as Firestore does). Not a general emulator. */
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
      set: async (d, opts) => { colMap(col).set(id, structuredClone(opts?.merge ? { ...(colMap(col).get(id) || {}), ...d } : d)); },
      update: async (d) => applyUpdate(col, id, d),
      delete: async () => { colMap(col).delete(id); },
    };
  }

  function applyUpdate(col, id, d) {
    if (!colMap(col).has(id)) throw new Error(`NOT_FOUND ${col}/${id}`);
    const cur = colMap(col).get(id);
    for (const [k, v] of Object.entries(d)) {
      if (k.includes('.')) {
        const [a, b] = k.split('.');
        cur[a] = { ...(cur[a] || {}), [b]: v };
      } else cur[k] = v;
    }
  }

  function query(col, filters = [], order = null) {
    return {
      kind: 'query',
      where: (f, op, v) => {
        if (!['==', 'array-contains', '>', '>=', '<', '<='].includes(op)) throw new Error(`fake: unsupported op ${op}`);
        return query(col, [...filters, [f, op, v]], order);
      },
      orderBy: (field, dir = 'asc') => query(col, filters, [field, dir]),
      select: () => query(col, filters, order),
      limit: () => query(col, filters, order),
      get: async () => runQuery(col, filters, order),
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

  function runQuery(col, filters, order) {
    let entries = [...colMap(col).entries()].filter(([, d]) => filters.every((flt) => matches(d, flt)));
    if (order) {
      const [field, dir] = order;
      entries = entries.sort(([, a], [, b]) => (String(a[field] ?? '') < String(b[field] ?? '') ? -1 : 1) * (dir === 'desc' ? -1 : 1));
    }
    const docs = entries.map(([id]) => snapOf(col, id));
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  return {
    store,
    collection: (col) => ({
      ...query(col),
      doc: (id = `auto${++autoId}`) => docRef(col, id),
    }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (target) => (target.kind === 'doc' ? target.get() : target.get()),
        set: (ref, d) => { writes.push(() => colMap(ref.col).set(ref.id, structuredClone(d))); },
        update: (ref, d) => { writes.push(() => applyUpdate(ref.col, ref.id, d)); },
      };
      const result = await fn(tx);
      for (const w of writes) w();
      return result;
    },
  };
}
