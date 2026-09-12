# reserved

Names held on npm with nothing published under them, so that no one else takes a name this project will
want. A directory here is **not** a workspace member: it is never installed, never built, never linked, and
never published by `npm run release`.

Publishing one is a thing a maintainer does by hand, once:

```
npm publish ./reserved/wilanis
```

The ten `@wilanis/*` packages need no placeholder of their own. The scope belongs to the npm organisation
`wilanis`, and creating that organisation reserves every name under it.

Why nothing real is on npm yet, and what goes there at 1.0: `docs/roadmap.md` (M14) and RFC 0008.
