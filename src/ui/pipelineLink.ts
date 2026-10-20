import { PIPELINE_DAYS } from '../sim/pipeline';
import { glyph } from './glyphs';
import { openPipeline } from './pipeline';

/** A line on a screen whose dated items live on the map's pipeline: a tap opens it. */
export function pipelineLink(what: string): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-link pipeline-link';
  button.append(glyph('timer'), ` ${what} · next ${PIPELINE_DAYS}d on the map's pipeline ›`);
  button.addEventListener('click', openPipeline);
  return button;
}
