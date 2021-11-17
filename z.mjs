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
const TRANSACTION_TYPES = {
  mapSet: Symbol('mapSet'),
  mapDelete: Symbol('mapDelete'),
  arrayInsert: Symbol('arrayInsert'),
  arrayDelete: Symbol('arrayDelete'),
  arrayPush: Symbol('arrayPush'),
  arrayUnshift: Symbol('arrayUnshift'),
};

/* const _parseKey = s => {
  const match = s.match(/^([\s\S]*?)(?::[\s\S])?$/);
  const key = match[1] ?? '';
  const type = match[2] ?? '';
  return {
    key,
    type,
  };
}; */
const _makeDataView = uint8Array => new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
const _parseBoundEvent = (doc, encodedEventData) => {
  const dataView = _makeDataView(encodedEventData);
  
  let index = 0;
  const method = dataView.getUint32(index, true);
  const Cons = ZEVENT_CONSTRUCTORS[method];
  if (Cons) {
    return Cons.deserializeUpdate(doc, encodedEventData);
  } else {
    console.warn('could not parse bound event due to incorrect method', method, ZEVENT_CONSTRUCTORS);
    return null;
  }
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const observersMap = new WeakMap();
const bindingsMap = new WeakMap();
const bindingParentsMap = new WeakMap();

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
  constructor(doc, origin, startClock = doc.clock, resolvePriority = doc.resolvePriority, events = []) {
    this.doc = doc;
    this.origin = origin;
    this.startClock = startClock;
    this.resolvePriority = resolvePriority;
    this.events = events;
  }
  pushEvent(event) {
    this.events.push(event);
  }
  rebase(clock, historyTail) {
    return new TransactionCache(
      this.doc,
      this.origin,
      clock,
      resolvePriority,
      rebasedEvents
    );
  }
  serializeUpdate() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // clock
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // resolve priority
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // num events
    const updateByteLengths = this.events.map(event => {
      totalSize += Uint32Array.BYTES_PER_ELEMENT; // length
      const updateByteLength = event.computeUpdateByteLength();
      totalSize += updateByteLength;
      return updateByteLength;
    });
    
    const ab = new ArrayBuffer(totalSize);
    const uint8Array = new Uint8Array(ab);
    const dataView = new DataView(ab);
    let index = 0;
    
    dataView.setUint32(index, MESSAGES.TRANSACTION, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    dataView.setUint32(index, this.startClock, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    dataView.setUint32(index, this.resolvePriority, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    dataView.setUint32(index, this.events.length, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      const updateByteLength = updateByteLengths[i];
      
      dataView.setUint32(index, updateByteLength, true);
      index += Uint32Array.BYTES_PER_ELEMENT; // length
      
      event.serializeUpdate(new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, updateByteLength));
      index += updateByteLength;
    }
    return uint8Array;
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const startClock = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const resolvePriority = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const numEvents = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const events = Array(numEvents);
    for (let i = 0; i < numEvents; i++) {
      const eventLength = dataView.getUint32(index, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      const encodedEventData = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, eventLength);
      const event = _parseBoundEvent(doc, encodedEventData);
      events[i] = event;
      index += eventLength;
      index = align4(index);
    }
    
    const transactionCache = new TransactionCache(doc, undefined, startClock, resolvePriority, events);
    return transactionCache;
  }
}

let zEventsIota = 0;
class ZEvent {
  constructor(impl, keyPath) {
    this.impl = impl;
    this.keyPath = keyPath;
    
    this.keyPathBuffer = null;
  }
  getEvent() {
    const actionSpec = this.getAction();
    return {
      added: new Set(actionSpec.action === 'add' ? [actionSpec.key] : []),
      deleted: new Set(actionSpec.action === 'delete' ? [actionSpec.key] : []),
      changes: {
        keys: new Map([[
          actionSpec.key,
          {
            action: actionSpec.action,
            oldValue: null, // we do not track old values
          },
        ]]),
      },
    };
  }
  triggerObservers() {
    const e = this.getEvent();
    this.impl.triggerObservers(e);
  }
  getKeyPathBuffer() {
    if (this.keyPathBuffer === null) {
      this.keyPathBuffer = textEncoder.encode(
        JSON.stringify(this.keyPath)
      );
    }
    return this.keyPathBuffer;
  }
  computeUpdateByteLength() {
    throw new Error('not implemented');
  }
  serializeUpdate(uint8Array) {
    throw new Error('not implemented');
  }
  static deserializeUpdate(doc, uint8Array) {
    throw new Error('not implemented');
  }
}
class ZMapEvent extends ZEvent {
  constructor(impl, keyPath) {
    super(impl, keyPath);
  
    this.keyBuffer = null;
    this.valueBuffer = null;
  }
  getKeyBuffer() {
    if (this.keyBuffer === null) {
      this.keyBuffer = textEncoder.encode(this.key);
    }
    return this.keyBuffer;
  }
  getValueBuffer() {
    if (this.valueBuffer === null) {
      this.valueBuffer = zbencode(this.value);
    }
    return this.valueBuffer;
  }
}
class ZArrayEvent extends ZEvent {
  constructor(impl, keyPath) {
    super(impl, keyPath);
    
    this.arrBuffer = null;
  }
  getArrBuffer() {
    if (this.arrBuffer === null) {
      this.arrBuffer = zbencode(this.arr);
    }
    return this.arrBuffer;
  }
}
class ZMapSetEvent extends ZMapEvent {
  constructor(impl, keyPath, key, value) {
    super(impl, keyPath);
    
    this.key = key;
    this.value = value;
  }
  static METHOD = ++zEventsIota;
  apply() {
    this.impl.binding[this.key] = this.value;
  }
  getAction() {
    return {
      action: 'update',
      key: this.key,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key length
    totalSize += this.getKeyBuffer().byteLength; // key data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // value length
    totalSize += this.getValueBuffer().byteLength; // value data
    totalSize = align4(totalSize);
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);
    
    const kb = this.getKeyBuffer();
    dataView.setUint32(index, kb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kb, index);
    index += kb.byteLength;
    index = align4(index);
    
    const vb = this.getValueBuffer();
    dataView.setUint32(index, vb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(vb, index);
    index += vb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kpjbLength);
    const keyPath = JSON.parse(textDecoder.decode(kpjb)); 
    index += kpjbLength;
    index = align4(index);

    const kbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const kb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kbLength);
    const key = textDecoder.decode(kb);
    index += kbLength;
    index = align4(index);

    const vbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const vb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, vbLength);
    const value = zbdecode(vb);
    index += vbLength;
    index = align4(index);
    
    const impl = doc.getImplByKeyPath(keyPath.slice(0, -1));
    
    return new this(
      impl,
      keyPath,
      key,
      value
    );
  }
}
class ZMapDeleteEvent extends ZMapEvent {
  constructor(impl, keyPath, key) {
    super(impl);

    this.keyPath = keyPath;
    this.key = key;
  }
  static METHOD = ++zEventsIota;
  apply() {
    delete this.impl.binding[this.key];
  }
  getAction() {
    return {
      action: 'update',
      key: this.key,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key length
    totalSize += this.getValueBuffer().byteLength; // key data
    totalSize = align4(totalSize);
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);
    
    const kb = this.getKeyBuffer();
    dataView.setUint32(index, kb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kb, index);
    index += kb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kpjbLength);
    const keyPath = JSON.parse(textDecoder.decode(kpjb)); 
    index += kpjbLength;
    index = align4(index);

