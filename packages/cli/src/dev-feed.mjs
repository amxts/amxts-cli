// What the dev panel knows of the build: read off the lines the core's build
// task prints, the one place that reads them. The words are the core's; a
// structured feed from the core would replace this file, and the panel would
// stay as it is.
//
//   Plugins   3 in plugins/                             the header
//   ◇ compiling hello 1/2                               a compile starts (no TTY)
//   ✔ hello · 1.2s                                      one is compiled
//   ✖ hello does not compile: ...                       an error, its lines under it
//   ✔ 12:01:33 plugins/hello.ts changed: deployed, the server reloaded hello (2.1s)
//   ◇ watching plugins - save a plugin and ...          the first build is done

/** A line without its colours. */
export function plain(line) {
	// eslint-disable-next-line no-control-regex
	return line.replace(/\x1B\[[\d;?]*[a-z]|\x1B\]8;[^\x1B]*\x1B\\/gi, '').replace(/\r/g, '');
}

/** The marks a line of the build starts with: a line without one belongs to the error above it. */
const MARK = /^[✔◇▲✖i] /;

/**
 * @typedef {object} Rebuild
 * @property {string[]} files the saved files that started it; none for a start
 * @property {string[]} plugins what it built
 * @property {number | undefined} compile seconds of compiling, the longest one (they compile side by side); undefined when nothing compiled
 * @property {number} total seconds, all of it
 * @property {string} outcome what the deploy did, as the core says it
 * @property {boolean} reloaded whether the server reloaded them all
 * @property {string} at the time it ended, as printed
 * @property {number | undefined} boot seconds before the core counts, for a build the panel started
 */

/** Each plugin a line names as not compiling is failed. */
function markFailed(feed, text) {
	for (const [, name] of text.matchAll(/(\S+) does not compile:/g)) feed.plugins.set(name, 'failed');
}

/** The lines the feed reads: what each is, and what it changes. */
const RULES = [
	[/^ {2}(Core|Modules|Server|Plugins) +(\S.*)$/, 'header', (feed, [, row, value]) => {
		feed.header[row] = value;
		if (row === 'Plugins') feed.count = Number.parseInt(value, 10) || 0;
	}],
	[/^◇ compiling (.+?) (\d+)\/(\d+)$/, 'compiling', (feed, [, what, , total]) => {
		feed.building ??= { what, done: 0, total: 0, since: Date.now() };
		feed.building.what = what;
		feed.building.total = Number(total);
	}],
	[/^✔ (\S+) · (?:(\d+(?:\.\d+)?)s|prebuilt|unchanged)$/, 'compiled', (feed, [, name, time]) => {
		if (!time) return;
		feed.times.set(name, Number(time));
		feed.expected = Number(time);
		if (feed.building) feed.building.done++;
	}],
	[/^✖ (.*)$/, 'error', (feed, [, text]) => {
		feed.error = [text];
		feed.inError = true;
		feed.broken = true;
		feed.building = null;
		markFailed(feed, text);
	}],
	[/^✔ (?:(\d{1,2}:\d{2}:\d{2}(?: ?[AP]M)?) )?(?:(.+?) changed: )?(.+) \((\d+(?:\.\d+)?)s\)$/, 'rebuilt', (feed, [, at = '', files = '', outcome, total]) => {
		const named = /reloaded (.+)$/.exec(outcome)?.[1]
			?? /^(?:deployed|built|rebuilt) (.+?)(?: into .*| - .*)?$/.exec(outcome)?.[1]
			?? /^(.+?) not deployed/.exec(outcome)?.[1] ?? '';
		const plugins = named.split(', ').filter(Boolean);
		for (const name of plugins) feed.plugins.set(name, 'built');
		const times = [...feed.times.values()];
		feed.last = {
			files: files ? files.split(', ') : [],
			plugins,
			compile: times.length ? Math.max(...times) : undefined,
			total: Number(total),
			outcome,
			reloaded: outcome.startsWith('deployed, the server reloaded '),
			at,
			// A build the panel started: the time before the core's own count - Bun, the project, the server asked.
			boot: feed.started === null ? undefined : Math.max(0, (Date.now() - feed.started) / 1000 - Number(total)),
		};
		feed.started = null;
		feed.times.clear();
		feed.broken = false;
		feed.building = null;
	}],
	[/^◇ watching /, 'watching', (feed) => {
		feed.watching = true;
	}],
];

/** The parser's state, which the panel shows. */
export function createFeed() {
	const feed = {
		/** @type {Record<string, string>} the header's rows: Core, Modules, Server, Plugins */
		header: {},
		/** How many plugins the project has, from the header. */
		count: 0,
		/** @type {Map<string, 'built' | 'failed'>} each plugin a build has named */
		plugins: new Map(),
		/** @type {{ what: string, done: number, total: number, since: number } | null} the build that compiles now: what started last, how many of how many are done, since when (ms) */
		building: null,
		/** Seconds the last plugin took to compile: what the next one is expected to take. */
		expected: 10,
		/** @type {number | null} when the panel started the build that runs (ms), till it ends; null for one a save started */
		started: null,
		/** @type {Rebuild | null} */
		last: null,
		/** @type {string[]} the last error's lines */
		error: [],
		watching: false,
		/** @type {Map<string, number>} seconds of each plugin compiled since the last summary */
		times: new Map(),
		/** Whether the lines that follow belong to the last error. */
		inError: false,
		/** Whether the last build failed: the server keeps the one before. */
		broken: false,

		/**
		 * Takes one line of the build's output.
		 * @returns {string | null} what it was - `header`, `compiling`, `compiled`, `error`, `rebuilt`, `watching` - or null for anything else
		 */
		push(raw) {
			const line = plain(raw);
			if (feed.inError && line && !MARK.test(line)) {
				feed.error.push(line);
				markFailed(feed, line);
				return 'error';
			}
			feed.inError = false;
			for (const [pattern, kind, take] of RULES) {
				const match = pattern.exec(line);
				if (match) {
					take(feed, match);
					return kind;
				}
			}
			return null;
		},

		/** How many plugins are built and how many failed. */
		counts() {
			const states = [...feed.plugins.values()];
			return { built: states.filter(each => each === 'built').length, failed: states.filter(each => each === 'failed').length };
		},
	};
	return feed;
}
