class ZEventEmitter {
  constructor() {
    this.listeners = {};
  }
  on(k, fn) {
    let ls = this.listeners[k];
    if (!ls) {
      ls = [];
      this.listeners[k] = ls;
    }
    ls.push(fn);
  }
  once(k, fn) {
    this.on(k, fn);
    
    const fn2 = () => {
      this.off(k, fn);
      this.off(k, fn2);
    };
    this.on(k, fn2);
  }
  off(k, fn) {
    const ls = this.listeners[k];
    if (ls) {
      for (;;) {
        const index = ls.indexOf(fn);
        if (index !== -1) {
          ls.splice(index, 1);
        } else {
          break;
        }
      }
    }
  }
  dispatchEvent(k, a, b, c, d) {
    const listeners = this.listeners[k];
    if (listeners) {
      for (const fn of listeners) {
        fn(a, b, c, d);
      }
    }
  }
}

class TransactionCache {
  constructor(origin) {
    this.origin = origin;
    this.queue = [];
  }
  flush() {
    for (const fn of this.queue) {
      fn(origin);
    }
  }
  getUpdate() {
    const uint8Array = new Uint8Array();
    // XXX
    return uint8Array;
  }
}

class ZDoc extends ZEventEmitter {
  constructor() {
    super();

    this.state = {};
    this.transactionCache = null;
  }
  get(k, Type) {
    let binding = this.state[k];
    if (binding === undefined) {
      binding = Type.nativeConstructor();
      this.state[k] = binding;
    }
    return new Type(binding);
  }
  getArray(k) {
    return this.get(k, ZArray);
  }
  getMap(k) {
    return this.get(k, ZMap);
  }
  startTransaction(origin) {
    if (!this.transactionCache) {
      this.transactionCache = new TransactionCache(origin);
    } else {
      throw new Error('recursive transaction');
    }
  }
  finishTransaction() {
    this.transactionCache.flush();
    const uint8Array = this.transactionCache.getUpdate();
    if (uint8Array) {
      this.dispatchEvent('update', uint8Array, origin, this, null);
    }
    this.transactionCache = null;
  }
  transact(fn, origin) {
    this.startTransaction(origin);
    fn();
    this.finishTransaction();
  }
}

class ZObservable {
  constructor(binding) {
    this.binding = binding;
    this.observers = [];
  }
  observe(fn) {
    this.observers.push(fn);
  }
  unobserve(fn) {
    const index = this.observers.indexOf(fn);
    if (index !== -1) {
      this.observers.splice(index, 1);
    }
  }
  triggerChange(e) {
    // XXX queue this
    const observers = this.observers.slice();
    for (const observer of observers) {
      observer(e);
    }
  }
  toJSON() {
    return this.binding;
  }
}

class ZMap extends ZObservable {
  constructor(binding) {
    super(binding);
  }
  static nativeConstructor = () => ({});
  has(k) {
    return k in this.binding;
  }
  get(k) {
    return this.binding[k];
  }
  set(k, v) {
    this.binding[k] = v;
    this.triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  delete(k) {
    delete this.binding[k];
    this.triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  keys() {
    const keys = Object.keys(this.binding);
    let i = 0;
    const next = () => {
      if (i < keys.length) {
        const key = keys[i++];
        return {
          done: false,
          value: key,
        };
      } else {
        return {
          done: true,
          value: null,
        };
      }
    };
    return {
      next,
      [Symbol.iterator]: () => ({next}),
    };
  }
  values() {
    const keys = Object.keys(this.binding);
    let i = 0;
    const next = () => {
      if (i < keys.length) {
        const key = keys[i++];
        const value = this.get(key);
        return {
          done: false,
          value,
        };
      } else {
        return {
          done: true,
          value: null,
        };
      }
    };
    return {
      next,
      [Symbol.iterator]: () => ({next}),
    };
  }
  entries() {
    const keys = Object.keys(this.binding);
    let i = 0;
    const next = () => {
      if (i < keys.length) {
        const key = keys[i++];
        const value = this.get(key);
        return {
          done: false,
          value: [key, value],
        };
      } else {
        return {
          done: false,
          value: null,
        };
      }
    };
    return {
      next,
      [Symbol.iterator]: () => ({next}),
    };
  }
}

class ZArray extends ZObservable {
  constructor(binding) {
    super(binding);
  }
  static nativeConstructor = () => [];
  get length() {
    return this.binding.length;
  }
  set length(length) {
    this.binding.length = length;
  }
  get(index) {
    return this.binding[index];
  }
  insert(index, arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    this.binding.splice.apply(this.binding, [index, 0].concat(arr));
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  delete(index, length = 1) {
    if (length !== 1) {
      throw new Error('only length 1 is supported');
    }
    this.binding.splice(index, length);
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  push(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    this.binding.push.apply(this.binding, arr);
    this.triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  unshift(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    this.binding.unshift.apply(this.binding, arr);
    this.triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  [Symbol.Iterator] = () => {
    let i = 0;
    return {
      next: () => {
        if (i < this.length) {
          return {
            done: false,
            value: this.get(i++),
          };
        } else {
          return {
            done: true,
            value: null,
          };
        }
      },
    };
  }
}

function applyUpdate(zdoc, uint8Array, transactionOrigin) {
  // XXX
}

function encodeStateAsUpdate(doc) {
  const uint8Array = new Uint8Array();
  // XXX
  return uint8Array;
}

const Z = {
  Doc: ZDoc,
  Map: ZMap,
  Array: ZArray,
  applyUpdate,
  encodeStateAsUpdate,
};
export default Z;