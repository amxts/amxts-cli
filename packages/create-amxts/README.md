# create-amxts

Creates an [amxts](https://amxts.github.io/) project: Counter-Strike 1.6
plugins in TypeScript.

```sh
npm create amxts@latest
pnpm create amxts
yarn create amxts
bun create amxts
```

It asks for the package manager, the folder, the modules, oxlint and oxfmt, git
and the server folder `dev` deploys to - each of them is also a flag:

```sh
npm create amxts@latest my-server -- --pm npm --modules menu-core,config-core --no-git --server D:/hlds/cstrike/addons/amxts --yes
```

It is `amxts init` of [@amxts/cli](../cli): `npx amxts init --help` lists the flags.
