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

## Resolved: GitHub Actions was deploying to the wrong DreamHost account

Fixed 2026-08-06: the `DREAMHOST_USER`/`DREAMHOST_HOST`/`DREAMHOST_SSH_KEY` GitHub secrets were
updated to point at the correct `dh_wy8a2d` account. Auto-deploy on push to `beta/5x6-circles`
should now reach the real playencircle.com directly — no manual pull/push step needed anymore.
(The workflow still probes several candidate paths/accounts as a fallback; that's harmless but
could be simplified now that the right account is confirmed working.)

## Also mentioned, not yet scheduled

- Tutorial visuals are now circular-board accurate (done). If new tutorial slides get added later,
  keep using the same `TUTORIAL_DEMOS` + real `neighbors()` adjacency approach so lock examples
  stay mechanically true rather than decorative.
