"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AccountModal } from "./AccountModal";
import { COMPOUND_WORDS, EXTENDED_WORDS, STRATEGY_WORDS } from "./strategy-words";
import {
  getAccountStatus,
  logout,
  saveGame,
  setMarketingOptIn,
  EMPTY_STATS,
  type AccountStats,
  type AccountUser,
  type DailyStanding,
  type Difficulty,
  type GameMode,
  type Owner,
  type PlayedWord,
  type SavedGame,
} from "./api-client";

// The board is 31 tiles, not 30 — an odd total on purpose, so a straight majority can never
// split evenly and the game can never end in a tie (see decidedOutcome below). The extra tile
// went onto the outer ring (13 -> 14); the center tile stays a single ring of its own.
export const BOARD_RING_COUNTS = [1, 6, 10, 14] as const;
export const BOARD_SIZE = BOARD_RING_COUNTS.reduce((sum, count) => sum + count, 0);
export const BOARD_VERSION = "circular-31-v1";
const WIN_MESSAGE_HOLD_MS = 2800;

// Locking the center "bullseye" tile (index 0) — i.e. owning it AND surrounding it with your own
// tiles, same as any other stronghold — grants that side an immediate bonus turn instead of passing
// play. Merely claiming/capturing the center in a word isn't enough on its own. Kept behind a flag
// so it's a one-line revert if playtesting says otherwise — flip to false to go back to the center
// being an ordinary tile.
const CENTER_BONUS_ENABLED = true;
const CENTER_TILE = 0;

const BASE_LETTERS = "STARECLOUDPINGMBEACHFORYTENASRE".split("");
const WORDS = `
ace ache act actor adore aer alert aloe alone alter amber ample angel angle angry ant ante any ape arch are area arm art ate atom aunt auto
bad bag bar bare bat bath be beach beam bean bear beat bed bee been beer belt bent best bet bird bite boat bone bore born both bowl boy brain bread break bring broad broke brown build burn burst
cab cable cage can cane cap cape car care cargo cart case cash cast cat catch cave chair charm chart chat chef child choir chose cite city claim clap clear climb clip close cloud coat coil coin cold color comb come core corn cost could count court cover craft crash crate crawl cream crop cross crowd crown cure curl cute
daily dare dark dart date day deal dear debt deck deep deer do dog doll door dot doubt down drag draw dream drip drop drum dry dune dust
each ear earn earth east eat echo edge edit eight else ember empty end era even ever every
face fact fair fall fame far farm fast fate fear feast feed feel feet felt field file film fire firm first fish fit five flag flame flat float floor flow foam fold food foot force forest form fort four frame free fresh from frost fruit full
game gate gear gem get giant gift girl give glad glare glass glow goal goat gold good grain grape graph grass great green grin grip group grow guard guide
hair half hall hand hard harm hat hate have haze head hear heart heat heel held help herb here hero hide hill hint hit hold hole home hope horn horse hot hour house huge hunt hurt
ice idea image in inch into iron item
jar jazz jet job join joke joy jump just
keep key kid kind king kite knee knew know
lace lake land large last late laugh lead leaf learn least left leg lemon lend less let liar life lift light like line link lion list live load loaf loan lock log long look lose lost loud love low luck lunar lunch
made mail main make male mall man many map march mark mass match mate may meal mean meat meet melt men metal mild mile milk mind mine mint miss mist moon more most mother mouse mouth move much mud music must
nail name near neat nest net new nice night nine node north nose note now nurse
oar oat ocean odd off old olive once one open or orange other our out over own
pace pack page paint pair pale palm pan panel paper park part path pay peace peak pear pen pet pick pie pin pink pipe place plain plane plant plate play plot poem point pool poor port pose post pot pound power print pull pure push
queen quest quick quiet quit quiz
race rain raise rake ran range rare rate reach read real red reef rest rice rich ride right ring rise river road roam rock role roll roof room root rope rose rough round route row rule run
safe sail salt same sand save scale scan scar sea seal seat seed seem self send set shade shake shape share sharp she sheep shelf shell shine ship shirt shoe shop short show side sign silk sing sit six size sky sleep slice slide slow small smart smile smoke snow soft soil sold some song soon sort sound soup south space spare speak speed spell spend spice spin split spoon sport spot spring star start steam steel step stick still stone stood stop store storm story stove straw stream street strong sum sun sure swim
table tail take tale talk tall tape task tea teach team tear tell ten tent test than thank that the their them then there these they thin thing think this three tide tie tile time tiny to toast toe tone tool top total touch tour town trace track trail train trap tree trick trip true try tune turn two
under unit up use
vast very vine visit voice vote
wait wake walk wall want warm was wash watch water way wear week well west wet whale what wheel when where which white who wide wild wind wine wing winter wire wise wish with wolf wood word wore work world would write wrong
yard year yellow yes yet you young your
`.trim().split(/\s+/);

const BOT_WORDS = [...new Set([...WORDS, ...STRATEGY_WORDS])];

// The rival's move-scoring stays on the small curated BOT_WORDS list so its play style stays
// predictable, but that list is too thin to reliably spot game-ending finishing words late in a
// match. We lazily fetch the same full dictionary the server validates human words against and
// cache it in memory, so the endgame finisher search (see selectRivalMove below) can draw on it
// once it's loaded without paying the cost on every single move. This is deliberately the smaller
// rival-words.json (plain modern English via Wiktionary) rather than the full ENABLE1-merged
// words.json used to validate player-typed words — the full list is a competitive-Scrabble word
// list padded with obscure technical entries, which made the rival's own move choices unreadable.
let rivalDictionaryCache: string[] | null = null;
let rivalDictionaryPromise: Promise<string[]> | null = null;
function loadRivalDictionary(): Promise<string[]> {
  if (rivalDictionaryCache) return Promise.resolve(rivalDictionaryCache);
  if (!rivalDictionaryPromise) {
    rivalDictionaryPromise = fetch("/api/data/rival-words.json")
      .then(response => response.ok ? response.json() : [])
      .then((words: unknown) => {
        rivalDictionaryCache = Array.isArray(words) ? words : [];
        return rivalDictionaryCache;
      })
      .catch(() => []);
  }
  return rivalDictionaryPromise;
}

const POWER_WORD_SET = new Set(STRATEGY_WORDS);
const COMPOUND_WORD_SET = new Set(COMPOUND_WORDS);
const MAX_NON_FIERCE_COMPOUND_WORDS = 2;
const EXTENDED_WORD_SET = new Set(EXTENDED_WORDS);
const CLIENT_SUPPLEMENTAL_WORDS = new Set([
  "motherboard", "motherboards", "masturbated",
  "agreement", "agreements",
  "release", "releases", "released", "releasing",
  "salesman", "salesmen", "saleswoman", "saleswomen", "salesperson", "salespeople",
]);

export type SectorLayout = { ring: number; rIn: number; rOut: number; a0: number; a1: number };

const BOARD_CENTER = 50;
const BOARD_INNER_RADIUS = 6.5;
const BOARD_OUTER_RADIUS = 46;

function circularBoardLayout(): SectorLayout[] {
  const ringWidth = (BOARD_OUTER_RADIUS - BOARD_INNER_RADIUS) / (BOARD_RING_COUNTS.length - 1);
  return BOARD_RING_COUNTS.flatMap((count, ring) => {
    if (ring === 0) return [{ ring, rIn: 0, rOut: BOARD_INNER_RADIUS, a0: 0, a1: 360 }];
    const rIn = BOARD_INNER_RADIUS + (ring - 1) * ringWidth;
    const rOut = BOARD_INNER_RADIUS + ring * ringWidth;
    const step = 360 / count;
    return Array.from({ length: count }, (_, position) => ({
      ring, rIn, rOut, a0: position * step, a1: (position + 1) * step,
    }));
  });
}

export function polarPoint(radius: number, angleDeg: number): [number, number] {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return [BOARD_CENTER + radius * Math.cos(rad), BOARD_CENTER + radius * Math.sin(rad)];
}

export function sectorPath(rIn: number, rOut: number, a0: number, a1: number) {
  const [x1, y1] = polarPoint(rOut, a0);
  const [x2, y2] = polarPoint(rOut, a1);
  const [x3, y3] = polarPoint(rIn, a1);
  const [x4, y4] = polarPoint(rIn, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4} Z`;
}

export const BOARD_LAYOUT = circularBoardLayout();
const OUTER_TILES = BOARD_LAYOUT.map((tile, index) => tile.ring === BOARD_RING_COUNTS.length - 1 ? index : -1).filter(index => index >= 0);
const CENTER_TILES = [0];

// Decorative board rendered on the home screen. Spells real words instead of random letters:
// the center + inner ring reads CLAIMED, the next ring reads STEAL/BOARD, and the outer ring
// reads STRONGHOLD/WINS — matching the 1/6/10/14 tile counts of each ring exactly.
const HOME_PREVIEW_LETTERS = "CLAIMEDSTEALBOARDSTRONGHOLDWINS".split("");
const HOME_PREVIEW_OWN = [0, 1, 2, 3, 4, 5, 6];
const HOME_PREVIEW_RIVAL = [28, 29, 30];

// Small static rendering of the 31-tile circular board, used for decorative previews (the home
// screen header and the daily-challenge card) rather than the interactive game board.
function BoardPreview({ letters, own = [], rival = [], className = "" }: { letters: readonly string[]; own?: readonly number[]; rival?: readonly number[]; className?: string }) {
  return (
    <svg className={`board-preview-svg ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      {letters.map((letter, i) => {
        const layout = BOARD_LAYOUT[i];
        if (!layout) return null;
        const [tx, ty] = polarPoint(layout.ring === 0 ? 0 : (layout.rIn + layout.rOut) / 2, (layout.a0 + layout.a1) / 2);
        const tileClass = `tile ${layout.ring === 0 ? "ring-0" : ""} ${own.includes(i) ? "preview-own" : ""} ${rival.includes(i) ? "preview-rival" : ""}`;
        return (
          <g className={tileClass} key={i}>
            {layout.ring === 0
              ? <circle className="tile-shape" cx={50} cy={50} r={layout.rOut} />
              : <path className="tile-shape" d={sectorPath(layout.rIn, layout.rOut, layout.a0, layout.a1)} />}
            <text className="tile-letter" dy="0.32em" textAnchor="middle" x={tx} y={ty}>{letter}</text>
          </g>
        );
      })}
    </svg>
  );
}

function computeTileNeighbors(layout: SectorLayout[]): number[][] {
  const neighborSets = layout.map(() => new Set<number>());
  const link = (a: number, b: number) => { neighborSets[a].add(b); neighborSets[b].add(a); };
  const byRing = new Map<number, number[]>();
  layout.forEach((tile, index) => byRing.set(tile.ring, [...(byRing.get(tile.ring) ?? []), index]));

  byRing.forEach((indices, ring) => {
    if (ring === 0) return;
    indices.forEach((index, position) => link(index, indices[(position + 1) % indices.length]));
  });
  const centerIndex = byRing.get(0)?.[0];
  if (centerIndex !== undefined) (byRing.get(1) ?? []).forEach(index => link(centerIndex, index));
  for (let ring = 1; ring < BOARD_RING_COUNTS.length - 1; ring++) {
    (byRing.get(ring) ?? []).forEach(innerIndex => (byRing.get(ring + 1) ?? []).forEach(outerIndex => {
      const inner = layout[innerIndex], outer = layout[outerIndex];
      if (inner.a0 < outer.a1 && outer.a0 < inner.a1) link(innerIndex, outerIndex);
    }));
  }
  return neighborSets.map(set => [...set]);
}

const TILE_NEIGHBORS = computeTileNeighbors(BOARD_LAYOUT);
const OUTER_MIN_NEIGHBORS = Math.min(...OUTER_TILES.map(index => TILE_NEIGHBORS[index].length));
const RING_ANCHORS = OUTER_TILES.filter(index => TILE_NEIGHBORS[index].length === OUTER_MIN_NEIGHBORS);

