# Classes and `this`

A class is a blueprint for objects that carry data and functions together.

```ts
class Counter {
  count = 0;                         // a property, set on every new object

  constructor(start: number) {       // runs when you write `new Counter(5)`
    this.count = start;
  }

  increment() {                      // a method
    this.count += 1;
    return this.count;
  }

  static fromText(text: string) {    // static: called on the class, not on an object
    return new Counter(Number(text));
  }
}

const c = new Counter(5);
c.increment();                       // 6
Counter.fromText('2');
```

- `this` means "the object this method was called on".
- Properties can also be created from data: `(this as any)[name] = new Map()` creates a property whose name is in the variable `name`. The `as any` tells TypeScript "I know this property is not declared".
- `class B extends A` makes B start with everything A has. B's constructor must call `super()` first; it runs A's constructor.
- `private readonly x: X` in a constructor's parameters both declares and fills the property `this.x`.
