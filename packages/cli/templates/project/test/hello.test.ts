import { expect, setDefaultTimeout, test } from "bun:test";
import { setup } from "@amxts/core/test-utils";
// #if menu-core
import { menusOf } from "@amxts/menu-core/testing";
// #endif

// The first run compiles the plugins; the next ones take them from the cache.
setDefaultTimeout(120_000);

test("a player who joins is greeted", async () => {
	const server = await setup();
	const alice = server.join("Alice");

	expect(alice.chat).toContain("Welcome, Alice!");
});

test("/hp tells a player their health", async () => {
	const server = await setup();
	const alice = server.join("Alice", { health: 40 });

	alice.say("/hp");
	expect(alice.chat).toContain("Alice, your HP: 40");
});
// #if menu-core

test("/menu heals a hurt player", async () => {
	const server = await setup();
	const menus = menusOf(server);
	const alice = server.join("Alice", { health: 40 });

	alice.say("/menu");
	expect(menus.screen(alice)!.text).toContain("Heal (40 HP)");

	menus.press(alice, 2);
	expect(alice.health).toBe(100);
});
// #endif
