/**
 * The player's own airline identity — a name and a two-letter code, same
 * shape `data/competitors.json` gives every competitor, for the same
 * reason: real airlines are known by a two-letter IATA-style code
 * (Capital Wings "CW", Trillium Air "TA", Bluenose Regional "BR"), and
 * the player's carrier needs one too to appear alongside them — in the
 * Competition map's hover tooltips, for instance, where every operator on
 * a route is labeled by its code. Fictional, not a real carrier, per
 * CLAUDE.md's public-sources-only rule.
 */
export const PLAYER_AIRLINE = {
  name: 'Fundy Air',
  code: 'FA',
};