// Fixed-composition letter bag (replaces the old pure-weighted draw, which drifted too far from
// board to board — anywhere from 6 to 15+ vowels, letters like Q/X/Z sometimes doubling up).
//   - A/E/I/O/U: exactly 2 of each (10 tiles).
//   - S/T/R/N/G/L/D/C/M: a dependable core of common consonants, 12 tiles total — but which three
//     of the nine get doubled (2 copies) versus single (1 copy) is re-rolled every game instead of
//     always being S/N/R, so the board doesn't feel like it's drawing from the same fixed set each
//     time. The 3-doubled/6-single split keeps the total at 12 either way, so nothing downstream
//     (the rare-letter slot math below) has to change game to game.
//   - The remaining 9 tiles come from the rest of the alphabet (B F H J K P Q V W X Y Z). Fierce
//     draws 9 of those 12 (including J/Q/X/Z), leaving three out at random each game. Relaxed,
//     Clever, and the Daily challenge exclude J/Q/X/Z entirely, leaving only 8 safe letters
//     (B F H K P V W Y) for 9 slots, so one of them repeats once each game — the only letter in
//     the whole bag that isn't either a fixed count or drawn from a pool with room to spare.
const VOWELS = new Set(["A", "E", "I", "O", "U"]);
const GUARANTEED_VOWELS = ["A", "E", "I", "O", "U"];
const CORE_CONSONANTS = ["S", "T", "R", "N", "G", "L", "D", "C", "M"];
const CORE_DOUBLE_COUNT = 3;
const RARE_LETTERS = ["B", "F", "H", "J", "K", "P", "Q", "V", "W", "X", "Y", "Z"];
const RARE_LETTERS_SAFE = RARE_LETTERS.filter(letter => !["J", "Q", "X", "Z"].includes(letter));
const RARE_SLOT_COUNT = BOARD_SIZE - GUARANTEED_VOWELS.length * 2 - CORE_CONSONANTS.length - CORE_DOUBLE_COUNT;
// The six tiles ringing the center (indices 1..BOARD_RING_COUNTS[1]) need a couple of vowels of
// their own so locking the center — which requires owning all six — stays realistic for an average
// player. A single guaranteed vowel still leaves five consonants that can only ever pair with
// vowels from elsewhere on the board, so one unlucky draw (rare letters landing next to each other)
// can make the ring practically impossible to complete quickly; two vowels gives enough internal
// combinations that a short word inside the ring itself is almost always available.
const RING1_TILES = Array.from({ length: BOARD_RING_COUNTS[1] }, (_, i) => i + 1);
const MIN_RING1_VOWELS = 2;

function shuffleWith<T>(random: () => number, values: T[]) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Draws a fresh random set of 31 letters (not just a reshuffle of a fixed set) from the fixed-
// composition bag above. `random` is injected so the daily challenge can use a seeded version.
// `allowRareQuad` opens up J/Q/X/Z — true only for Fierce; Relaxed, Clever, and the Daily
// challenge always stay in the safer range (see seededLetters).
function drawLetters(random: () => number, allowRareQuad: boolean) {
  const bag: string[] = [];
  GUARANTEED_VOWELS.forEach(letter => bag.push(letter, letter));
  const shuffledCore = shuffleWith(random, CORE_CONSONANTS);
  const coreDoubles = new Set(shuffledCore.slice(0, CORE_DOUBLE_COUNT));
  CORE_CONSONANTS.forEach(letter => bag.push(letter, ...(coreDoubles.has(letter) ? [letter] : [])));
  if (allowRareQuad) {
    bag.push(...shuffleWith(random, RARE_LETTERS).slice(0, RARE_SLOT_COUNT));
  } else {
    bag.push(...RARE_LETTERS_SAFE);
    const extra = Math.max(0, RARE_SLOT_COUNT - RARE_LETTERS_SAFE.length);
    bag.push(...shuffleWith(random, RARE_LETTERS_SAFE).slice(0, extra));
  }

  const letters = shuffleWith(random, bag);
  const isVowel = (letter: string) => VOWELS.has(letter);

  // Relocate vowels from elsewhere on the board into the ring — a straight swap, so it never
  // disturbs the overall bag composition.
  let guard = 0;
  while (RING1_TILES.filter(i => isVowel(letters[i])).length < MIN_RING1_VOWELS && guard < 30) {
    const ring1Consonants = RING1_TILES.filter(i => !isVowel(letters[i]));
    const outsideVowels = letters.map((letter, i) => (!RING1_TILES.includes(i) && isVowel(letter)) ? i : -1).filter(i => i >= 0);
    if (!ring1Consonants.length || !outsideVowels.length) break;
    const from = ring1Consonants[Math.floor(random() * ring1Consonants.length)];
    const to = outsideVowels[Math.floor(random() * outsideVowels.length)];
    [letters[from], letters[to]] = [letters[to], letters[from]];
    guard++;
  }

  return letters;
}

