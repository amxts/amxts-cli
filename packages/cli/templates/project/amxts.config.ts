// The project's config: the modules it uses and their options.
// About this file: https://amxts.github.io/docs/getting-started/quick-start#a-project
export default defineConfig({
	modules: [{{modules}}],
	// The server the plugins are for: "rehlds" (ReHLDS, ReGameDLL, ReAPI) or "hlds".
	// With AMXTS_SERVER the build takes that server's includes; without, amxts
	// fetches this one's into .amxts/include.
	target: "{{target}}",
	// #if menu-core
	// menu-core reads menus from configs/menu.ini: menus: { file: "menu" }
	// #endif
	// A module no plugin uses is left out of the build; one whose natives
	// Pawn plugins call stays with pawn: ["@amxts/menu-core"].
});
