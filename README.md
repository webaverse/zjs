# zjs

CRDT like [yjs](https://github.com/yjs/yjs), but faster for game engine usage.

## Benefits

- Small memory footprint
- Fast conflict resolution based on single clock, resolution priority, and binary history buffer
- Supports binary data (typed arrays)

## Restrictions

- Only SFU supported
- Can only push one element at a time
- Cannot move elements
