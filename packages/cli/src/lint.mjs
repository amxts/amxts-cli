// What a project and a module get to lint and format with: oxlint running
// @antfu/eslint-config's rules - its own where it has them, the ESLint
// plugins as JS plugins where it has not - and oxfmt for JSON and YAML.
// The rules are in the templates' .oxlintrc.json.

export const LINT_DEPENDENCIES = {
	'@e18e/eslint-plugin': '^0.8.1',
	'@eslint-community/eslint-plugin-eslint-comments': '^4.8.1',
	'@stylistic/eslint-plugin': '^5.10.0',
	'eslint-plugin-antfu': '^3.2.3',
	'eslint-plugin-command': '^4.0.0',
	'eslint-plugin-n': '^18.4.0',
	'eslint-plugin-perfectionist': '^5.12.1',
	'eslint-plugin-regexp': '^3.3.1',
	'oxfmt': '^0.70.0',
	'oxlint': '^1.85.0',
};

export const LINT_SCRIPTS = {
	'lint': 'oxlint && oxfmt --check',
	// Up to two more oxlint passes fix what overlapped in the first.
	'lint:fix': 'oxfmt && oxlint --fix --silent || oxlint --fix --silent || oxlint --fix',
};

/** The files in a template that are there only for the lint. */
export const LINT_FILES = ['_oxlintrc.json', '_oxfmtrc.json'];
