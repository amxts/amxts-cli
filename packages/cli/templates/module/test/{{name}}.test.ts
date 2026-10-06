// #if bun
import { describe, expect, test } from "bun:test";
// #endif
// #if !bun
import { describe, expect, test } from "vitest";
// #endif
import { setup } from "@amxts/core/test-utils";

// The first test compiles the plugins; the next runs take them from the cache.
const TIMEOUT = 120_000;

describe("{{name}}", () => {
	test("the playground's plugin greets whoever asks, with the playground's greeting", async () => {
		const server = await setup({ rootDir: "playground" });
		const alice = server.join("Alice");

		alice.say("/hello");
		expect(alice.chat).toContain("Hi, Alice!");
	}, TIMEOUT);
	// #if natives

	test("a Pawn plugin greets through the native", async () => {
		const server = await setup();
		const bob = server.join("Bob");

		server.native("{{include}}_greet", bob.id);
		expect(bob.chat).toContain("Hello, Bob!");
	}, TIMEOUT);
	// #endif
});
