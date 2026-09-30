plugin({ name: "Hello", version: "1.0.0", author: "{{author}}", description: "The first plugin of {{name}}" });

// #if config-core
// configs/hello.yaml (or hello.json) says what a player is greeted with -
// "greeting: Hi" - and "Welcome" is what it is when the file does not say.
const { greeting } = configs.load("hello", { greeting: "Welcome" });
// #endif
// #if !config-core
const greeting = "Welcome";
// #endif

server.addCommand("/hp", sayHp);
server.addEventListener("putinserver", event => print(0, `${greeting}, ${event.player.name}!`));
// #if menu-core

// A menu made in code: its title and items can be functions of the player.
const hello = menus.create("HELLO", { title: player => `Hello, ${player.name}` });
hello.addItem("Wave", { onSelect: wave });
hello.addItem(player => `Heal (${player.health} HP)`, {
	visible: player => player.health < 100,
	onSelect: heal,
});

server.addCommand("/menu", player => hello.show(player));
// #endif

function sayHp(player: Player) {
	print(player, `${player.name}, your HP: ${player.health}`);
}
// #if menu-core

function wave(player: Player) {
	print(0, `${player.name} waves`);
}

function heal(player: Player) {
	player.health = 100;
}
// #endif
