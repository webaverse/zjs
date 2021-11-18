import assert from 'assert';
import Z from '../z.mjs';
import alea from 'alea';

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
  describe('detached', function() {
    const map = new Z.Map();
    
    map.set('key', 'value');
    assert.equal(map.get('key'), 'value');
    assert.equal(map.get('key2'), undefined);
  });
  describe('inline', function() {
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
  describe('delayed attach', function() {
    const map = new Z.Map();
    map.set('key', 'value');
    
    const doc = new Z.Doc();
    const array = doc.getArray('array');
    array.push([map]);
    
    assert.deepEqual(doc.toJSON(), {
      array: [
        {
          key: 'value',
        },
      ],
    });
  });
});

describe('ZArray', function() {
  describe('detached', function() {
    const array = new Z.Array();
    
    array.push([1]);
    assert.equal(array.get(0), 1);
    assert.equal(array.get(1), undefined);
    assert.equal(array.length, 1);
    assert.deepEqual(array.toJSON(), [1]);
  });
  describe('inline', function() {
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
  describe('delayed attach', function() {
    const array = new Z.Array();
    array.push([1]);
    
    const doc = new Z.Doc();
    const map = doc.getMap('map');
    map.set('array', array);
    
    assert.deepEqual(doc.toJSON(), {
      map: {
        array: [1],
      },
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
});

describe('complex data', function() {
  it('mixed map array', function() {
    const doc = new Z.Doc();
    const array = doc.getArray('array');
    const map = doc.getMap('map');
    
    array.push([1]);
    map.set('key', 'value');
    assert.deepEqual(doc.toJSON(), {array: [1], map: {key: 'value'}});
  });
  it('array of maps', function() {
    const doc = new Z.Doc();
    const array = doc.getArray('array');

    const map1 = new Z.Map();
    const map2 = new Z.Map();
    const map3 = new Z.Map();
    array.push([map1]);
    array.push([map2]);
    array.push([map3]);

    map2.set('lol2', 'zol2');
    map1.set('lol1', 32.5);
    const float32Array = Float32Array.from([1, 2, 3]);
    map3.set('lol3', float32Array);

    assert.deepEqual(doc.toJSON(), {
      array: [
        {
          lol1: 32.5,
        },
        {
          lol2: 'zol2',
        },
        {
          lol3: float32Array,
        },
      ],
    });
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
                value: 1,
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
          assert.deepEqual(e.added, new Set(['key']));
          assert.deepEqual(e.deleted, new Set([]));
          assert.deepEqual(e.changes, {
            keys: new Map([[
              'key',
              {
                action: 'update',
                value: 'value',
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
      const array1 = doc1.getArray('array');
      
      const doc2 = new Z.Doc();
      const map2 = doc2.getMap('map');
      const array2 = doc2.getArray('array');
      
      const doc3 = new Z.Doc();
      const map3 = doc3.getMap('map');
      const array3 = doc3.getArray('array');
      
      map1.set('key', 'value');
      array1.push([7]);
      
      {
        const uint8Array = Z.encodeStateAsUpdate(doc1);
        Z.applyUpdate(doc2, uint8Array);

        assert.deepEqual(map1.toJSON(), {key: 'value'});
        assert.deepEqual(map2.toJSON(), {key: 'value'});
        assert.deepEqual(array1.toJSON(), [7]);
        assert.deepEqual(array2.toJSON(), [7]);
      }
      {
        let numObserves = 0;
        const observe1 = e => {
          assert.deepEqual(e.added, new Set(['key']));
          assert.deepEqual(e.deleted, new Set([]));
          assert.deepEqual(e.changes, {
            keys: new Map([[
              'key',
              {
                action: 'add',
                value: 'value',
              },
            ]]),
          });
          
          numObserves++
        };
        map3.observe(observe1);
        
        const observe2 = e => {
          assert.deepEqual(e.added, new Set([0]));
          assert.deepEqual(e.deleted, new Set([]));
          assert.deepEqual(e.changes, {
            keys: new Map([[
              0,
              {
                action: 'add',
                value: 7,
              },
            ]]),
          });
          
          numObserves++
        };
        array3.observe(observe2);
        
        const uint8Array = Z.encodeStateAsUpdate(doc2);
        Z.applyUpdate(doc3, uint8Array);

        assert.equal(numObserves, 2);
        assert.deepEqual(map3.toJSON(), {key: 'value'});
        assert.deepEqual(array3.toJSON(), [7]);
      }
    });
  });
  describe('basic transactions', function() {
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
  describe('non-conflicting transactions', function() {
    const run = forward => function() {
      const doc1 = new Z.Doc();
      const array1 = doc1.getArray('array');
      const map1 = doc1.getMap('map');
      
      const doc2 = new Z.Doc();
      const array2 = doc2.getArray('array');
      const map2 = doc2.getMap('map');
      
      const doc3 = new Z.Doc();
      const array3 = doc3.getArray('array');
      const map3 = doc3.getMap('map');
      
      let doc1Update;
      doc1.on('update', (uint8Array, origin, doc, transaction) => {
        if (origin === 'doc1') {
          doc1Update = uint8Array;
        }
      });
      let doc2Update;
      doc2.on('update', (uint8Array, origin, doc, transaction) => {
        if (origin === 'doc2') {
          doc2Update = uint8Array;
        }
      });
      doc3.on('update', (uint8Array, origin, doc, transaction) => {
        if (origin === 'doc1') {
          Z.applyUpdate(doc2, uint8Array, origin);
        } else if (origin === 'doc2') {
          Z.applyUpdate(doc1, uint8Array, origin);
        }
      });
      
      doc1.transact(() => {
        array1.push(['lol']);
      }, 'doc1');
      doc2.transact(() => {
        map2.set('lol', 'zol');
      }, 'doc2');
      
      let fns = [
        () => {
          Z.applyUpdate(doc3, doc1Update, 'doc1');
        },
        () => {
          Z.applyUpdate(doc3, doc2Update, 'doc2');
        },
      ];
      if (!forward) {
        fns = fns.reverse();
      }
      for (const fn of fns) {
        fn();
      }
      
      assert.deepEqual(array3.toJSON(), ['lol']);
      assert.deepEqual(map3.toJSON(), {lol: 'zol'});
      assert.deepEqual(array1.toJSON(), ['lol']);
      assert.deepEqual(map1.toJSON(), {lol: 'zol'});
      assert.deepEqual(array2.toJSON(), ['lol']);
      assert.deepEqual(map2.toJSON(), {lol: 'zol'});
      
      assert.equal(doc1.clock, 2);
      assert.equal(doc2.clock, 2);
      assert.equal(doc3.clock, 2);
    }
    it('array + map', run(true));
    it('array + map reverse', run(false));
  });
  describe('conflicting transactions', function() {
    {
      const run = forward => function() {
        const doc1 = new Z.Doc();
        doc1.setResolvePriority(1);
        const array1 = doc1.getArray('array');
        const map1 = doc1.getMap('map');
        
        const doc2 = new Z.Doc();
        doc2.setResolvePriority(1);
        const array2 = doc2.getArray('array');
        const map2 = doc2.getMap('map');
        
        const doc3 = new Z.Doc();
        doc3.setResolvePriority(0);
        const array3 = doc3.getArray('array');
        const map3 = doc3.getMap('map');

        // initialize
        {
          array1.push([1]);
          const uint8Array = Z.encodeStateAsUpdate(doc1);
          Z.applyUpdate(doc2, uint8Array);
          Z.applyUpdate(doc3, uint8Array);
        }

        let doc1Update;
        doc1.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc1') {
            doc1Update = uint8Array;
          }
        });
        let doc2Update;
        doc2.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc2') {
            doc2Update = uint8Array;
          }
        });

        doc1.transact(() => {
          array1.push([2]);
        }, 'doc1');
        doc2.transact(() => {
          array2.delete(0);
        }, 'doc2');

        if (forward) {
          Z.applyUpdate(doc3, doc1Update, 'doc1');
          Z.applyUpdate(doc3, doc2Update, 'doc2');
        } else {
          Z.applyUpdate(doc3, doc2Update, 'doc2');
          Z.applyUpdate(doc3, doc1Update, 'doc1');
        }

        assert.deepEqual(array3.toJSON(), [2]);
      };
      it('conflicting array push delete', run(true));
      it('conflicting array push delete', run(false));
    }
    {
      const run = forward => function() {
        const doc1 = new Z.Doc();
        doc1.setResolvePriority(1);
        const array1 = doc1.getArray('array');
        const map1 = doc1.getMap('map');
        
        const doc2 = new Z.Doc();
        doc2.setResolvePriority(1);
        const array2 = doc2.getArray('array');
        const map2 = doc2.getMap('map');
        
        const doc3 = new Z.Doc();
        doc3.setResolvePriority(0);
        const array3 = doc3.getArray('array');
        const map3 = doc3.getMap('map');

        // initialize
        {
          array1.push([1]);
          array1.push([2]);
          const uint8Array = Z.encodeStateAsUpdate(doc1);
          Z.applyUpdate(doc2, uint8Array);
          Z.applyUpdate(doc3, uint8Array);
        }

        let doc1Update;
        doc1.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc1') {
            doc1Update = uint8Array;
          }
        });
        let doc2Update;
        doc2.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc2') {
            doc2Update = uint8Array;
          }
        });

        doc1.transact(() => {
          array1.delete(0);
        }, 'doc1');
        doc2.transact(() => {
          array2.delete(0);
        }, 'doc2');

        if (forward) {
          Z.applyUpdate(doc3, doc1Update, 'doc1');
          Z.applyUpdate(doc3, doc2Update, 'doc2');
        } else {
          Z.applyUpdate(doc3, doc2Update, 'doc2');
          Z.applyUpdate(doc3, doc1Update, 'doc1');
        }

        assert.deepEqual(array3.toJSON(), [2]);
      };
      it('conflicting array delete same', run(true));
      it('conflicting array delete same reverse', run(true));
    }
    {
      const run = forward => function() {
        const doc1 = new Z.Doc();
        doc1.setResolvePriority(1);
        const array1 = doc1.getArray('array');
        const map1 = doc1.getMap('map');
        
        const doc2 = new Z.Doc();
        doc2.setResolvePriority(1);
        const array2 = doc2.getArray('array');
        const map2 = doc2.getMap('map');
        
        const doc3 = new Z.Doc();
        doc3.setResolvePriority(0);
        const array3 = doc3.getArray('array');
        const map3 = doc3.getMap('map');

        // initialize
        {
          array1.push([1]);
          array1.push([2]);
          array1.push([3]);
          const uint8Array = Z.encodeStateAsUpdate(doc1);
          Z.applyUpdate(doc2, uint8Array);
          Z.applyUpdate(doc3, uint8Array);
        }

        let doc1Update;
        doc1.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc1') {
            doc1Update = uint8Array;
          }
        });
        let doc2Update;
        doc2.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc2') {
            doc2Update = uint8Array;
          }
        });

        doc1.transact(() => {
          array1.delete(0);
        }, 'doc1');
        doc2.transact(() => {
          array2.delete(2);
        }, 'doc2');

        if (forward) {
          Z.applyUpdate(doc3, doc1Update, 'doc1');
          Z.applyUpdate(doc3, doc2Update, 'doc2');
        } else {
          Z.applyUpdate(doc3, doc2Update, 'doc2');
          Z.applyUpdate(doc3, doc1Update, 'doc1');
        }

        assert.deepEqual(array3.toJSON(), [2]);
      };
      it('conflicting array delete different', run(true));
      it('conflicting array delete different reverse', run(false));
    }
    {
      const run = forward => function() {
        const doc1 = new Z.Doc();
        doc1.setResolvePriority(1);
        const array1 = doc1.getArray('array');
        
        const doc2 = new Z.Doc();
        doc2.setResolvePriority(1);
        const array2 = doc2.getArray('array');
        
        const doc3 = new Z.Doc();
        doc3.setResolvePriority(0);
        const array3 = doc3.getArray('array');

        const map1 = new Z.Map();
        const map2 = new Z.Map();
        const map3 = new Z.Map();

        // initialize
        {
          array1.push([map1]);
          array1.push([map2]);
          array1.push([map3]);
          
          map2.set('lol2', 'zol2');
          map3.set('lol3', 'zol3');
          
          const uint8Array = Z.encodeStateAsUpdate(doc1);
          Z.applyUpdate(doc2, uint8Array);
          Z.applyUpdate(doc3, uint8Array);
        }

        let doc1Update;
        doc1.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc1') {
            doc1Update = uint8Array;
          }
        });
        let doc2Update;
        doc2.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc2') {
            doc2Update = uint8Array;
          }
        });

        doc1.transact(() => {
          map1.set('lol1', 'zol1');
        }, 'doc1');
        doc2.transact(() => {
          array2.delete(0);
        }, 'doc2');

        if (forward){
          Z.applyUpdate(doc3, doc1Update, 'doc1');
          Z.applyUpdate(doc3, doc2Update, 'doc2');
        } else {
          Z.applyUpdate(doc3, doc2Update, 'doc2');
          Z.applyUpdate(doc3, doc1Update, 'doc1');
        }

        assert.deepEqual(array3.toJSON(), [
          {
            lol2: 'zol2',
          },
          {
            lol3: 'zol3',
          }
        ]);
      };
      it('conflicting deep array > map', run(true));
      it('conflicting deep array > map reverse', run(false));
    }
    {
      const run = forward => function() {
        const doc1 = new Z.Doc();
        doc1.setResolvePriority(1);
        const map1 = doc1.getMap('map');
        
        const doc2 = new Z.Doc();
        doc2.setResolvePriority(1);
        const map2 = doc2.getMap('map');
        
        const doc3 = new Z.Doc();
        doc3.setResolvePriority(0);
        const map3 = doc3.getMap('map');

        const array11 = new Z.Array();
        const array12 = new Z.Array();
        const array13 = new Z.Array();
        
        const array21 = new Z.Array();
        const array22 = new Z.Array();
        const array23 = new Z.Array();

        // initialize
        {
          map1.set('array1', array11);
          map1.set('array2', array12);
          map1.set('array3', array13);
          
          map2.set('array1', array21);
          map2.set('array2', array22);
          map2.set('array3', array23);
          
          array11.push([1]);
          array11.push([2]);
          array11.push([3]);
          
          array12.push([4]);
          array12.push([5]);
          array12.push([6]);
          
          array13.push([7]);
          array13.push([8]);
          array13.push([9]);
          
          const uint8Array = Z.encodeStateAsUpdate(doc1);
          Z.applyUpdate(doc2, uint8Array);
          Z.applyUpdate(doc3, uint8Array);
        }

        let doc1Update;
        doc1.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc1') {
            doc1Update = uint8Array;
          }
        });
        let doc2Update;
        doc2.on('update', (uint8Array, origin, doc, transaction) => {
          if (origin === 'doc2') {
            doc2Update = uint8Array;
          }
        });

        doc1.transact(() => {
          map1.set('array1', 42);
          map1.set('array1', 20);
          map1.delete('array1');
          map1.set('array1', null);
        }, 'doc1');
        doc2.transact(() => {
          array21.delete(0);
          array21.push([100]);
          array21.delete(2);
          array21.push([100]);
          array21.push([101]);
          array21.delete(0);
        }, 'doc2');

        if (forward) {
          Z.applyUpdate(doc3, doc1Update, 'doc1');
          Z.applyUpdate(doc3, doc2Update, 'doc2');
        } else {
          Z.applyUpdate(doc3, doc2Update, 'doc2');
          Z.applyUpdate(doc3, doc1Update, 'doc1');
        }
        
        {
          const map3 = doc3.getMap('map');
          const array31 = map3.get('array1');
          const array32 = map3.get('array2', Z.Array);
          const array33 = map3.get('array3', Z.Array);
        }

        assert.deepEqual(doc3.toJSON(), {
          map: {
            array1: null,
            array2: [4, 5, 6],
            array3: [7, 8, 9],
          },
        });
      };
      it('conflicting deep map > array', run(true));
      it('conflicting deep map > array reverse', run(false));
    }
  });
});
describe('stress test', function() {
  const _makeId = () => Math.random().toString(36).substr(2, 5);
  const rng = new alea('lol');
  
  class Simulation {
    constructor(server = new ServerWorldView(), clients = []) {
      this.server = server;
      this.clients = clients;
    }
    update() {
      // add/remove players
      {      
        const r = rng();
        if (r < 1/3) {
          const client = new ClientWorldView();
          const uint8Array = Z.encodeStateAsUpdate(this.server.doc);
          Z.applyUpdate(client.doc, uint8Array);
          this.clients.push(client);

          this.server.pipe(client);
          client.pipe(this.server);
        } else if (r < 2/3) {
          if (this.clients.length > 0) {
            const index = Math.floor(rng() * this.clients.length);
            const client = this.clients[index];
            this.server.clearPlayer(client.playerId);
            this.clients.splice(index, 1);

            this.server.unpipe(client);
            client.unpipe(this.server);
          }
        }
      }
      // tick all clients
      {
        for (const client of this.clients) {
          client.update();
        }
      }
      // tick server
      {
        this.server.update();
      }
    }
    clone() {
      return new Simulation(
        this.server.clone(),
        this.clients.map(client => client.clone())
      );
    }
    flushAndVerify() {
      
    }
  }
  class AppManager {
    constructor(appsArray) {
      this.appsArray = appsArray;
    }
    update() {
      // XXX
    }
  }
  class PacketQueueEntry {
    constructor(data, delay) {
      this.data = data;
      this.delay = delay;
    }
  }
  class WorldView {
    constructor(doc = new Z.Doc()) {
      this.doc = doc;
      this.appManager = null;
      this.remotePlayers = [];

      // packet buffer
      this.packetDestinations = [];
      this.outPacketQueue = [];
      
      // listeners

      // listen for local data spout
      this.doc.on('update', (uint8Array, origin, doc, transaction) => {
        // decide a packet delay for hte simulation. it must be between 0-5 and a power bias towards lower values.
        const delay = Math.floor(Math.pow(Math.random() * 5, 0.7));
        this.outPacketQueue.push(new PacketQueueEntry(uint8Array, 0));
      });

      // listen for players
      const playersArray = this.getPlayersArray();
      playersArray.observe(e => {
        // console.log('got deleted', deleted);
        for (const index of e.deleted) {
          // console.log('check changes', e.changes?.keys);
          const oldPlayerMap = e.changes.keys.get(index).value;
          const playerId = oldPlayerMap.get('playerId');
          const oldPlayerIndex = this.remotePlayers.findIndex(player => player.playerId);
          if (oldPlayerIndex !== -1) {
            const oldPlayer = this.remotePlayers[oldPlayerIndex];
            oldPlayer.destroy();
            this.remotePlayers.splice(oldPlayerIndex, 1);
          } else {
            throw new Error('delete nonexistent player: ' + playerId);
          }
        }
        for (const newKey of e.added) {
          const newPlayerMap = playersArray.get(newKey, Z.Map);
          // console.log('got new player', newKey, newPlayerMap);
          const newPlayer = new Player(newPlayerMap);
          this.remotePlayers.push(newPlayer);
        }
      });
    }
    update() {
      this.appManager.update();
    }
    getPlayersArray() {
      return this.doc.getArray('players');
    }
    pipe(packetDestination) {
      this.packetDestinations.push(packetDestination);
    }
    unpipe(packetDestination) {
      const index = this.packetDestinations.indexOf(packetDestination);
      if (index !== -1) {
        this.packetDestinations.splice(index, 1);
      } else {
        throw new Error('unpipe nonexistent packet destination');
      }
    }
    pushPacket(data, delay = 0) {
      const e = new PacketQueueEntry(data, delay);
      this.outPacketQueue.push(e);
    }
    update() {
      const _tickPackets = () => {
        if (this.outPacketQueue.length > 0) {
          const packet = this.outPacketQueue[0];
          if (packet.delay > 0) {
            packet.delay--;
          } else {
            for (const packetDestination of this.packetDestinations) {
              packetDestination.handleData(packet.data);
            }
            this.outPacketQueue.shift();
          }
        }
      };
      _tickPackets();
    }
    handleData(uint8Array) {
      Z.applyUpdate(this.doc, uint8Array);
    }
    clone() {
      return new WorldView(this.doc.clone());
    }
  }
  class ServerWorldView extends WorldView {
    constructor() {
      super();
      
      this.playerId = 'server';
      const appsArray = this.doc.getArray('world.apps');
      this.appManager = new AppManager(appsArray);
    }
    clearPlayer(playerId) {
      const playerIndex = this.remotePlayers.findIndex(player => {
        return player.playerId === playerId;
      });
      if (playerIndex !== -1) {
        const playersArray = this.getPlayersArray();
        playersArray.delete(playerIndex);
      } /* else {
        throw new Error('failed to clear player: ' + playerId);
      } */
    }
  }
  class ClientWorldView extends WorldView {
    constructor() {
      super();
      
      this.playerId = 'player.' + _makeId();
      const playersArray = this.getPlayersArray();
      const localPlayerMap = new Z.Map();
      localPlayerMap.set('playerId', this.playerId);
      localPlayerMap.set('position', Float32Array.from([0, 0, 0]));
      const appsArray = new Z.Array();
      localPlayerMap.set('apps', appsArray);
      playersArray.push([localPlayerMap]);
      this.localPlayer = new Player(localPlayerMap);
      this.appManager = new AppManager(appsArray);
    }
  }
  class Player {
    constructor(playerMap) {
      this.playerMap = playerMap;
      const appsArray = playerMap.get('apps', Z.Array);
      this.appManager = new AppManager(appsArray);
    }
    get playerId() {
      return this.playerMap.get('playerId');
    }
    set playerId(playerId) {
      this.playerMap.set('playerId', playerId);
    }
    destroy() {
      // XXX
    }
  }
  const _check = simulation => {
    const simulation2 = simulation.clone();
    simulation2.flushAndVerify();
  };
  const _stressTest = (numIterations = 1) => {
    const simulation = new Simulation();
    for (let i = 0; i < numIterations; i++) {
      simulation.update();
      _check(simulation);
    }
  };
  it('should survive 1000 iterations', function() {
    _stressTest(1000);
  });
});