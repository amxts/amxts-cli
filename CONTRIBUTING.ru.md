# Как устроена команда amxts

[English](CONTRIBUTING.md) | **Русский**

Этот репозиторий — команда `amxts` и `create-amxts`. Ядро — компилятор,
генераторы, сборочные скрипты, утилиты для тестов — это
[@amxts/core](https://amxts.github.io/ru/), и команда им управляет. Как это
видит автор плагинов — страница сайта
[команда amxts](https://amxts.github.io/ru/docs/getting-started/cli).

| пакет | что |
| --- | --- |
| `packages/cli` | `@amxts/cli`: bin `amxts`, команды (`src/`), стартовые шаблоны (`templates/`) |
| `packages/create-amxts` | `create-amxts`: его запускает `npm create amxts`, а он — `amxts init` со своими аргументами, поэтому они не расходятся |

## Команда и ядро

`@amxts/cli` — это команда. Ядро зависит от неё
и несёт `bin/amxts.mjs`, который её запускает: менеджер пакетов связывает bin
только прямых зависимостей проекта, поэтому `npx amxts` в проекте — это bin
ядра, который вызывает `main()` из этого пакета — того, от которого зависит
ядро. Установленная глобально, команда работает так же.

Команда никогда не импортирует путь внутри ядра. Она находит ядро,
установленное в проект, — `@amxts/core/package.json`, разрешённый из папки,
где она запущена, так, как его разрешает Node (`src/core.mjs`,
`projectCore()`), — сверяет его версию с `CORE_RANGE` (`^0.1.0`), импортирует
`@amxts/core/cli-api` и сверяет `cliApi` с `CLI_API`. Ядро вне диапазона или
с другим `cliApi` — это `CliError`, который говорит, что из двух обновить:
для старого ядра — ядро, для нового — команду. Контракт со стороны ядра — его
`src/cli-api.mjs`:

| из cli-api | чем пользуется |
| --- | --- |
| `version`, `cliApi`, `fromSource` | каждая команда, которой нужно ядро; `--local` — поведение `module add` по умолчанию, когда ядро проекта — рабочая копия |
| `task(name, args)` | `build`, `dev` (`build --deploy --watch`), `typecheck`, `check`, `prepare`, `upgrade`: `{ runtime: 'bun' \| 'node', args }`, их запускает `runTask()` в папке проекта |
| `localModules()` | `--local`: где официальные модули лежат на этой машине |
| `typescript()` | `src/config.mjs`: `amxts.config.ts` читается парсером ядра, поэтому `npm create amxts` не тянет TypeScript |
| `toolchain()` | `info` |
| `bunBinary()` | `src/core.mjs`: Bun, на котором работают задачи и `test` |
| `includeSources()` | `src/includes.mjs`: релиз ReAPI, который скачивает проект без сервера, с его sha256 |
| `serverSystem(argv, env)`, `describeSystem()` | `info`: для какой системы собирает сборка и откуда это известно; необязательны - ядро без них собирает для этой машины |

`init` (проект или модуль), `--help`, `--version` и `info` вне проекта ядра
не требуют.

## Node впереди, Bun позади

`src/` — обычный JavaScript (ESM, типы в JSDoc), который Node запускает как
есть: npm, pnpm и yarn стартуют его Node'ом, и ничему в нём не нужна сборка.

- **На Node**: `init`, `module add` / `list`, `info`, `--help`. Они читают
  `amxts.config.ts` парсером TypeScript, никогда не выполняя его, поэтому
  работают без Bun.
- **На Bun**: задачи ядра `prepare`, `build`, `check` и `upgrade` — `runTask()`
  запускает их и передаёт `--debug` дальше как `AMXTS_DEBUG=1`. `typecheck`
  запускает задачу `prepare`, затем `tsc` под Node. `test` сам запускает
  `bun test` с переданными аргументами.

Bun — тот, что установлен с ядром: `@amxts/core` зависит от пакета `bun`, и
`bunBinary()` из его cli-api находит бинарник — в платформенном пакете
(`@oven/bun-<os>-<arch>`), который npm, pnpm, yarn и bun ставят как
необязательную зависимость без всяких скриптов, иначе там, куда его положил
postinstall `bun`. `bunFor()` (`src/core.mjs`) берёт его, Bun из PATH — только
без него, а `needBun()` говорит, что делать, когда нет ни того, ни другого.
Своего Bun проекту не нужно.

## Файлы

| файл | что |
| --- | --- |
| `src/main.mjs` | таблица команд, справка, «did you mean», единственный `catch` |
| `src/args.mjs` | `--flag value`, `--flag=value`, `--no-flag`, псевдонимы; незнакомый флаг называет ближайший |
| `src/ui.mjs` | цвета (выключены без TTY или с `NO_COLOR`, включены с `FORCE_COLOR`), `log`, `CliError(message, hint)`, `report()`, `closest()` (расстояние правки с перестановками) |
| `src/pm.mjs` | менеджер пакетов: `npm_config_user_agent`, lock-файлы, `packageManager`; как у каждого пишутся install / add / run / exec |
| `src/core.mjs` | версия команды, ядро проекта и ядро на этой машине, проверки версии и `cliApi`, Bun, запуск задачи |
| `src/catalog.mjs` | каталог amxts (`loadCatalog()`), имена в нём, папки `--local`, спецификации `file:` / `link:`; `withRequired()` / `configEntries()`: выбранный модуль, за ним то, что ему нужно (и то, что нужно тому), у каждого — модули, которым он нужен |
| `src/modules.json` | каталог таким, каким он был при публикации команды: то, что она предлагает без сети |
| `src/config.mjs` | `amxts.config.ts`: прочитать `modules` и `target`, дописать в `modules`, сохранив кавычки и раскладку — по одному на строке, когда у записи есть комментарий `// needed by menu-core` |
| `src/includes.mjs` | include сервера: его собственные или скачанные для `target` (`fetch`, `.zip` читается через `node:zlib`, sha256 сверяется); `prepare()`, который первым делом запускают `prepare`, `dev`, `build` и `typecheck` |
| `src/template.mjs` | `{{placeholders}}`, блоки `// #if flag` / `// #if !flag` (`<!-- #if -->` в Markdown, `# #if` в `.gitignore`), `_x` пишется как `.x` |
| `src/lint.mjs` | чем проект и модуль проверяют код: пакеты oxlint и oxfmt, скрипты `lint` / `lint:fix`, файлы, которые нужны только линтеру |
| `src/init.mjs` | стартер проекта поверх `templates/project/` |
| `src/init-module.mjs` | стартер модуля поверх `templates/module/` |
| `src/module.mjs`, `src/info.mjs` | `module add` (установка, конфиг, затем `prepare()`, чтобы конфиг редактора называл модуль) / `list`, `info` |
| `src/server.mjs` | сервер, на который выкладывает проект, — `AMXTS_SERVER` в `.env`: вопрос `init`, который `dev` и `build --deploy` задают, когда он не задан, — в терминале, не в CI |
| `src/system.mjs` | система сервера для `init`: `hlds_linux` или `hlds.exe` рядом с папкой игры |

## Стартеры

`templates/project/` — проект в том виде, в каком он пишется, с блоками на
модуль (`// #if menu-core`) и на выбор (`lint`). Блок модуля остаётся, когда
модуль ставится — выбран или пришёл вместе с тем, кому он нужен, — поэтому
`plugins/hello.ts` пользуется config-core всякий раз, когда выбран
menu-core. `package.json` и `.env` пишет код, а не шаблон; в `package.json`
есть `postinstall: amxts prepare`, так что конфиг редактора в `.amxts/`
пишется после каждой установки и не коммитится. После своей установки `init`
запускает `prepare` этой команды в проекте. С pnpm он ещё пишет
`pnpm-workspace.yaml` с `allowBuilds: { bun: false }`: pnpm останавливает
установку на скрипте сборки зависимости, который никто не разрешил, а скрипт
bun не нужен — бинарник берётся из его платформенного пакета.

## Include сервера

Сборка читает объявления Pawn там, где они нужны плагину, — include-контракт,
нативы и форварды других Pawn-плагинов, Pawn-набор тестов, — из `includes/`
проекта, потом из include его сервера, потом ядра и AMX Mod X
(`includes/README.md` ядра). «Include сервера» — это `src/includes.mjs`:

- задан `AMXTS_SERVER` (в окружении или `.env`), и рядом с ним есть
  `addons/amxmodx/scripting/include`: собственные include сервера, читаются
  на месте. Ничего не скачивается.
- Иначе — `target` в `amxts.config.ts`: `"rehlds"` (по умолчанию) скачивает
  в `.amxts/include` тот релиз ReAPI, из которого сгенерирован API ядра
  (`includeSources()`), со сверкой sha256, один раз — `source.json` там
  говорит, что это; `"hlds"` ничего не скачивает (собственные include AMX Mod
  X идут с ядром) и удаляет скачанное для `"rehlds"`.

`init` спрашивает target, только когда его не говорят include сервера
(`reapi.inc` там — значит `rehlds`); `--target` отвечает на вопрос, `--yes`
берёт `rehlds`. Он скачивает сразу после установки и пишет `target` в
конфиг, так что клон проекта получает те же include при первой установке
(`postinstall: amxts prepare`). `prepare`, `dev`, `build` и `typecheck`
первым делом проверяют их; неудачная загрузка — предупреждение с тем, что
делать, а не ошибка: include нужен сборке, только где его называет плагин.

Менеджер пакетов спрашивается первым; README, установка и следующие шаги
пишутся его командами (`pm.mjs`: `runScript`, `installArgs`, `execAmxts`).

`templates/module/` — пакет модуля с песочницей, тестом и обоими README. Его
`peerDependencies` просят ядро из `CORE_RANGE`; с `--local` его
`devDependencies` ещё и подключают ядро с этой машины — с ним модуль
разрабатывают и тестируют.

## Система сервера

Плагин компилируется в машинный код в объектном формате своего сервера -
COFF для Windows, ELF для Linux, - и собранный для другой системы не
загрузится. Систему решает сборка ядра: `--os`, иначе `AMXTS_SERVER_OS`
(окружение или `.env`), иначе то, что лежит в папке `AMXTS_SERVER`
(`hlds_linux` или `hlds.exe`, иначе её модули), иначе система этой машины.

- `build` и `dev` принимают `--os windows|linux` и передают его задаче
  сборки как есть; другое значение отклоняется до начала сборки.
- `init` узнаёт систему по папке сервера (`src/system.mjs`); если по ней не
  видно, отвечает `--os` или вопрос, и ответ пишется в `.env` как
  `AMXTS_SERVER_OS`. `--yes` без `--os` ничего не пишет: сборка берёт
  систему этой машины.
- `info` показывает, для какой системы соберёт сборка, через
  `serverSystem()` ядра.

## Каталог

Модули, которые предлагает `init`, показывает `module list` и знает по имени
`module add`, — это каталог amxts: реестр
[amxts/modules](https://github.com/amxts/modules), по YAML-файлу на модуль,
которые добавляются через pull request и проверяются его CI, а он собирает их
в `modules.json`. `loadCatalog()` скачивает этот файл один раз за запуск (не
дольше 3 секунд), а если не выходит — без сети или GitHub не отвечает —
берёт `src/modules.json`, копию, которую несёт пакет. Кэша на диске нет:
команды, которые его читают, запускаются редко, а кэш — ещё один файл,
который устаревает. `AMXTS_CATALOG` называет вместо него другой URL или файл —
им пользуются тесты.

Имя из каталога — это его пакет (`menu-core` — это `@amxts/menu-core`,
`votes` мог бы быть `amxts-votes`); любое другое имя — пакет npm, он ставится
так же, но с предупреждением, что в каталоге его нет. Перед релизом
`src/modules.json` обновляется:

```sh
curl -o packages/cli/src/modules.json https://raw.githubusercontent.com/amxts/modules/main/modules.json
npm run lint:fix
```

## `--local`

`--local` — для работы над ядром, командой и официальными модулями вместе:
он берёт ядро с этой машины, а официальные модули каталога — из папок, на
которые ссылается `package.json` этого ядра (`file:`); модуль от сообщества
ставится из npm.
Это поведение по умолчанию, когда команда запущена из рабочей копии этого
репозитория (`FROM_SOURCE`: рядом с корневым `package.json` лежит `.git`), и
для `module add`, когда ядро проекта — рабочая копия.

Ядро на этой машине — папка, которую называет `AMXTS_CORE`, иначе ядро,
которое команда разрешает из своей папки: корневой `package.json` рабочей
копии подключает `../amxts` как dev-зависимость, поэтому после
`npm install` здесь это ядро рядом с этим репозиторием.

Их связывают ссылкой, а не копируют: копия — это то, что опубликовал бы
пакет, а в папке ядра больше (заплатанный компилятор, сгенерированный API).
npm ссылается на `file:`-папку; pnpm и yarn её копируют, поэтому им пишется
`link:`; bun получает `link:<имя>` после `bun link` в папке пакета. Модуль по
ссылке разрешает свои импорты из своей настоящей папки: его `testing/` нужен
`@amxts/core` в собственном `node_modules` модуля — как у модуля, который
разрабатывают.

## Работа здесь

```sh
npm install --no-package-lock   # links the core beside it (../amxts) and the workspaces
npm test                        # bun test ./test
npm run lint                    # oxlint && oxfmt --check
npm link -w @amxts/cli -w create-amxts   # the global amxts and create-amxts, from this checkout
```

Собственная установка ядра подключает `packages/cli` этого репозитория как
его `@amxts/cli` (`file:../amxts-cli/packages/cli`), поэтому
`bin/amxts.mjs` ядра и каждый проект, связанный с этим ядром, запускают
команду отсюда.

## Тесты

`test/cli.test.ts`: аргументы, «did you mean», правка конфига,
спецификации `--local`, шаблоны, `create-amxts`, `init` по флагам с модулями
и без них и без линтера, `init --module`, target по include сервера и
`--target`. `test/includes.test.ts`: собственные include сервера, include
ReAPI, скачанные с релиза на этой машине, `hlds`, неудачная или подменённая
загрузка и чтение `.zip`. `test/core.test.ts`: диапазон
версий и проект с ядром-заглушкой (`standInProject()` в `test/helpers.ts`) —
без ядра, со старым, с новым, без cli-api, с другим `cliApi` и с тем, чья
задача запускается. `test/project.test.ts`: `module add`, который готовит
проект после того, как внёс модуль в конфиг; `dev`, который спрашивает сервер
в терминале (`amxtsInTerminal()`, чей `test/terminal.mjs` делает ввод
терминалом) и сохраняет его в `.env`, и не спрашивает вне терминала.
`test/system.test.ts`: система сервера по его папке, `--os`, который `init`
сохраняет в `.env`, и `build` и `dev`, отказывающиеся от незнакомой системы.

Изменение стартеров или установки стоит проверить от начала до конца, в
папке вне репозиториев, с ядром, модулями и этим репозиторием копиями (не
ссылками — удаление копии не должно пройти по ссылке в настоящие
`node_modules`, `runtime/deps` или `amxmodx`): `create-amxts` с npm и
`amxts init` с pnpm и bun, затем `build`, `typecheck`, `lint`, `test`,
`module add` / `list`, `info`, `dev` в папку-заглушку сервера (с
`addons/amxmodx/scripting/include` и без сервера для каждого target) и
`init --module` с его `build`, `check` и тестами.
