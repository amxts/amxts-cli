// #if bun
import { expect, setDefaultTimeout, test } from "bun:test";
// #endif
// #if !bun
import { expect, test, vi } from "vitest";
// #endif
import { setup } from "@amxts/core/test-utils";
// #if menu-core
import { menusOf } from "@amxts/menu-core/testing";
// #endif

// The first run compiles the plugins; the next ones take them from the cache.
// #if bun
setDefaultTimeout(120_000);
// #endif
// #if !bun
vi.setConfig({ testTimeout: 120_000 });
// #endif

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

test("Wave in /menu tells everyone", async () => {
	const server = await setup();
	const menus = menusOf(server);
	const alice = server.join("Alice");
	const bob = server.join("Bob");

	alice.say("/menu");
	menus.press(alice, 1);
	expect(bob.chat).toContain("Alice waves");
});
// #endif
