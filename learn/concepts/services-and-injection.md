# Services and dependency injection

A **service** is a class that owns one area of the application (owners, teams, projects...). Services need each other, and they need the shared store. They do not create those themselves; they ask for them in their constructor:

```ts
@Injectable()
export class TeamsService {
  constructor(
    private readonly ctx: LogContext,        // the shared store and clock
    private readonly owners: OwnersService,  // another service
  ) {}

  create(input) {
    this.owners.require(input.owner);        // use it through `this`
    this.ctx.store.teams.set(...);
  }
}
```

Nest (the framework) creates every service once and **injects** the ones a constructor lists. This is dependency injection. To use another service, add it to your constructor's parameters; Nest does the rest.

## The rule: no cycles

If A needs B and B needs A, Nest cannot build either. `TeamsService` needs `OwnersService`, so `OwnersService` must not need `TeamsService`. When you hit that, work with the store directly instead.

## The context

`LogContext` (`this.ctx`) gives every service:

- `this.ctx.store`: the collections (`this.ctx.store.owners`, `.teams`, ...)
- `this.ctx.now()`: the current time as an ISO string, from the clock the tests control
