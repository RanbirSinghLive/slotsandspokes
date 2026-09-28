import { version } from '../../package.json';

/**
 * The build players are on (package.json's version), shown in the Game
 * screen and the clock bar's alpha badge and stamped into every save, so
 * a report says which build it came from.
 */
export const GAME_VERSION: string = version;
