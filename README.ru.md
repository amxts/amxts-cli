<div align="center">

<img src="assets/logo.svg" alt="amxts" width="96" height="96">

# amxts-cli

*Команда `amxts` и `npm create amxts`*

[Документация](https://amxts.github.io/ru/docs/getting-started/cli) • [Начало работы](https://amxts.github.io/ru/docs/getting-started/quick-start) • [Как это устроено](CONTRIBUTING.ru.md)

[English](README.md) | **Русский**

</div>

Командная строка [amxts](https://amxts.github.io/ru/) — плагинов для
Counter-Strike 1.6 на TypeScript. Она создаёт проекты и пакеты модулей,
добавляет модули, собирает, выкладывает, проверяет типы и запускает тесты.
В репозитории два пакета:

| пакет | что |
| --- | --- |
| [`@amxts/cli`](packages/cli) | команда `amxts` и стартовые шаблоны, которые она пишет |
| [`create-amxts`](packages/create-amxts) | `npm create amxts` — это `amxts init` |

## Возможности

- **Проект одной командой.** Спрашивает менеджер пакетов, папку, модули,
  линтер, git и папку сервера; каждый вопрос — ещё и флаг, а `--yes` берёт
  значения по умолчанию.
- **Словами менеджера пакетов.** npm, pnpm, yarn или bun: установка, README
  и следующие шаги пишутся командами выбранного.
- **Модуль одной командой.** `amxts module add menu-core` ставит модуль и
  вписывает его в `amxts.config.ts`, не трогая остальной файл.
- **Include сервера.** С папкой сервера сборка читает include, которые
  стоят на нём; без неё `amxts init` спрашивает, для какого сервера проект, —
  ReHLDS + ReGameDLL + ReAPI или обычный HLDS — и для первого скачивает
  include ReAPI.
- **Сохранил — и в игре.** `amxts dev` собирает, выкладывает на сервер и
  повторяет это при каждом сохранении.
- **Ошибки, с которыми понятно, что делать.** Одна строка и подсказка; на
  опечатку — «did you mean»; `--debug` добавляет стек.
- **Стартер модуля.** `amxts init --module` пишет рабочий пакет модуля с
  песочницей, тестом и нативами для Pawn-плагинов.

## Что нужно

- [Node.js](https://nodejs.org) 20.12+ — команда работает на нём.

Сборка, проверка типов и тесты работают на [Bun](https://bun.sh), который
приходит с `@amxts/core` как зависимость: ставить для него ничего не нужно.

## Использование

```sh
npm create amxts@latest    # или: pnpm create amxts, yarn create amxts, bun create amxts
```

Затем в проекте:

```sh
npx amxts dev              # собрать, выложить на сервер из AMXTS_SERVER и повторять при каждом сохранении
npx amxts dev --docker     # собирать для Docker-сервера, который монтирует проект, при каждом сохранении
npx amxts build --deploy   # собрать один раз и выложить
npx amxts build --os linux # для Linux-сервера, когда по AMXTS_SERVER этого не видно
npx amxts build --watch    # собирать при каждом сохранении, не выкладывая
npx amxts typecheck        # проверить проект так, как это делает редактор
npx amxts test             # тесты на поддельном сервере
npx amxts module add menu-core
npx amxts upgrade          # перевести проект и его сервер на последний amxts
npx amxts info             # версии и настройки для сообщения об ошибке
```

`amxts --help` перечисляет команды, `amxts <команда> --help` показывает её
параметры. Каждая команда описана на странице
[команда amxts](https://amxts.github.io/ru/docs/getting-started/cli).

## Как она находит ядро

`@amxts/core` зависит от `@amxts/cli` и несёт bin `amxts`, который её
запускает: менеджер пакетов связывает bin только
прямых зависимостей проекта, поэтому `npx amxts` работает в каждом проекте.

Дальше команда работает с собственным ядром проекта — `@amxts/core` в том
виде, в каком его поставил проект, — и говорит с ним только через
`@amxts/core/cli-api`. Ядро старше или новее, чем команда знает, — это
ошибка, которая говорит, что из двух обновить:

```
✖ @amxts/core 0.1.0 is not a core amxts 0.2.0 works with (^0.2.0)
  Update the core: npm install -D @amxts/core@latest
```

Создать проект или модуль можно без ядра, поэтому `npm create amxts`
работает где угодно.

## Разработка

```sh
npm install --no-package-lock   # воркспейсы и ядро рядом с этим репозиторием (../amxts)
npm test
npm run lint
npm link -w @amxts/cli -w create-amxts   # amxts и create-amxts в PATH, из этой копии
```

[CONTRIBUTING.ru.md](CONTRIBUTING.ru.md) объясняет, как устроена команда:
команда и ядро, Node впереди и Bun позади, стартовые шаблоны, `--local` и
тесты.
