const MESSAGES = (() => {
  let iota = 0;
  return {
    STATE_RESET: ++iota,
  };
})();
const ADDENDUM_TYPES = (() => {
  let iota = 0;
  return {
    Uint8Array: ++iota,
    Uint16Array: ++iota,
    Uint32Array: ++iota,
    Int8Array: ++iota,
    Int16Array: ++iota,
    Int32Array: ++iota,
    Float32Array: ++iota,
    Float64Array: ++iota,
  };
})();
const ADDENDUM_CONSTRUCTORS = [
  null, // start at 1
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
function zbencode(o) {
  let recursionIndex = 0;
  const addendums = [];
  const addendumIndexes = [];
  const _recurse = o => {
    recursionIndex++;
    if (Array.isArray(o)) {
      const childResult = Array(o.length);
      for (let i = 0; i < o.length; i++) {
        childResult[i] = _recurse(o[i]);
      }
      return childResult;
    } else if (
      o instanceof Uint8Array ||
      o instanceof Uint16Array ||
      o instanceof Uint32Array ||
      o instanceof Int8Array ||
      o instanceof Int16Array ||
      o instanceof Int32Array ||
      o instanceof Float32Array ||
      o instanceof Float64Array
    ) {
      addendums.push(o);
      addendumIndexes.push(recursionIndex);
      const addendumType = ADDENDUM_TYPES[o.constructor.name];
      addendumType.push(addendumType)
      return null;
    } else if (
      o === null || o === undefined ||
      typeof o === 'boolean' || typeof o === 'string' || typeof o === 'number'
    ) {
      return o;
    } else if (typeof o === 'object') {
      const childResult = {};
      for (const k in o) {
        childResult[k] = _recurse(o[k]);
      }
      return childResult;
    } else {
      console.warn('ignoring during zbencode:', o);
      return null;
    }
  };
  const j = _recurse(o);
  const s = JSON.stringify(j);
  const sb = textEncoder.encode(s);
  
  let totalSize = 0;
  totalSize += Uint32Array.BYTES_PER_ELEMENT; // length
  totalSize += sb.byteLength; // data
  totalSize += Uint32Array.BYTES_PER_ELEMENT; // count
  for (const addendum of addendums) {
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // index
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // length
    totalSize += a.byteLength; // data
  }
  
  const ab = new ArrayBuffer(totalSize);
  const uint8Array = new Uint8Array(ab);
  const dataView = new DataView(ab);
  {
    let index = 0;
    // sb
    {
      dataView.setUint32(index, sb.byteLength, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      uint8Array.set(sb, index);
      index += a.byteLength;
    }
    // addendums
    dataView.setUint32(index, addendums.length, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < addendums.length; i++) {
      const addendum = addendums[i];
      const addendumIndex = addendumIndexes[i];
      const addendumType = addendumTypes[i];
      
      dataView.setUint32(index, addendumIndex, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      dataView.setUint32(index, addendumType, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      dataView.setUint32(index, a.byteLength, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      uint8Array.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), index);
      index += a.byteLength;
    }
  }
  return uint8Array;
}
function zbdecode(uint8Array) {
  const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  
  let index = 0;
  const sbLength = dataView.setUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  
  const sb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, sbLength);
  const s = textDecoder.decode(sbLength);
  const j = JSON.parse(s);
  
  const numAddendums = dataView.setUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  
  const addendums = Array(numAddendums);
  const addendumIndexes = Array(numAddendums);
  const addendumTypes = Array(numAddendums);
  for (let i = 0; i < numAddendums; i++) {
    const addendumIndex = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const addendumType = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const addendumLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const TypedArrayCons = ADDENDUM_CONSTRUCTORS[addendumType];
    if (!TypedArrayCons) {
      console.warn('failed to find tyed array cons for', addendumType);
    }
    const addendum = TypedArrayCons ?
      new TypedArrayCons(a.buffer, a.byteOffset + index, a.byteLength)
    : null;
    index += a.byteLength;
    
    addendums.push(addendum);
    addendumIndexes.push(addendumIndex);
    addendumTypes.push(addendumType);
  }
  
  {
    let recursionIndex = 0;
    let currentAddendum = 0;
    const _recurse = o => {
      recursionIndex++;
      
      const addendumIndex = addendumIndexes[currentAddendum];
      if (addendumIndex !== undefined && addendumIndex === recursionIndex) {
        const addendum = addendums[currentAddendum];
        currentAddendum++;
        return addendum;
      } else if (Array.isArray(o)) {
        const childResult = Array(o.length);
        for (let i = 0; i < o.length; i++) {
          childResult[i] = _recurse(o[i]);
        }
        return childResult;
      } else if (
        o === null || o === undefined ||
        typeof o === 'boolean' || typeof o === 'string' || typeof o === 'number'
      ) {
        return o;
      } else if (typeof o === 'object') {
        const childResult = {};
        for (const k in o) {
          childResult[k] = _recurse(o[k]);
        }
        return childResult;
      } else {
        console.warn('ignoring during zbencode:', o);
        return null;
      }
    };
    return _recurse(j);
  }
}

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
    this.events = [];
  }
  pushEvent(event) {
    this.events.push(event);
  }
  flush() {
    for (const event of this.events) {
      console.log('get event', event);
      // fn(origin);
    }
  }
  serializeUpdate() {
    const uint8Array = new Uint8Array();
    // XXX
    return uint8Array;
  }
}

class ZDoc extends ZEventEmitter {
  constructor() {
    super();

    this.state = {};
    this.clock = 0; // XXX send this with STATE_RESET and UPDATE-type messages
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
    // XXX make this work recursively
    // XXX make children of the doc call this on sets
    if (!this.transactionCache) {
      this.transactionCache = new TransactionCache(origin);
    } else {
      throw new Error('recursive transaction');
    }
  }
  popTransaction() {
    this.transactionCache.flush();
    const uint8Array = this.transactionCache.serializeUpdate();
    if (uint8Array) {
      this.dispatchEvent('update', uint8Array, origin, this, null);
    }
    this.transactionCache = null;
  }
  transact(fn, origin) {
    this.pushTransaction(origin);
    fn();
    this.popTransaction();
  }
  setState(state) {
    this.state = state; // XXX need to trigger observers
  }
}

class ZObservable {
  constructor(binding) {
    this.binding = binding;
    this.observers = [];
    // XXX add keyPath
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
  const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  
  let index = 0;
  const method = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  switch (method) {
    case MESSAGES.STATE_RESET: {
      const encodedData = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, uint8Array.byteLength);
      const state = zbdecode(encodedData);
      zdoc.setState(state);
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
window.Z = Z;

import * as Y from 'yjs';
window.Y = Y;