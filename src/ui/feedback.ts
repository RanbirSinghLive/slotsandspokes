import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { GAME_VERSION } from './version';

/**
 * Feedback goes to a Google Form, so a player needs no account. The form
 * comes pre-filled with the build, the home and the day, so every report
 * says where it came from. Its responses are published as a CSV the
 * owner's scheduled scan reads (WEEK-TWELVE.md, thread 4); nothing is sent
 * from the game itself, which has no server.
 */

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfGpwUSuGqSTGb0MR-utRc5-JtVjs2rMytbf4LxvwDE1rhThg/viewform';
// The form's fields for the pre-filled answers (its "Get pre-filled link").
const VERSION_FIELD = 'entry.1817449454';
const HOME_FIELD = 'entry.1209244325';
const DAY_FIELD = 'entry.1313828881';

/** The form, filled in with where this game is. */
export function feedbackUrl(state: SimState): string {
  const params = new URLSearchParams({
    usp: 'pp_url',
    [VERSION_FIELD]: GAME_VERSION,
    [HOME_FIELD]: state.homeAirport,
    [DAY_FIELD]: String(dayIndex(state)),
  });
  return `${FORM_URL}?${params.toString()}`;
}

/** Open the form in a new tab, leaving the game where it is. */
export function openFeedback(state: SimState): void {
  window.open(feedbackUrl(state), '_blank', 'noopener');
}
