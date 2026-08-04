
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

<!-- memento:agents-instructions -->
## Memento

This repo uses **Memento** (`mm`), a markdown-first, repo-local tracker and memory surface.

- Run `mm prime --json` at the start of each session for the full workflow guide.
- **Workflow items** (`milestone` / `epic` / `feature` / `task` / `bug`) live in `.memento/items` and `.memento/archive`; statuses are `draft` / `todo` / `in-progress` / `completed` / `scrapped`.
- **Observations** (`note` / `rule` / `tattoo` / `document`) live in `.memento/notes` — durable memory, not backlog work.
- Find work with `mm rank ready --json` / `mm rank next --json`; create with `mm item create`; keep items current with `mm item update`.
- Prefer Memento over ad hoc todo lists for repo-local tracking. Use `--json` for machine-readable output.
<!-- /memento:agents-instructions -->

<!-- memento:project-prefix -->
### Item IDs in this repo

New Memento items and notes mint with the **`OTG-`** prefix (`identity.default_prefix` in `.memento.yml`). Ids created before the per-project prefixes — `mm-…`, and `hbd-…` in haberdashery — are left as they are: memento has no re-id verb, and the ids are referenced by `blocked_by:` relations and ledger entries. A mixed set is expected; do not try to normalise it.
<!-- /memento:project-prefix -->
