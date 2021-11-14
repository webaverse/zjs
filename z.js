class ZDoc {
  constructor() {
    this.state = {};
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
  static nativeConstructor = () => {};
  has(k) {
    return k in this.binding;
  }
  get(k) {
    return this.binding[k];
  }
  set(k, v) {
    this.binding[k] = v;
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  delete(k) {
    delete this.binding[k];
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  keys() {
    const keys = Object.keys(this.binding);
    let i = 0;
    return {
      next() {
        if (i < keys.length) {
          const key = keys[i++];
          return {
            done: false,
            value: key,
          };
        } else {
          return {
            done: false,
            value: null,
          };
        }
      },
    };
  }
  values() {
    const keys = Object.keys(this.binding);
    let i = 0;
    return {
      next() {
        if (i < keys.length) {
          const key = keys[i++];
          const value = this.get(key);
          return {
            done: false,
            value,
          };
        } else {
          return {
            done: false,
            value: null,
          };
        }
      },
    };
  }
  entries() {
    const keys = Object.keys(this.binding);
    let i = 0;
    return {
      next() {
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
      },
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
  insert(index, v) {
    this.binding.splice(index, 0, v);
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  delete(index, length) {
    this.binding.splice(index, length);
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  push(arr) {
    this.binding.push.apply(this.binding, arr);
    triggerChange(new MessageEvent('change', {
      data: {
      },
    }));
  }
  unshift(arr) {
    this.binding.unshift.apply(this.binding, arr);
    triggerChange(new MessageEvent('change', {
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

const Z = {
  Doc: ZDoc,
  Map: ZMap,
  Array: ZArray,
};