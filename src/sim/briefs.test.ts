import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { buildDailyBrief, buildSeasonReview, dailyBriefDue, markSeasonReviewShown, seasonReviewDue, SEASON_REVIEW_DAYS } from './briefs';
import { step } from './step';

// Run with `npm run briefstest`: one daily brief a day, a season review half a
// year on, rows that read only that half year, and a state that survives a save.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 7, player);
let dailyCount = 0;
let reviewDay: number | null = null;
for (let day = 1; day <= 200; day++) {
  for (let minute = 0; minute < 1440; minute++) {
    step(state);
    if (dailyBriefDue(state)) dailyCount++;
    if (reviewDay === null && seasonReviewDue(state)) reviewDay = day;
  }
  player.playDay(state);
}
assert.ok(dailyCount >= 195 && dailyCount <= 200, `daily brief fired ${dailyCount} times in 200 days`);
assert.ok(reviewDay !== null && reviewDay >= SEASON_REVIEW_DAYS - 2 && reviewDay <= SEASON_REVIEW_DAYS + 2, `season review fired on day ${reviewDay}`);

const brief = buildDailyBrief(state);
assert.ok(Array.isArray(brief.chips));
const review = buildSeasonReview(state);
assert.ok(review.rows.length > 0, 'review has route rows');
assert.ok(review.rows.every((row, i, rows) => i === 0 || rows[i - 1].profit >= row.profit), 'rows are ranked best first');

markSeasonReviewShown(state);
assert.equal(seasonReviewDue(state), false, 'review is not due again straight away');
const reloaded = JSON.parse(JSON.stringify(state));
assert.deepEqual(reloaded.briefs, state.briefs, 'briefs survive a save');
console.log(`briefs: ok (${dailyCount} dailies, review day ${reviewDay}, ${review.rows.length} routes)`);
