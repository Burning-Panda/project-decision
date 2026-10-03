# HTTP basics

A browser or client sends a **request**: a method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), a **path** (`/decisions/PRJ-001`), headers and sometimes a JSON body. The server answers with a **status code**, headers and a body.

## Routes in Nest

A controller maps method + path to a function:

```ts
@Controller('decisions')          // every path in this class starts with /decisions
export class DecisionsController {
  @Get(':id')                     // GET /decisions/PRJ-001  → id = 'PRJ-001'
  get(@Param('id') id: string) { ... }
}
```

If no route matches the method and path, the server answers 404.

## Status codes you will meet

| Code | Means |
|---|---|
| 200 | OK |
| 201 | Created something new |
| 202 | Accepted: recorded, and it changed something bigger (a vote that closed a decision) |
| 204 | OK, no body |
| 400 | The request is invalid (bad input) |
| 401 | Who are you? (no `X-User` header) |
| 403 | I know who you are, but you may not do this |
| 404 | Not found |
| 405 | That path exists, but not for this method |
| 409 | Conflicts with the current state (a duplicate, or the wrong state) |
| 500 | The server itself failed |
