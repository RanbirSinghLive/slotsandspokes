import { askForCode, cloudLinkInfo, disableCloudSave, enableCloudSave, isCloudAvailable, onCloudChange } from './cloudSave';

/**
 * The Game screen's Cloud save section, and the home picker's "use your
 * sync code" link. Both stay hidden until the server says cloud saves are
 * set up (ui/cloudSave.ts), so a build without the backend shows nothing.
 */
const section = document.querySelector<HTMLElement>('#cloud-save-section')!;
const offView = document.querySelector<HTMLElement>('#cloud-save-off')!;
const onView = document.querySelector<HTMLElement>('#cloud-save-on')!;
const codeEl = document.querySelector<HTMLElement>('#cloud-save-code')!;
const statusEl = document.querySelector<HTMLElement>('#cloud-save-status')!;
const pickerLink = document.querySelector<HTMLButtonElement>('#home-world-cloud')!;

function copy(text: string, done: string): void {
  navigator.clipboard.writeText(text).then(
    () => (statusEl.textContent = done),
    () => (statusEl.textContent = 'Copy failed · select the code and copy it by hand'),
  );
}

function refresh(): void {
  const available = isCloudAvailable();
  section.hidden = !available;
  pickerLink.hidden = !available;
  const info = cloudLinkInfo();
  offView.hidden = info !== null;
  onView.hidden = info === null;
  if (info) {
    codeEl.textContent = info.code;
    statusEl.textContent = info.status;
  }
}

export function setupCloudSaveControls(): void {
  onCloudChange(refresh);
  document.querySelector('#cloud-save-enable')!.addEventListener('click', enableCloudSave);
  document.querySelector('#cloud-save-join')!.addEventListener('click', askForCode);
  document.querySelector('#cloud-save-disable')!.addEventListener('click', () => {
    disableCloudSave();
    refresh();
    statusEl.textContent = 'Off · this device keeps its game; the cloud copy stays under the code';
  });
  document.querySelector('#cloud-save-copy-code')!.addEventListener('click', () => copy(cloudLinkInfo()?.code ?? '', 'Code copied.'));
  document.querySelector('#cloud-save-copy-link')!.addEventListener('click', () => copy(cloudLinkInfo()?.shareLink ?? '', 'Link copied · open it on your other device.'));
  pickerLink.addEventListener('click', askForCode);
}
