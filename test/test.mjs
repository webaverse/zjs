import assert from 'assert';
import Z from '../z.mjs';

describe('zbencode + zbdecode', function() {
  describe('basic', function() {
    it('should support basic operations', function() {
      const s = 'lol';
      assert.equal(s, Z.zbdecode(Z.zbencode(s)));
    
      const n = 42;
      assert.equal(n, Z.zbdecode(Z.zbencode(n)));
    
      const a = [s, n];
      assert.deepEqual(a, Z.zbdecode(Z.zbencode(a)));

      const o = {
        s,
      };
      assert.deepEqual(o, Z.zbdecode(Z.zbencode(o)));
      
      const float32Array = Float32Array.from([1, 2, 2]);
      const o2 = {
        float32Array,
      };
      assert.deepEqual(o2, Z.zbdecode(Z.zbencode(o2)));
      
      const uint8Array = Uint8Array.from([1, 2, 2]);
      const int16Array = Int8Array.from([1, 2, 2]);
      const o3 = {
        uint8Array,
        int16Array,
        float32Array,
      };
      assert.deepEqual(o3, Z.zbdecode(Z.zbencode(o3)));
    });
  });
});

describe('ZMap', function() {
  describe('basic', function() {
    it('should support basic operations', function() {
      const doc = new Z.Doc();
      const map = doc.getMap('map');
      
      map.set('key', 'value');
      assert.equal(map.get('key'), 'value');
      assert.equal(map.get('key2'), undefined);
      
      const keys = Array.from(map.keys());
      assert.deepEqual(keys, ['key']);
      
      const values = Array.from(map.values());
      assert.deepEqual(values, ['value']);
      
      const entries = Array.from(map.entries());
      assert.deepEqual(entries, [['key', 'value']]);
      
      map.set('key2', 'value2');
      assert.equal(map.get('key2'), 'value2');
    });
  });
});

describe('ZArray', function() {
  describe('basic', function() {
    it('should support basic operations', function() {
      const doc = new Z.Doc();
      const array = doc.getArray('array');
      
      array.push([1]);
      assert.equal(array.get(0), 1);
      assert.equal(array.get(1), undefined);
      assert.equal(array.length, 1);
      assert.deepEqual(array.toJSON(), [1]);
      
      array.push([2]);
      assert.equal(array.length, 2);
      assert.equal(array.get(0), 1);
      assert.equal(array.get(1), 2);
      assert.equal(array.get(2), undefined);
      assert.deepEqual(array.toJSON(), [1, 2]);
      
      array.delete(0);
      assert.equal(array.length, 1);
      assert.equal(array.get(0), 2);
      assert.equal(array.get(1), undefined);
      assert.deepEqual(array.toJSON(), [2]);
    });
  });
});

describe('api limits', function() {
  it('array limits', function() {
    const doc = new Z.Doc();
    const array = doc.getArray('array');

    {
      let numThrows = 0;
      try {
        array.push([1, 2]);
      } catch (err) {
        numThrows++;
      }
      assert.equal(numThrows, 1);
    }
    {
      let numThrows = 0;
      try {
        array.insert(0, [1, 2]);
      } catch (err) {
        numThrows++;
      }
      assert.equal(numThrows, 1);
    }
    {
      let numThrows = 0;
      try {
        array.push([1, 2]);
      } catch (err) {
        numThrows++;
      }
      assert.equal(numThrows, 1);
    }
    {
      let numThrows = 0;
      try {
        array.unshift([1, 2]);
      } catch (err) {
        numThrows++;
      }
      assert.equal(numThrows, 1);
    }
  });
  it('repeat array insert', function() {
    const doc = new Z.Doc();
    const array = doc.getArray('array');
    const map = new Z.Map();
    
    array.push([map]);
    
    let numThrows = 0;
    try {
      array.push([map]);
    } catch (err) {
      numThrows++;
    }
    assert.equal(numThrows, 1);
  });
  it('repeat map insert', function() {
    const doc = new Z.Doc();
    const map = doc.getMap('map');
    const array = new Z.Array();
    
    map.set('lol', array);
    
    let numThrows = 0;
    try {
      map.set('lol', array);
    } catch (err) {
      numThrows++;
    }
    assert.equal(numThrows, 1);
  });
});

describe('complex data', function() {
  it('mixed', function() {
    const doc = new Z.Doc();
    const array = doc.getArray('array');
    const map = doc.getMap('map');
    
    array.push([1]);
    map.set('key', 'value');
    assert.deepEqual(doc.toJSON(), {array: [1], map: {key: 'value'}});
  });
});

