# zjs

API-compatible [yjs](https://github.com/yjs/yjs) CRDT, but faster for game engine usage.

## Benefits

- Small memory footprint (O(data) objects garbage)
- Fast conflict resolution based on single clock, resolution priority, and binary history buffer
- Supports all JSON and binary data (typed arrays)

## Restrictions

- Only SFU supported
- Can only push one element at a time
- Cannot move elements
- Pushing a new element and then adding children in the same transaction can have unintended side effects*

* Maybe sure you've fully constructed your object in your transaction before binding it to Z state. If you're getting a message to create an object twice and you shouldn't be, it's possible that this is the issue. Attaching your new state to the old state after you've added any new objects (apps, arrays, etc) in your transaction should prevent this.
