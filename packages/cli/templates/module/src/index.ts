/**
 * {{title}}: an amxts module. Its exports are its API - the plugins of a
 * project that lists it use it as `{{camel}}`, without an import - and one
 * instance of it runs on the server for all of them.
 */
import { Player, print } from "@amxts/core";
import { {{Options}} } from "./types";

export * from "./types";

export default defineModule<{{Options}}>({
	meta: { name: "{{name}}", configKey: "{{configKey}}" },
	defaults: { greeting: "Hello" },
	imports: [{ from: "{{package}}", as: "{{camel}}" }],
	setup(options) {
		greeting = options.greeting;
	},
});

let greeting = "";

/** Greets the player in chat. */
export function greet(player: Player) {
	player.print(`${greeting}, ${player.name}!`);
}
