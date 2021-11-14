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
}

class ZArray extends ZObservable {
  constructor(binding) {
    super(binding);
  }
  static nativeConstructor = () => [];
  get length() {
    return this.binding.length;
  }
  get length(length) {
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
  [Symbol.Iterator]: () => {
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
  },
}

const Z = {
  Doc: ZDoc,
  Map: ZMap,
  Array: ZArray,
};