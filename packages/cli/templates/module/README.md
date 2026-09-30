<div align="center">

<img src="assets/logo.svg" width="96" alt="{{title}}">

# {{title}}

*What {{title}} does, in one line*

[![amxts module](https://img.shields.io/badge/amxts-module-3178c6?style=flat-square)](https://amxts.github.io/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Development](#development)

**English** | [Русский](README.ru.md)

</div>

{{title}} greets players — say here what your module does, for whom and why.

## Features

- **Greets players.** `greet(player)` says hello in chat — replace this with what your module does.

## Installation

```bash
npx amxts module add {{package}}
```

It installs the package and adds it to your project's `amxts.config.ts`:

```ts
export default defineConfig({
	modules: ["{{package}}"],
	{{configKey}}: {
		greeting: "Hi",
	},
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `greeting` | `"Hello"` | What a player is greeted with. |

## Usage

A plugin of a project that lists the module uses it as `{{camel}}`, without an import:

```ts
server.addCommand("/hello", {{camel}}.greet);
```

| Function | What it does |
| --- | --- |
| `greet(player)` | Greets the player in chat. |

The module is built only for a project whose plugins use it.
<!-- #if natives -->

## Pawn plugins

Pawn plugins call the module through its natives: `#include <{{include}}>` — the package ships `include/{{include}}.inc`. A project whose Pawn plugins call them keeps the module in the build when no TypeScript plugin uses it: `pawn: ["{{package}}"]` in `amxts.config.ts`.

```pawn
#include <{{include}}>

public client_putinserver(id) {
	{{include}}_greet(id);
}
```
<!-- #endif -->

## Development

```bash
npm install
npm test             # the tests in test/, on the playground project
npm run check        # the package is ready to publish
```

`playground/` is a project with the module in it: its `amxts.config.ts` lists the module, and `plugins/` has a plugin that uses it. `npx amxts build` there builds it for a server.