function shuffledLetters(difficulty: Difficulty) {
  return drawLetters(Math.random, difficulty === "fierce");
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit", month: "2-digit", timeZone: "America/Los_Angeles", year: "numeric",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const DAILY_LAUNCH_DATE = "2026-08-02";

function findBlockingPlayedWord(candidate: string, playedWords: Iterable<string>) {
  return [...playedWords].find(previous => previous === candidate || previous.startsWith(candidate));
}

function blocksPlayedWord(candidate: string, playedWords: Iterable<string>) {
  return findBlockingPlayedWord(candidate, playedWords) !== undefined;
}

const WORD_PREFIXES = ["re", "un", "mis", "dis", "pre", "out", "over"];

// A longer word "contains" a shorter one whenever it's a literal prefix extension of it (SMOKE ->
// SMOKERS, CHOSE -> CHOSEN, CRASH -> CRASHING) — this is deliberately the same test blocksPlayedWord
// uses for whether an already-played word blocks a shorter root from being played later, so the two
// stay in sync: whatever counts as "the rival could have blocked this by playing the longer form
// first" here is exactly what would in fact block it once played. A plain startsWith check also
// covers every case the old hardcoded suffix list did (and then some, like irregular forms such as
// CHOSEN) without needing to enumerate suffixes by hand. Prepended forms (un/re/dis + word) aren't
// prefix extensions, so those still need the explicit WORD_PREFIXES check.
function isLongerForm(longer: string, shorter: string) {
  if (longer.length <= shorter.length) return false;
  if (longer.startsWith(shorter)) return true;
  if (WORD_PREFIXES.some(prefix => longer === `${prefix}${shorter}`)) return true;
  return false;
}

// A short suffix inflection (STRONG -> STRONGEST, SMOKE -> SMOKER) is just the normal grammatical
// form of a word the rival already knows — not a display of vocabulary the way a compound or a
// much longer/different extension (DEAL -> DEALERSHIP) is. See selectRivalMove below: this is used
// to exempt plain inflections from the showy-word pacing cap, on both sides of it, so the rival
// isn't stuck defaulting to the bare root for most of the game just because its "showy word" budget
// ran out.
const MAX_INFLECTION_GROWTH = 3;
function isNaturalInflection(word: string) {
  return BOT_WORDS.some(root => {
    if (root === word || word.length <= root.length || word.length - root.length > MAX_INFLECTION_GROWTH) return false;
    // Mirrors the e-dropped-stem handling in the dictionary-extension search below (SMOKE -> SMOK- ->
    // SMOKING/SMOKER) — without it, silent-e words never register as natural inflections of the root
    // the rival already knows, since "smoking" doesn't literally start with "smoke".
    const stems = root.endsWith("e") ? [root, root.slice(0, -1)] : [root];
    return stems.some(stem => word.startsWith(stem)) || WORD_PREFIXES.some(prefix => word === `${prefix}${root}`);
  });
}

// Binary-searches the (alphabetically sorted, see build-server.mjs) full dictionary for words that
// are a prefix extension of `root` — i.e. real dictionary words the rival could play instead of the
// bare root to claim more tiles and block the human from stealing that extension later. Used to plug
// gaps in the rival's small curated word list (BOT_WORDS), which doesn't carry every inflected form
// of every word it knows.
function findDictionaryExtensions(root: string, dictionaryWords: string[], maxLength: number): string[] {
  const lowerBound = (prefix: string) => {
    let lo = 0;
    let hi = dictionaryWords.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (dictionaryWords[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const start = lowerBound(root);
  const end = lowerBound(`${root}￿`);
  const found: string[] = [];
  for (let i = start; i < end && found.length < 40; i++) {
    const candidate = dictionaryWords[i];
    if (candidate.length > root.length && candidate.length <= maxLength) found.push(candidate);
  }
  return found;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(year, month - 1 + amount, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function calendarDays(value: string) {
  const [year, month] = value.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const count = new Date(year, month, 0).getDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: count }, (_, index) => `${value}-${String(index + 1).padStart(2, "0")}`),
  ];
}

// Bump this whenever the letter-drawing algorithm changes in a way that should reroll every daily
// board (past and present) onto the new, fairer distribution — every player still gets the same
// board for a given date, this just changes which board that is.
const DAILY_BOARD_VERSION = "v4";

function seededLetters(seed: string) {
  let state = [...seed].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  // The Daily challenge is one board shared by everyone regardless of which difficulty each
  // player picks, so it always draws from the safer Clever-level pool — never Fierce's J/Q/X/Z.
  return drawLetters(random, false);
}

export function neighbors(index: number) {
  return TILE_NEIGHBORS[index] ?? [];
}

function protectedTiles(owners: Owner[]) {
  return owners.map((owner, i) => owner !== 0 && neighbors(i).every(n => owners[n] === owner));
}

export function claimTiles(tileIds: number[], owner: 1 | 2, source: Owner[]) {
  const protectedNow = protectedTiles(source);
  const next = [...source];
  tileIds.forEach(i => {
    if (!(source[i] !== 0 && source[i] !== owner && protectedNow[i])) next[i] = owner;
  });
  return next;
}

// Returns "you" | "rival" | "tie" once the game is over, or null while it's still going. The game
// is never over while any tile is unclaimed — deciding *when* to spend your remaining tiles/words
// is the whole strategic tension of ENCIRCLE, so an early call based on "the score can't change
// anymore" would cut that off. The only thing this function is for is reading the final tally once
// every one of the 31 tiles has an owner. The "tie" case is unreachable in practice now that the
// board is an odd 31 tiles — 31 can't split evenly two ways — but it's left in rather than assumed
// away, since a resigned/abandoned game or a future board-size change could still hit it.
export function decidedOutcome(owners: Owner[]): "you" | "rival" | "tie" | null {
  if (!owners.every(Boolean)) return null;
  const you = owners.filter(o => o === 1).length;
  const rival = owners.filter(o => o === 2).length;
  return you > rival ? "you" : rival > you ? "rival" : "tie";
}

function boardDistance(left: number, right: number) {
  if (left === right) return 0;
  const visited = new Set([left]);
  let frontier = [left];
  let distance = 0;
  while (frontier.length) {
    distance++;
    const next: number[] = [];
    for (const tile of frontier) {
      for (const neighbor of neighbors(tile)) {
        if (neighbor === right) return distance;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return BOARD_RING_COUNTS.length * 2;
}

function distanceToCenter(index: number) {
  return Math.min(...CENTER_TILES.map(center => boardDistance(index, center)));
}

function largestTerritory(owners: Owner[], owner: 1 | 2) {
  const remaining = new Set(owners.map((value, i) => value === owner ? i : -1).filter(i => i >= 0));
  let largest = 0;
  while (remaining.size) {
    const start = remaining.values().next().value as number;
    const queue = [start];
    remaining.delete(start);
    let size = 0;
    while (queue.length) {
      const current = queue.pop() as number;
      size++;
      neighbors(current).forEach(next => {
        if (remaining.delete(next)) queue.push(next);
      });
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

function territoryValue(owners: Owner[], owner: 1 | 2) {
  const opponent = owner === 1 ? 2 : 1;
  const locked = protectedTiles(owners);
  const owned = owners.map((value, i) => value === owner ? i : -1).filter(i => i >= 0);
  const phase = Math.min(1, owned.length / 13);
  const anchor = RING_ANCHORS.filter(i => owners[i] === owner)
    .sort((a, b) => distanceToCenter(a) - distanceToCenter(b))[0];
  let score = owned.length * 2.6 + largestTerritory(owners, owner) * 2.8;

  owned.forEach(i => {
    const adjacent = neighbors(i);
    const friends = adjacent.filter(n => owners[n] === owner).length;
    const enemies = adjacent.filter(n => owners[n] === opponent).length;
    score += friends * 1.35 - enemies * .7;
    if (locked[i]) score += 18;
    else if (friends === adjacent.length - 1) score += 8;
    else if (friends >= Math.ceil(adjacent.length * .6)) score += 3.5;
    if (RING_ANCHORS.includes(i)) score += 11 - phase * 5;
    else if (OUTER_TILES.includes(i)) score += 2.2;
    if (anchor !== undefined) score += Math.max(0, 6 - boardDistance(anchor, i)) * (1.5 - phase * .6);
    score += Math.max(0, 4 - distanceToCenter(i)) * phase * 1.8;
  });

  owners.forEach((value, i) => {
    if (value !== opponent || locked[i]) return;
    const adjacent = neighbors(i);
    const enemyFriends = adjacent.filter(n => owners[n] === opponent).length;
    if (enemyFriends === adjacent.length - 1) score -= 10;
    else if (enemyFriends >= Math.ceil(adjacent.length * .6)) score -= 4;
  });
  return score;
}

export function boardAdvantage(owners: Owner[], owner: 1 | 2) {
  return territoryValue(owners, owner) - territoryValue(owners, owner === 1 ? 2 : 1);
}

function cornerPressure(owners: Owner[], owner: 1 | 2) {
  const opponent = owner === 1 ? 2 : 1;
  const locked = protectedTiles(owners);
  return RING_ANCHORS.reduce((score, corner) => {
    const adjacent = neighbors(corner);
    const friends = adjacent.filter(i => owners[i] === owner).length;
    const enemies = adjacent.filter(i => owners[i] === opponent).length;
    if (owners[corner] === owner) return score + (locked[corner] ? 90 : 18 + friends * 24 - enemies * 10);
    if (owners[corner] === opponent) return score - (locked[corner] ? 105 : 22 + enemies * 26 - friends * 12);
    return score + friends * 9 - enemies * 11;
  }, 0);
}

function fiercePosition(owners: Owner[]) {
  const locked = protectedTiles(owners);
  const lockBalance = owners.reduce<number>((score, owner, i) => score + (locked[i] ? owner === 2 ? 16 : owner === 1 ? -19 : 0 : 0), 0);
  return boardAdvantage(owners, 2) + cornerPressure(owners, 2) * 1.35 + lockBalance;
}

function canForm(word: string, letters: string[]) {
  const available = [...letters];
  return [...word.toUpperCase()].every(letter => {
    const i = available.indexOf(letter);
    if (i < 0) return false;
    available.splice(i, 1);
    return true;
  });
}

// Used only to check whether a word can close the game out: for each letter, prefer an empty circle
// over a capturable rival circle over one of the bot's own circles, so the search below reliably
// finds a fill/finish when one exists instead of missing it due to the usual strategic tile picks.
function chooseFinishingTiles(word: string, letters: string[], owners: Owner[]) {
  const locked = protectedTiles(owners);
  const used = new Set<number>();
  const picks: number[] = [];
  for (const letter of word.toUpperCase()) {
    const candidates = letters.map((l, i) => l === letter && !used.has(i) ? i : -1).filter(i => i >= 0);
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const rank = (i: number) => owners[i] === 0 ? 3 : owners[i] === 1 && !locked[i] ? 2 : owners[i] === 2 ? 1 : 0;
      return rank(b) - rank(a);
    });
    const pick = candidates[0];
    used.add(pick);
    picks.push(pick);
  }
  return picks;
}

export function chooseTiles(word: string, letters: string[], owners: Owner[], difficulty: Difficulty) {
  const locked = protectedTiles(owners);
  if (difficulty === "fierce") {
    let beams: { picks: number[]; used: Set<number>; score: number }[] = [{ picks: [], used: new Set(), score: fiercePosition(owners) }];
    for (const letter of word.toUpperCase()) {
      const expanded: typeof beams = [];
      beams.forEach(beam => {
        letters.forEach((candidate, i) => {
          if (candidate !== letter || beam.used.has(i)) return;
          const picks = [...beam.picks, i];
          const used = new Set(beam.used);
          used.add(i);
          const next = claimTiles(picks, 2, owners);
          const capture = owners[i] === 1 && !locked[i] ? 16 : 0;
          expanded.push({ picks, used, score: fiercePosition(next) + capture });
        });
      });
      beams = expanded.sort((a, b) => b.score - a.score).slice(0, 24);
    }
    return beams[0]?.picks ?? [];
  }
  const used = new Set<number>();
  const picks: number[] = [];
  for (const letter of word.toUpperCase()) {
    const candidates = letters.map((l, i) => l === letter && !used.has(i) ? i : -1).filter(i => i >= 0);
    candidates.sort((a, b) => {
      const value = (i: number) => {
        if (difficulty === "clever") {
          const next = claimTiles([...picks, i], 2, owners);
          const capture = owners[i] === 1 && !locked[i] ? 7 : 0;
          const friends = neighbors(i).filter(n => next[n] === 2).length;
          return boardAdvantage(next, 2) * .4 + capture + friends * 2;
        }
        if (owners[i] === 1 && !locked[i]) return 5;
        if (owners[i] === 0) return 3;
        if (owners[i] === 2) return 1;
        return -4;
      };
      return value(b) - value(a) + (difficulty === "relaxed" ? Math.random() - .5 : 0);
    });
    const pick = candidates[0];
    used.add(pick);
    picks.push(pick);
  }
  return picks;
}

function bestReplySwing(source: Owner[], letters: string[], usedWords: Set<string>) {
  const before = fiercePosition(source);
  const locked = protectedTiles(source);
  const replies = BOT_WORDS.filter(word => word.length >= 3 && word.length <= 15 && !blocksPlayedWord(word, usedWords) && canForm(word, letters))
    .map(word => {
      const ids = chooseTiles(word, letters, source, "clever");
      const captures = ids.filter(i => source[i] === 2 && !locked[i]).length;
      return { ids, priority: word.length * 1.15 + captures * 6 + (POWER_WORD_SET.has(word) ? 2 : 0) };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 30);
  return replies.reduce((worst, reply) => {
    const after = fiercePosition(claimTiles(reply.ids, 1, source));
    return Math.max(worst, before - after);
  }, 0);
}

// Once the board is down to this many (or fewer) truly unclaimed tiles, grabbing *some* of them
// without clearing the rest just hands the human an easy, uncontested finish on what's left — see
// the "partialEndgameGrab" penalty in scoreCandidate below. Tuned from actual reports of the rival
// taking 2 of the last 4 blanks and leaving a trivial 2-tile mop-up.
const ENDGAME_BLANK_THRESHOLD = 6;

export function selectRivalMove(sourceOwners: Owner[], sourcePlayed: PlayedWord[], letters: string[], difficulty: Difficulty, deterministic = false, dictionaryWords?: string[], recentWords?: string[]) {
  const usedWords = new Set(sourcePlayed.map(play => play.word));
  // Words the rival has played recently in past games at this difficulty (see recordRivalWord /
  // loadRecentRivalWords) get scored down, not excluded — without this, the same handful of
  // long/compound words that happen to fit almost any letter draw (SCHOOLHOUSE, CAMPGROUND, etc.)
  // dominate the top of every ranking and get replayed constantly.
  const recentSet = new Set(recentWords ?? []);
  // "Showy" words — compounds (WORDPLAY-style), the prefix/suffix extended forms (BUILDINGS,
  // REPLAYING...), and anything only found via the dictionary-extension search below that's more
  // than a plain inflection (DEALERSHIP, FACTORSHIP, ARCHANGELS...) rather than the rival's own basic
  // word list — are capped per game so the rival doesn't lean on them every single turn. EXTENDED_WORD_SET
  // used to be treated as unrestricted "normal vocabulary," but it's exactly as showy as the compound
  // list (and gets its own score bonus below), so leaving it ungated meant the rival kept opening
  // games with BUILDINGS/REPLAYING regardless of this cap — that was the actual bug, not just a too-
  // small memory window. Plain inflections (STRONGEST, SMOKER — see isNaturalInflection) are excluded
  // from this count on purpose: they're not vocabulary showing off, and counting them ate the whole
  // budget on ordinary plays, which was the actual cause of the rival defaulting to bare roots
  // (STRONG instead of STRONGEST) for most of every game.
  const showyWordsPlayed = sourcePlayed.filter(play => play.owner === 2 && (COMPOUND_WORD_SET.has(play.word) || EXTENDED_WORD_SET.has(play.word) || (!BOT_WORDS.includes(play.word) && !isNaturalInflection(play.word)))).length;
  // Turn number counting every play so far, both sides — a showy word as the rival's opening move or
  // two reads as showing off rather than playing naturally, so non-fierce difficulties hold off on
  // them until turn 5.
  const turnNumber = sourcePlayed.length + 1;
  const blanks = sourceOwners.filter(owner => owner === 0).length;
  const maxLength = difficulty === "fierce" ? 15 : difficulty === "clever" ? 10 : 6;
  const minLength = blanks <= 8 ? 2 : 3;
  const dynamicMax = Math.max(minLength, maxLength);
  const showyWordsAllowed = difficulty === "fierce" || (showyWordsPlayed < MAX_NON_FIERCE_COMPOUND_WORDS && turnNumber >= 5);
  const availableCandidates = BOT_WORDS.filter(word => word.length >= minLength && word.length <= dynamicMax && !blocksPlayedWord(word, usedWords) && (showyWordsAllowed || !(COMPOUND_WORD_SET.has(word) || EXTENDED_WORD_SET.has(word))) && canForm(word, letters));
  // If the player currently has the center bullseye locked, the rival sniping just one ring tile away
  // from them doesn't gain much (that lone tile usually isn't even protected once it changes hands)
  // but hands the player an easy one-tile relock next turn — which re-fires the bonus turn. Earning it
  // once is the intended reward; letting the rival's own tile choices repeatedly re-open it for free
  // isn't, so moves that would break an existing player lock on the center are filtered out below.
  const centerWasPlayerLocked = CENTER_BONUS_ENABLED && protectedTiles(sourceOwners)[CENTER_TILE] && sourceOwners[CENTER_TILE] === 1;

  if (blanks > 0) {
    // decidedOutcome only returns non-null once every tile is claimed, so this only matches a word
    // that uses up every remaining blank in one move AND leaves the rival ahead — a genuine game-
    // ending finisher, not just a strong move.
    // The rival's regular vocabulary (BOT_WORDS) is deliberately small, which meant it could walk
    // right past a real finishing word just because that word wasn't in its curated list. Once the
    // board is down to a handful of blanks, also check the rival's wider dictionary (loaded once and
    // cached — see loadRivalDictionary above) so it works as hard as a human would to close the game
    // out. Relaxed and Clever stay on the small curated list here on purpose. Relaxed is meant to be
    // the easy/beginner difficulty, and Clever is meant to be the middle difficulty — letting either
    // reach into a much larger dictionary for a closing move (e.g. an obscure finisher like EVONYMUS)
    // defeats the point of both. Only Fierce, the "throw everything at it" difficulty, gets the
    // widened dictionary fallback. Even there it's capped at 8 letters — long enough to catch real
    // finishing words, short enough to stay away from things like BIVOUACKED or REMANUFACTURING.
    const WIDENED_FINISHER_MAX_LENGTH = 8;
    const finisherPool = blanks <= 12 && difficulty === "fierce" && dictionaryWords?.length
      ? [...new Set([
          ...availableCandidates,
          ...dictionaryWords.filter(word => word.length >= minLength && word.length <= Math.min(dynamicMax, WIDENED_FINISHER_MAX_LENGTH) && !blocksPlayedWord(word, usedWords) && canForm(word, letters)),
        ])]
      : availableCandidates;
    const finishers = finisherPool
      .map(word => {
        const ids = chooseFinishingTiles(word, letters, sourceOwners);
        if (!ids) return null;
        const nextOwners = claimTiles(ids, 2, sourceOwners);
        return decidedOutcome(nextOwners) === "rival" ? { word, ids, nextOwners } : null;
      })
      .filter((entry): entry is { word: string; ids: number[]; nextOwners: Owner[] } => entry !== null)
      // Prefer a finisher from the rival's normal curated vocabulary over one that only turned up
      // via the widened dictionary search, and prefer the shorter (more everyday) word as a
      // tiebreaker — the goal is a finish a human would recognize, not the showiest possible word.
      .sort((a, b) => {
        const aCommon = BOT_WORDS.includes(a.word) ? 1 : 0;
        const bCommon = BOT_WORDS.includes(b.word) ? 1 : 0;
        if (aCommon !== bCommon) return bCommon - aCommon;
        return a.word.length - b.word.length;
      });
    const finisher = finishers[0];
    if (finisher) {
      const { word, ids, nextOwners } = finisher;
      const captures = ids.filter(i => sourceOwners[i] === 1 && !protectedTiles(sourceOwners)[i]).length;
      return { word, ids, nextOwners, score: 9999 + captures, captures };
    }
  }
  // BOT_WORDS (the rival's curated vocabulary) is missing most inflected forms of the words it does
  // know — it might have SMOKE without SMOKERS, CHOSE without CHOSEN, CRASH without CRASHING. That
  // meant the isLongerForm dedup below had nothing to prefer over the short root, so the rival played
  // it, leaving the longer extension sitting there for the human to steal on their next turn. Look up
  // real dictionary extensions of each candidate root (and, for silent-e words, of the e-dropped stem
  // too — SMOKE -> SMOK- -> SMOKER/SMOKING/SMOKED) so the rival can actually consider playing the
  // longer, more defensive word instead. Only for Clever/Fierce — Relaxed keeps its narrower vocabulary
  // on purpose. This search isn't picky about *how much* longer the match is (DEALERSHIP, FACTORSHIP,
  // ARCHANGELS all turned up this way too), so a genuinely longer/different find still counts as a
  // "showy" word toward the same per-game cap as compounds — otherwise every single turn ends up
  // being an elaborate word, not just a couple. Plain inflections (STRONGEST off STRONG) are exempt
  // from that cap (see isNaturalInflection) and always searched for, regardless of showyWordsAllowed
  // — the rival should never settle for a bare root over its own genuine longer form just because the
  // showy budget for the game happens to be spent, or because it's still turn 1-4.
  const dictionaryExtendedCandidates = (difficulty === "clever" || difficulty === "fierce") && dictionaryWords?.length
    ? (() => {
        const availableCandidateSet = new Set(availableCandidates);
        const extended = new Set<string>();
        availableCandidates.forEach(word => {
          const bases = word.endsWith("e") ? [word, word.slice(0, -1)] : [word];
          bases.forEach(base => {
            findDictionaryExtensions(base, dictionaryWords, dynamicMax).forEach(ext => extended.add(ext));
          });
        });
        const found = [...extended].filter(ext => !availableCandidateSet.has(ext) && !blocksPlayedWord(ext, usedWords) && canForm(ext, letters));
        return showyWordsAllowed ? found : found.filter(isNaturalInflection);
      })()
    : [];
  const candidatesBeforeVariety = difficulty === "clever" || difficulty === "fierce"
    ? (() => {
        const combined = [...new Set([...availableCandidates, ...dictionaryExtendedCandidates])];
        return combined.filter(word => !combined.some(longer => isLongerForm(longer, word)));
      })()
    : availableCandidates;
  // The recentRepeat score penalty below wasn't enough on its own either — a handful of words
  // (SCHOOLHOUSE, CAMPGROUND, PLAYERS, BUILDINGS...) that fit nearly any letter draw kept scoring so
  // far above everything else that the penalty couldn't dethrone them. Same fix as the endgame
  // restraint above: hard-exclude recently played words as long as at least one non-recent candidate
  // still exists, and only fall back to a recent word when it's genuinely the only legal move.
  const freshCandidates = candidatesBeforeVariety.filter(word => !recentSet.has(word));
  const candidates = freshCandidates.length > 0 ? freshCandidates : candidatesBeforeVariety;
  const scoreCandidate = (word: string, ids: number[]) => {
    const protectedNow = protectedTiles(sourceOwners);
    const captures = ids.filter(i => sourceOwners[i] === 1 && !protectedNow[i]).length;
    const open = ids.filter(i => sourceOwners[i] === 0).length;
    const nextOwners = claimTiles(ids, 2, sourceOwners);
    const swing = boardAdvantage(nextOwners, 2) - boardAdvantage(sourceOwners, 2);
    const strategicSwing = fiercePosition(nextOwners) - fiercePosition(sourceOwners);
    const cornerSwing = cornerPressure(nextOwners, 2) - cornerPressure(sourceOwners, 2);
    const powerBonus = POWER_WORD_SET.has(word) ? Math.min(5, word.length * .35) : 0;
    // Grabbing some, but not all, of a dwindling pool of neutral tiles is exactly the "leaves an
    // easy 2-tile mop-up" pattern reported — so once blanks are scarce, only claiming every last one
    // of them (an actual finish) or none of them (a pure steal elsewhere) is left unpenalized.
    const clearsRemainingBlanks = blanks > 0 && open === blanks;
    const partialEndgameGrab = blanks > 0 && blanks <= ENDGAME_BLANK_THRESHOLD && open > 0 && !clearsRemainingBlanks;
    // Playing the same handful of words every game (the ones that happen to fit almost any letter
    // draw) reads as repetitive rather than clever, so a word played recently at this difficulty is
    // scored down — not banned — until it ages out of the recent-words list.
    const recentRepeat = recentSet.has(word);
    // The rival never went out of its way to surround the center bullseye for the bonus turn — it
    // only ever happened by accident. This doesn't make it hunt for the lock proactively (that would
    // take real multi-turn planning), but whenever a candidate move it's already considering would
    // complete the lock, give it a real nudge toward taking that opportunity instead of an
    // equally-scored alternative.
    const centerNewlyLocked = CENTER_BONUS_ENABLED && protectedTiles(nextOwners)[CENTER_TILE] && !protectedNow[CENTER_TILE] && nextOwners[CENTER_TILE] === 2;
    const centerBonusIncentive = centerNewlyLocked ? 30 : 0;
    const breaksPlayerCenterLock = centerWasPlayerLocked && !(protectedTiles(nextOwners)[CENTER_TILE] && nextOwners[CENTER_TILE] === 1);
    const score = difficulty === "fierce"
      ? strategicSwing * 1.65 + cornerSwing * 1.8 + captures * 9 + word.length * .8 + powerBonus - (partialEndgameGrab ? open * 14 : 0) - (recentRepeat ? 16 : 0) + centerBonusIncentive
      : difficulty === "clever"
        ? swing * .62 + captures * 4.1 + open * .65 + word.length * .72 + (EXTENDED_WORD_SET.has(word) ? 2.4 : 0) + (COMPOUND_WORD_SET.has(word) ? 1.2 : 0) - (partialEndgameGrab ? open * 9 : 0) - (recentRepeat ? 10 : 0) + centerBonusIncentive
        : word.length + captures * 1.5 + open * .5 + Math.random() * 4 - (partialEndgameGrab ? open * 6 : 0) - (recentRepeat ? 6 : 0) + centerBonusIncentive;
    return { word, ids, nextOwners, score, captures, open, breaksPlayerCenterLock };
  };
  const quickDifficulty = difficulty === "fierce" ? "clever" : difficulty;
  const quickRankedAll = candidates.map(word => scoreCandidate(word, chooseTiles(word, letters, sourceOwners, quickDifficulty)))
    .sort((a, b) => b.score - a.score);
  // Same hard-filter-with-fallback pattern as the endgame restraint below: if any move exists that
  // doesn't break the player's current center lock, only consider those; only fall back to a
  // lock-breaking move if it's genuinely the rival's only legal option.
  const centerLockSafeAll = quickRankedAll.filter(move => !move.breaksPlayerCenterLock);
  const quickRankedCenterSafe = centerLockSafeAll.length > 0 ? centerLockSafeAll : quickRankedAll;
  // A score penalty alone (see partialEndgameGrab above) wasn't strict enough — the rival still took
  // one of the last few blanks when a high-scoring word happened to touch one. So once blanks are
  // scarce, this hard-filters down to only moves that touch zero neutral tiles, as long as at least
  // one such move actually exists — the rival keeps playing (stealing/rearranging claimed tiles)
  // without ever reaching into the dwindling blank pool until it truly has no other legal move.
  const endgameSafeMoves = quickRankedCenterSafe.filter(move => move.open === 0);
  const quickRanked = blanks > 0 && blanks <= ENDGAME_BLANK_THRESHOLD && endgameSafeMoves.length > 0
    ? endgameSafeMoves
    : quickRankedCenterSafe;
  // Fierce re-picks tiles with its own beam search below, which can land on a different tile for the
  // same word than the quick pass did — including, in rare cases, a neutral one the filters above were
  // meant to rule out. Re-check after the re-pick so both guarantees actually hold for Fierce.
  const rerankedFierceAll = difficulty === "fierce"
    ? quickRanked.slice(0, 40).map(move => scoreCandidate(move.word, chooseTiles(move.word, letters, sourceOwners, "fierce"))).sort((a, b) => b.score - a.score)
    : quickRanked;
  const centerLockSafeFierce = rerankedFierceAll.filter(move => !move.breaksPlayerCenterLock);
  const rerankedFierce = centerLockSafeFierce.length > 0 ? centerLockSafeFierce : rerankedFierceAll;
  const fierceSafeMoves = rerankedFierce.filter(move => move.open === 0);
  const ranked = difficulty === "fierce" && blanks > 0 && blanks <= ENDGAME_BLANK_THRESHOLD && fierceSafeMoves.length > 0
    ? fierceSafeMoves
    : rerankedFierce;
  const strategic = difficulty === "fierce"
    ? ranked.slice(0, 12).map(move => ({
        ...move,
        score: move.score - bestReplySwing(move.nextOwners, letters, new Set([...usedWords, move.word])) * 1.08,
      })).sort((a, b) => b.score - a.score)
    : ranked;
  // Clever's non-deterministic pool was only 7 deep, and combined with a short 24-word memory
  // window that meant the same handful of top-scoring words (REBUILD, BUILDERS, COUNTLESS...) kept
  // resurfacing across games. Widening the pool gives real variety more room to matter without
  // touching the deterministic/daily pool (kept at 5 so daily boards stay fair and repeatable).
  const pool = difficulty === "relaxed" ? strategic.filter(move => move.word.length <= 5).slice(0, 18)
    : difficulty === "clever" ? strategic.slice(0, deterministic ? 5 : 12) : strategic.slice(0, 1);
  return deterministic ? pool[Math.min(1, pool.length - 1)] ?? ranked[0] ?? null
    : pool[Math.floor(Math.random() * Math.max(pool.length, 1))] ?? ranked[0] ?? null;
}

const LABELS: Record<Difficulty, { name: string; note: string; face: string }> = {
  relaxed: { name: "Relaxed", note: "A gentle first match", face: "◡" },
  clever: { name: "Clever", note: "Things get more interesting", face: "•ᴗ•" },
  fierce: { name: "Fierce", note: "Can you keep up?", face: "◉‿◉" },
};

// Only called once decidedOutcome has confirmed every tile is claimed (see decidedOutcome).
// winningWord is the word that completed the board — the deciding play of the game — and
// closerOwner is whoever actually played it. Those two things can point different directions:
// closing the board out doesn't mean you won it, if the other side already banked more tiles
// earlier in the game. So the message credits the close and the win separately.
function describeOutcome(finalOwners: Owner[], difficulty: Difficulty, winningWord: string, closerOwner: 1 | 2) {
  const you = finalOwners.filter(o => o === 1).length;
  const rival = finalOwners.filter(o => o === 2).length;
  const word = winningWord.toUpperCase();
  const rivalName = LABELS[difficulty].name;
  if (you === rival) return `Every tile is claimed — it's a tie. Final word: ${word}.`;
  const youWon = you > rival;
  if (youWon && closerOwner === 1) return `You encircled the board with ${word}!`;
  if (!youWon && closerOwner === 2) return `${rivalName} encircled the board with ${word}.`;
  if (youWon && closerOwner === 2) return `${rivalName} played ${word}. You encircled the board!`;
  return `You played ${word}. ${rivalName} encircled the board. Better luck next time...`;
}

type DailyResult = { letters: string[]; owners: Owner[]; played: PlayedWord[]; message: string };

function dailyResultKey(date: string) {
  return `gridlock-daily-result-${date}`;
}

function saveDailyResult(date: string, result: DailyResult) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`gridlock-daily-${date}`, "complete");
  window.localStorage.setItem(dailyResultKey(date), JSON.stringify(result));
}

function loadDailyResult(date: string): DailyResult | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(dailyResultKey(date));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DailyResult>;
    if (!Array.isArray(parsed.letters) || !Array.isArray(parsed.owners) || !Array.isArray(parsed.played)) return null;
    return parsed as DailyResult;
  } catch {
    return null;
  }
}

// How many of the rival's most recent words (per difficulty) get remembered and scored down in
// selectRivalMove — see the "recentRepeat" penalty there. Kept out of localStorage's normal per-game
// keys since it needs to persist and accumulate across games, not reset each time.
const RECENT_RIVAL_WORD_LIMIT = 60;

function recentRivalWordsKey(difficulty: Difficulty) {
  return `gridlock-rival-recent-${difficulty}`;
}

function loadRecentRivalWords(difficulty: Difficulty): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentRivalWordsKey(difficulty)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((word): word is string => typeof word === "string") : [];
  } catch {
    return [];
  }
}

function recordRivalWord(difficulty: Difficulty, word: string) {
  if (typeof window === "undefined") return;
  const next = [...loadRecentRivalWords(difficulty).filter(existing => existing !== word), word].slice(-RECENT_RIVAL_WORD_LIMIT);
  window.localStorage.setItem(recentRivalWordsKey(difficulty), JSON.stringify(next));
}

const TUTORIAL_SLIDES = [
  {
    kind: "goal", eyebrow: "The objective", title: "Claim more tiles than your rival.",
    body: "The game ends the instant all 31 tiles are claimed, when there's no empty space left to play. Whoever owns the most tiles at that point, wins. It isn't about matching colors or covering the board in one color, just who holds more tiles when it runs out of room.",
  },
  {
    kind: "claim", eyebrow: "The basic move", title: "Make words. Take ground.",
    body: "Choose tiles anywhere on the 31-tile board, then submit your word. Every tile you use becomes yours, so useful words are also territory moves. Surround the center bullseye tile with your own letters and you get an immediate bonus turn.",
  },
  {
    kind: "defend", eyebrow: "Think one turn ahead", title: "Protect yours. Break theirs.",
    body: "A surrounded tile is locked while its support holds. Defend your clusters, break the tiles supporting theirs, and remember: every move changes both players’ position.",
  },
  {
    kind: "steal", eyebrow: "The score swings", title: "Their loss is your gain.",
    body: "ENCIRCLE is a zero-sum fight for 31 tiles. Use a rival’s letter and its tile changes sides: you gain one while they lose one, making a steal twice as valuable as claiming empty space.",
  },
  {
    kind: "corner", eyebrow: "Build a stronghold", title: "Start on the outer ring.",
    body: "Tiles on the outer ring have fewer neighbors to secure. Capture one early, protect the tiles around it, then grow your connected territory toward the center.",
  },
  {
    kind: "words", eyebrow: "Make language work harder", title: "Stretch the word.",
    body: "Before submitting, look for a prefix or suffix: LOCK can become UNLOCKED. Then look again for compounds: WORD and PLAY can become WORDPLAY. Longer forms claim more tiles and create more chances to steal.",
  },
] as const;

// Builds a full 31-tile letter set for a demo board: the word's letters land on the exact
// tiles the demo selects (in order), everything else is filled with plausible background letters.
function demoLetters(word: string, selected: readonly number[]) {
  const letters = [...BASE_LETTERS];
  [...word.toUpperCase()].forEach((letter, i) => { if (selected[i] !== undefined) letters[selected[i]] = letter; });
  return letters;
}

// Every "locked"/"unlocking" tile below is mechanically real: it only appears locked because every
// one of its neighbors on the actual 31-tile board (see TILE_NEIGHBORS) is owned by that player.
// A couple of these (tile 21's neighbor count, specifically) were tuned for the old 13-tile outer
// ring and are worth re-checking against the 14-tile ring, though the demos still teach the right
// concept either way since they're illustrative, not a live simulation.
const TUTORIAL_DEMOS = {
  // Playing CIRCLES claims the six tiles ringing the center (1-6) plus the center tile itself (0,
  // landing the final S there) all in one move — claiming every tile touching the bullseye at once
  // surrounds and locks it immediately, which is what earns the bonus turn (see CENTER_BONUS_ENABLED;
  // the bonus only fires once the center is actually locked, not just captured).
  claim: {
    word: "CIRCLES",
    selected: [1, 2, 3, 4, 5, 6, 0],
    own: [],
    rival: [],
    changing: [],
    locked: [0],
    unlocking: [],
  },
  // Tile 21 sits on the outer ring with only 3 neighbors (10, 20, 22), so it locks in one move —
  // the whole point of starting on the outer ring instead of fighting for the center.
  corner: {
    word: "ANCHOR",
    selected: [21, 10, 20, 22, 9, 11],
    own: [],
    rival: [],
    changing: [],
    locked: [21],
    unlocking: [],
  },
  // Playing TAKEOVERS steals five tiles straight out of the rival's cluster (8, 20, 9, 19, 24) and
  // lands the final S on the center — a much bigger swing than a single-tile steal.
  steal: {
    word: "TAKEOVERS",
    selected: [8, 20, 9, 19, 24, 1, 2, 3, 0],
    own: [],
    rival: [8, 20, 9, 19, 24, 25, 10, 11],
    changing: [8, 20, 9, 19, 24],
    locked: [],
    unlocking: [],
  },
  // Tile 9 was locked because the rival held all 5 of its neighbors (2, 8, 10, 19, 20). Stealing
  // two of those neighbors (10 and 20) — while also using them to lock your own tile 21 — breaks it.
  defend: {
    word: "UNLOCK",
    selected: [21, 10, 20, 22, 1, 3],
    own: [],
    rival: [9, 2, 8, 19, 10, 20],
    changing: [10, 20],
    locked: [21],
    unlocking: [9],
  },
} satisfies Record<string, {
  word: string; selected: readonly number[]; own: readonly number[]; rival: readonly number[];
  changing: readonly number[]; locked: readonly number[]; unlocking: readonly number[];
}>;

const hasTutorialTile = (tiles: readonly number[], tile: number) => tiles.includes(tile);

// Shrinks an element's font size just enough for its text to fit on one line, instead of letting the
// browser wrap or break a long word mid-letter (e.g. "MOTHERBOARDS" splitting into "MOTHERBOAR"/"DS").
// Re-measures whenever the text changes; the element itself needs white-space:nowrap in CSS.
function useFitFontSize<T extends HTMLElement = HTMLElement>(text: string, active: boolean, maxPx = 20, minPx = 8) {
  const ref = useRef<T | null>(null);
  const [fontSize, setFontSize] = useState(maxPx);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    while (el.scrollWidth > el.clientWidth && size > minPx) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
    setFontSize(size);
    // Re-measuring depends on the element actually being mounted, not just the text changing — the
    // results modal (and thus this button) can mount again showing the *same* word as last time,
    // which wouldn't otherwise re-trigger this effect since `text` didn't change.
  }, [text, active, maxPx, minPx]);
  return { ref, fontSize };
}

