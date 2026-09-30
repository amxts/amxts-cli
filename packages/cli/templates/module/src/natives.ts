/**
 * {{title}} for Pawn plugins: each `export function` here is a native, and
 * `npx amxts build` writes include/{{include}}.inc from them.
 */
import { Player, plugin } from "@amxts/core";
import * as {{camel}} from "./index";

plugin({ name: "{{title}}", version: "0.1.0", author: "{{author}}", description: "{{title}} for amxts" });

/** Greets the player in chat. */
export function {{include}}_greet(player: Player) {
	{{camel}}.greet(player);
}