    const kbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const kb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kbLength);
    const key = textDecoder.decode(kb);
    index += kbLength;
    index = align4(index);
    
    const impl = doc.getImplByKeyPath(keyPath.slice(0, -1));
    
    return new this(
      impl,
      keyPath,
      key
    );
  }
}
class ZArrayInsertEvent extends ZArrayEvent {
  constructor(impl, keyPath, index, arr) {
    super(impl);

    this.keyPath = keyPath;
    this.index = index;
    this.arr = arr;
  }
  static METHOD = ++zEventsIota;
  apply() {
    this.impl.binding.splice.apply(this.impl.binding, [this.index, 0].concat(this.arr));
  }
  getAction() {
    return {
      action: 'add',
      key: this.index,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // op index
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // arr length
    totalSize += this.getArrBuffer().byteLength; // arr data
    totalSize = align4(totalSize);
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);
    
    const opIndex = this.index;
    dataView.setUint32(index, opIndex, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const arrb = this.getArrBuffer();
    dataView.setUint32(index, arrb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(arrb, index);
    index += arrb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kpjbLength);
    const keyPath = JSON.parse(textDecoder.decode(kpjb)); 
    index += kpjbLength;
    index = align4(index);
    
    const opIndex = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;

    const arrLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const arrb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, arrLength);
    const arr = zbdecode(arrb);
    index += arrLength;
    index = align4(index);
    
    const impl = doc.getImplByKeyPath(keyPath.slice(0, -1));
    
    return new this(
      impl,
      keyPath,
      opIndex,
      arr
    );
  }
}
class ZArrayDeleteEvent extends ZArrayEvent {
  constructor(impl, keyPath, index, length) {
    super(impl);

    this.keyPath = keyPath;
    this.index = index;
    this.length = length;
  }
  static METHOD = ++zEventsIota;
  apply() {
    this.impl.binding.splice.apply(this.impl.binding, [this.index, this.length]);
  }
  getAction() {
    return {
      action: 'delete',
      key: this.index,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // op index
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // op length
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);
    
    const opIndex = this.index;
    dataView.setUint32(index, opIndex, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const opLength = this.length;
    dataView.setUint32(index, opLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kpjbLength);
    const keyPath = JSON.parse(textDecoder.decode(kpjb)); 
    index += kpjbLength;
    index = align4(index);
    
    const opIndex = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const opLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const impl = doc.getImplByKeyPath(keyPath.slice(0, -1));
    
    return new this(
      impl,
      keyPath,
      opIndex,
      opLength
    );
  }
}
class ZArrayPushEvent extends ZArrayEvent {
  constructor(impl, keyPath, index, arr) {
    super(impl);

    this.keyPath = keyPath;
    this.index = index;
    this.arr = arr;
  }
  static METHOD = ++zEventsIota;
  apply() {
    this.impl.binding.push.apply(this.impl.binding, this.arr);
  }
  getAction() {
    return {
      action: 'add',
      key: this.index,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // op index
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // arr length
    totalSize += this.getArrBuffer().byteLength; // arr data
    totalSize = align4(totalSize);
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);
    
    const opIndex = this.index;
    dataView.setUint32(index, opIndex, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const arrb = this.getArrBuffer();
    dataView.setUint32(index, arrb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    uint8Array.set(arrb, index);
    index += arrb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kpjbLength);
    const keyPath = JSON.parse(textDecoder.decode(kpjb)); 
    index += kpjbLength;
    index = align4(index);

    const opIndex = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;

    const arrLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const arrb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, arrLength);
    const arr = zbdecode(arrb);
    index += arrLength;
    index = align4(index);
    
    const impl = doc.getImplByKeyPath(keyPath.slice(0, -1));
    
    return new this(
      impl,
      keyPath,
      opIndex,
      arr
    );
  }
}
class ZArrayUnshiftEvent extends ZArrayEvent {
  constructor(impl, keyPath, arr) {
    super(impl);

    this.keyPath = keyPath;
    this.arr = arr;
  }
  static METHOD = ++zEventsIota;
  apply() {
    this.impl.binding.unshift.apply(this.impl.binding, this.arr);
  }
  getAction() {
    return {
      action: 'add',
      key: 0,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // arr length
    totalSize += this.getArrBuffer().byteLength; // arr data
    totalSize = align4(totalSize);
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);
    
    const arrb = this.getArrBuffer();
    dataView.setUint32(index, arrb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    uint8Array.set(arrb, index);
    index += arrb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(doc, uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    // skip method
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const kpjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kpjbLength);
    const keyPath = JSON.parse(textDecoder.decode(kpjb)); 
    index += kpjbLength;
    index = align4(index);

    const arrLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const arrb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, arrLength);
    const arr = zbdecode(arrb);
    index += arrLength;
    index = align4(index);
    
    const impl = doc.getImplByKeyPath(keyPath.slice(0, -1));
    
    return new this(
      impl,
      keyPath,
      arr
    );
  }
}
const ZEVENT_CONSTRUCTORS = [
  null, // start at 1
  ZMapSetEvent,
  ZMapDeleteEvent,
  ZArrayInsertEvent,
  ZArrayDeleteEvent,
  ZArrayPushEvent,
  ZArrayUnshiftEvent,
];

class ZDoc extends ZEventEmitter {
  constructor() {
    super();

    this.state = {};
    this.clock = 0;
    this.history = [];
    this.transactionDepth = 0;
    this.transactionCache = null;
    this.resolvePriority = Math.round(Math.random() * 0xFFFFFF);
    
    this.isZDoc = true;
    
    bindingsMap.set(this.state, this);
  }
  get(k, Type) {
    let binding = this.state[k];
    if (binding === undefined) {
      binding = Type.nativeConstructor();
      this.state[k] = binding;
    }
    let impl = bindingsMap.get(binding);
    if (!impl) {
      impl = new Type(binding, this);
      bindingsMap.set(binding, impl);
      bindingParentsMap.set(binding, this.state);
    }
    return impl;
  }
  getArray(k) {
    return this.get(k, ZArray);
  }
  getMap(k) {
    return this.get(k, ZMap);
  }
  transact(fn, origin) {
    this.pushTransaction(origin);
    fn();
    this.popTransaction();
  }
  setResolvePriority(resolvePriority) {
    this.resolvePriority = resolvePriority;
  }
  toJSON() {
    return this.state;
  }
  pushTransaction(origin) {
    if (++this.transactionDepth === 1) {
      this.transactionCache = new TransactionCache(this, origin);
    }
  }
  popTransaction() {
    if (--this.transactionDepth === 0) {
      this.clock++;
      const uint8Array = this.transactionCache.serializeUpdate();
      if (uint8Array) {
        this.dispatchEvent('update', uint8Array, this.transactionCache.origin, this, null);
      }
      this.history.push(this.transactionCache);
      this.transactionCache = null;
    }
  }
  setClockState(clock, state) {
    const _emitDeleteEvents = state => {
      const _recurse = binding => {
        const impl = bindingsMap.get(binding);
        
        if (impl instanceof ZDoc) {
          for (const k in impl.state) {
            _recurse(impl.state[k]);
          }
        } else if (impl instanceof ZArray) {
          if (impl.length > 0) {
            const indexes = Array(impl.length);
            for (let i = 0; i < impl.length; i++) {
              indexes[i] = i;
            }
            const e = {
              added: new Set([]),
              deleted: new Set(indexes),
              changes: {
                keys: new Map(indexes.map(index => {
                  return [
                    index,
                    {
                      action: 'delete',
                      oldValue: null,
                    },
                  ];
                })),
              },
            };
            impl.triggerObservers(e);
          }
          
          for (let i = 0; i < impl.binding.length; i++) {
            _recurse(impl.binding[i]);
          }
        } else if (impl instanceof ZMap) {
          const keys = Array.from(impl.keys());
          if (keys.length > 0) {
            const e = {
              added: new Set([]),
              deleted: new Set(keys),
              changes: {
                keys: new Map(keys.map(key => {
                  return [
                    key,
                    {
                      action: 'delete',
                      oldValue: null,
                    },
                  ];
                })),
              },
            };
            impl.triggerObservers(e);
          }

          for (const k in impl.binding) {
            _recurse(impl.binding[k]);
          }
        } else {
          // nothing
        }
      };
      _recurse(state);
    };
    const _emitAddEvents = state => {
      const _recurse = binding => {
        const impl = bindingsMap.get(binding);
        
        if (impl instanceof ZDoc) {
          for (const k in impl.state) {
            _recurse(impl.state[k]);
          }
        } else if (impl instanceof ZArray) {
          if (impl.length > 0) {
            const indexes = Array(impl.length);
            for (let i = 0; i < impl.length; i++) {
              indexes[i] = i;
            }
            const e = {
              added: new Set(indexes),
              deleted: new Set([]),
              changes: {
                keys: new Map(indexes.map(index => {
                  return [
                    index,
                    {
                      action: 'add',
                      oldValue: null,
                    },
                  ];
                })),
              },
            };
            impl.triggerObservers(e);
          }
          
          for (let i = 0; i < impl.binding.length; i++) {
            _recurse(impl.binding[i]);
          }
        } else if (impl instanceof ZMap) {
          const keys = Array.from(impl.keys());
          if (keys.length > 0) {
            const e = {
              added: new Set(keys),
              deleted: new Set([]),
              changes: {
                keys: new Map(keys.map(key => {
                  return [
                    key,
                    {
                      action: 'add',
                      oldValue: null,
                    },
                  ];
                })),
              },
            };
            impl.triggerObservers(e);
          }

          for (const k in impl.binding) {
            _recurse(impl.binding[k]);
          }
        } else {
          // nothing
        }
      };
      _recurse(state);
    };
    const _remapState = (oldState, newState) => {
      // remap old impls onto new bindings
      const _lookupKeyPath = (binding, keyPath) => {
        for (const key of keyPath) {
          if (key in binding) {
            binding = binding[key];
          } else {
            return undefined;
          }
        }
        return binding;
      };
      const _recurse = (newBinding, keyPath) => {
        const oldBinding = _lookupKeyPath(oldState, keyPath);
        if (oldBinding !== undefined) {
          const oldImpl = bindingsMap.get(oldBinding);
          oldImpl.binding = newBinding;
          bindingsMap.set(newBinding, oldImpl);
        }
        
        if (Array.isArray(newBinding)) {
          for (let i = 0; i < newBinding.length; i++) {
            _recurse(newBinding[i], keyPath.concat([i]));
          }
        } else if (newBinding !== null && typeof newBinding === 'object') {
          for (const k in newBinding) {
            _recurse(newBinding[k], keyPath.concat([k]));
          }
        } else {
          // nothing
        }
      };
      _recurse(newState, []);
    };
    
    _emitDeleteEvents(this.state);
    _remapState(this.state, state);
    _emitAddEvents(state);
    
    this.clock = clock;
    this.state = state;
    this.history = [];
  }
  getImplByKeyPath(keyPath) {
    let binding = this.state;
    let impl = bindingsMap.get(binding);
    for (const [key, type] of keyPath) {
      let value = binding[key];
      
      const child = (() => {
        switch (type) {
          case 'a': return impl.get(key, ZArray);
          case 'm': return impl.get(key, ZMap);
          case 'i': return impl.get(key);
          case 'k': return impl.get(key);
          case 'e': return impl.get(key);
          case 'v': return impl.get(key);
          default: return null;
        }
      })();
      if (child) {
        impl = child;
        binding = child.binding ?? null;
      } else {
        console.warn('could not look up key path', key, impl);
        return null;
      }
    }
    return impl;
  }
}

class ZObservable {
  constructor(binding, doc) {
    this.binding = binding;
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
  triggerObservers(e) {
    const observers = observersMap.get(this);
    if (observers) {
      for (const fn of observers) {
        fn(e);
      }
    }
  }
  getKeyPath() {
    const keyPath = [];
    for (let binding = this.binding;;) {
      const parentBinding = bindingParentsMap.get(binding);
      const parentImpl = bindingsMap.get(parentBinding);
      if (parentImpl) {
        if (parentImpl.isZDoc) {
          const impl = bindingsMap.get(binding);
          const keyType = (() => {
            if (impl.isZArray) {
              return 'a';
            } else if (impl.isZMap) {
              return 'm';
            } else {
              return null;
            }
          })();
          if (keyType !== null) {
            const keys = Object.keys(parentBinding);
            const matchingKeys = keys.filter(k => parentBinding[k] === binding);
            if (matchingKeys.length === 1) {
              const key = matchingKeys[0];
              keyPath.push([key, keyType]);
            } else {
              console.warn('unexpected number of matching keys; duplicate or corruption', matchingKeys, parentBinding, binding);
            }
          } else {
            console.warn('unknown key type', impl);
          }
        } else if (parentImpl.isZArray) {
          const index = parentBinding.indexOf(binding);
          keyPath.push([index, 'i']);
        } else if (parentImpl.isZMap) {
          const keys = Object.keys(parentBinding);
          const matchingKeys = keys.filter(k => parentBinding[k] === binding);
          if (matchingKeys.length === 1) {
            const key = matchingKeys[0];
            keyPath.push([key, 'k']);
          } else {
            console.warn('unexpected number of matching keys; duplicate or corruption', matchingKeys, parentBinding, binding);
          }
        } else {
          console.log('failed to find binding getting key path', binding);
        }
        binding = parentImpl;
      } else {
        break;
      }
    }
    return keyPath.reverse();
  }
  toJSON() {
    return this.binding;
  }
}

const _ensureImplBound = (v, parent) => {
  if (
    v instanceof ZMap ||
    v instanceof ZArray
  ) {
    const impl = bindingsMap.get(v.binding);
    if (!impl) {
      bindingsMap.set(v.binding, v);
      bindingParentsMap.set(v.binding, parent.binding);
    } else {
      throw new Error('already bound');
    }
  }
};
class ZMap extends ZObservable {
  constructor(binding = ZMap.nativeConstructor(), doc = null) {
    super(binding, doc);
    
    this.isZMap = true;
  }
  static nativeConstructor = () => ({});
  has(k) {
    return k in this.binding;
  }
  get(k) {
    return this.binding[k];
  }
  set(k, v) {
    _ensureImplBound(v, this);
    
    const keyPath = this.getKeyPath();
    keyPath.push([k, 'v']);
    const event = new ZMapSetEvent(
      this,
      keyPath,
      k,
      v
    );
    if (this.doc) {
      this.doc.pushTransaction(TRANSACTION_TYPES.mapSet);
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  delete(k) {
    delete this.binding[k];
    const keyPath = this.getKeyPath();
    keyPath.push([k, 'v']);
    const event = new ZMapDeleteEvent(
      this,
      keyPath,
      k
    );
    if (this.doc) {
      this.doc.pushTransaction(TRANSACTION_TYPES.mapDelete);
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    if (this.doc) {
      this.doc.popTransaction();
    }
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
  constructor(binding = ZArray.nativeConstructor(), doc = null) {
    super(binding, doc);
    
    this.isZArray = true;
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
    
    arr.forEach(e => _ensureImplBound(e, this));
    
    const keyPath = this.getKeyPath();
    keyPath.push([index, 'e']);
    const event = new ZArrayInsertEvent(
      this,
      keyPath,
      index,
      arr
    );
    if (this.doc) {
      this.doc.pushTransaction(TRANSACTION_TYPES.arrayInsert);
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  delete(index, length = 1) {
    if (length !== 1) {
      throw new Error('only length 1 is supported');
    }
    
    const keyPath = this.getKeyPath();
    keyPath.push([index, 'e']);
    const event = new ZArrayDeleteEvent(
      this,
      keyPath,
      index,
      length
    );
    if (this.doc) {
      this.doc.pushTransaction(TRANSACTION_TYPES.arrayDelete);
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  push(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    
    arr.forEach(e => _ensureImplBound(e, this));
    
    const keyPath = this.getKeyPath();
    keyPath.push([this.length, 'e']);
    const event = new ZArrayPushEvent(
      this,
      keyPath,
      this.length,
      arr
    );
    if (this.doc) {
      this.doc.pushTransaction(TRANSACTION_TYPES.arrayPush);
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  unshift(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    
    arr.forEach(e => _ensureImplBound(e, this));
    
    const keyPath = this.getKeyPath();
    keyPath.push([0, 'e']);
    const event = new ZArrayUnshiftEvent(
      this,
      keyPath,
      arr
    );
    if (this.doc) {
      this.doc.pushTransaction(TRANSACTION_TYPES.arrayUnshift);
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  [Symbol.iterator] = () => {
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

function applyUpdate(doc, uint8Array, transactionOrigin) {
  const dataView = _makeDataView(uint8Array);
  
  let index = 0;
  const method = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  
  const _handleStateMessage = () => {
    const clock = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const encodedData = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index);
    const state = zbdecode(encodedData);
    doc.setClockState(clock, state);
  };
  const _handleTransactionMessage = () => {
    let transactionCache = TransactionCache.deserializeUpdate(doc, uint8Array);
    
    // rebase on top of local history as needed
    if (transactionCache.startClock === doc.clock) {
      // nothing
    } else if (transactionCache.startClock < doc.clock) {
      const historyTail = doc.history.slice(doc.history.length - (doc.clock - transactionCache.startClock));
      transactionCache = transactionCache.rebase(doc.clock, historyTail);
    } else {
      throw new Error('transaction skipped clock ticks; desynced');
    }
    
    for (const event of transactionCache.events) {
      event.apply();
      doc.clock++;
      event.triggerObservers();
    }
    
    if (doc.clock !== transactionCache.startClock + transactionCache.events.length) {
      console.warn('clock out of sync', doc.clock, transactionCache.startClock + transactionCache.events.length);
      throw new Error('clock out of sync');
    }
  };
  switch (method) {
    case MESSAGES.STATE_RESET: {
      _handleStateMessage();
      break;
    }
    case MESSAGES.TRANSACTION: {
      _handleTransactionMessage();
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
  
  const totalSize =
    Uint32Array.BYTES_PER_ELEMENT +
    Uint32Array.BYTES_PER_ELEMENT +
    encodedData.byteLength;
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
globalThis.Z = Z; // XXX testing only

import * as Y from 'yjs'; // XXX testing only
globalThis.Y = Y;