function TutorialScore({ after, before }: { after: [number, number]; before: [number, number] }) {
  return (
    <div className="tutorial-score" aria-hidden="true">
      <span>YOU <em><b>{before[0]}</b><strong>{after[0]}</strong></em></span>
      <i>—</i>
      <span>CLEVER <em><b>{before[1]}</b><strong>{after[1]}</strong></em></span>
    </div>
  );
}

// A believable finished-board split for the "objective" tutorial slide: a jagged, organically-grown
// 16-15 territory boundary (like a real close game) rather than a perfect ring or wedge, so it doesn't
// look like there's a shape/pattern to aim for.
const GOAL_DEMO_OWN = new Set([0, 1, 2, 3, 7, 8, 10, 11, 14, 17, 18, 19, 21, 22, 23, 27]);

function TutorialDemo({ kind }: { kind: typeof TUTORIAL_SLIDES[number]["kind"] }) {
  if (kind === "goal") return (
    <div className="goal-demo" aria-hidden="true">
      <div className="tutorial-board">
        <svg className="tutorial-board-svg" viewBox="0 0 100 100">
          {BOARD_LAYOUT.map((layout, i) => (
            <g className={GOAL_DEMO_OWN.has(i) ? "demo-own" : "demo-rival"} key={i}>
              {layout.ring === 0
                ? <circle className="tile-shape" cx={50} cy={50} r={layout.rOut} />
                : <path className="tile-shape" d={sectorPath(layout.rIn, layout.rOut, layout.a0, layout.a1)} />}
            </g>
          ))}
        </svg>
      </div>
      <div className="goal-demo-tally"><span>16 tiles</span><i>—</i><span>15 tiles</span></div>
      <p className="goal-demo-caption">Board full · game over</p>
    </div>
  );
  if (kind === "words") return (
    <div className="word-power-demo" aria-hidden="true">
      <TutorialScore before={[4, 7]} after={[9, 5]} />
      <div className="word-grow"><span>LOCK</span><span>LOCKED</span><strong>UNLOCKED</strong></div>
      <div className="compound-build"><span>WORD</span><i>+</i><span>PLAY</span><i>→</i><strong>WORDPLAY</strong></div>
    </div>
  );
  const demo = TUTORIAL_DEMOS[kind];
  const letters = useMemo(() => demoLetters(demo.word, demo.selected), [demo]);
  const beforeScore: [number, number] = [new Set(demo.own).size, new Set(demo.rival).size];
  const afterScore: [number, number] = [new Set([...demo.own, ...demo.selected]).size, demo.rival.filter(tile => !hasTutorialTile(demo.selected, tile)).length];
  return (
    <div className={`tutorial-demo demo-${kind}`} aria-hidden="true">
      <TutorialScore before={beforeScore} after={afterScore} />
      <div className="tutorial-wordline"><span>PLAY</span><strong>{demo.word}</strong>{kind === "defend" && <b className="tutorial-submit">SUBMIT</b>}</div>
      <div className="tutorial-board">
        <svg className="tutorial-board-svg" viewBox="0 0 100 100">
          {letters.map((letter, i) => {
            const layout = BOARD_LAYOUT[i];
            const [tx, ty] = polarPoint(layout.ring === 0 ? 0 : (layout.rIn + layout.rOut) / 2, (layout.a0 + layout.a1) / 2);
            const tileClass = `${layout.ring === 0 ? "ring-0" : ""} ${hasTutorialTile(demo.own, i) ? "demo-own" : ""} ${hasTutorialTile(demo.rival, i) ? "demo-rival" : ""} ${hasTutorialTile(demo.selected, i) ? "demo-selected" : ""} ${hasTutorialTile(demo.changing, i) ? "demo-changing" : ""} ${hasTutorialTile(demo.locked, i) ? "demo-locks" : ""} ${hasTutorialTile(demo.unlocking, i) ? "demo-unlocking" : ""}`;
            return (
              <g className={tileClass} key={i} style={{ "--tile-delay": `${Math.max(0, demo.selected.indexOf(i)) * .2}s` } as CSSProperties}>
                {layout.ring === 0
                  ? <circle className="tile-shape" cx={50} cy={50} r={layout.rOut} />
                  : <path className="tile-shape" d={sectorPath(layout.rIn, layout.rOut, layout.a0, layout.a1)} />}
                {CENTER_BONUS_ENABLED && layout.ring === 0 && (
                  <circle className="tile-bonus-ring" cx={50} cy={50} r={layout.rOut - 1.2} fill="none" pointerEvents="none" />
                )}
                <text className="tile-letter" dy="0.32em" textAnchor="middle" x={tx} y={ty}>{letter}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function TutorialModal({ page, onClose, onPage }: { page: number; onClose: () => void; onPage: (page: number) => void }) {
  const swipeStart = useRef<number | null>(null);
  const slide = TUTORIAL_SLIDES[page];
  const changePage = (next: number) => onPage(Math.max(0, Math.min(TUTORIAL_SLIDES.length - 1, next)));
  return (
    <div className="tutorial-backdrop">
      <section
        className="tutorial-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        onPointerDown={event => { swipeStart.current = event.clientX; }}
        onPointerUp={event => {
          if (swipeStart.current === null) return;
          const distance = event.clientX - swipeStart.current;
          swipeStart.current = null;
          if (Math.abs(distance) > 45) changePage(page + (distance < 0 ? 1 : -1));
        }}
      >
        <button className="tutorial-skip" onClick={onClose} type="button">Skip</button>
        <div className="tutorial-demo-frame">
          {TUTORIAL_SLIDES.map((item, i) => (
            <div className="tutorial-demo-slide" hidden={i !== page} key={item.kind}>
              <TutorialDemo kind={item.kind} />
            </div>
          ))}
        </div>
        <div className="tutorial-copy" key={slide.kind}>
          <p className="eyebrow">{slide.eyebrow}</p>
          <h2 id="tutorial-title">{slide.title}</h2>
          <p>{slide.body}</p>
        </div>
        <div className="tutorial-dots" aria-label={`Tutorial page ${page + 1} of ${TUTORIAL_SLIDES.length}`}>
          {TUTORIAL_SLIDES.map((item, i) => <button className={i === page ? "active" : ""} key={item.kind} onClick={() => onPage(i)} type="button" aria-label={`Go to tutorial page ${i + 1}`} />)}
        </div>
        <div className="tutorial-nav">
          <button className="tutorial-back" disabled={page === 0} onClick={() => changePage(page - 1)} type="button">Back</button>
          {page < TUTORIAL_SLIDES.length - 1
            ? <button className="primary" onClick={() => changePage(page + 1)} type="button">Next</button>
            : <button className="primary" onClick={onClose} type="button">Let’s play</button>}
        </div>
      </section>
    </div>
  );
}

function newGameId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [screen, setScreen] = useState<"home" | "game" | "rules" | "archive">("home");
  const [difficulty, setDifficulty] = useState<Difficulty>("clever");
  const [mode, setMode] = useState<GameMode>("classic");
  const [dailyDate, setDailyDate] = useState<string | null>(null);
  const [letters, setLetters] = useState(BASE_LETTERS);
  const [owners, setOwners] = useState<Owner[]>(Array(BOARD_SIZE).fill(0));
  const [selected, setSelected] = useState<number[]>([]);
  const [played, setPlayed] = useState<PlayedWord[]>([]);
  const [turn, setTurn] = useState<"you" | "rival" | "done">("you");
  const [message, setMessage] = useState("Make any word");
  const [wordError, setWordError] = useState("");
  const [validating, setValidating] = useState(false);
  const [draggingTile, setDraggingTile] = useState<number | null>(null);
  const [gameId, setGameId] = useState<string>(newGameId);
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [accountStats, setAccountStats] = useState<AccountStats>(EMPTY_STATS);
  const [accountReady, setAccountReady] = useState(false);
  const [dailyStanding, setDailyStanding] = useState<DailyStanding | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [definition, setDefinition] = useState<{ word: string; text: string; loading: boolean; source?: string } | null>(null);
  const [claimEffect, setClaimEffect] = useState<{ tiles: number[]; stolen: number[]; locked: number[] }>({ tiles: [], stolen: [], locked: [] });
  const [hapticsEnabled, setHapticsEnabled] = useState(() => typeof window === "undefined" || window.localStorage.getItem("gridlock-haptics") !== "off");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialPage, setTutorialPage] = useState(0);
  const [archiveMonth, setArchiveMonth] = useState(() => monthKey(todayKey()));
  const dragRef = useRef({ tileId: null as number | null, startX: 0, startY: 0, moved: false });
  const suppressClickRef = useRef(false);

  const locked = useMemo(() => protectedTiles(owners), [owners]);
  const currentWord = selected.map(i => letters[i]).join("").toLowerCase();
  const yourScore = owners.filter(o => o === 1).length;
  const rivalScore = owners.filter(o => o === 2).length;
  const projectedOwners = useMemo(() => selected.length && turn === "you" ? claimTiles(selected, 1, owners) : owners, [owners, selected, turn]);
  const projectedYourScore = projectedOwners.filter(o => o === 1).length;
  const projectedRivalScore = projectedOwners.filter(o => o === 2).length;
  const showingProjectedScore = selected.length > 0 && turn === "you";
  const longestWord = played.filter(play => play.owner === 1).reduce((best, play) => play.word.length > best.length ? play.word : best, "");
  const bestWordFit = useFitFontSize<HTMLButtonElement>(longestWord ? longestWord.toUpperCase() : "—", resultsOpen, 20, 8);
  const biggestSteal = played.filter(play => play.owner === 1).reduce((best, play) => Math.max(best, play.captures ?? 0), 0);
  const result = yourScore > rivalScore ? "win" : yourScore < rivalScore ? "loss" : "tie";
  // Trust the saved results snapshot itself, not just the old completion flag — a stale flag with
  // no snapshot behind it (e.g. from before this check existed) should offer a fresh game, not a broken "results" link.
  const dailyCompleted = typeof window !== "undefined" && loadDailyResult(todayKey()) !== null;
  const dailyPreviewLetters = useMemo(() => seededLetters(`GRIDLOCK-${DAILY_BOARD_VERSION}-${todayKey()}`), []);
  const archiveDates = useMemo(() => calendarDays(archiveMonth), [archiveMonth]);
  const archiveMonthName = useMemo(() => {
    const [year, month] = archiveMonth.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [archiveMonth]);

  const celebrateClaim = useCallback((wordTiles: number[], sourceOwners: Owner[], nextOwners: Owner[], owner: 1 | 2) => {
    const changed = wordTiles.filter(tile => sourceOwners[tile] !== nextOwners[tile]);
    const stolen = changed.filter(tile => sourceOwners[tile] !== 0 && sourceOwners[tile] !== owner);
    const beforeLocked = protectedTiles(sourceOwners);
    const afterLocked = protectedTiles(nextOwners);
    const newlyLocked = afterLocked.flatMap((isLocked, tile) => isLocked && !beforeLocked[tile] && nextOwners[tile] === owner ? [tile] : []);
    const tiles = [...new Set([...changed, ...newlyLocked])];
    setClaimEffect({ tiles, stolen, locked: newlyLocked });
    window.setTimeout(() => setClaimEffect({ tiles: [], stolen: [], locked: [] }), 900 + tiles.length * 70);
    if (hapticsEnabled && "vibrate" in navigator) {
      navigator.vibrate(newlyLocked.length ? [18, 30, 24] : stolen.length ? [15, 28, 15] : owner === 1 ? 16 : 8);
    }
  }, [hapticsEnabled]);

  const toggleHaptics = () => {
    const next = !hapticsEnabled;
    setHapticsEnabled(next);
    window.localStorage.setItem("gridlock-haptics", next ? "on" : "off");
    if (next && "vibrate" in navigator) navigator.vibrate(12);
  };

  const restoreGame = useCallback((game: SavedGame) => {
    if (game.boardVersion !== BOARD_VERSION || game.letters.length !== BOARD_SIZE || game.owners.length !== BOARD_SIZE) return;
    setGameId(game.gameId);
    setDifficulty(game.difficulty);
    setMode(game.mode ?? "classic");
    setDailyDate(game.dailyDate ?? null);
    setLetters(game.letters);
    setOwners(game.owners);
    setPlayed(game.played);
    setTurn(game.turn);
    setMessage(game.message);
    setSelected([]);
    setWordError("");
    setResultsOpen(game.turn === "done");
    setScreen("game");
  }, []);

  useEffect(() => {
    if (window.localStorage.getItem("gridlock-tutorial-v2") !== "seen") setTutorialOpen(true);
  }, []);

  // Warm the rival-dictionary cache as soon as the app loads so it's ready well before the rival
  // needs it — both for an endgame finishing move and, from turn one, for finding real dictionary
  // extensions of its own curated words (see loadRivalDictionary / selectRivalMove).
  useEffect(() => { void loadRivalDictionary(); }, []);

  useEffect(() => {
    let cancelled = false;
    getAccountStatus()
      .then(result => {
        if (cancelled) return;
        setAccount(result.user);
        setAccountStats(result.stats);
        if (result.user && result.game) restoreGame(result.game);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setAccountReady(true); });
    return () => { cancelled = true; };
  }, [restoreGame]);

  useEffect(() => {
    if (!account || !accountReady || screen !== "game" || turn === "rival") return;
    const savedResult = turn === "done" ? result : null;
    const timer = window.setTimeout(() => {
      void saveGame({ gameId, boardVersion: BOARD_VERSION, difficulty, letters, owners, played, turn, message, result: savedResult, mode, dailyDate })
        .then(response => {
          setAccountStats(response.stats);
          if (response.daily) setDailyStanding(response.daily);
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [account, accountReady, dailyDate, difficulty, gameId, letters, message, mode, owners, played, result, screen, turn]);

  const startWordDrag = (event: ReactPointerEvent<HTMLButtonElement>, tileId: number) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { tileId, startX: event.clientX, startY: event.clientY, moved: false };
    suppressClickRef.current = false;
    setDraggingTile(tileId);
  };

  const moveWordDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag.tileId === null) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) drag.moved = true;
    if (!drag.moved) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-word-position]");
    const targetPosition = Number(target?.dataset.wordPosition);
    if (!Number.isInteger(targetPosition)) return;
    setSelected(current => {
      const from = current.indexOf(drag.tileId as number);
      if (from < 0 || from === targetPosition) return current;
      const reordered = [...current];
      const [tile] = reordered.splice(from, 1);
      reordered.splice(targetPosition, 0, tile);
      return reordered;
    });
    setWordError("");
  };

  const endWordDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current.tileId === null) return;
    suppressClickRef.current = dragRef.current.moved;
    dragRef.current.tileId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingTile(null);
  };

  const beginGame = (level: Difficulty, nextMode: GameMode, date: string | null) => {
    setGameId(nextMode === "daily" && date ? `daily-${date}` : newGameId());
    setDifficulty(level);
    setMode(nextMode);
    setDailyDate(date);
    setLetters(nextMode === "daily" && date ? seededLetters(`GRIDLOCK-${DAILY_BOARD_VERSION}-${date}`) : shuffledLetters(level));
    setOwners(Array(BOARD_SIZE).fill(0));
    setSelected([]);
    setPlayed([]);
    setTurn("you");
    setMessage("Make any word");
    setWordError("");
    setDailyStanding(null);
    setResultsOpen(false);
    setShareStatus("");
    setDefinition(null);
    setScreen("game");
  };

  const newGame = (level = difficulty) => beginGame(level, "classic", null);

  // The little circular arrow in the game topbar looked like a "new game" button, but players
  // expect it to put all the tiles back on the same board so they can replay it — not deal out an
  // entirely different set of letters. Keep the letters/difficulty/mode as-is; only clear the play
  // state. Assign a fresh gameId so a completed replay saves as its own result instead of colliding
  // with (and being ignored in favor of) a previous completed save under the old gameId.
  const resetBoard = () => {
    setGameId(newGameId());
    setOwners(Array(BOARD_SIZE).fill(0));
    setSelected([]);
    setPlayed([]);
    setTurn("you");
    setMessage("Make any word");
    setWordError("");
    setDailyStanding(null);
    setResultsOpen(false);
    setShareStatus("");
    setDefinition(null);
  };
  // The daily challenge can only be played once per day: if it's already been finished, jump
  // straight to the results instead of letting the board reset for another attempt.
  const startDaily = (date = todayKey()) => {
    const existing = loadDailyResult(date);
    if (existing) {
      setGameId(`daily-${date}`);
      setDifficulty("clever");
      setMode("daily");
      setDailyDate(date);
      setLetters(existing.letters);
      setOwners(existing.owners);
      setPlayed(existing.played);
      setSelected([]);
      setTurn("done");
      setMessage(existing.message);
      setWordError("");
      setDailyStanding(null);
      setShareStatus("");
      setDefinition(null);
      setScreen("game");
      setResultsOpen(true);
      return;
    }
    beginGame("clever", "daily", date);
  };

  const applyClaim = useCallback((tileIds: number[], owner: 1 | 2, source: Owner[]) => {
    return claimTiles(tileIds, owner, source);
  }, []);

  const rivalMove = useCallback((sourceOwners: Owner[], sourcePlayed: PlayedWord[]) => {
    // Daily challenge boards must play out identically for every player for the leaderboard to be a
    // fair comparison, so the recent-words variety penalty (which depends on this device's local
    // history) only applies to regular classic games, not daily ones.
    const recentWords = mode === "daily" ? undefined : loadRecentRivalWords(difficulty);
    const move = selectRivalMove(sourceOwners, sourcePlayed, letters, difficulty, mode === "daily", rivalDictionaryCache ?? undefined, recentWords);
    if (!move) { setTurn("you"); setMessage("Your turn"); return; }
    if (mode !== "daily") recordRivalWord(difficulty, move.word);
    const nextOwners = move.nextOwners;
    const nextPlayed = [...sourcePlayed, { word: move.word, owner: 2 as const, captures: move.captures }];
    celebrateClaim(move.ids, sourceOwners, nextOwners, 2);
    setOwners(nextOwners);
    setPlayed(nextPlayed);
    const decided = decidedOutcome(nextOwners);
    // The bullseye bonus turn only fires when the center tile becomes locked — i.e. the rival owns
    // it AND has now surrounded it with their own tiles too (the same "stronghold" condition as any
    // other locked tile), not merely from playing a word that includes the center. Compare
    // protectedTiles() before/after so an already-locked center doesn't re-trigger the bonus.
    const centerNewlyLocked = protectedTiles(nextOwners)[CENTER_TILE] && !protectedTiles(sourceOwners)[CENTER_TILE];
    const bonusTurn = !decided && CENTER_BONUS_ENABLED && centerNewlyLocked && nextOwners[CENTER_TILE] === 2;
    setTurn(decided ? "done" : bonusTurn ? "rival" : "you");
    setMessage(decided
      ? describeOutcome(nextOwners, difficulty, move.word, 2)
      : bonusTurn
        ? `${LABELS[difficulty].name} played ${move.word.toUpperCase()} and surrounded the bullseye — bonus turn.`
        : `${LABELS[difficulty].name} played ${move.word.toUpperCase()}`);
    if (decided) {
      if (mode === "daily" && dailyDate) saveDailyResult(dailyDate, { letters, owners: nextOwners, played: nextPlayed, message: describeOutcome(nextOwners, difficulty, move.word, 2) });
      window.setTimeout(() => setResultsOpen(true), WIN_MESSAGE_HOLD_MS);
      return;
    }
    if (bonusTurn) window.setTimeout(() => rivalMove(nextOwners, nextPlayed), 3000);
  }, [celebrateClaim, dailyDate, difficulty, letters, mode]);

  const submit = async () => {
    if (turn !== "you") return;
    if (currentWord.length < 2) { setWordError("Choose at least 2 letters"); return; }
    const blockingWord = findBlockingPlayedWord(currentWord, played.map(play => play.word));
    if (blockingWord) { setWordError(`${blockingWord.toUpperCase()} has already been played`); return; }
    setValidating(true);
    let valid = CLIENT_SUPPLEMENTAL_WORDS.has(currentWord);
    if (!valid) {
      try {
        const response = await fetch("/api/index.php?action=validate-word", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ word: currentWord }),
        });
        const result = await response.json() as { valid?: boolean };
        valid = response.ok && result.valid === true;
      } catch {
        if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
          valid = BOT_WORDS.includes(currentWord);
        } else {
          setWordError("Couldn’t check that word. Try again.");
          setValidating(false);
          return;
        }
      }
    }
    setValidating(false);
    if (!valid) {
      setWordError(currentWord === "masterbated" ? "Did you mean MASTURBATED?" : `${currentWord.toUpperCase()} isn’t in the dictionary`);
      return;
    }
    const beforeLocked = protectedTiles(owners);
    const captures = selected.filter(i => owners[i] === 2 && !beforeLocked[i]).length;
    const nextOwners = applyClaim(selected, 1, owners);
    const nextPlayed = [...played, { word: currentWord, owner: 1 as const, captures }];
    celebrateClaim(selected, owners, nextOwners, 1);
    setOwners(nextOwners);
    setPlayed(nextPlayed);
    setSelected([]);
    setWordError("");
    const decided = decidedOutcome(nextOwners);
    if (decided) {
      setTurn("done");
      const finishedMessage = describeOutcome(nextOwners, difficulty, currentWord, 1);
      setMessage(finishedMessage);
      if (mode === "daily" && dailyDate) saveDailyResult(dailyDate, { letters, owners: nextOwners, played: nextPlayed, message: finishedMessage });
      window.setTimeout(() => setResultsOpen(true), WIN_MESSAGE_HOLD_MS);
      return;
    }
    // Same bullseye bonus as the rival gets in rivalMove above — only fires once you've both claimed
    // the center AND surrounded it with your own tiles (i.e. it just became locked), not merely from
    // playing a word that touches the center.
    const centerNewlyLockedByYou = protectedTiles(nextOwners)[CENTER_TILE] && !protectedTiles(owners)[CENTER_TILE];
    if (CENTER_BONUS_ENABLED && centerNewlyLockedByYou && nextOwners[CENTER_TILE] === 1) {
      setTurn("you");
      setMessage("Bullseye! You've surrounded the center — bonus turn, go again.");
      return;
    }
    setTurn("rival");
    setMessage(`${LABELS[difficulty].name} is thinking…`);
    window.setTimeout(() => rivalMove(nextOwners, nextPlayed), 3000);
  };

  const completeLogin = (result: { game: SavedGame | null; stats: AccountStats; user: AccountUser }) => {
    setAccount(result.user);
    setAccountStats(result.stats);
    if (result.game && screen !== "game") restoreGame(result.game);
    setAccountReady(true);
    setAccountOpen(false);
  };

  const signOut = async () => {
    await logout();
    setAccount(null);
    setAccountStats(EMPTY_STATS);
    setAccountOpen(false);
  };

  const updateMarketingOptIn = async (optIn: boolean) => {
    const result = await setMarketingOptIn(optIn);
    setAccount(result.user);
  };

  const lookUpWord = async (word: string) => {
    setDefinition({ word, text: "", loading: true });
    try {
      const response = await fetch("/api/index.php?action=define-word", {
        body: JSON.stringify({ word }), headers: { "content-type": "application/json" }, method: "POST",
      });
      const entry = await response.json() as { definition?: string | null; source?: string | null };
      if (!response.ok) throw new Error("Definition request failed");
      setDefinition({ word, text: entry.definition || "No definition was found for this word.", loading: false, source: entry.source || undefined });
    } catch {
      setDefinition({ word, text: "The definition is unavailable right now.", loading: false });
    }
  };

  const shareResult = async () => {
    let ringOffset = 0;
    const circles = BOARD_RING_COUNTS.map(count => {
      const ring = owners.slice(ringOffset, ringOffset + count)
        .map(owner => owner === 1 ? "🟢" : owner === 2 ? "🟡" : "⚪").join("");
      ringOffset += count;
      return ring;
    }).join("\n");
    const heading = mode === "daily" && dailyDate ? `ENCIRCLE Daily ${dailyDate}` : `ENCIRCLE vs ${LABELS[difficulty].name}`;
    const text = `${heading}\n${yourScore}–${rivalScore} ${result === "win" ? "Win" : result === "loss" ? "Loss" : "Tie"}\n${circles}\n${longestWord ? `Your best word: ${longestWord.toUpperCase()}\n` : ""}https://playencircle.com`;
    const canShare = typeof navigator.share === "function";
    try {
      if (canShare) await navigator.share({ text, title: "My ENCIRCLE result" });
      else await navigator.clipboard.writeText(text);
      setShareStatus(canShare ? "Shared!" : "Copied!");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus("Couldn’t share");
    }
  };

  const closeTutorial = () => {
    window.localStorage.setItem("gridlock-tutorial-v2", "seen");
    setTutorialOpen(false);
    setTutorialPage(0);
  };

  const accountModal = accountOpen ? (
    <AccountModal
      account={account}
      stats={accountStats}
      onClose={() => setAccountOpen(false)}
      onLogin={completeLogin}
      onLogout={signOut}
      onSetMarketingOptIn={updateMarketingOptIn}
    />
  ) : null;

  const definitionModal = definition ? (
    <div className="modal-backdrop" onMouseDown={() => setDefinition(null)}>
      <section className="definition-modal" role="dialog" aria-modal="true" aria-labelledby="definition-title" onMouseDown={event => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setDefinition(null)} type="button" aria-label="Close">×</button>
        <p className="eyebrow">Word played</p>
        <h2 id="definition-title">{definition.word.toUpperCase()}</h2>
        <p>{definition.loading ? "Looking it up…" : definition.text}</p>
        {definition.source && <small>Definition provided by {definition.source}</small>}
      </section>
    </div>
  ) : null;

  const tutorialModal = tutorialOpen ? <TutorialModal page={tutorialPage} onClose={closeTutorial} onPage={setTutorialPage} /> : null;

  if (screen === "home") return (
    <><main className="home-shell">
      <button className="account-chip home-account" onClick={() => setAccountOpen(true)} type="button">{account ? "My progress" : "Save progress"}</button>
      <section className="brand-block">
        <div className="mini-field" aria-hidden="true">
          <BoardPreview letters={HOME_PREVIEW_LETTERS} own={HOME_PREVIEW_OWN} rival={HOME_PREVIEW_RIVAL} />
        </div>
        <p className="eyebrow">A battle of words</p>
        <h1>ENCIRCLE</h1>
        <p className="lede">Find words. Claim tiles.<br/>Surround letters to make them yours for good.</p>
      </section>
      <button aria-label={dailyCompleted ? "View today’s daily challenge results" : "Play today’s daily challenge"} className="daily-feature" onClick={() => startDaily()} type="button">
        <span className="daily-preview-grid" aria-hidden="true">
          <BoardPreview letters={dailyPreviewLetters} own={[0, 1, 2]} rival={[20, 21, 22]} />
        </span>
        <span className="daily-feature-copy">
          <small>Today’s tiles · {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
          <strong>{dailyCompleted ? "View today’s results" : "Play today’s challenge"}</strong>
          <b>Same board for everyone</b>
          <i>→</i>
        </span>
      </button>
      <button className="archive-link" onClick={() => { setArchiveMonth(monthKey(todayKey())); setScreen("archive"); }} type="button">Browse the daily archive <span>→</span></button>
      <section className="level-picker" aria-labelledby="choose-level">
        <p id="choose-level" className="picker-label">Keep playing · Choose your rival</p>
        {(Object.keys(LABELS) as Difficulty[]).map(level => (
          <button className={`level ${level}`} key={level} onClick={() => newGame(level)}>
            <span className="rival-face">{LABELS[level].face}</span>
            <span><b>{LABELS[level].name}</b><small>{LABELS[level].note}</small></span>
            <span className="arrow">→</span>
          </button>
        ))}
      </section>
      <button className="text-button" onClick={() => { setTutorialPage(0); setTutorialOpen(true); }}>How to play & strategy</button>
      <button className="text-button haptics-toggle" aria-pressed={hapticsEnabled} onClick={toggleHaptics}>Vibration {hapticsEnabled ? "on" : "off"}</button>
      <a className="text-button haptics-toggle" href="mailto:hi@playencircle.com">Feedback? hi@playencircle.com</a>
    </main>{tutorialModal}{accountModal}</>
  );

  if (screen === "archive") {
    const currentMonth = monthKey(todayKey());
    const firstMonth = monthKey(DAILY_LAUNCH_DATE);
    return (
      <><main className="archive-shell">
        <header className="archive-header">
          <button className="back" onClick={() => setScreen("home")} aria-label="Back to menu">←</button>
          <div><p className="eyebrow">Daily Encircle</p><h1>Archive</h1><p>Play any challenge since launch day.</p></div>
        </header>
        <section className="archive-picker" aria-label="Daily Encircle archive">
          <div className="archive-month-nav">
            <button disabled={archiveMonth <= firstMonth} onClick={() => setArchiveMonth(month => shiftMonth(month, -1))} aria-label="Previous month">‹</button>
            <h2>{archiveMonthName}</h2>
            <button disabled={archiveMonth >= currentMonth} onClick={() => setArchiveMonth(month => shiftMonth(month, 1))} aria-label="Next month">›</button>
          </div>
          <div className="archive-weekdays" aria-hidden="true">{["S","M","T","W","T","F","S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
          <div className="archive-calendar">
            {archiveDates.map((date, index) => {
              if (!date) return <span className="archive-blank" key={`blank-${index}`} />;
              const available = date >= DAILY_LAUNCH_DATE && date <= todayKey();
              const complete = available && typeof window !== "undefined" && window.localStorage.getItem(`gridlock-daily-${date}`) === "complete";
              return <button className={complete ? "completed" : ""} disabled={!available} onClick={() => startDaily(date)} key={date} type="button"><span>{Number(date.slice(-2))}</span>{complete && <b aria-label="Completed">★</b>}</button>;
            })}
          </div>
        </section>
      </main>{accountModal}</>
    );
  }

  if (screen === "rules") return (
    <><main className="rules-shell">
      <button className="back" onClick={() => setScreen("home")} aria-label="Back">←</button>
      <p className="eyebrow">Five simple rules</p>
      <h2>Claim the tiles</h2>
      <div className="rules-list">
        <article><span>1</span><div><h3>Make a word</h3><p>Tap letters in any order. Every letter you use becomes yours.</p></div></article>
        <article><span>2</span><div><h3>Steal their letters</h3><p>Use a rival’s letter in your word and it changes to your color.</p></div></article>
        <article><span>3</span><div><h3>Build a stronghold</h3><p>Surround a letter with your color to lock it. Locked letters can’t be stolen.</p></div></article>
        <article><span>4</span><div><h3>Fill the board</h3><p>The game ends the instant all 31 tiles are claimed — there’s no empty space left to play. Whoever owns the most tiles at that point wins, so there’s always a winner and never a tie.</p></div></article>
        <article><span>5</span><div><h3>Surround the bullseye</h3><p>The center tile is marked with a dotted ring: own it and lock it by surrounding it with your own letters, and you get an extra turn.</p></div></article>
      </div>
      <button className="primary" onClick={() => newGame("relaxed")}>Play a relaxed game</button>
    </main>{tutorialModal}{accountModal}</>
  );

  return (
    <><main className="game-shell">
      <header className="game-topbar">
        <button className="icon-button" onClick={() => setScreen("home")} aria-label="Back to menu">←</button>
        <div className="wordmark">{mode === "daily" ? "ENCIRCLE DAILY" : "ENCIRCLE"}</div>
        <div className="topbar-actions">
          <button className="account-chip" onClick={() => setAccountOpen(true)} type="button">{account ? "Stats" : "Save"}</button>
          <button className="icon-button restart" onClick={resetBoard} aria-label="Reset board">↻</button>
        </div>
      </header>

      <section className="scoreboard">
        <div className={`player you ${showingProjectedScore ? "score-preview" : ""}`}><span className="face">YOU</span><strong key={`you-${projectedYourScore}-${selected.length}`} aria-label={showingProjectedScore ? `Projected score ${projectedYourScore}` : `Score ${yourScore}`}>{projectedYourScore}</strong></div>
        <div className="turn-status"><span className={turn}></span>{turn === "you" ? "your turn" : turn === "rival" ? "thinking" : "game over"}</div>
        <div className={`player rival ${difficulty} ${showingProjectedScore ? "score-preview" : ""}`}><span className="face">{LABELS[difficulty].face}</span><strong key={`rival-${projectedRivalScore}-${selected.length}`} aria-label={showingProjectedScore ? `Projected rival score ${projectedRivalScore}` : `Rival score ${rivalScore}`}>{projectedRivalScore}</strong><small>{LABELS[difficulty].name}</small></div>
      </section>

      <section className="play-area">
        {currentWord ? (
          <div className="word-builder" aria-live="polite">
            <div className="word-actions">
              <button className="clear-word" onClick={() => { setSelected([]); setWordError(""); }}>Clear</button>
              <button className="submit-word" disabled={validating || turn !== "you" || currentWord.length < 2} onClick={submit}>{validating ? "Checking…" : "Submit"}</button>
            </div>
            <div className={`assembled-word ${selected.length >= 11 ? "very-long-word" : selected.length >= 8 ? "long-word" : ""}`} aria-label={`Selected word: ${currentWord}`}>
              {selected.map((i, position) => (
                <button
                  key={i}
                  data-word-position={position}
                  className={`word-letter owner-${owners[i]} ${locked[i] ? "locked" : ""} ${draggingTile === i ? "dragging" : ""}`}
                  onPointerDown={event => startWordDrag(event, i)}
                  onPointerMove={moveWordDrag}
                  onPointerUp={endWordDrag}
                  onPointerCancel={endWordDrag}
                  onClick={() => {
                    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                    setSelected(s => s.filter(x => x !== i));
                    setWordError("");
                  }}
                  aria-label={`${letters[i]}, position ${position + 1}. Drag to reorder or click to remove.`}
                >{letters[i]}</button>
              ))}
            </div>
            <p className={`word-feedback ${wordError ? "visible" : ""}`} role="alert">{wordError || "Ready to submit"}</p>
          </div>
        ) : (
          <div className="word-tray" aria-live="polite"><span>{message}</span></div>
        )}
        <div className="board circular-board" role="grid" aria-label="Circular letter board">
          <svg className="circular-board-svg" viewBox="0 0 100 100">
            {letters.map((letter, i) => {
              const owner = owners[i];
              const isSelected = selected.includes(i);
              const disabled = turn !== "you";
              const layout = BOARD_LAYOUT[i];
              const [tx, ty] = polarPoint(layout.ring === 0 ? 0 : (layout.rIn + layout.rOut) / 2, (layout.a0 + layout.a1) / 2);
              const tileClass = `tile owner-${owner} ${layout.ring === 0 ? "ring-0" : ""} ${locked[i] ? "locked" : ""} ${isSelected ? "vacated" : ""} ${claimEffect.tiles.includes(i) ? "just-claimed" : ""} ${claimEffect.stolen.includes(i) ? "just-stolen" : ""} ${claimEffect.locked.includes(i) ? "just-locked" : ""}`;
              const activate = () => { if (disabled) return; setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]); setWordError(""); };
              const shapeProps = {
                role: "gridcell" as const,
                tabIndex: disabled ? -1 : 0,
                "aria-disabled": disabled,
                "aria-label": `${letter}${owner === 1 ? ", yours" : owner === 2 ? ", rival’s" : ""}${locked[i] ? ", locked" : ""}`,
                "aria-pressed": isSelected,
                className: "tile-shape",
                style: { "--claim-delay": `${Math.max(0, claimEffect.tiles.indexOf(i)) * 70}ms` } as CSSProperties,
                onClick: activate,
                onKeyDown: (event: ReactKeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } },
              };
              return (
                <g className={tileClass} key={i}>
                  {layout.ring === 0
                    ? <circle cx={50} cy={50} r={layout.rOut} {...shapeProps} />
                    : <path d={sectorPath(layout.rIn, layout.rOut, layout.a0, layout.a1)} {...shapeProps} />}
                  {CENTER_BONUS_ENABLED && layout.ring === 0 && (
                    <circle
                      className="tile-bonus-ring"
                      cx={50}
                      cy={50}
                      r={layout.rOut - 1.2}
                      fill="none"
                      pointerEvents="none"
                    />
                  )}
                  <text className="tile-letter" dy="0.32em" textAnchor="middle" x={tx} y={ty}>{letter}</text>
                  {locked[i] && <text className="tile-lock" dy="0.32em" textAnchor="middle" x={tx} y={ty - (layout.ring === 0 ? layout.rOut : layout.rOut - layout.rIn) * .42}>🔑</text>}
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      <footer className="game-controls">
        {played.length > 0 && <details className="word-history">
          <summary>Words played so far: <span>{played.length}</span></summary>
          <ol>{played.map((play, index) => <li className={play.owner === 1 ? "mine" : "theirs"} key={`${play.word}-${index}`}><button type="button" onClick={() => void lookUpWord(play.word)}>{play.word.toUpperCase()}</button></li>)}</ol>
        </details>}
        <div className="last-play">{played.length ? <button type="button" onClick={() => void lookUpWord(played.at(-1)?.word ?? "")}><span className={played.at(-1)?.owner === 1 ? "blue-dot" : "coral-dot"}></span>{played.at(-1)?.word.toUpperCase()} <i>define</i></button> : "First move is yours"}</div>
        {!account && <button className="save-progress-link" onClick={() => setAccountOpen(true)} type="button">Save this game across devices</button>}
        {turn === "done" && !resultsOpen && <button className="primary" onClick={() => setResultsOpen(true)}>See results</button>}
      </footer>
    </main>
    {resultsOpen && turn === "done" && (
      <div className="modal-backdrop results-backdrop">
        <section className="results-modal" role="dialog" aria-modal="true" aria-labelledby="results-title">
          <button className="modal-close" onClick={() => setResultsOpen(false)} type="button" aria-label="Close">×</button>
          <p className="eyebrow">{mode === "daily" ? `Encircle Daily · ${dailyDate}` : `Against ${LABELS[difficulty].name}`}</p>
          <h2 id="results-title">{result === "win" ? "Tiles claimed!" : result === "loss" ? "The rival held on." : "Deadlocked."}</h2>
          <div className="final-score"><strong>{yourScore}</strong><span>–</span><strong>{rivalScore}</strong></div>
          <div className="result-highlights">
            <div><span>Your best word</span><button ref={bestWordFit.ref} style={{ fontSize: bestWordFit.fontSize }} title={longestWord.toUpperCase()} type="button" onClick={() => longestWord && void lookUpWord(longestWord)}>{longestWord ? longestWord.toUpperCase() : "—"}</button></div>
            <div><span>Biggest steal</span><strong>{biggestSteal}</strong></div>
            {mode === "daily" && <div><span>Daily standing</span>{dailyStanding ? <strong>{`#${dailyStanding.rank} of ${dailyStanding.total}`}</strong> : account ? <strong>Calculating…</strong> : <button className="daily-standing-signin" onClick={() => setAccountOpen(true)} type="button">Sign in</button>}</div>}
          </div>
          {dailyStanding && <p className="percentile">Top {dailyStanding.percentile}% today</p>}
          <button className="primary share-result" onClick={() => void shareResult()} type="button">{shareStatus || "Share result"}</button>
          <button className="secondary" onClick={() => mode === "daily" ? newGame(difficulty) : newGame()} type="button">Play another game</button>
          {!account && <button className="account-guest" onClick={() => setAccountOpen(true)} type="button">Sign in to save this result</button>}
        </section>
      </div>
    )}
    {definitionModal}{tutorialModal}{accountModal}</>
  );
}
