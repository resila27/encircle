"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { AccountModal } from "./AccountModal";
import { COMPOUND_WORDS, EXTENDED_WORDS, STRATEGY_WORDS } from "./strategy-words";
import {
  getAccountStatus,
  logout,
  saveGame,
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

export const BOARD_ROWS = 5;
export const BOARD_COLUMNS = 6;
export const BOARD_SIZE = BOARD_ROWS * BOARD_COLUMNS;
export const BOARD_VERSION = "circular-30-v1";
export const BOARD_RING_COUNTS = [1, 5, 9, 15] as const;
const WIN_MESSAGE_HOLD_MS = 2800;

const BASE_LETTERS = "STARECLOUDPINGMBEACHFORYTENASR".split("");
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
const POWER_WORD_SET = new Set(STRATEGY_WORDS);
const COMPOUND_WORD_SET = new Set(COMPOUND_WORDS);
const EXTENDED_WORD_SET = new Set(EXTENDED_WORDS);
const CLIENT_SUPPLEMENTAL_WORDS = new Set([
  "motherboard", "motherboards", "masturbated",
  "agreement", "agreements",
  "release", "releases", "released", "releasing",
  "salesman", "salesmen", "saleswoman", "saleswomen", "salesperson", "salespeople",
]);

type CircularTileLayout = { ring: number; size: number; x: number; y: number };

function circularBoardLayout(): CircularTileLayout[] {
  const baseRadius = 4.17;
  const ringRadii = [0, 10.12, 24.44, 41.4];
  const tileRadii = [baseRadius, baseRadius * 1.427, baseRadius * 2.004, baseRadius * 2.062];
  const insetScale = .94;

  return BOARD_RING_COUNTS.flatMap((count, ring) => {
    if (ring === 0) return [{ ring, size: tileRadii[ring] * 2 * insetScale, x: 50, y: 50 }];
    const offset = -Math.PI / 2 + (ring % 2 === 0 ? Math.PI / count : 0);
    return Array.from({ length: count }, (_, position) => {
      const angle = offset + position * Math.PI * 2 / count;
      const radius = ringRadii[ring] * insetScale;
      return {
        ring,
        size: tileRadii[ring] * 2 * insetScale,
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * radius,
      };
    });
  });
}

export const BOARD_LAYOUT = circularBoardLayout();
const OUTER_TILES = BOARD_LAYOUT.map((tile, index) => tile.ring === BOARD_RING_COUNTS.length - 1 ? index : -1).filter(index => index >= 0);
const RING_ANCHORS = OUTER_TILES.filter((_, position) => position % 3 === 0);
const CENTER_TILES = [0];

const TILE_NEIGHBORS = BOARD_LAYOUT.map((tile, index) => BOARD_LAYOUT
  .map((candidate, candidateIndex) => {
    if (candidateIndex === index) return -1;
    const distance = Math.hypot(tile.x - candidate.x, tile.y - candidate.y);
    return distance <= (tile.size + candidate.size) * .57 ? candidateIndex : -1;
  })
  .filter(candidateIndex => candidateIndex >= 0));

function shuffledLetters() {
  const a = [...BASE_LETTERS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit", month: "2-digit", timeZone: "America/Los_Angeles", year: "numeric",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const DAILY_LAUNCH_DATE = "2026-08-02";

function blocksPlayedWord(candidate: string, playedWords: Iterable<string>) {
  return [...playedWords].some(previous => previous === candidate || previous.startsWith(candidate));
}

const WORD_PREFIXES = ["re", "un", "mis", "dis", "pre", "out", "over"];
const WORD_SUFFIXES = ["s", "es", "ed", "ing", "er", "ers", "est", "ly", "ness", "less", "ful"];

function isLongerForm(longer: string, shorter: string) {
  if (longer.length <= shorter.length) return false;
  if (WORD_PREFIXES.some(prefix => longer === `${prefix}${shorter}`)) return true;
  if (WORD_SUFFIXES.some(suffix => longer === `${shorter}${suffix}`)) return true;
  if (shorter.endsWith("e") && longer === `${shorter.slice(0, -1)}ing`) return true;
  if (shorter.endsWith("y") && longer === `${shorter.slice(0, -1)}ies`) return true;
  return false;
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

function seededLetters(seed: string) {
  let state = [...seed].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const letters = [...BASE_LETTERS];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
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

export function selectRivalMove(sourceOwners: Owner[], sourcePlayed: PlayedWord[], letters: string[], difficulty: Difficulty, deterministic = false) {
  const usedWords = new Set(sourcePlayed.map(play => play.word));
  const compoundAlreadyPlayed = sourcePlayed.some(play => play.owner === 2 && COMPOUND_WORD_SET.has(play.word));
  const blanks = sourceOwners.filter(owner => owner === 0).length;
  const maxLength = difficulty === "fierce" ? 15 : difficulty === "clever" ? 10 : 6;
  const minLength = blanks <= 8 ? 2 : 3;
  const dynamicMax = Math.max(minLength, maxLength);
  const availableCandidates = BOT_WORDS.filter(word => word.length >= minLength && word.length <= dynamicMax && !blocksPlayedWord(word, usedWords) && (difficulty === "fierce" || !COMPOUND_WORD_SET.has(word) || !compoundAlreadyPlayed) && canForm(word, letters));

  if (blanks > 0 && blanks <= 8) {
    const guaranteedWin = availableCandidates
      .map(word => {
        const ids = chooseTiles(word, letters, sourceOwners, difficulty === "fierce" ? "clever" : difficulty);
        const nextOwners = claimTiles(ids, 2, sourceOwners);
        return nextOwners.every(Boolean) ? { word, ids, nextOwners } : null;
      })
      .find(Boolean);
    if (guaranteedWin && guaranteedWin.ids.length) {
      const { word, ids, nextOwners } = guaranteedWin;
      const captures = ids.filter(i => sourceOwners[i] === 1 && !protectedTiles(sourceOwners)[i]).length;
      return { word, ids, nextOwners, score: 9999 + captures, captures };
    }
  }
  const candidates = difficulty === "clever"
    ? availableCandidates.filter(word => !availableCandidates.some(longer => isLongerForm(longer, word)))
    : availableCandidates;
  const scoreCandidate = (word: string, ids: number[]) => {
    const protectedNow = protectedTiles(sourceOwners);
    const captures = ids.filter(i => sourceOwners[i] === 1 && !protectedNow[i]).length;
    const open = ids.filter(i => sourceOwners[i] === 0).length;
    const nextOwners = claimTiles(ids, 2, sourceOwners);
    const swing = boardAdvantage(nextOwners, 2) - boardAdvantage(sourceOwners, 2);
    const strategicSwing = fiercePosition(nextOwners) - fiercePosition(sourceOwners);
    const cornerSwing = cornerPressure(nextOwners, 2) - cornerPressure(sourceOwners, 2);
    const powerBonus = POWER_WORD_SET.has(word) ? Math.min(5, word.length * .35) : 0;
    const score = difficulty === "fierce"
      ? strategicSwing * 1.65 + cornerSwing * 1.8 + captures * 9 + word.length * .8 + powerBonus
      : difficulty === "clever"
        ? swing * .62 + captures * 4.1 + open * .65 + word.length * .72 + (EXTENDED_WORD_SET.has(word) ? 2.4 : 0) + (COMPOUND_WORD_SET.has(word) ? 1.2 : 0)
        : word.length + captures * 1.5 + open * .5 + Math.random() * 4;
    return { word, ids, nextOwners, score, captures };
  };
  const quickDifficulty = difficulty === "fierce" ? "clever" : difficulty;
  const quickRanked = candidates.map(word => scoreCandidate(word, chooseTiles(word, letters, sourceOwners, quickDifficulty)))
    .sort((a, b) => b.score - a.score);
  const ranked = difficulty === "fierce"
    ? quickRanked.slice(0, 40).map(move => scoreCandidate(move.word, chooseTiles(move.word, letters, sourceOwners, "fierce"))).sort((a, b) => b.score - a.score)
    : quickRanked;
  const strategic = difficulty === "fierce"
    ? ranked.slice(0, 12).map(move => ({
        ...move,
        score: move.score - bestReplySwing(move.nextOwners, letters, new Set([...usedWords, move.word])) * 1.08,
      })).sort((a, b) => b.score - a.score)
    : ranked;
  const pool = difficulty === "relaxed" ? strategic.filter(move => move.word.length <= 5).slice(0, 18)
    : difficulty === "clever" ? strategic.slice(0, deterministic ? 5 : 7) : strategic.slice(0, 1);
  return deterministic ? pool[Math.min(1, pool.length - 1)] ?? ranked[0] ?? null
    : pool[Math.floor(Math.random() * Math.max(pool.length, 1))] ?? ranked[0] ?? null;
}

const LABELS: Record<Difficulty, { name: string; note: string; face: string }> = {
  relaxed: { name: "Relaxed", note: "A gentle first match", face: "◡" },
  clever: { name: "Clever", note: "Things get more interesting", face: "•ᴗ•" },
  fierce: { name: "Fierce", note: "Can you keep up?", face: "◉‿◉" },
};

const TUTORIAL_SLIDES = [
  {
    kind: "claim", eyebrow: "The basic move", title: "Make words. Take ground.",
    body: "Choose circles anywhere on the 5×6 board, then submit your word. Every circle you use becomes yours, so useful words are also territory moves.",
  },
  {
    kind: "defend", eyebrow: "Think one turn ahead", title: "Protect yours. Break theirs.",
    body: "A surrounded circle is locked while its support holds. Defend your clusters, break the circles supporting theirs, and remember: every move changes both players’ position.",
  },
  {
    kind: "steal", eyebrow: "The score swings", title: "Their loss is your gain.",
    body: "ENCIRCLE is a zero-sum fight for 30 circles. Use a rival’s letter and its circle changes sides: you gain one while they lose one, making a steal twice as valuable as claiming empty space.",
  },
  {
    kind: "corner", eyebrow: "Build a stronghold", title: "Start at an edge. Own a corner.",
    body: "Corners have fewer neighboring circles to secure. Capture one early, protect the circles around it, then grow your connected territory toward the center.",
  },
  {
    kind: "words", eyebrow: "Make language work harder", title: "Stretch the word.",
    body: "Before submitting, look for a prefix or suffix: LOCK can become UNLOCKED. Then look again for compounds: WORD and PLAY can become WORDPLAY. Longer forms claim more circles and create more chances to steal.",
  },
] as const;

export const TUTORIAL_DEMOS = {
  claim: {
    word: "CIRCLE",
    letters: "CILRECRCEDPINGMBEACHFORYTENASR".split(""),
    selected: [0, 1, 6, 7, 2, 8],
    own: [],
    rival: [],
    changing: [],
    locked: [0, 1],
    unlocking: [],
  },
  steal: {
    word: "TAKEOVER",
    letters: "TAKRECEOVDPIERMBEACHFORYTENASR".split(""),
    selected: [0, 1, 2, 6, 7, 8, 12, 13],
    own: [],
    rival: [0, 2, 7, 12, 17, 22, 23, 29],
    changing: [0, 2, 7, 12],
    locked: [0, 1, 6],
    unlocking: [],
  },
  corner: {
    word: "ANCHOR",
    letters: "ANORECCHRDPINGMBEACHFORYTENASR".split(""),
    selected: [0, 1, 6, 7, 2, 8],
    own: [],
    rival: [],
    changing: [],
    locked: [0, 1],
    unlocking: [],
  },
  defend: {
    word: "UNLOCK",
    letters: "UNARECLOKDCINGMBEACHFORYTENASR".split(""),
    selected: [0, 1, 6, 7, 10, 8],
    own: [],
    rival: [4, 5, 10, 11, 17, 22],
    changing: [10],
    locked: [0],
    unlocking: [5],
  },
} as const;

const hasTutorialTile = (tiles: readonly number[], tile: number) => tiles.includes(tile);

function TutorialScore({ after, before }: { after: [number, number]; before: [number, number] }) {
  return (
    <div className="tutorial-score" aria-hidden="true">
      <span>YOU <em><b>{before[0]}</b><strong>{after[0]}</strong></em></span>
      <i>—</i>
      <span>CLEVER <em><b>{before[1]}</b><strong>{after[1]}</strong></em></span>
    </div>
  );
}

function TutorialDemo({ kind }: { kind: typeof TUTORIAL_SLIDES[number]["kind"] }) {
  if (kind === "words") return (
    <div className="word-power-demo" aria-hidden="true">
      <TutorialScore before={[4, 7]} after={[9, 5]} />
      <div className="word-grow"><span>LOCK</span><span>LOCKED</span><strong>UNLOCKED</strong></div>
      <div className="compound-build"><span>WORD</span><i>+</i><span>PLAY</span><i>→</i><strong>WORDPLAY</strong></div>
    </div>
  );
  const demo = TUTORIAL_DEMOS[kind];
  const beforeScore: [number, number] = [new Set(demo.own).size, new Set(demo.rival).size];
  const afterScore: [number, number] = [new Set([...demo.own, ...demo.selected]).size, demo.rival.filter(tile => !hasTutorialTile(demo.selected, tile)).length];
  return (
    <div className={`tutorial-demo demo-${kind}`} aria-hidden="true">
      <TutorialScore before={beforeScore} after={afterScore} />
      <div className="tutorial-wordline"><span>PLAY</span><strong>{demo.word}</strong>{kind === "defend" && <b className="tutorial-submit">SUBMIT</b>}</div>
      <div className="tutorial-board">
        {demo.letters.map((letter, i) => <span
          className={`${hasTutorialTile(demo.own, i) ? "demo-own" : ""} ${hasTutorialTile(demo.rival, i) ? "demo-rival" : ""} ${hasTutorialTile(demo.selected, i) ? "demo-selected" : ""} ${hasTutorialTile(demo.changing, i) ? "demo-changing" : ""} ${hasTutorialTile(demo.locked, i) ? "demo-locks" : ""} ${hasTutorialTile(demo.unlocking, i) ? "demo-unlocking" : ""}`}
          key={i}
          style={{ "--tile-delay": `${Math.max(0, (demo.selected as readonly number[]).indexOf(i)) * .2}s` } as CSSProperties}
        >{letter}{(hasTutorialTile(demo.locked, i) || hasTutorialTile(demo.unlocking, i)) && <i>🔑</i>}</span>)}
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
  const longestWord = played.reduce((best, play) => play.word.length > best.length ? play.word : best, "");
  const biggestSteal = played.filter(play => play.owner === 1).reduce((best, play) => Math.max(best, play.captures ?? 0), 0);
  const result = yourScore > rivalScore ? "win" : yourScore < rivalScore ? "loss" : "tie";
  const dailyCompleted = typeof window !== "undefined" && window.localStorage.getItem(`gridlock-daily-${todayKey()}`) === "complete";
  const dailyPreviewLetters = useMemo(() => seededLetters(`GRIDLOCK-${todayKey()}`), []);
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
    setLetters(nextMode === "daily" && date ? seededLetters(`GRIDLOCK-${date}`) : shuffledLetters());
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
  const startDaily = (date = todayKey()) => beginGame("clever", "daily", date);

  const applyClaim = useCallback((tileIds: number[], owner: 1 | 2, source: Owner[]) => {
    return claimTiles(tileIds, owner, source);
  }, []);

  const rivalMove = useCallback((sourceOwners: Owner[], sourcePlayed: PlayedWord[]) => {
    const move = selectRivalMove(sourceOwners, sourcePlayed, letters, difficulty, mode === "daily");
    if (!move) { setTurn("you"); setMessage("Your turn"); return; }
    const nextOwners = move.nextOwners;
    const nextPlayed = [...sourcePlayed, { word: move.word, owner: 2 as const, captures: move.captures }];
    celebrateClaim(move.ids, sourceOwners, nextOwners, 2);
    setOwners(nextOwners);
    setPlayed(nextPlayed);
    const filled = nextOwners.every(Boolean);
    setTurn(filled ? "done" : "you");
    setMessage(filled ? (nextOwners.filter(o=>o===1).length > nextOwners.filter(o=>o===2).length ? "You encircled the board!" : "Every circle is claimed") : `${LABELS[difficulty].name} played ${move.word.toUpperCase()}`);
    if (filled) {
      if (mode === "daily" && dailyDate) window.localStorage.setItem(`gridlock-daily-${dailyDate}`, "complete");
      window.setTimeout(() => setResultsOpen(true), WIN_MESSAGE_HOLD_MS);
    }
  }, [celebrateClaim, dailyDate, difficulty, letters, mode]);

  const submit = async () => {
    if (turn !== "you") return;
    if (currentWord.length < 2) { setWordError("Choose at least 2 letters"); return; }
    if (blocksPlayedWord(currentWord, played.map(play => play.word))) { setWordError("That word, or a longer form of it, has already been played"); return; }
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
    if (nextOwners.every(Boolean)) {
      setTurn("done");
      setMessage(nextOwners.filter(o=>o===1).length > nextOwners.filter(o=>o===2).length ? "You encircled the board!" : "Every circle is claimed");
      if (mode === "daily" && dailyDate) window.localStorage.setItem(`gridlock-daily-${dailyDate}`, "complete");
      window.setTimeout(() => setResultsOpen(true), WIN_MESSAGE_HOLD_MS);
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
    const text = `${heading}\n${yourScore}–${rivalScore} ${result === "win" ? "Win" : result === "loss" ? "Loss" : "Tie"}\n${circles}\n${longestWord ? `Best word: ${longestWord.toUpperCase()}\n` : ""}https://beta.gridlockword.com`;
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
          {[..."STARECLOUDPINGMBEACHFORYTENASR"].map((letter, i) => <span key={i}>{letter}</span>)}
        </div>
        <p className="eyebrow">A battle of words</p>
        <p className="beta-label">5×6 circle beta</p>
        <h1>ENCIRCLE</h1>
        <p className="lede">Find words. Claim circles.<br/>Surround letters to make them yours for good.</p>
      </section>
      <button aria-label={dailyCompleted ? "Replay today’s daily challenge" : "Play today’s daily challenge"} className="daily-feature" onClick={() => startDaily()} type="button">
        <span className="daily-preview-grid" aria-hidden="true">
          {dailyPreviewLetters.map((letter, i) => <span className={i === 0 || i === 1 || i === 6 ? "preview-own" : i === 23 || i === 28 || i === 29 ? "preview-rival" : ""} key={i}>{letter}</span>)}
        </span>
        <span className="daily-feature-copy">
          <small>Today’s circles · {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
          <strong>{dailyCompleted ? "Replay today’s challenge" : "Play today’s challenge"}</strong>
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
      <p className="eyebrow">Three simple rules</p>
      <h2>Claim the circles</h2>
      <div className="rules-list">
        <article><span>1</span><div><h3>Make a word</h3><p>Tap letters in any order. Every letter you use becomes yours.</p></div></article>
        <article><span>2</span><div><h3>Steal their letters</h3><p>Use a rival’s letter in your word and it changes to your color.</p></div></article>
        <article><span>3</span><div><h3>Build a stronghold</h3><p>Surround a letter with your color to lock it. Locked letters can’t be stolen.</p></div></article>
      </div>
      <button className="primary" onClick={() => newGame("relaxed")}>Play a relaxed game</button>
    </main>{tutorialModal}{accountModal}</>
  );

  return (
    <><main className="game-shell">
      <header className="game-topbar">
        <button className="icon-button" onClick={() => setScreen("home")} aria-label="Back to menu">←</button>
        <div className="wordmark">{mode === "daily" ? "ENCIRCLE DAILY · BETA" : "ENCIRCLE · BETA"}</div>
        <div className="topbar-actions">
          <button className="account-chip" onClick={() => setAccountOpen(true)} type="button">{account ? "Stats" : "Save"}</button>
          <button className="icon-button restart" onClick={() => newGame()} aria-label="New game">↻</button>
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
          {letters.map((letter, i) => {
            const owner = owners[i];
            const isSelected = selected.includes(i);
            const layout = BOARD_LAYOUT[i];
            return <span
              aria-hidden="false"
              className={`tile-slot ring-${layout.ring}`}
              key={i}
              style={{ height: `${layout.size}%`, left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.size}%` }}
            ><button
                role="gridcell"
                aria-label={`${letter}${owner === 1 ? ", yours" : owner === 2 ? ", rival’s" : ""}${locked[i] ? ", locked" : ""}`}
                aria-pressed={isSelected}
                disabled={turn !== "you"}
                className={`tile owner-${owner} ${locked[i] ? "locked" : ""} ${isSelected ? "vacated" : ""} ${claimEffect.tiles.includes(i) ? "just-claimed" : ""} ${claimEffect.stolen.includes(i) ? "just-stolen" : ""} ${claimEffect.locked.includes(i) ? "just-locked" : ""}`}
                style={{ "--claim-delay": `${Math.max(0, claimEffect.tiles.indexOf(i)) * 70}ms` } as CSSProperties}
                onClick={() => { setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]); setWordError(""); }}
              >{letter}{locked[i] && <i>🔑</i>}</button></span>;
          })}
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
          <h2 id="results-title">{result === "win" ? "Circles claimed!" : result === "loss" ? "The rival held on." : "Deadlocked."}</h2>
          <div className="final-score"><strong>{yourScore}</strong><span>–</span><strong>{rivalScore}</strong></div>
          <div className="result-highlights">
            <div><span>Best word</span><button title={longestWord.toUpperCase()} type="button" onClick={() => longestWord && void lookUpWord(longestWord)}>{longestWord ? longestWord.toUpperCase() : "—"}</button></div>
            <div><span>Biggest steal</span><strong>{biggestSteal}</strong></div>
            {mode === "daily" && <div><span>Daily standing</span><strong>{dailyStanding ? `#${dailyStanding.rank} of ${dailyStanding.total}` : account ? "Calculating…" : "Sign in"}</strong></div>}
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
