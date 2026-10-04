<div align="center">

<img src="assets/logo.svg" alt="amxts" width="96" height="96">

# amxts-cli

*The `amxts` command and `npm create amxts`*

[Documentation](https://amxts.github.io/docs/getting-started/cli) • [Getting started](https://amxts.github.io/docs/getting-started/quick-start) • [How it works](CONTRIBUTING.md)

**English** | [Русский](README.ru.md)

</div>

The command line of [amxts](https://amxts.github.io/), Counter-Strike 1.6
plugins in TypeScript. It creates projects and module packages, adds modules,
builds, deploys, type-checks and tests. This repository has two packages:

| package | what |
| --- | --- |
| [`@amxts/cli`](packages/cli) | the `amxts` command and the starters it writes |
| [`create-amxts`](packages/create-amxts) | `npm create amxts`, which is `amxts init` |

## Features

- **A project in one command.** It asks for the package manager, the folder,
  the modules, lint, git and the server's folder; every question is also a
  flag, and `--yes` takes the defaults.
- **In the package manager's words.** npm, pnpm, yarn or bun: the install,
  the README and the next steps are written with the one you picked.
- **A module in one command.** `amxts module add menu-core` installs a module and
  lists it in `amxts.config.ts`, leaving the rest of the file as you wrote
  it.
- **The server's includes.** With the server's folder the build reads the
  includes installed there; without one, `amxts init` asks which server the
  project is for - ReHLDS + ReGameDLL + ReAPI or plain HLDS - and fetches
  ReAPI's includes when it is the first.
- **Save and play.** `amxts dev` builds, deploys to the server and does it
  again on every save.
- **Errors you can act on.** One line and a hint; a typo gets "did you mean";
  `--debug` adds the stack.
- **A module starter.** `amxts init --module` writes a working module package
  with a playground, a test and natives for Pawn plugins.

## Requirements

- [Node.js](https://nodejs.org) 20.12+ - the command runs on it.

Building, type-checking and testing run on [Bun](https://bun.sh), which
comes with `@amxts/core` as a dependency: nothing to install for it.

## Usage

```sh
npm create amxts@latest    # or: pnpm create amxts, yarn create amxts, bun create amxts
```

Then, in the project:

```sh
npx amxts dev              # build, deploy to the server in AMXTS_SERVER, again on every save
npx amxts dev --docker     # build for the Docker server that mounts the project, again on every save
npx amxts build --deploy   # build once and deploy
npx amxts build --os linux # for a Linux server, when AMXTS_SERVER does not show it
npx amxts build --watch    # build again on every save, without deploying
npx amxts typecheck        # check the project as the editor does
npx amxts test             # the tests, on a fake server
npx amxts module add menu-core
npx amxts upgrade          # move the project and its server to the latest amxts
npx amxts info             # versions and settings, for a bug report
```

`amxts --help` lists the commands, `amxts <command> --help` shows a
command's options. Every command is described on the
[amxts command](https://amxts.github.io/docs/getting-started/cli) page.

## How it finds the core

`@amxts/core` depends on `@amxts/cli` and carries an `amxts` bin that starts
it: a package manager links the bins of a project's own dependencies only,
so `npx amxts` works in every project.

The command then works with the project's own core - `@amxts/core` as the
project installed it - and talks to it only through `@amxts/core/cli-api`.
A core older or newer than the command knows is an error that says which of
the two to update:

```
✖ @amxts/core 0.1.0 is not a core amxts 0.2.0 works with (^0.2.0)
  Move the project to amxts 0.2.0: npx amxts upgrade
```

Creating a project or a module needs no core, so `npm create amxts` works
anywhere.

## Development

```sh
npm install --no-package-lock   # the workspaces, and the core beside this repository (../amxts)
npm test
npm run lint
npm link -w @amxts/cli -w create-amxts   # amxts and create-amxts on the PATH, from this checkout
```

[CONTRIBUTING.md](CONTRIBUTING.md) explains how the command is built: the
command and the core, Node in front and Bun behind, the starters, `--local`
and the tests.
