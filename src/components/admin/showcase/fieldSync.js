/* Optimistic saves, one field at a time.

   Every change is shown at once (apply), then sent. Changes to the SAME
   field (e.g. "necklace.isActive" toggled twice quickly) are sent one
   after another, so the server applies them in the order they were made.
   A failure puts the field back to the last value the server accepted —
   but only when no newer change to that field is still on its way (that
   newer change decides the final value). Fields never wait for each
   other, and a response never overwrites what is on screen. */
export function createFieldSync() {
  const fields = new Map(); // name -> { tail, inFlight, confirmed }

  /**
   * @param {string} name      field id, e.g. `${key}.isActive` or 'order'
   * @param {{ current: any, next: any, apply: (v: any) => void, send: () => Promise<any>, onRevert?: (err: Error) => void }} op
   * @returns {Promise<boolean>} true when saved, false when it failed
   */
  return function run(name, { current, next, apply, send, onRevert }) {
    let f = fields.get(name);
    if (!f) { f = { tail: Promise.resolve(), inFlight: 0, confirmed: current }; fields.set(name, f); }
    /* Nothing pending: what is on screen is what the server has. */
    if (f.inFlight === 0) f.confirmed = current;
    f.inFlight += 1;
    apply(next);
    const task = f.tail
      .then(send)
      .then(
        () => { f.confirmed = next; return true; },
        (err) => {
          if (f.inFlight === 1) { apply(f.confirmed); onRevert?.(err); }
          return false;
        },
      )
      .finally(() => { f.inFlight -= 1; });
    f.tail = task;
    return task;
  };
}
