#!/usr/bin/env node
// npm create amxts@latest [folder] [options] - which is `amxts init`: the
// questions, the flags and the files are @amxts/cli's, so the two never
// drift apart.
import process from 'node:process';
import { main } from '@amxts/cli';

main(['init', ...process.argv.slice(2)]);
