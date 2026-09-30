# {{name}}

Counter-Strike 1.6 plugins in TypeScript, built with [amxts](https://amxts.github.io/).

## Commands

- `{{install}}` - installs the core, the modules and the tools
- `{{run.dev}}` - builds, deploys to the server in `AMXTS_SERVER` and again on every save
- `{{run.build}}` - builds the plugins into `dist/`, with `plugins.ini`
- `{{run.typecheck}}` - checks the plugins as the editor does
- `{{run.test}}` - runs the tests in `test/` on a fake server
<!-- #if lint -->
- `{{run.lint}}` - oxlint and oxfmt check the code; `lint:fix` fixes what they can
<!-- #endif -->
- `{{amxts}} module add <name>` - installs a module and lists it in `amxts.config.ts`

`AMXTS_SERVER` in `.env` is the `addons/amxts` folder of the server `dev`
deploys to:

```sh
AMXTS_SERVER=D:/hlds/cstrike/addons/amxts
```

## Layout

- `plugins/` - the plugins: each `.ts` file here is one plugin on the server
- `amxts.config.ts` - the modules the project uses and their options
- `test/` - tests: the plugins on a fake server, driven as players would
