import {
  zbencode,
  zbdecode,
} from './encoding.mjs';
import {align4} from './util.mjs';

const MESSAGES = (() => {
  let iota = 0;
  return {
    STATE_RESET: ++iota,
    TRANSACTION: ++iota,
  };
})();
const EVENTS = (() => {
  let iota = 0;
  return {
    ARRAY_PUSH: ++iota,
  };
})();

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
  constructor(doc, origin) {
    this.doc = doc;
    this.origin = origin;
    this.events = [];
  }
  pushEvent(event) {
    this.events.push(event);
  }
  triggerEvents() {
    for (const event of this.events) {
      event.triggerObservers();
    }
  }
  serializeUpdate() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // clock
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // num events
    const updateByteLengths = this.events.map(event => {
      totalSize += Uint32Array.BYTES_PER_ELEMENT; // length
      const updateByteLength = events.computeUpdateByteLength();
      totalSize += updateByteLength;
      return updateByteLength;
    });
    
    const uint8Array = new Uint8Array(totalSize);
    const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    let index = 0;
    dataView.setUint32(index, MESSAGES.TRANSACTION, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    dataView.setUint32(index, this.doc.clock, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    dataView.setUint32(index, this.events.length, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      const updateByteLength = updateByteLengths[i];
      
      dataView.setUint32(index, updateByteLength, true);
      totalSize += Uint32Array.BYTES_PER_ELEMENT; // length
      
      events.serializeUpdate(new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, uint8Array.byteLength));
      totalSize += updateByteLength;
    }
    return uint8Array;
  }
}

const observersMap = new WeakMap();
class ZPushEvent {
  constructor(zArray, keyPath, arr) {
    this.zArray = zArray;
    this.keyPath = keyPath;
    this.arr = arr;
  }
  triggerObservers() {
    const observers = observersMap.get(this.zArray);
    if (observers) {
      for (const fn of observers) {
        fn(this);
      }
    }
  }
  apply() {
    this.zArray.binding.push.apply(this.zArray.binding, this.arr);
  }
}

class ZDoc extends ZEventEmitter {
  constructor() {
    super();

    this.state = {};
    this.clock = 0;
    this.transactionDepth = 0;
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
  pushTransaction(origin) {
    if (++this.transactionDepth === 1) {
      this.transactionCache = new TransactionCache(this, origin);
    }
  }
  popTransaction() {
    if (--this.transactionDepth === 0) {
      this.clock++;
      this.transactionCache.triggerEvents();
      const uint8Array = this.transactionCache.serializeUpdate();
      if (uint8Array) {
        this.dispatchEvent('update', uint8Array, this.transactionCache.origin, this, null);
      }
      this.transactionCache = null;
    }
  }
  transact(fn, origin) {
    this.pushTransaction(origin);
    fn();
    this.popTransaction();
  }
  setClockState(clock, state) {
    this.clock = clock;
    this.state = state; // XXX need to trigger observers
  }
}

class ZObservable {
  constructor(binding, keyPath, doc) {
    this.binding = binding;
    this.keyPath = keyPath;
    this.doc = doc;
  }
  observe(fn) {
    let observers = observersMap.get(this);
    if (!observers) {
      observers = [];
      observersMap.set(this, observers);
    }
    observers.push(fn);
  }
  unobserve(fn) {
    const observers = observersMap.get(this);
    if (observers) {
      const index = observers.indexOf(fn);
      if (index !== -1) {
        observers.splice(index, 1);
      }
    }
  }
  /* triggerChange(e) {
    // XXX queue this
    const observers = this.observers.slice();
    for (const observer of observers) {
      observer(e);
    }
  } */
  toJSON() {
    return this.binding;
  }
}

class ZMap extends ZObservable {
  constructor(binding = ZMap.nativeConstructor(), keyPath = [], doc = null) {
    super(binding, keyPath, doc);
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
    /* this.triggerChange(new MessageEvent('change', {
      data: {
      },
    })); */
  }
  delete(k) {
    delete this.binding[k];
    /* this.triggerChange(new MessageEvent('change', {
      data: {
      },
    })); */
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
}

class ZArray extends ZObservable {
  constructor(binding = ZArray.nativeConstructor(), keyPath = [], doc = null) {
    super(binding, keyPath, doc);
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
    /* this.triggerChange(new MessageEvent('change', {
      data: {
      },
    })); */
  }
  delete(index, length = 1) {
    if (length !== 1) {
      throw new Error('only length 1 is supported');
    }
    this.binding.splice(index, length);
    /* this.triggerChange(new MessageEvent('change', {
      data: {
      },
    })); */
  }
  push(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    const event = new ZPushEvent(
      this,
      this.keyPath.slice()
        .concat([this.keyPath.length + '']),
      arr
    );
    if (this.doc) {
      this.doc.pushTransaction('push');
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  unshift(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    this.binding.unshift.apply(this.binding, arr);
    /* this.triggerChange(new MessageEvent('change', {
      data: {
      },
    })); */
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
  const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  
  let index = 0;
  const method = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  switch (method) {
    case MESSAGES.STATE_RESET: {
      const clock = dataView.getUint32(index, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      const encodedData = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, uint8Array.byteLength);
      const state = zbdecode(encodedData);
      zdoc.setClockState(clock, state);
      break;
    }
    case MESSAGES.TRANSACTION: {
      const clock = dataView.getUint32(index, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      const numEvents = dataView.getUint32(index, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      for (let i = 0; i < numEvents; i++) {
        const eventLength = dataView.getUint32(index, true);
        index += Uint32Array.BYTES_PER_ELEMENT;
        
        const encodedEventData = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, eventLength);
        // XXX parse the event here
        index += eventLength;
        index = align4(index);
      }
      break;
    }
    default: {
      console.warn('unknown method:', method);
      break;
    }
  }
}

function encodeStateAsUpdate(doc) {
  const encodedData = zbencode(doc.state);
  
  const totalSize = Uint32Array.BYTES_PER_ELEMENT + encodedData.byteLength;
  const ab = new ArrayBuffer(totalSize);
  const uint8Array = new Uint8Array(ab);
  const dataView = new DataView(ab);
  
  let index = 0;
  dataView.setUint32(index, MESSAGES.STATE_RESET, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  
  dataView.setUint32(index, doc.clock, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  
  uint8Array.set(new Uint8Array(encodedData.buffer, encodedData.byteOffset, encodedData.byteLength), index);
  index += encodedData.byteLength;
  
  return uint8Array;
}

export {
  ZDoc as Doc,
  ZMap as Map,
  ZArray as Array,
  applyUpdate,
  encodeStateAsUpdate,
  zbencode,
  zbdecode,
};

const Z = {
  Doc: ZDoc,
  Map: ZMap,
  Array: ZArray,
  applyUpdate,
  encodeStateAsUpdate,
  zbencode,
  zbdecode,
};
export default Z;
globalThis.Z = Z;

import * as Y from 'yjs';
globalThis.Y = Y;