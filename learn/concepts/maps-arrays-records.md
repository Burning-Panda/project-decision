# Maps, arrays and records

The store keeps three kinds of collections. Pick by how you look things up.

## Map: look up by id

```ts
const owners = new Map<string, Owner>();
owners.set('acme', { identifier: 'acme', name: 'Acme' });
owners.get('acme');     // the owner, or undefined
owners.has('acme');     // true
owners.delete('acme');
owners.size;            // how many
for (const [id, owner] of owners) { ... }
[...owners.values()]    // all owners as an array
```

## Array: an ordered list

```ts
const audit: Entry[] = [];
audit.push(entry);                        // add at the end
audit.filter((e) => e.actor === 'alice'); // a new array with the matches
audit.find((e) => e.seq === 3);           // the first match, or undefined
audit.map((e) => e.action);               // a new array of transformed items
```

Order matters for arrays: the audit chain depends on it.

## Record: a plain object used as a small table

```ts
const counters: Record<string, number> = {};
counters['PRJ'] = 3;
Object.keys(counters);     // ['PRJ']
Object.entries(counters);  // [['PRJ', 3]]
```

Each new store must give every collection its **own** empty Map, array or object. Reusing one array for two collections makes them share contents.
