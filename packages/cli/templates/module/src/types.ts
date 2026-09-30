/** {{title}}'s options: `{{configKey}}` in a project's amxts.config.ts. */
export interface {{Options}} {
	/** What a player is greeted with. */
	greeting: string;
}

declare module "@amxts/core" {
	interface ModuleOptions {
		{{configKey}}?: Partial<{{Options}}>;
	}
}
