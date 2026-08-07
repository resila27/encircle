import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "api");
const source = await readFile(path.join(root, "app", "word-list.ts"), "utf8");
const encoded = source.match(/=\s*(\[[\s\S]*\]);\s*$/)?.[1];
if (!encoded) throw new Error("ENCIRCLE dictionary source could not be read.");
const clientSource = await readFile(path.join(root, "app", "page.tsx"), "utf8");
const clientEncoded = clientSource.match(/const WORDS = `([\s\S]*?)`\.trim\(\)\.split/)?.[1];
if (!clientEncoded) throw new Error("ENCIRCLE common-word source could not be read.");
const strategySource = await readFile(path.join(root, "app", "strategy-words.ts"), "utf8");
const strategyEncoded = [...strategySource.matchAll(/`([\s\S]*?)`\.trim\(\)\.split/g)].map(match => match[1]).join(" ");
if (!strategyEncoded) throw new Error("ENCIRCLE strategy dictionary could not be read.");
const wiktionaryWords = JSON.parse(await readFile(path.join(root, "data", "wiktionary-words.json"), "utf8"));
if (!Array.isArray(wiktionaryWords) || wiktionaryWords.length < 30000) throw new Error("ENCIRCLE Wiktionary data is unexpectedly small.");
// ENABLE1 (Enhanced North American Benchmark LExicon) is the standard public-domain word-game
// dictionary — curated specifically to exclude offensive terms, which is why it's the usual choice
// for Scrabble-style apps. app/word-list.ts and the Wiktionary extract both have real gaps (entire
// missing letter sections, common words like "wordless" absent), so this fills those in wholesale
// instead of patching one missing word at a time forever.
const enable1Text = await readFile(path.join(root, "data", "enable1-additions.txt"), "utf8");
const enable1Words = enable1Text.split("\n").map(line => line.trim()).filter(Boolean);
if (enable1Words.length < 100000) throw new Error("ENCIRCLE ENABLE1 word list is unexpectedly small.");
const supplementalWords = [
  "motherboard", "motherboards",
  "release",
  "salesman", "saleswoman", "salesperson",
  "underhand", "underhanded", "underhandedly", "underhandedness", "underhands",
  "undercarriage", "undercarriages",
  "wanderlust", "wanderlusts", "wanderlusty",
  "wordless", "wordlessly", "wordlessness",
  "longshot", "longshots",
];
const words = [...new Set([...JSON.parse(encoded), ...wiktionaryWords, ...enable1Words, ...clientEncoded.trim().split(/\s+/), ...strategyEncoded.trim().split(/\s+/), ...supplementalWords])].sort();
if (!Array.isArray(words) || words.length < 200000) throw new Error("ENCIRCLE dictionary is unexpectedly small.");

await mkdir(path.join(output, "data"), { recursive: true });
await cp(path.join(root, "server", "api"), output, { recursive: true });
await writeFile(path.join(output, "data", "words.json"), JSON.stringify(words));
