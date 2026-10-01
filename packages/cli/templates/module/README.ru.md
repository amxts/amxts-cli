<div align="center">

<img src="assets/logo.svg" width="96" alt="{{title}}">

# {{title}}

*Что делает {{title}}, одной строкой*

[![amxts module](https://img.shields.io/badge/amxts-module-3178c6?style=flat-square)](https://amxts.github.io/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

[Возможности](#возможности) • [Установка](#установка) • [Использование](#использование) • [Разработка](#разработка)

[English](README.md) | **Русский**

</div>

{{title}} приветствует игроков — напишите здесь, что делает ваш модуль, для кого и зачем.

## Возможности

- **Приветствует игроков.** `greet(player)` здоровается в чате — замените это тем, что делает ваш модуль.

## Установка

```bash
npx amxts module add {{package}}
```

Команда ставит пакет и добавляет его в `amxts.config.ts` проекта:

```ts
export default defineConfig({
	modules: ["{{package}}"],
	{{configKey}}: {
		greeting: "Привет",
	},
});
```

| Настройка | По умолчанию | Что делает |
| --- | --- | --- |
| `greeting` | `"Hello"` | Чем приветствовать игрока. |

## Использование

Плагин проекта, в котором модуль указан, пользуется им как `{{camel}}`, без импорта:

```ts
server.addCommand("/hello", ({ player }) => {{camel}}.greet(player));
```

| Функция | Что делает |
| --- | --- |
| `greet(player)` | Приветствует игрока в чате. |

Модуль собирается только для проекта, плагины которого им пользуются.
<!-- #if natives -->

## Pawn-плагины

Pawn-плагины обращаются к модулю через его нативы: `#include <{{include}}>` — пакет поставляет `include/{{include}}.inc`. Проект, Pawn-плагины которого их вызывают, оставляет модуль в сборке, даже когда им не пользуется ни один плагин на TypeScript: `pawn: ["{{package}}"]` в `amxts.config.ts`.

```pawn
#include <{{include}}>

public client_putinserver(id) {
	{{include}}_greet(id);
}
```
<!-- #endif -->

## Разработка

```bash
npm install
npm test             # тесты из test/ на проекте playground
npm run check        # пакет готов к публикации
```

`playground/` — проект с модулем: его `amxts.config.ts` перечисляет модуль, а в `plugins/` лежит плагин, который им пользуется. `npx amxts build` там собирает его для сервера.
