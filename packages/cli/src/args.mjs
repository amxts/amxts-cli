// A command's arguments: `--flag`, `--flag value`, `--flag=value`, `--no-flag`
// for a boolean, `-y` for an alias, and the rest as positionals. An unknown
// flag is an error that names the closest known one.
import { CliError, closest } from './ui.mjs';

/** Flags every command takes, as a command's help lists them. */
export const GLOBAL_FLAGS = {
	help: { type: 'boolean', alias: 'h', description: 'Show this help' },
	debug: { type: 'boolean', description: 'Show the stack of an error' },
};

/**
 * @param {string[]} argv
 * @param {Record<string, { type: 'boolean' | 'string', alias?: string }>} flags
 * @param {string} command the command's name, for the error
 */
export function parseArgs(argv, flags, command) {
	const all = { ...GLOBAL_FLAGS, ...flags };
	const aliases = new Map(Object.entries(all).filter(([, flag]) => flag.alias).map(([name, flag]) => [flag.alias, name]));
	/** @type {Record<string, unknown>} */
	const values = {};
	const positionals = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--') {
			positionals.push(...argv.slice(i + 1));
			break;
		}
		if (!arg.startsWith('-') || arg === '-') {
			positionals.push(arg);
			continue;
		}

		const [rawName, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
		let name = rawName.startsWith('--') ? rawName.slice(2) : aliases.get(rawName.slice(1)) ?? rawName.slice(1);
		let negated = false;
		if (!(name in all) && name.startsWith('no-') && all[name.slice(3)]?.type === 'boolean') {
			name = name.slice(3);
			negated = true;
		}
		const flag = all[name];
		if (!flag) {
			const guess = closest(name, Object.keys(all));
			throw new CliError(
				`Unknown option ${rawName} for ${command}`,
				guess ? `Did you mean --${guess}?` : `amxts ${command} --help lists the options.`,
			);
		}

		if (flag.type === 'boolean') {
			values[name] = negated ? false : inline === undefined ? true : !/^(?:false|0|no)$/i.test(inline);
			continue;
		}
		const value = inline ?? argv[++i];
		if (value === undefined || (inline === undefined && value.startsWith('--'))) {
			throw new CliError(`${rawName} needs a value`, `amxts ${command} --help shows what it takes.`);
		}
		values[name] = value;
	}
	return { values, positionals };
}
