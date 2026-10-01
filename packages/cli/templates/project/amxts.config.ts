/**
 * The project's config: the modules it uses and their options.
 * About this file: https://amxts.github.io/docs/getting-started/quick-start#a-project
 */
export default defineConfig({
	/**
	 * The modules the plugins use. A module no plugin uses is left out of the
	 * build; one whose natives only Pawn plugins call stays with
	 * `pawn: ["@amxts/menu-core"]`.
	 */
	modules: {{modules}},

	/**
	 * The server the plugins are for: "rehlds" (ReHLDS, ReGameDLL, ReAPI) or "hlds".
	 * With AMXTS_SERVER the build takes that server's includes; without, amxts
	 * fetches this one's into .amxts/include.
	 */
	target: "{{target}}",
	// #if menu-core

	// Where menu-core reads its menus - configs/menu.ini, .yaml or .json:
	// menus: { file: "menu" },
	// #endif
});
