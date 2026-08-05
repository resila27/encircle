# ENCIRCLE — design & follow-up notes

Running list of ideas and known follow-ups, kept here so they survive between sessions.

## Next build: center wildcard ("joker") tile

Locking the center circle (tile index 0) currently has no special reward beyond being hard to get
(it needs all 6 ring-1 neighbors). Planned mechanic:

- Once you've locked the center, it acts as a **true joker**: any time you play a word that
  includes it, you choose what letter it represents *for that play* — re-chosen fresh every turn,
  not fixed permanently like a Scrabble blank.
- Needs a small letter-picker UI when a word selection includes the locked center tile.
- Ties into the existing lock mechanic: if the opponent later steals back one of the 6 ring-1
  tiles, your center lock (and the joker privilege) breaks — it's not a permanent prize, it has to
  be defended.
- Also still open: should there be an additional flat point bonus for locking the center, on top
  of the joker utility? Decide when building this.

## Known follow-up: GitHub Actions auto-deploy targets the wrong DreamHost account

`.github/workflows/deploy-playencircle.yml` currently guesses at 8 possible folder paths under the
`dh_cwxxe8` DreamHost user. The real live site for playencircle.com is actually served from the
`dh_wy8a2d` account (`/home/dh_wy8a2d/playencircle.com/`). Every push still auto-deploys to the
wrong account harmlessly; getting the real site updated currently requires a manual step:

1. Let the GitHub Action build and push to `dh_cwxxe8` (wrong account, harmless).
2. Pull the freshly-built files down from `dh_cwxxe8` to a local temp folder, then push them up to
   `dh_wy8a2d` (both `/home/dh_wy8a2d/playencircle.com/` and `.../playencircle.com/public/`).

Proper fix: update the `DREAMHOST_USER`/`DREAMHOST_HOST`/`DREAMHOST_SSH_KEY` GitHub secrets to the
correct account and key (a working passwordless key for `dh_wy8a2d` already exists locally at
`/Users/dki/Documents/Codex/Gridlock/deploy/encircle-deploy-key`, already added to that account's
`authorized_keys`), then simplify the workflow to deploy to that one real path instead of guessing.

## Also mentioned, not yet scheduled

- Tutorial visuals are now circular-board accurate (done). If new tutorial slides get added later,
  keep using the same `TUTORIAL_DEMOS` + real `neighbors()` adjacency approach so lock examples
  stay mechanically true rather than decorative.
