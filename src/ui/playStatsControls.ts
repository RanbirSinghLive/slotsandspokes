/**
 * The two places a player can turn anonymous play stats off: the line under
 * Start on the home picker, and the switch in the Game screen's About card.
 * The setting itself lives in ui/playStats.ts.
 */

import { onPlayStatsChange, playStatsOn, setPlayStatsOn } from './playStats';

export function setupPlayStatsControls(): void {
  const gameSwitch = document.querySelector<HTMLInputElement>('#stats-setting-on')!;
  const startLine = document.querySelector<HTMLDivElement>('#home-world-stats')!;
  const startToggle = document.querySelector<HTMLButtonElement>('#home-world-stats-toggle')!;
  const sync = (): void => {
    const on = playStatsOn();
    gameSwitch.checked = on;
    startLine.dataset.on = String(on);
    startToggle.textContent = on ? 'Turn off' : 'Turn on';
  };
  gameSwitch.addEventListener('change', () => setPlayStatsOn(gameSwitch.checked));
  startToggle.addEventListener('click', () => setPlayStatsOn(!playStatsOn()));
  onPlayStatsChange(sync);
  sync();
}
