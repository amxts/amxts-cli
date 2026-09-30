// Loaded before the command (node --import) in a test that types into it: its
// input is a pipe the test writes, taken for a terminal - the prompts read it
// key by key, as they read a keyboard.
import process from 'node:process';

process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;
