/**
 * The Sound card on the Game screen: the Music switch and the volume slider.
 * The settings themselves live in ui/sound.ts.
 */

import { setupMusic } from './music';
import { onSoundSettingsChange, setSoundSetting, soundSettings, wakeSound } from './sound';

export function setupSoundControls(): void {
  const musicInput = document.querySelector<HTMLInputElement>('#sound-setting-music')!;
  const volumeInput = document.querySelector<HTMLInputElement>('#sound-setting-volume')!;
  const sync = (): void => {
    const settings = soundSettings();
    musicInput.checked = settings.music;
    volumeInput.value = String(Math.round(settings.volume * 100));
  };
  setupMusic();
  // The switch's change event is a user gesture, which is what lets the
  // browser start audio; wake the context here before the music asks for it.
  musicInput.addEventListener('change', () => {
    if (musicInput.checked) wakeSound();
    setSoundSetting('music', musicInput.checked);
  });
  volumeInput.addEventListener('input', () => setSoundSetting('volume', Number(volumeInput.value) / 100));
  onSoundSettingsChange(sync);
  sync();
}
