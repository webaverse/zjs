import {
  zbencode,
  zbdecode,
  zbclone,
} from './encoding.mjs';
import {align4} from './util.mjs';

const MESSAGES = (() => {
  let iota = 0;
  return {
    STATE_RESET: ++iota,
    TRANSACTION: ++iota,
  };
})();

// XXX can use a power-of-two buffer cache for memory

let rng = Math.random();
function setRng(r) {
  rng = r;
}
const _makeId = () => Math.round(rng() * 0xFFFFFF);
const _jsonify = o => {
  const impl = bindingsMap.get(o);
  if (impl?.isZArray) {
    return o.e.map(_jsonify);
  } else if (Array.isArray(o)) {
    return o.map(_jsonify);
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
    return o;
  } else if (o !== null && typeof o === 'object') {
    const result = {};
    for (const k in o) {
      result[k] = _jsonify(o[k]);
    }
    return result;
  } else {
    return o;
  }
};
const _getBindingForValue = e => {
  if (e?.isZMap || e?.isZArray) {
    return e.binding;
  } else {
    return e;
  }
};
const _getBindingForArray = arr => arr.map(_getBindingForValue);

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
const _parseBoundEvent = encodedEventData => {
  const dataView = _makeDataView(encodedEventData);
  
  let index = 0;
  const method = dataView.getUint32(index, true);
  const Cons = ZEVENT_CONSTRUCTORS[method];
  if (Cons) {
    return Cons.deserializeUpdate(encodedEventData);
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

const conflictSpec = {
  weAreHighestPriority: false,
};
const _keyPathEquals = (a, b) => {
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      const ae = a[i];
      const be = b[i];
      if (ae !== be) {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
};
const _isKeyPathPrefix = (a, b) => {
  if (a.length < b.length) {
    for (let i = 0; i < a.length; i++) {
      const ae = a[i];
      const be = b[i];
      if (ae !== be) {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
};
const _parseHistoryBuffer = (historyData, historyOffsets, historyIndex) => {
  const historyElementData = new Uint8Array(
    historyData.buffer,
    historyData.byteOffset + historyOffsets[historyIndex],
  );
  const dataView = _makeDataView(historyElementData);

  let index = 0;
  const eventType = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;

  const Cons = ZEVENT_CONSTRUCTORS[eventType];

  const resolvePriority = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;

  const kpjbLength = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;

  try {
    const kpjb = new Uint8Array(historyElementData.buffer, historyElementData.byteOffset + index, kpjbLength);
    const s = textDecoder.decode(kpjb);
    const keyPath = JSON.parse(s); 
    index += kpjbLength;
    index = align4(index);

    switch (Cons) {
      case ZNullEvent: {
        return {
          keyPath,
          resolvePriority,
          isZNullEvent: true,
        };
        break;
      }
      case ZMapSetEvent: {
        return {
          keyPath,
          resolvePriority,
          isZMapSetEvent: true,
        };
        break;
      }
      case ZMapDeleteEvent: {
        return {
          keyPath,
          resolvePriority,
          isZMapDeleteEvent: true,
        };
        break;
      }
      case ZArrayPushEvent: {
        return {
          keyPath,
          resolvePriority,
          isZArrayPushEvent: true,
        };
        break;
      }
      case ZArrayDeleteEvent: {
        return {
          keyPath,
          resolvePriority,
          isZArrayDeleteEvent: true,
        };
        break;
      }
      default: {
        throw new Error('unknown history buffer event type');
        break;
      }
    }
  } catch (e) {
    console.warn('could not parse history buffer', historyIndex, eventType, Cons, resolvePriority, kpjbLength);

    throw e;
  }
};
const _parentWasSet = (event, historyStartIndex, historyEndIndex, historyData, historyOffsets) => {
  for (let i = historyStartIndex; i < historyEndIndex; i++) {
    const e = _parseHistoryBuffer(historyData, historyOffsets, i);
    if ( // if this is a parent overwrite
      _isKeyPathPrefix(e.keyPath, event.keyPath) &&
        (
          (e.isZMapSetEvent) ||
          (e.isZMapDeleteEvent) ||
          (e.isZArrayDeleteEvent)
        )
    ) {
      return true;
    }
  }
  return false;
};
const _getConflicts = (event, historyStartIndex, historyEndIndex, historyData, historyOffsets, resolvePriority, conflictSpec) => {
  let conflictFound = false;
  conflictSpec.weAreHighestPriority = true;
  
  for (let i = historyStartIndex; i < historyEndIndex; i++) {
    const e = _parseHistoryBuffer(historyData, historyOffsets, i);
    if ( // if this is a conflicting event
      ((e.isZMapSetEvent) || (e.isZMapDeleteEvent)) &&
        _keyPathEquals(e.keyPath, event.keyPath)
    ) {
      conflictFound = true;
      if (e.resolvePriority > resolvePriority) {
        conflictSpec.weAreHighestPriority = false;
        break;
      }
    }
  }
  
  return conflictFound;
};
const _alreadyDeleted = (event, historyStartIndex, historyEndIndex, historyData, historyOffsets) => {
  for (let i = historyStartIndex; i < historyEndIndex; i++) {
    const e = _parseHistoryBuffer(historyData, historyOffsets, i);
    if ( // if this is a conflicting delete
      (e.isZArrayDeleteEvent) &&
        _keyPathEquals(e.keyPath, event.keyPath)
    ) {
      return true;
    }
  }
  return false;
};

class TransactionCache {
  constructor(doc = null, origin = undefined, startClock = doc.clock, resolvePriority = doc.resolvePriority, events = []) {
    this.doc = doc;
    this.origin = origin;
    this.startClock = startClock;
    this.resolvePriority = resolvePriority;
    this.events = events;
  }
  pushEvent(event) {
    this.events.push(event);
  }
  bindEventsToDoc() {
    for (const event of this.events) {
      event.bindToDoc(this.doc);
    }
  }
  rebase() {
    const historyTailLength = this.doc.clock - this.startClock;
    globalThis.maxHistoryTailLength = Math.max(globalThis.maxHistoryTailLength, historyTailLength);
    const historyStartIndex = this.startClock;
    const historyEndIndex = this.doc.clock;
    const {historyData, historyOffsets}  = this.doc;
    
    const rebasedEvents = this.events.map(event => {
      if (event.isZMapSetEvent || event.isZMapDeleteEvent) {
        if (_parentWasSet(event, historyStartIndex, historyEndIndex, historyData, historyOffsets)) {
          // console.log('torpedo self due to parent conflict');
          return new ZNullEvent();
        } else if (_getConflicts(event, historyStartIndex, historyEndIndex, historyData, historyOffsets, this.resolvePriority, conflictSpec)) {
          /* const _isHighestPriority = () => {
            return conflicts.every(([p, e]) => {
              return this.resolvePriority <= p;
            });
          }; */

          if (conflictSpec.weAreHighestPriority) {
            // console.log('survive due to high prio');
            return event;
          } else {
            // console.log('torpedo self due to low prio');
            return new ZNullEvent();
          }
        } else {
          // console.log('no conflicts');
          return event;
        }
      } else if (event.isZArrayPushEvent) {
        if (_parentWasSet(event, historyStartIndex, historyEndIndex, historyData, historyOffsets)) {
          return new ZNullEvent();
        } else {
          // console.log('no conflicts');
          return event;
        }
      } else if (event.isZArrayDeleteEvent) {
        if (
          _parentWasSet(event, historyStartIndex, historyEndIndex, historyData, historyOffsets) ||
          _alreadyDeleted(event, historyStartIndex, historyEndIndex, historyData, historyOffsets)
        ) {
          // console.log('torpedo self due to parent conflict');
          return new ZNullEvent();
        } else {
          // console.log('no conflicts');
          return event;
        }
      } else if (event.isZNullEvent) {
        // console.log('skip null event');
        return event;
      } else {
        console.warn('unknown event type', event);
        return event;
      }
    });
    this.events = rebasedEvents;
    this.startClock += historyTailLength;
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
    
    // XXX setBigUint64
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
  static deserializeUpdate(uint8Array) {
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
      const event = _parseBoundEvent(encodedEventData);
      events[i] = event;
      index += eventLength;
      index = align4(index);
    }
    
    const transactionCache = new TransactionCache(undefined, undefined, startClock, resolvePriority, events);
    return transactionCache;
  }
}

const HISTORY_DATA_SIZE = 1024 * 1024; // 1 MB
const HISTORY_OFFSETS_SIZE = HISTORY_DATA_SIZE / 4;
class ZDoc extends ZEventEmitter {
  constructor(
    state = {},
    clock = 0,
    historyData = new Uint8Array(HISTORY_DATA_SIZE),
    historyOffsets = new Uint32Array(HISTORY_OFFSETS_SIZE / Uint32Array.BYTES_PER_ELEMENT),
 ) {
    super();

    this.state = state;
    this.clock = clock;

    this.historyData = historyData;
    this.historyOffsets = historyOffsets;
    
    this.transactionDepth = 0;
    this.transactionCache = null;
    this.resolvePriority = _makeId();
    this.mirror = false;

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
  setMirror(mirror) {
    this.mirror = mirror;
  }
  toJSON() {
    return _jsonify(this.state);
  }
  pushHistory(event) {
    const eventTargetBuffer = new Uint8Array(
      this.historyData.buffer,
      this.historyData.byteOffset + this.historyOffsets[this.clock],
    );
    const eventByteLength = event.serializeHistory(eventTargetBuffer);

    this.clock++;
    this.historyOffsets[this.clock] = eventTargetBuffer.byteOffset + eventByteLength;
    // console.log('set history offsets', historyOffsets);

    globalThis.maxHistoryLength = Math.max(globalThis.maxHistoryLength, this.clock); // XXX temp
  }
  pushTransaction(origin) {
    if (++this.transactionDepth === 1) {
      this.transactionCache = new TransactionCache(this, origin);
    }
  }
  popTransaction() {
    if (--this.transactionDepth === 0) {
      const uint8Array = this.transactionCache.serializeUpdate();
      // console.log('transaction cache clock', this.clock, this.transactionCache.startClock, this.transactionCache.events.length, this.transactionCache.doc.clock);
      if (uint8Array) {
        this.dispatchEvent('update', uint8Array, this.transactionCache.origin, this, null);
      }
      for (const event of this.transactionCache.events) {
        event.resolvePriority = this.transactionCache.resolvePriority;
        this.pushHistory(event);
      }
      /* if (this.transactionCache.events.some(e => e.constructor.name === 'ZEvent')) {
        throw new Error('bad construction');
      } */
      this.transactionCache = null;
    }
  }
  setClockState(clock, state) {
    const _emitDeleteEvents = state => {
      const _recurse = binding => {
        const impl = bindingsMap.get(binding);
        
        if (impl.isZDoc) {
          for (const k in impl.state) {
            _recurse(impl.state[k]);
          }
        } else if (impl.isZArray) {
          if (impl.length > 0) {
            const indexes = [];
            for (let i = 0; i < impl.length; i++) {
              indexes.push(i);
            }

            const e = {
              added: new Set([]),
              deleted: new Set(indexes),
              changes: {
                keys: new Map(indexes.map(index => {
                  let value = impl.binding.e[index];
                  value = bindingsMap.get(value) ?? value;
                  return [
                    index,
                    {
                      action: 'delete',
                      value,
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
        } else if (impl.isZMap) {
          const keys = Array.from(impl.keys());
          if (keys.length > 0) {
            const values = Array.from(impl.values());
            const e = {
              added: new Set([]),
              deleted: new Set(keys),
              changes: {
                keys: new Map(keys.map((key, index) => {
                  const value = values[index];
                  return [
                    key,
                    {
                      action: 'delete',
                      value,
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
        
        if (impl?.isZDoc) {
          for (const k in impl.state) {
            _recurse(impl.state[k]);
          }
        } else if (impl?.isZArray) {
          if (impl.length > 0) {
            const indexes = [];
            for (let i = 0; i < impl.binding.e.length; i++) {
              indexes.push(i);
            }

            const e = {
              added: new Set(indexes),
              deleted: new Set([]),
              changes: {
                keys: new Map(indexes.map(index => {
                  const value = impl.binding.e[index];
                  return [
                    index,
                    {
                      action: 'add',
                      value,
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
        } else if (impl?.isZMap) {
          const keys = Array.from(impl.keys());
          if (keys.length > 0) {
            const values = Array.from(impl.values());
            const e = {
              added: new Set(keys),
              deleted: new Set([]),
              changes: {
                keys: new Map(keys.map((key, index) => {
                  const value = values[index];
                  return [
                    key,
                    {
                      action: 'add',
                      value,
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
        const newParent = keyPath.length > 0 ? _lookupKeyPath(newState, keyPath.slice(0, -1)) : null;
        let oldImpl;
        if (oldBinding !== undefined) {
          oldImpl = bindingsMap.get(oldBinding);
          oldImpl.binding = newBinding;
          bindingsMap.set(newBinding, oldImpl);
          if (newParent) {
            bindingParentsMap.set(newBinding, newParent);
          }
        }
        
        if (oldImpl?.isZArray) {
          for (let i = 0; i < newBinding.e.length; i++) {
            const zid = newBinding.i[i];
            const index = oldBinding.i.indexOf(zid);
            _recurse(newBinding.e[i], keyPath.concat(['e', index]));
          }
        } else if (Array.isArray(newBinding)) {
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
    this.historyData = new Uint8Array(HISTORY_DATA_SIZE);
    this.historyOffsets = new Uint32Array(HISTORY_OFFSETS_SIZE / Uint32Array.BYTES_PER_ELEMENT);
  }
  getImplByKeyPathParent(keyPath, keyTypes) {
    let binding = this.state;
    let impl = bindingsMap.get(binding);
    for (let i = 0; i < keyPath.length - 1; i++) {
      const key = keyPath[i];
      const keyType = keyTypes[i];
      // let value = binding[key];
      
      const child = (() => {
        switch (keyType) {
          case 'a': return impl.get(key, ZArray);
          case 'm': return impl.get(key, ZMap);
          case 'v': return impl.get(key);
          case 'ea': return impl.getId(key, ZArray);
          case 'em': return impl.getId(key, ZMap);
          case 'ev': return impl.getId(key);
          default: return undefined;
        }
      })();
      if (child) {
        impl = child;
        binding = child.binding;
      } else {
        // console.warn('could not look up key path', [key, type], impl);
        return undefined;
      }
    }
    return impl;
  }
  clone() {
    const oldState = this.state;
    const newState = zbclone(this.state);
    // console.log('old history', this.state, this.history.length, this.history[0]);
    const newDoc = new ZDoc(
      newState,
      this.clock,
      this.historyData.slice(),
      this.historyOffsets.slice(),
    );

    // remap old impls onto new bindings
    const _recurse = (oldBinding, newBinding) => {
      const oldImpl = bindingsMap.get(oldBinding);
      if (oldImpl?.isZDoc) {
        for (const k in oldBinding) {
          _recurse(oldBinding[k], newBinding[k]);
          bindingParentsMap.set(newBinding[k], newBinding);
        }
      } else if (oldImpl?.isZArray) {
        const newImpl = new ZArray(newBinding, newDoc);
        bindingsMap.set(newBinding, newImpl);

        for (let i = 0; i < oldBinding.e.length; i++) {
          _recurse(oldBinding.e[i], newBinding.e[i]);

          const childImpl = bindingsMap.get(newBinding.e[i]);
          if (childImpl) {
            bindingParentsMap.set(newBinding.e[i], newBinding);
          }
        }
      } else if (oldImpl?.isZMap) {
        const newImpl = new ZMap(newBinding, newDoc);
        bindingsMap.set(newBinding, newImpl);

        for (const k in oldBinding) {
          _recurse(oldBinding[k], newBinding[k]);

          const childImpl = bindingsMap.get(newBinding[k]);
          if (childImpl) {
            bindingParentsMap.set(newBinding[k], newBinding);
          }
        }
      } else if (Array.isArray(oldBinding)) {
        for (let i = 0; i < oldBinding.length; i++) {
          _recurse(oldBinding[i], newBinding[i]);
        }
      } else if (oldBinding !== null && typeof oldBinding === 'object') {
        for (const k in oldBinding) {
          _recurse(oldBinding[k], newBinding[k]);
        }
      } else {
        // nothing
      }
    };
    _recurse(oldState, newState);

    return newDoc;
  }
}

const _getImplKeyType = impl => {
  if (impl?.isZArray) {
    return 'a';
  } else if (impl?.isZMap) {
    return 'm';
  } else {
    return null;
  }
};
const _getImplConstructorForKeyType = type => {
  if (/m$/.test(type)) {
    return ZMap;
  } else if (/a$/.test(type)) {
    return ZArray;
  } else {
    return null;
  }
};
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
  getKeyPathSpec() {
    const keyPath = [];
    const keyTypes = [];
    for (let binding = this.binding;;) {
      const parentBinding = bindingParentsMap.get(binding);

      if (parentBinding) {
        const parentImpl = bindingsMap.get(parentBinding);
        if (parentImpl.isZDoc) {
          const impl = bindingsMap.get(binding);
          const keyType = _getImplKeyType(impl);
          if (keyType !== null) {
            const keys = Object.keys(parentBinding);
            const matchingKeys = keys.filter(k => parentBinding[k] === binding);
            if (matchingKeys.length === 1) {
              const key = matchingKeys[0];
              keyPath.push(key);
              keyTypes.push(keyType);
            } else {
              console.warn('unexpected number of matching keys; duplicate or corruption', matchingKeys, parentBinding, binding);
              throw new Error('zarray did not have unique key (had ' + matchingKeys.length + ')');
            }
          } else {
            console.warn('unknown key type for doc set', impl, parentImpl);
          }
        } else if (parentImpl.isZArray) {
          const index = parentImpl.binding.e.indexOf(binding);
          const zid = parentImpl.binding.i[index];
          const impl = bindingsMap.get(binding);
          const type = 'e' + (_getImplKeyType(impl) || 'v');
          keyPath.push(zid);
          keyTypes.push(type);
        } else if (parentImpl.isZMap) {
          const keys = Object.keys(parentBinding);
          const matchingKeys = keys.filter(k => parentBinding[k] === binding);
          if (matchingKeys.length === 1) {
            const key = matchingKeys[0];
            const impl = bindingsMap.get(binding);
            const type = _getImplKeyType(impl) || 'v';
            keyPath.push(key);
            keyTypes.push(type);
          } else {
            console.warn('unexpected number of matching keys; duplicate or corruption', matchingKeys, parentBinding, binding);
            throw new Error('zmap did not have unique key (had ' + matchingKeys.length + ')');
          }
        } else {
          console.log('failed to find binding getting key path', binding);
        }
        binding = parentBinding;
      } else {
        break;
      }
    }
    return {
      keyPath: keyPath.reverse(),
      keyTypes: keyTypes.reverse(),
    };
  }
  toJSON() {
    return this.binding;
  }
}

const _ensureImplBound = (v, parent) => {
  if (
    v?.isZMap ||
    v?.isZArray
  ) {
    bindingsMap.set(v.binding, v);
    bindingParentsMap.set(v.binding, parent.binding);
    v.doc = parent.doc;
  }
};
class ZMap extends ZObservable {
  constructor(binding = ZMap.nativeConstructor(), doc = new ZDoc()) {
    super(binding, doc);
    
    this.isZMap = true;
  }
  static nativeConstructor = () => ({});
  has(k) {
    return k in this.binding;
  }
  get(k, Type) {
    if (Type) {
      let binding = this.binding[k];
      if (binding === undefined) {
        // binding = Type.nativeConstructor();
        // this.binding[k] = binding;
        // throw new Error('map lookup nonexistent typed element');
        return undefined;
      }
      let impl = bindingsMap.get(binding);
      if (!impl) {
        impl = new Type(binding, this);
        bindingsMap.set(binding, impl);
        bindingParentsMap.set(binding, this.binding);
      }
      return impl;
    } else {
      const v = this.binding[k];
      return bindingsMap.get(v) ?? v;
    }
  }
  set(k, v) {
    _ensureImplBound(v, this);
    
    const {keyPath, keyTypes} = this.getKeyPathSpec();
    const keyType = _getImplKeyType(v) || 'v';
    keyPath.push(k);
    keyTypes.push(keyType);
    const event = new ZMapSetEvent(
      keyPath,
      keyTypes,
      k,
      v
    );
    event.bindToImpl(this);
    if (this.doc) {
      this.doc.pushTransaction();
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    event.gc();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  delete(k) {
    delete this.binding[k];
    const {keyPath, keyTypes} = this.getKeyPathSpec();
    keyPath.push(k);
    keyTypes.push('v');
    const event = new ZMapDeleteEvent(
      keyPath,
      keyTypes,
      k
    );
    event.bindToImpl(this);
    if (this.doc) {
      this.doc.pushTransaction();
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    event.gc();
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
  constructor(binding = ZArray.nativeConstructor(), doc = new ZDoc()) {
    super(binding, doc);
    
    this.isZArray = true;
  }
  static nativeConstructor = () => ({
    e: [],
    i: [],
  });
  get length() {
    return this.binding.e.length;
  }
  set length(length) {
    this.binding.e.length = length;
  }
  get(index, Type) {
    if (Type) {
      let binding = this.binding.e[index];
      if (binding === undefined) {
        // binding = Type.nativeConstructor();
        // this.state[k] = binding;
        // throw new Error('array lookup nonexistent typed element');
        return undefined;
      }
      let impl = bindingsMap.get(binding);
      if (!impl) {
        impl = new Type(binding, this);
        bindingsMap.set(binding, impl);
        bindingParentsMap.set(binding, this.state);
      }
      return impl;
    } else {
      return this.binding.e[index];
    }
  }
  getId(zid, Type) {
    const index = this.binding.i.indexOf(zid);
    if (index !== -1) {
      return this.get(index, Type);
    } else {
      return undefined;
    }
  }
  push(arr) {
    if (arr.length !== 1) {
      throw new Error('only length 1 is supported');
    }
    
    arr.forEach(e => _ensureImplBound(e, this));
    
    const zid = _makeId();
    
    const {keyPath, keyTypes} = this.getKeyPathSpec();
    const impl = bindingsMap.get(arr[0]) ?? arr[0];
    const keyType = 'e' + (_getImplKeyType(impl) || 'v');
    keyPath.push(zid);
    keyTypes.push(keyType);
    const event = new ZArrayPushEvent(
      keyPath,
      keyTypes,
      arr
    );
    event.bindToImpl(this);
    if (this.doc) {
      this.doc.pushTransaction();
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    event.gc();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  delete(index, length = 1) {
    if (length !== 1) {
      throw new Error('only length 1 is supported');
    }
    
    const zid = this.binding.i[index];
    
    const {keyPath, keyTypes} = this.getKeyPathSpec();
    keyPath.push(zid);
    keyTypes.push('ev');
    const event = new ZArrayDeleteEvent(
      keyPath,
      keyTypes,
    );
    event.bindToImpl(this);
    if (this.doc) {
      this.doc.pushTransaction();
      this.doc.transactionCache.pushEvent(event);
    }
    event.apply();
    event.triggerObservers();
    event.gc();
    if (this.doc) {
      this.doc.popTransaction();
    }
  }
  toJSON() {
    return this.binding.e.map(_jsonify);
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

let zEventsIota = 0;
class ZEvent {
  constructor(keyPath, keyTypes) {
    this.keyPath = keyPath;
    this.keyTypes = keyTypes;

    this.impl = null;
    this.keyPathBuffer = null;
    this.resolvePriority = -1; // populated when we push history
  }
  bindToDoc(doc) {
    if (doc) {
      this.impl = doc.getImplByKeyPathParent(this.keyPath, this.keyTypes);
      if (!this.impl) {
        console.warn('cannot bind impl to key path', doc.state, keyPath, keyTypes);
        throw new Error('cannot bind impl to key path');
      }
      // this.doc = doc;
    } else {
      this.impl = null;
      // this.doc = null;
    }
  }
  bindToImpl(impl) {
    this.impl = impl;
  }
  gc() {
    this.impl = null;
    this.keyPathBuffer = null;
    this.keyTypesBuffer = null;
  }
  getEvent() {
    const actionSpec = this.getAction();
    if (actionSpec) {
      const added = new Set(/add|update/.test(actionSpec.action) ? [actionSpec.key] : []);
      const deleted = new Set(actionSpec.action === 'delete' ? [actionSpec.key] : []);
      const value = bindingsMap.get(actionSpec.value) ?? actionSpec.value;
      return {
        added,
        deleted,
        changes: {
          keys: new Map([[
            actionSpec.key,
            {
              action: actionSpec.action,
              value,
            },
          ]]),
        },
      };
    } else {
      return null;
    }
  }
  triggerObservers() {
    const e = this.getEvent();
    if (e !== null) {
      this.impl.triggerObservers(e);
    }
  }
  getKeyPathBuffer() {
    if (this.keyPathBuffer === null) {
      this.keyPathBuffer = textEncoder.encode(
        JSON.stringify(this.keyPath)
      );
    }
    return this.keyPathBuffer;
  }
  getKeyTypesBuffer() {
    if (this.keyTypesBuffer === null) {
      this.keyTypesBuffer = textEncoder.encode(
        JSON.stringify(this.keyTypes)
      );
    }
    return this.keyTypesBuffer;
  }
  computeUpdateByteLength() {
    throw new Error('not implemented');
  }
  serializeUpdate(uint8Array) {
    throw new Error('not implemented');
  }
  static deserializeUpdate(uint8Array) {
    throw new Error('not implemented');
  }
  serializeHistory(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;

    dataView.setUint32(index, this.resolvePriority, true);
    index += Uint32Array.BYTES_PER_ELEMENT;

    const kpjb = this.getKeyPathBuffer();
    dataView.setUint32(index, kpjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kpjb, index);
    index += kpjb.byteLength;
    index = align4(index);

    return index;
  }
  clone() {
    const event = new this.constructor(...this.getConstructorArgs());
    event.impl = this.impl;
    return event;
  }
}
class ZNullEvent extends ZEvent {
  constructor() {
    super([], []);
    
    this.isZNullEvent = true;
  }
  static METHOD = ++zEventsIota;
  apply() {
    // nothing
  }
  getConstructorArgs() {
    return [];
  }
  getAction() {
    return null;
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    return totalSize;
  }
  serializeUpdate(uint8Array) {
    const dataView = _makeDataView(uint8Array);
    
    let index = 0;
    dataView.setUint32(index, this.constructor.METHOD, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
  }
  static deserializeUpdate(uint8Array) {
    return new this();
  }
}
class ZMapEvent extends ZEvent {
  constructor(keyPath, keyTypes) {
    super(keyPath, keyTypes);
  
    this.keyBuffer = null;
    this.valueBuffer = null;
    
    this.isZMapEvent = true;
  }
  getKeyBuffer() {
    if (this.keyBuffer === null) {
      this.keyBuffer = textEncoder.encode(this.key);
    }
    return this.keyBuffer;
  }
  getValueBuffer() {
    if (this.valueBuffer === null) {
      this.valueBuffer = zbencode(_getBindingForValue(this.value));
    }
    return this.valueBuffer;
  }
  gc() {
    super.gc();
    
    this.keyBuffer = null;
    this.valueBuffer = null;
  }
}
class ZArrayEvent extends ZEvent {
  constructor(keyPath, keyTypes) {
    super(keyPath, keyTypes);
    
    this.arrBuffer = null;
    
    this.isZArrayEvent = true;
  }
  getArrBuffer() {
    if (this.arrBuffer === null) {
      this.arrBuffer = zbencode(_getBindingForArray(this.arr));
    }
    return this.arrBuffer;
  }
  gc() {
    super.gc();
    
    this.arrBuffer = null;
  }
}
class ZMapSetEvent extends ZMapEvent {
  constructor(keyPath, keyTypes, key, value) {
    super(keyPath, keyTypes);
    
    this.key = key;
    this.value = _getBindingForValue(value);
    
    this.isZMapSetEvent = true;
  }
  static METHOD = ++zEventsIota;
  static Type = ZMap;
  apply() {
    if (!this.impl) {
      console.warn('no impl', this);
    }
    this.impl.binding[this.key] = this.value;
  }
  getConstructorArgs() {
    return [this.keyPath, this.keyTypes, this.key, this.value];
  }
  getAction() {
    return {
      action: 'update',
      key: this.key,
      value: this.value,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyBuffer().byteLength; // key path data
    totalSize = align4(totalSize);

    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key types length
    totalSize += this.getKeyTypesBuffer().byteLength; // key types data
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

    const ktjb = this.getKeyTypesBuffer();
    dataView.setUint32(index, ktjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(ktjb, index);
    index += ktjb.byteLength;
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
  static deserializeUpdate(uint8Array) {
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

    const ktjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const ktjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, ktjbLength);
    const keyTypes = JSON.parse(textDecoder.decode(ktjb)); 
    index += ktjbLength;
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

    return new this(
      keyPath,
      keyTypes,
      key,
      value
    );
  }
}
class ZMapDeleteEvent extends ZMapEvent {
  constructor(keyPath, keyTypes, key, oldValue = null) {
    super(keyPath, keyTypes);

    this.key = key;
    this.oldValue = oldValue;
    
    this.isZMapDeleteEvent = true;
  }
  static METHOD = ++zEventsIota;
  static Type = ZMap;
  apply() {
    this.oldValue = this.impl.binding[this.key];
    delete this.impl.binding[this.key];
  }
  getConstructorArgs() {
    return [this.keyPath, this.keyTypes, this.key, this.oldValue];
  }
  getAction() {
    return {
      action: 'delete',
      key: this.key,
      value: this.oldValue,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);

    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key types length
    totalSize += this.getKeyTypesBuffer().byteLength; // key types data
    totalSize = align4(totalSize);
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key length
    totalSize += this.getKeyBuffer().byteLength; // key data
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

    const ktjb = this.getKeyTypesBuffer();
    dataView.setUint32(index, ktjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(ktjb, index);
    index += ktjb.byteLength;
    index = align4(index);
    
    const kb = this.getKeyBuffer();
    dataView.setUint32(index, kb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(kb, index);
    index += kb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(uint8Array) {
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

    const ktjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const ktjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, ktjbLength);
    const keyTypes = JSON.parse(textDecoder.decode(ktjb)); 
    index += ktjbLength;
    index = align4(index);

    const kbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const kb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, kbLength);
    const key = textDecoder.decode(kb);
    index += kbLength;
    index = align4(index);
    
    return new this(
      keyPath,
      keyTypes,
      key
    );
  }
}
class ZArrayPushEvent extends ZArrayEvent {
  constructor(keyPath, keyTypes, arr) {
    super(keyPath, keyTypes);

    // console.log('check binding', arr, this.arr);
    this.arr = _getBindingForArray(arr);
    this.index = -1;
    
    this.isZArrayPushEvent = true;
  }
  static METHOD = ++zEventsIota;
  static Type = ZArray;
  apply() {
    const arrBinding = this.arr;
    this.index = this.impl.binding.e.length;
    this.impl.binding.e.push.apply(this.impl.binding.e, arrBinding);
    const zid = this.keyPath[this.keyPath.length - 1];
    this.impl.binding.i.push(zid);

    const keyType = this.keyTypes[this.keyTypes.length - 1];
    const Type = _getImplConstructorForKeyType(keyType);
    const value = this.arr[0];
    let impl = bindingsMap.get(value);
    if (Type && !(impl instanceof Type)) {
      const binding = value;
      impl = new Type(binding, this.impl.doc);
      bindingsMap.set(binding, impl);
      bindingParentsMap.set(binding, this.impl.binding);
      // console.log('forge array value during apply', binding, impl);
    }
  }
  getConstructorArgs() {
    return [this.keyPath, this.keyTypes, this.arr];
  }
  getAction() {
    const keyType = this.keyTypes[this.keyTypes.length - 1];
    const Type = _getImplConstructorForKeyType(keyType);
    const value = this.arr[0];
    let impl = bindingsMap.get(value);
    if (Type && !(impl instanceof Type)) {
      const binding = value;
      impl = new Type(binding, this.impl.doc);
      bindingsMap.set(binding, impl);
      bindingParentsMap.set(binding, this.impl.binding);
      // console.log('forge array value during change event emit', binding, impl);
    }

    return {
      action: 'add',
      key: this.index,
      value: this.arr[0],
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);

    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key types length
    totalSize += this.getKeyTypesBuffer().byteLength; // key types data
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

    const ktjb = this.getKeyTypesBuffer();
    dataView.setUint32(index, ktjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(ktjb, index);
    index += ktjb.byteLength;
    index = align4(index);
    
    const arrb = this.getArrBuffer();
    dataView.setUint32(index, arrb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    uint8Array.set(arrb, index);
    index += arrb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(uint8Array) {
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

    const ktjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const ktjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, ktjbLength);
    const keyTypes = JSON.parse(textDecoder.decode(ktjb)); 
    index += ktjbLength;
    index = align4(index);

    const arrLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    
    const arrb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, arrLength);
    const arr = zbdecode(arrb);
    index += arrLength;
    index = align4(index);
    
    return new this(
      keyPath,
      keyTypes,
      arr
    );
  }
}
class ZArrayDeleteEvent extends ZArrayEvent {
  constructor(keyPath, keyTypes) {
    super(keyPath, keyTypes);

    this.index = -1;
    this.oldValue = null;
    
    this.isZArrayDeleteEvent = true;
  }
  static METHOD = ++zEventsIota;
  static Type = ZArray;
  apply() {
    const zid = this.keyPath[this.keyPath.length - 1];
    this.index = this.impl.binding.i.indexOf(zid);
    this.oldValue = this.impl.binding.e.splice(this.index, 1)[0];
    this.impl.binding.i.splice(this.index, 1);
  }
  getConstructorArgs() {
    return [this.keyPath, this.keyTypes];
  }
  getAction() {
    return {
      action: 'delete',
      key: this.index,
      value: this.oldValue,
    };
  }
  computeUpdateByteLength() {
    let totalSize = 0;
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // method
    
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key path length
    totalSize += this.getKeyPathBuffer().byteLength; // key path data
    totalSize = align4(totalSize);

    totalSize += Uint32Array.BYTES_PER_ELEMENT; // key types length
    totalSize += this.getKeyTypesBuffer().byteLength; // key types data
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

    const ktjb = this.getKeyTypesBuffer();
    dataView.setUint32(index, ktjb.byteLength, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    uint8Array.set(ktjb, index);
    index += ktjb.byteLength;
    index = align4(index);
  }
  static deserializeUpdate(uint8Array) {
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

    const ktjbLength = dataView.getUint32(index, true);
    index += Uint32Array.BYTES_PER_ELEMENT;
    const ktjb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, ktjbLength);
    const keyTypes = JSON.parse(textDecoder.decode(ktjb)); 
    index += ktjbLength;
    index = align4(index);
    
    return new this(
      keyPath,
      keyTypes,
    );
  }
}
const ZEVENT_CONSTRUCTORS = [
  null, // start at 1
  ZNullEvent,
  ZMapSetEvent,
  ZMapDeleteEvent,
  ZArrayPushEvent,
  ZArrayDeleteEvent,
];

globalThis.maxHistoryLength = 0;
globalThis.maxHistoryTailLength = 0;
function applyUpdate(doc, uint8Array, transactionOrigin, playerId) {
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

    if (doc.mirror) {
      // console.log('mirror yes');
      doc.dispatchEvent('update', encodedData, transactionOrigin, this, null);
    } /* else {
      console.log('mirror no');
    } */
  };
  const _handleTransactionMessage = () => {
    let transactionCache = TransactionCache.deserializeUpdate(uint8Array);
    transactionCache.doc = doc;
    transactionCache.origin = transactionOrigin;

    /* console.log('packet 0', playerId, transactionOrigin, doc.clock, transactionCache.startClock, transactionCache.events.length, util.inspect(transactionCache.events, {
      depth: 5,
    })); */

    // rebase on top of local history as needed
    if (transactionCache.startClock === doc.clock) {
      // nothing
    } else if (transactionCache.startClock < doc.clock) {
      transactionCache.rebase();
    } else {
      throw new Error('transaction skipped clock ticks; desynced');
    }
    
    transactionCache.bindEventsToDoc();
    for (const event of transactionCache.events) {
      event.apply();
      // doc.clock++;
      event.triggerObservers();
      event.gc();
    }

    for (const event of transactionCache.events) {
      event.resolvePriority = transactionCache.resolvePriority;
      doc.pushHistory(event);
    }

    if (doc.mirror) {
      // console.log('mirror yes');
      transactionCache.resolvePriority = doc.resolvePriority;
      const uint8Array = transactionCache.serializeUpdate();
      doc.dispatchEvent('update', uint8Array, transactionOrigin, this, null);
    } /* else {
      console.log('mirror no');
    } */
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
  TransactionCache,
  applyUpdate,
  encodeStateAsUpdate,
  setRng,
  zbencode,
  zbdecode,
};

const Z = {
  Doc: ZDoc,
  Map: ZMap,
  Array: ZArray,
  TransactionCache,
  applyUpdate,
  encodeStateAsUpdate,
  setRng,
  zbencode,
  zbdecode,
};
export default Z;
globalThis.Z = Z; // XXX testing only

import * as Y from 'yjs'; // XXX testing only
globalThis.Y = Y;