describe('observers', function() {
  describe('basic', function() {
    it('array observers', function() {
      {
        const doc = new Z.Doc();
        const array = doc.getArray('array');
        let numObserves = 0;
        const observe = e => {
          assert.deepEqual(e.added, new Set([0]));
          assert.deepEqual(e.deleted, new Set([]));
          assert.deepEqual(e.changes, {
            keys: new Map([[
              0,
              {
                action: 'add',
                oldValue: null,
              },
            ]]),
          });
          
          numObserves++;
        };
        array.observe(observe);
        array.push([1]);
        assert.equal(numObserves, 1);
      }
      {
        const doc = new Z.Doc();
        const array = doc.getArray('array');
        let numObserves = 0;
        const observe = e => {
          numObserves++;
        };
        array.observe(observe);
        array.unobserve(observe);
        array.push([1]);
        assert.equal(numObserves, 0);
      }
    });
    it('map observers', function() {
      {
        const doc = new Z.Doc();
        const map = doc.getMap('map');
        let numObserves = 0;
        const observe = e => {
          assert.deepEqual(e.added, new Set([]));
          assert.deepEqual(e.deleted, new Set([]));
          assert.deepEqual(e.changes, {
            keys: new Map([[
              'key',
              {
                action: 'update',
                oldValue: null,
              },
            ]]),
          });
          
          numObserves++;
        };
        map.observe(observe);
        map.set('key', 'value');
        assert.equal(numObserves, 1);
      }
      {
        const doc = new Z.Doc();
        const map = doc.getMap('map');
        let numObserves = 0;
        const observe = e => {
          numObserves++;
        };
        map.observe(observe);
        map.unobserve(observe);
        map.set('key', 'value');
        assert.equal(numObserves, 0);
      }
    });
  });
});

describe('sync', function() {
  describe('state reset', function() {
    it('basic state reset', function() {
      const doc1 = new Z.Doc();
      const map1 = doc1.getMap('map');
      
      const doc2 = new Z.Doc();
      const map2 = doc2.getMap('map');
      
      const doc3 = new Z.Doc();
      const map3 = doc3.getMap('map');
      
      map1.id = 1;
      map2.id = 2;
      map3.id = 3;
      
      map1.set('key', 'value');
      
      {
        const uint8Array = Z.encodeStateAsUpdate(doc1);
        Z.applyUpdate(doc2, uint8Array);

        assert.deepEqual(map1.toJSON(), {key: 'value'});
        assert.deepEqual(map2.toJSON(), {key: 'value'});
      }
      {
        let numObserves = 0;
        const observe = e => {
          assert.deepEqual(e.added, new Set(['key']));
          assert.deepEqual(e.deleted, new Set([]));
          assert.deepEqual(e.changes, {
            keys: new Map([[
              'key',
              {
                action: 'add',
                oldValue: null,
              },
            ]]),
          });
          
          numObserves++
        };
        map3.observe(observe);
        
        const uint8Array = Z.encodeStateAsUpdate(doc2);
        Z.applyUpdate(doc3, uint8Array);

        assert.equal(numObserves, 1);
        assert.deepEqual(map3.toJSON(), {key: 'value'});
      }
    });
  });
  describe('transactions', function() {
    it('array insert', function() {
      const doc1 = new Z.Doc();
      const array1 = doc1.getArray('array');
      
      const doc2 = new Z.Doc();
      const array2 = doc2.getArray('array');
      
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        Z.applyUpdate(doc2, uint8Array, origin);
      });
      doc1.transact(() => {
        array1.insert(0, ['lol']);
      });
      assert.deepEqual(array1.toJSON(), ['lol']);
      assert.deepEqual(array2.toJSON(), ['lol']);
    });
    it('array delete', function() {
      const doc1 = new Z.Doc();
      const array1 = doc1.getArray('array');
      
      const doc2 = new Z.Doc();
      const array2 = doc2.getArray('array');
      
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        Z.applyUpdate(doc2, uint8Array, origin);
      });
      doc1.transact(() => {
        array1.push(['lol']);
        array1.delete(0);
      });
      assert.deepEqual(array1.toJSON(), []);
      assert.deepEqual(array2.toJSON(), []);
    });
    it('array push', function() {
      const doc1 = new Z.Doc();
      const array1 = doc1.getArray('array');
      
      const doc2 = new Z.Doc();
      const array2 = doc2.getArray('array');
      
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        Z.applyUpdate(doc2, uint8Array, origin);
      });
      doc1.transact(() => {
        array1.push(['lol']);
      });
      assert.deepEqual(array1.toJSON(), ['lol']);
      assert.deepEqual(array2.toJSON(), ['lol']);
    });
    it('array unshift', function() {
      const doc1 = new Z.Doc();
      const array1 = doc1.getArray('array');
      
      const doc2 = new Z.Doc();
      const array2 = doc2.getArray('array');
      
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        Z.applyUpdate(doc2, uint8Array, origin);
      });
      doc1.transact(() => {
        array1.unshift(['lol']);
      });
      assert.deepEqual(array1.toJSON(), ['lol']);
      assert.deepEqual(array2.toJSON(), ['lol']);
    });
    it('map set', function() {
      const doc1 = new Z.Doc();
      const map1 = doc1.getMap('map');
      
      const doc2 = new Z.Doc();
      const map2 = doc2.getMap('map');
      
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        // console.log('got update', uint8Array, origin);
        Z.applyUpdate(doc2, uint8Array, origin);
      });
      doc1.transact(() => {
        map1.set('key', 'value');
      });
      assert.deepEqual(map1.toJSON(), {key: 'value'});
      assert.deepEqual(map2.toJSON(), {key: 'value'});
    });
    it('map delete', function() {
      const doc1 = new Z.Doc();
      const map1 = doc1.getMap('map');
      
      const doc2 = new Z.Doc();
      const map2 = doc2.getMap('map');
      
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        Z.applyUpdate(doc2, uint8Array, origin);
      });
      doc1.transact(() => {
        map1.set('key', 'value');
        map1.delete('key');
      });
      assert.deepEqual(map1.toJSON(), {});
      assert.deepEqual(map2.toJSON(), {});
    });
  });
});