# async and await

Some work takes time: a network call, reading a file. Such functions return a **Promise**, a value that arrives later.

```ts
async function send(): Promise<void> {
  await transport.send(message);   // wait here until it is done (or throws)
  console.log('sent');
}
```

- `await` pauses the function until the promise settles, then gives its value, or throws its error.
- You can only use `await` inside a function marked `async`. An `async` function always returns a Promise.
- Errors from an awaited call are caught with a normal `try/catch`:

```ts
try {
  await transport.send(message);
} catch (e) {
  // the send failed
}
```

- Forgetting `await` is a classic bug: the code continues before the work is done, and its errors are not caught.
- `for (const x of list) { await doSomething(x); }` does the items one after another. That keeps their order.
