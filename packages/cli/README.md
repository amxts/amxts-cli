# @amxts/cli

The `amxts` command of [amxts](https://amxts.github.io/): Counter-Strike 1.6
plugins in TypeScript. It creates projects and module packages, adds
modules, builds, deploys, type-checks and tests.

A project has it already - `@amxts/core` depends on it - and runs it through
its package manager:

```sh
npx amxts --help
npx amxts dev              # build, deploy, again on every save
npx amxts module add menu-core
```

A new project: `npm create amxts@latest`. Installed globally
(`npm install -g @amxts/cli`), `amxts` works in any project with the
project's own core.

Every command: [the amxts command](https://amxts.github.io/docs/getting-started/cli).
