// Familiar compounds and extended forms used by the stronger ENCIRCLE rivals.
// They remain separate so Clever (and Relaxed) can use extensions freely but only up to two
// compound words per game (see MAX_NON_FIERCE_COMPOUND_WORDS in page.tsx).
export const COMPOUND_WORDS = `
aircraft airplane airport backbone background backyard ballgame barefoot bathroom bedroom birthday blackbird blackout bookshelf brainstorm breakfast butterfly campground carpool catfish classroom coastline cookbook daylight dishwasher doorway downstairs driveway earphone earthquake evergreen everybody everyday everyone everything farmhouse fireplace firehouse football forecast forever friendship grandfather grandmother greenhouse haircut hallway handbook headlight heartbeat highway homework honeymoon horseplay horsepower houseboat household houseplant keyboard landmark lifetime lighthouse mailbox moonlight motorcycle newspaper nightclub nightmare nobody notebook outcome outdoors pancake playground playtime popcorn rainbow railroad raindrop rainfall raincoat rattlesnake roommate sailboat schoolhouse schoolmate seafood shipyard shoelace shortcut skateboard snowfall snowman someday somehow someone something soundtrack spaceship stairway starfish steamboat sunrise sunset sunshine tabletop teacup toothbrush toothpaste touchscreen townhouse underground upstairs waterfall weekend wheelchair wildfire wildlife windmill workbook workplace worldwide yourself
`.trim().split(/\s+/);

export const EXTENDED_WORDS = `
disagree dislike download misread mistake outplayed outside overtake overtime overlook prepaid preview rebuild rebuilt replay replayed replaying remake remade restart restarted retell return rewrite rewritten unable unfair unhappy unlock unlocked unsafe update updated updates upload uploaded
builders building buildings careful carefully colorful countless darkness fearless friendship friendships helpful hopeful hopeless kindness player players playful played playing replayable stronger strongest thoughtful thoughtless useful useless winner winners winning wonderful
`.trim().split(/\s+/);

// The server build merges this combined list into the player dictionary.
export const STRATEGY_WORDS = [...new Set([...COMPOUND_WORDS, ...EXTENDED_WORDS])];
