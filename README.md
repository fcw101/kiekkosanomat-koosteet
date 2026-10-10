# kiekkosanomat-koosteet

Official NHL highlight ("maalikooste") matches for the score cards and game pages on
[Kiekkosanomat.com](https://kiekkosanomat.com). Public data only: game ids, NHL.com recap links and
YouTube video ids from the official NHL channel. No secrets live in this repository.

## How it works

`poll.yml` runs `node poll.mjs` (Node built-ins only, no `npm install`) every 10 minutes during the
NHL night and every 30 minutes in the daytime. Each run:

1. Fetches `api-web.nhle.com/v1/score/{date}` for the US game dates of the last 30 hours. A finished
   game's `threeMinRecap` path gives the NHL.com recap link (link-out only, never embedded).
2. Fetches the NHL channel's long-form uploads feed (`playlist_id=UULFqFMzb-4AUf6WAIbl132QKA`, no Shorts)
   with a cache-buster, and matches recaps by exact title:
   `{away} vs. {home} | NHL Highlights | {Mon D, YYYY}`. No fuzzy matching. Anything else stays on the
   NHL.com link.
3. Updates `koosteet.json` and commits it only when something changed. Then it calls the Vercel deploy
   hook (`VERCEL_DEPLOY_HOOK` secret) so the static site rebuilds. Without the secret, the hook step is skipped.

States follow the site's design contract: `pending` (final, nothing yet) -> `available` with provider
`nhl`, then `youtube`. A game becomes `none` if nothing has arrived 24 h after the final horn. Status never
goes back to `pending`, and a YouTube match is kept after the video leaves the 15-entry feed. Entries
older than 30 days are pruned.

The site reads `https://raw.githubusercontent.com/fcw101/kiekkosanomat-koosteet/main/koosteet.json`
at build time (cached up to 5 min by GitHub) and merges it with live fetches of the same two feeds,
so the newest matches never depend on that cache. A build never fails if this file is unreachable.

`match.mjs` is shared with the site (`src/lib/koosteet-match.mjs` there). Keep the two copies identical.

## Tests

    node --test test/

Fixtures are the real score feeds and YouTube feeds saved on 2026-10-10.

## Notes

- GitHub disables scheduled workflows in public repositories after 60 days without activity. In the
  off-season, re-enable the workflow in September (Actions tab).
- Public repository: Actions minutes are free. The same schedule in a private repository would bill
  about 3,240 minutes a month.
