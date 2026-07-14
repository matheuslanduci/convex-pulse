- `pnpm` is the package manager.
- Prefer `type` over `interface`.
- Use function declarations for top-level functions. Arrow functions are fine for callbacks and nested functions.
- If a function is only used by a class, make it a private class method instead of placing it outside the class.
- Types always comes after any production code.

```ts
function foo(params: Bar) {
  return 'bar'
}

type Bar = {
  foo: string
}
```

- Prefer non-relative imports over relative imports.
- Keep tests flat: use only root-level `it(...)` or `it.todo(...)` calls. Never use `describe`, `suite`, or any other test grouping.
