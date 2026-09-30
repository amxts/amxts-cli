#!/usr/bin/env node
// The amxts command: `npx amxts --help`. Plain JavaScript, so that npm, pnpm
// and yarn can start it with Node; the commands are in src/ (src/main.mjs
// lists them).
import process from 'node:process';
import { main } from '../src/main.mjs';

main(process.argv.slice(2));
