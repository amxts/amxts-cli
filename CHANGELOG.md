# Changelog

## v0.3.0

[compare changes](https://github.com/amxts/amxts-cli/compare/v0.2.1...v0.3.0)

### Summary

The command for amxts 0.3: it drives the 0.3 cores, and the `amxts upgrade` of a 0.2 project installs it and hands the rest over to it. A panel under `amxts dev`, `amxts rcon`, and a line when a newer amxts is out.

### 🚀 Enhancements

- **cli:** The `amxts` logo in the banner ([e80a915](https://github.com/amxts/amxts-cli/commit/e80a915))
- **rcon:** `amxts` rcon sends a command to the server ([9a93721](https://github.com/amxts/amxts-cli/commit/9a93721))
- **dev:** A panel under the build, one dev per project ([5920088](https://github.com/amxts/amxts-cli/commit/5920088))
- **cli:** A line when a newer `amxts` is out ([f7e4d25](https://github.com/amxts/amxts-cli/commit/f7e4d25))
- **templates:** `player.print`, the wave is `server.print` ([52467a0](https://github.com/amxts/amxts-cli/commit/52467a0))

### 🩹 Fixes

- **create:** The starter prints to players, on every core ([44fbf3b](https://github.com/amxts/amxts-cli/commit/44fbf3b))
- **upgrade:** Take an older release's plugin out of AMX Mod X ([ba3f7fe](https://github.com/amxts/amxts-cli/commit/ba3f7fe))
- **upgrade:** A failed build fails the upgrade ([32882fc](https://github.com/amxts/amxts-cli/commit/32882fc))

### 📖 Documentation

- **readme:** The hint for an older core ([b3fccfe](https://github.com/amxts/amxts-cli/commit/b3fccfe))
- The dev panel, `amxts` rcon and the update line ([cfbefbc](https://github.com/amxts/amxts-cli/commit/cfbefbc))
- **readme:** The server loads only what the project builds ([4bbb618](https://github.com/amxts/amxts-cli/commit/4bbb618))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.2.1

[compare changes](https://github.com/amxts/amxts-cli/compare/v0.2.0...v0.2.1)

### Summary

A project's tests run without Bun: a project or module made with npm, pnpm or Yarn tests on Node with Vitest, and `amxts test` runs the project's Vitest when it has one. With Bun nothing changes. It goes with `@amxts/core` 0.2.3, whose fake server loads under Node.

### 🩹 Fixes

- **create:** Tests on Vitest without Bun - a project or module made with npm, pnpm or Yarn tests on Node with Vitest; with Bun nothing changes ([463c8f9](https://github.com/amxts/amxts-cli/commit/463c8f9))
- **test:** The project's Vitest when it has one - `amxts test` runs `vitest run` in a project with vitest installed, else `bun test` ([1184a2e](https://github.com/amxts/amxts-cli/commit/1184a2e))

### 📖 Documentation

- **readme:** The hint for an older core ([b795531](https://github.com/amxts/amxts-cli/commit/b795531))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

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

- **upgrade:** Each package to its own version for the core ([426f2a9](https://github.com/amxts/amxts-cli/commit/426f2a9))
- New modules at their version for the core ([a2be088](https://github.com/amxts/amxts-cli/commit/a2be088))

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

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))
