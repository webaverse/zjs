import {align4} from './util.mjs';

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
  const addendumTypes = [];
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
      addendumTypes.push(addendumType)
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
  totalSize = align4(totalSize);
  totalSize += Uint32Array.BYTES_PER_ELEMENT; // count
  for (const addendum of addendums) {
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // index
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // type
    totalSize += Uint32Array.BYTES_PER_ELEMENT; // length
    totalSize += addendum.byteLength; // data
    totalSize = align4(totalSize);
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
      index += sb.byteLength;
      index = align4(index);
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
      
      dataView.setUint32(index, addendum.byteLength, true);
      index += Uint32Array.BYTES_PER_ELEMENT;
      
      uint8Array.set(new Uint8Array(addendum.buffer, addendum.byteOffset, addendum.byteLength), index);
      index += addendum.byteLength;
      index = align4(index);
    }
  }
  return uint8Array;
}
function zbdecode(uint8Array) {
  const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  
  let index = 0;
  const sbLength = dataView.getUint32(index, true);
  index += Uint32Array.BYTES_PER_ELEMENT;
  
  const sb = new Uint8Array(uint8Array.buffer, uint8Array.byteOffset + index, sbLength);
  index += sbLength;
  index = align4(index);
  const s = textDecoder.decode(sb);
  const j = JSON.parse(s);
  
  const numAddendums = dataView.getUint32(index, true);
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
      console.warn('failed to find typed array cons for', addendumType);
    }
    const addendum = TypedArrayCons ?
      new TypedArrayCons(
        uint8Array.buffer,
        uint8Array.byteOffset + index,
        addendumLength / TypedArrayCons.BYTES_PER_ELEMENT
      )
    : null;
    index += addendumLength;
    index = align4(index);
    
    addendums[i] = addendum;
    addendumIndexes[i] = addendumIndex;
    addendumTypes[i] = addendumType;
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
        console.warn('ignoring during zbdecode:', o);
        return null;
      }
    };
    const result = _recurse(j);
    if (currentAddendum !== addendums.length) {
      console.warn('did not bind all addendums', result, currentAddendum, addendums);
    }
    return result;
  }
}

export {
  zbencode,
  zbdecode,
};