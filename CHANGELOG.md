# Changelog

## v0.2.0

[compare changes](https://github.com/amxts/amxts-cli/compare/v0.1.0...v0.2.0)


### Summary

The command for amxts 0.2.0. `amxts upgrade` moves a 0.1.0 project over in one step, and a new project starts from 0.2.0's API.

### ✨ Highlights

#### `amxts upgrade`

One command updates the packages, rewrites the code for the renamed API, builds, and puts the release's module, compiler and `wamrc` on the server named in `.env`, with a backup of each file it replaces. `--dry-run` shows what it would do; `--no-server` and `--server-only` do half of it.

#### A new project

`hello.ts` has a typed config and a menu that greets the player by name; with `@amxts/menu-core`, its starter menu takes the menu's context.

#### The server's folder

`AMXTS_SERVER` may name the server's root or its `cstrike` folder.

### ⚠️ Breaking changes

- The command drives `@amxts/core` 0.2.x only. A 0.1.0 project runs `amxts upgrade` first.

### ⬆️ Upgrade guide

Update the command with the package manager the project uses - `npm install @amxts/cli@latest`, `bun add @amxts/cli@latest`, `pnpm add @amxts/cli@latest` or `yarn add @amxts/cli@latest` - then run `npx amxts upgrade`.

### 🧭 Known issues

- The server step of `amxts upgrade` downloads the release from GitHub; without network access run it with `--no-server` and install the server kit by hand.

### 📦 Dependencies

| Package | From | To |
| --- | --- | --- |
| `@amxts/core` | `^0.1.0` | `^0.2.0` |

### 🚀 Enhancements

- **server:** Take the server's folder or its cstrike ([f41a1d7](https://github.com/amxts/amxts-cli/commit/f41a1d7))
- **init:** Typed config and the core's Menu in `hello.ts` ([50a7343](https://github.com/amxts/amxts-cli/commit/50a7343))
- **init:** The starter menu greets by name in its title ([f38a850](https://github.com/amxts/amxts-cli/commit/f38a850))
- **init:** The menu-core starter menu takes its context ([3e590ab](https://github.com/amxts/amxts-cli/commit/3e590ab))
- **upgrade:** One command moves a project to a release ([00d3974](https://github.com/amxts/amxts-cli/commit/00d3974))

### 🩹 Fixes

- **init:** `knip` 6 in a new project ([868f2e3](https://github.com/amxts/amxts-cli/commit/868f2e3))
- **init:** Keep a linked core's own `.bin` on yarn ([1262f55](https://github.com/amxts/amxts-cli/commit/1262f55))
- **templates:** The starter hears `putInServer` ([e20acbe](https://github.com/amxts/amxts-cli/commit/e20acbe))

### 💅 Refactors

- Command handlers take one object ([5bd680c](https://github.com/amxts/amxts-cli/commit/5bd680c))

### 📖 Documentation

- The packages are on npm ([9770340](https://github.com/amxts/amxts-cli/commit/9770340))
- `amxts` upgrade in the READMEs and CONTRIBUTING ([7c69105](https://github.com/amxts/amxts-cli/commit/7c69105))

### ❤️ Contributors

- Ernest Manukyan
