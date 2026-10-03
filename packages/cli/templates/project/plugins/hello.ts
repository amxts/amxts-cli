plugin({ name: "Hello", version: "1.0.0", author: "{{author}}", description: "The first plugin of {{name}}" });

// #if config-core
// configs/hello.yaml (or hello.json) says what a player is greeted with -
// "greeting: Hi" - and "Welcome" is what it is when the file does not say.
interface HelloConfig {
	greeting: string;
}

const { greeting } = configs.load<HelloConfig>("hello", { greeting: "Welcome" });
// #endif
// #if !config-core
const greeting = "Welcome";
// #endif

server.addCommand("/hp", ({ player }) => sayHp(player));
server.addEventListener("putInServer", event => print(0, `${greeting}, ${event.player.name}!`));
// #if menu-core

// A menu made in code: its title and items can be functions of the player it is shown to.
const hello = menus.create("HELLO", { title: ({ player }) => `Hello, ${player.name}` });
hello.addItem({ title: "Wave", onSelect: ({ player }) => print(0, `${player.name} waves`) });
hello.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	visible: ({ player }) => player.health < 100,
	onSelect: ({ player }) => {
		player.health = 100;
	},
});

server.addCommand("/menu", ({ player }) => hello.show(player));
// #endif
// #if !menu-core

// A menu: its title and items can be functions of the player it is shown to.
const hello = new Menu(({ player }) => `Hello, ${player.name}`);
hello.addItem({ title: "Wave", onSelect: ({ player }) => print(0, `${player.name} waves`) });
hello.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	visible: ({ player }) => player.health < 100,
	onSelect: ({ player }) => {
		player.health = 100;
	},
});

server.addCommand("/menu", ({ player }) => hello.show(player));
// #endif

function sayHp(player: Player) {
	print(player, `${player.name}, your HP: ${player.health}`);
}
