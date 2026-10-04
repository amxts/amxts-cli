# How the amxts command works

**English** | [Русский](CONTRIBUTING.ru.md)

This repository is the `amxts` command and `create-amxts`. The core -
compiler, generators, build scripts, test utils - is
[@amxts/core](https://amxts.github.io/), and the command drives it.
The plugin-author view is the site's
[amxts command](https://amxts.github.io/docs/getting-started/cli) page.

| package | what |
| --- | --- |
| `packages/cli` | `@amxts/cli`: the `amxts` bin, the commands (`src/`), the starters (`templates/`) |
| `packages/create-amxts` | `create-amxts`: `npm create amxts` runs it, and it runs `amxts init` with its arguments, so the two never drift apart |

## The command and the core

`@amxts/cli` is the command. The core depends on it
and carries a `bin/amxts.mjs` that starts it: a package manager links the
bins of a project's own dependencies only, so `npx amxts` in a project is
the core's bin, which runs `main()` from this package - the one the core
depends on. Installed globally, the command works the same way.

The command never imports a path inside the core. It finds the core the
project installed - `@amxts/core/package.json` resolved from the folder it
runs in, as Node resolves it (`src/core.mjs`, `projectCore()`) - checks its
version against `CORE_RANGE` (`^0.2.0`), imports `@amxts/core/cli-api` and
checks `cliApi` against `CLI_API`. A core outside the range or with another
`cliApi` is a `CliError` that says what to do: an older core is moved
with `amxts upgrade`, a newer one needs a newer command. The contract, from the core's side, is
its `src/cli-api.mjs`:

| from the cli-api | used by |
| --- | --- |
| `version`, `cliApi`, `fromSource` | every command that needs the core; `--local` is the default for `module add` when the project's core is a checkout |
| `task(name, args)` | `build`, `dev` (`build --deploy --watch`), `typecheck`, `check`, `prepare`, `upgrade` (`--report <file>`, `--dry-run`): `{ runtime: 'bun' \| 'node', args }`, run by `runTask()` in the project's folder |
| `localModules()` | `--local`: where the official modules are on this machine |
| `typescript()` | `src/config.mjs`: `amxts.config.ts` is read with the core's parser, so `npm create amxts` does not fetch TypeScript |
| `toolchain()` | `info` |
| `bunBinary()` | `src/core.mjs`: the Bun the tasks and `test` run on |
| `includeSources()` | `src/includes.mjs`: the ReAPI release a project without a server fetches, with its sha256 |
| `serverSystem(argv, env)`, `describeSystem()` | `info`: the system the build compiles for, and how it was decided; optional - a core without them builds for this machine |
| `release(system)`, `moduleVersion(file)` | `src/server-update.mjs`: the server step of `upgrade` - the release's files, their manifest and where they go - and the line `dev` and `build` start with when the server's module is of another release |

`init` (a project or a module), `--help`, `--version` and `info` outside a
project need no core.

## Node in front, Bun behind

`src/` is plain JavaScript (ESM, JSDoc types) that Node runs as it is: npm,
pnpm and yarn start it with Node, and nothing in it needs a build step.

- **On Node**: `init`, `module add` / `list`, `info`, `--help`. They read
  `amxts.config.ts` with the TypeScript parser, never by running it, so they
  work without Bun.
- **On Bun**: the core's `prepare`, `build`, `check` and `upgrade` tasks - `runTask()`
  runs them and passes `--debug` on as `AMXTS_DEBUG=1`. `typecheck` runs the
  `prepare` task, then `tsc` under Node. `test` runs `bun test` itself, with
  the arguments it was given.

The Bun is the one installed with the core: `@amxts/core` depends on the
`bun` package, and its cli-api's `bunBinary()` finds the binary - in the
platform package (`@oven/bun-<os>-<arch>`), which npm, pnpm, yarn and bun
install as an optional dependency without running a script, else where
`bun`'s postinstall put it. `bunFor()` (`src/core.mjs`) takes it, a Bun on
PATH only without it, and `needBun()` says what to do when there is neither.
A project needs no Bun of its own.

## Files

| file | what |
| --- | --- |
| `src/main.mjs` | the command table, help, "did you mean", the one `catch` |
| `src/args.mjs` | `--flag value`, `--flag=value`, `--no-flag`, aliases; an unknown flag names the closest one |
| `src/ui.mjs` | colors (off without a TTY or with `NO_COLOR`, on with `FORCE_COLOR`), `log`, `CliError(message, hint)`, `report()`, `closest()` (edit distance with swaps) |
| `src/pm.mjs` | the package manager: `npm_config_user_agent`, lockfiles, `packageManager`; each one's install / add / run / exec spelling |
| `src/core.mjs` | the command's version, the project's core and the one on this machine, the version and `cliApi` checks, Bun, running a task |
| `src/catalog.mjs` | the amxts catalog (`loadCatalog()`), names in it, `--local` folders, `file:` / `link:` specs; `withRequired()` / `configEntries()`: a chosen module, then what it requires (and that, in turn), each with the modules that need it |
| `src/modules.json` | the catalog as the command was published with it: what it offers offline |
| `src/config.mjs` | `amxts.config.ts`: read `modules` and `target`, add to `modules` keeping its quotes and layout - one per line when an entry has its `// needed by menu-core` comment |
| `src/includes.mjs` | the server's includes: its own, or fetched for `target` (`fetch`, a `.zip` read with `node:zlib`, the sha256 checked); `prepare()`, which `prepare`, `dev`, `build` and `typecheck` run first |
| `src/template.mjs` | `{{placeholders}}`, `// #if flag` / `// #if !flag` blocks (`<!-- #if -->` in Markdown, `# #if` in `.gitignore`), `_x` written as `.x` |
| `src/lint.mjs` | what a project and a module get to lint with: the oxlint and oxfmt packages, the `lint` / `lint:fix` scripts, the files that are there only for the lint |
| `src/init.mjs` | the project starter over `templates/project/` |
| `src/init-module.mjs` | the module starter over `templates/module/` |
| `src/module.mjs`, `src/info.mjs` | `module add` (the install, the config, then `prepare()`, so the editor config names the module) / `list`, `info` |
| `src/server.mjs` | the server a project deploys to, `AMXTS_SERVER` in `.env`: the question `init` asks, and `dev` and `build --deploy` ask when it is not set - in a terminal, not in CI |
| `src/system.mjs` | the server's system for `init`: `hlds_linux` or `hlds.exe` beside its game folder |
| `src/registry.mjs` | the versions that go together ([versions](#versions)): `npm view` through the registry npm is set to, `versionsFor()` - for a core, each package's newest version that works with it |
| `src/upgrade.mjs` | `upgrade`: the core moved to its latest version or `--to`, every other `@amxts/` package to its newest for that core, each in the project's style, and installed; the core's `upgrade` task, the build, the server step, the summary; a command of another release hands the rest to the project's new one (`AMXTS_UPGRADE_FROM`) |
| `src/server-update.mjs` | the server step: the release's manifest and files (a URL, or a folder in `AMXTS_RELEASE_URL`), the sha256 checked, a file in use found before anything changes, the old files kept, `amxts_host.amxx` out of `plugins.ini`; `serverMismatch()` for `dev` and `build` |

## Starters

`templates/project/` is the project as it is written, with blocks per
module (`// #if menu-core`) and per choice (`lint`). A block for a module
is kept when the module is installed - chosen, or brought by one that
requires it - so `plugins/hello.ts` uses config-core whenever menu-core is
chosen. `package.json` and `.env` are written by the code, not the
template; `package.json` has `postinstall: amxts prepare`, so the editor
config in `.amxts/` is written after every install and is not committed.
After its own install `init` runs this command's `prepare` in the project.
With pnpm it also writes `pnpm-workspace.yaml` with `allowBuilds: { bun:
false }`: pnpm stops an install at a dependency's build script nobody
approved, and bun's is not needed - the binary comes from its platform
package.

## The server's includes

A build reads Pawn's declarations where a plugin needs them - an include
contract, the natives and forwards of other Pawn plugins, a Pawn test suite
- from the project's `includes/`, then its server's, then the core's and AMX
Mod X's (the core's `includes/README.md`). "Its server's" is
`src/includes.mjs`:

- `AMXTS_SERVER` set (the environment or `.env`) and
  `addons/amxmodx/scripting/include` beside it: the server's own, read in
  place. Nothing is fetched.
- Otherwise `target` in `amxts.config.ts`: `"rehlds"` (the default) fetches
  the ReAPI release the core's API is generated from (`includeSources()`)
  into `.amxts/include`, the sha256 checked, once - a `source.json` there
  says what it is; `"hlds"` fetches nothing (AMX Mod X's own come with the
  core) and removes what `"rehlds"` fetched.

`init` asks the target only when no server's includes say it (`reapi.inc`
there means `rehlds`); `--target` answers it, `--yes` takes `rehlds`. It
fetches right after the install and writes `target` into the config, so a
clone of the project gets the same includes on its first install
(`postinstall: amxts prepare`). `prepare`, `dev`, `build` and `typecheck`
make sure of them first; a download that fails is a warning with what to do,
not an error, since a build needs an include only where a plugin names it.

The package manager is asked first; the README, the install and the next
steps are written with its commands (`pm.mjs`: `runScript`, `installArgs`,
`execAmxts`).

`templates/module/` is a module package with its playground, test and both
READMEs. Its `peerDependencies` ask for the core in `CORE_RANGE`; with
`--local` its `devDependencies` also link the core on this machine, which it
is developed and tested against.

## The server's system

A plugin is compiled to machine code in its server's object format - COFF
for Windows, ELF for Linux - and one built for the other system does not
load. The core's build decides the system: `--os`, else `AMXTS_SERVER_OS`
(the environment or `.env`), else what the `AMXTS_SERVER` folder holds
(`hlds_linux` or `hlds.exe`, else its modules), else this machine's.

- `build` and `dev` take `--os windows|linux` and pass it to the build
  task as it is; anything else is refused before the build starts.
- `init` reads the system off the server's folder (`src/system.mjs`); when
  that does not show it, `--os` answers, or it is asked, and it goes into
  `.env` as `AMXTS_SERVER_OS`. `--yes` without `--os` writes nothing:
  the build takes this machine's.
- `info` shows what the build would compile for, through the core's
  `serverSystem()`.

## The catalog

The modules `init` offers, `module list` shows and `module add` knows by
name are the amxts catalog: the registry
[amxts/modules](https://github.com/amxts/modules), one YAML file per module,
added by a pull request and checked by its CI, which builds them into
`modules.json`. `loadCatalog()` fetches that file once per run (3 seconds at
most) and falls back to `src/modules.json`, the copy the package ships, when
it cannot - offline, or GitHub not answering. No cache on disk: the commands
that read it run rarely, and a cache would be one more file that goes stale.
`AMXTS_CATALOG` names another URL or a file instead - the tests use it.

A name the catalog lists is its package (`menu-core` is `@amxts/menu-core`,
`votes` could be `amxts-votes`); any other name is an npm package, installed
all the same, with a warning that the catalog does not list it. Refresh
`src/modules.json` before a release:

```sh
curl -o packages/cli/src/modules.json https://raw.githubusercontent.com/amxts/modules/main/modules.json
npm run lint:fix
```

## `--local`

`--local` is for working on the core, the command and the official modules
together: it takes the core from this machine and the official modules of the
catalog from the folders that core's `package.json` links (`file:`); a
community module comes from npm. It is the default when the command runs from a checkout of this
repository (`FROM_SOURCE`: a `.git` beside the root `package.json`), and for
`module add` when the project's core is a checkout.

The core on this machine is the folder `AMXTS_CORE` names, else the core
the command resolves from its own folder: the checkout's root `package.json`
links `../amxts` as a dev dependency, so after `npm install` here it is the
core beside this repository.

They are linked, not copied: a copy is what the package would publish, and
the core's folder has more than that (the patched compiler, the generated
API). npm links a `file:` folder; pnpm and yarn copy one, so they get
`link:`; bun gets `link:<name>` after `bun link` in the package's folder. A
linked module resolves its own imports from its real folder: its `testing/`
needs `@amxts/core` in the module's own `node_modules`, as a module being
developed has.

## Versions

Every package has a version of its own. The core and `wamrc` share one; the
command and `create-amxts` have theirs, and the command drives the cores of
its `CORE_RANGE`; a module versions by its own API and names the cores it
works with as a range in its `peerDependencies` (`"@amxts/core": "^0.2.0"`),
and another module the same way. So which versions go together is read off
the registry (`src/registry.mjs`): for a core, each package's newest version
whose range for `@amxts/core` takes it - for a package that names no core,
the one the core's own range for it takes (the command, `wamrc`).

- `upgrade` moves the core to its latest version or `--to`, and every other
  `@amxts/` package to its newest version for that core; a package with none
  stops it before anything changes.
- `init` gives a module from the registry its newest version for the newest
  core of `CORE_RANGE` - the core the project gets; offline it writes
  `latest`, and the install says why.
- `module add` installs a module from the registry at its newest version for
  the project's core.

`npm view` is asked once per package, all at once, for every version (`*`) or
an exact one or a tag: a range on the command line would go through Windows'
shell, which reads `^` and `>`; `commandLine()` quotes such an argument for
the same reason.

## Working here

```sh
npm install --no-package-lock   # links the core beside it (../amxts) and the workspaces
npm test                        # bun test ./test
npm run lint                    # oxlint && oxfmt --check
npm link -w @amxts/cli -w create-amxts   # the global amxts and create-amxts, from this checkout
```

The core's own install links this repository's `packages/cli` as its
`@amxts/cli` (`file:../amxts-cli/packages/cli`), so the core's `bin/amxts.mjs`
and every project linked to that core run the command from here.

## Tests

`test/cli.test.ts`: arguments, "did you mean", the config edit, `--local`
specs, templates, `create-amxts`, `init` from flags with and without modules
and the lint, `init --module`, the target from a server's includes and
`--target`. `test/includes.test.ts`: the server's own includes, ReAPI's
fetched from a release on this machine, `hlds`, a failed or changed
download, and the `.zip` reader. `test/core.test.ts`: the version range and a
module's ranges, and a
project with a stand-in core (`standInProject()` in `test/helpers.ts`) -
none, older, newer, without the cli-api, with another `cliApi`, and one whose
task runs. The stand-in cores take their versions from `CORE_RANGE`
(`CORE`, `NEXT_CORE` in `test/helpers.ts`), so a release's version changes no
test. `test/upgrade.test.ts`: the specs moved in the project's style, each
package's version for a core from a stand-in registry, every package
manager, a core or a module the registry does not have, a dry run, the hand
over to a newer command, the server step and the whole run. `test/project.test.ts`: `module add` preparing after it lists the
module; `dev` asking for the server in a terminal (`amxtsInTerminal()`, whose
`test/terminal.mjs` makes the input a terminal) and keeping it in `.env`, and
not asking elsewhere. `test/system.test.ts`: the
server's system read off its folder, `--os` kept in `.env` by `init`, and
`build` and `dev` refusing a system they do not know.

A change to the starters or the install is worth checking end to end, in a
folder outside the repositories with the core, the modules and this
repository copied (not linked - removing the copy must not follow a link into
the real `node_modules`, `runtime/deps` or `amxmodx`): `create-amxts` with
npm and `amxts init` with pnpm and bun, then `build`, `typecheck`, `lint`,
`test`, `module add` / `list`, `info`, `dev` against a stand-in server
folder (with an `addons/amxmodx/scripting/include`, and without a server for
each target), and `init --module` with its `build`, `check` and tests.
