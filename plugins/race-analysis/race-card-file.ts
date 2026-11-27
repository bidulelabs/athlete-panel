import type { RaceCardContent, RaceCardStop } from './race-card';

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => htmlEscapes[char]!);
const paragraphHtml = (className: string, text: string | null) =>
  text ? `<p class="${className}">${escapeHtml(text)}</p>` : '';
const longTextSection = (heading: string, text: string) =>
  text
    ? `<section><h2>${escapeHtml(heading)}</h2><p class="long-text">${escapeHtml(text)}</p></section>`
    : '';

export const raceCardFileName = (title: string) => {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'race'}-race-card.html`;
};

const stopListItem = (stop: RaceCardStop) =>
  `<li><span class="marker">${escapeHtml(stop.marker)}</span><strong class="title">${escapeHtml(stop.title)}</strong>${stop.time ? `<span class="time">${escapeHtml(stop.time)}</span>` : ''}<div class="body">${paragraphHtml('action', stop.action)}${paragraphHtml(stop.overCapacity ? 'leave-with late' : 'leave-with', stop.leaveWith)}${paragraphHtml(stop.cutoffMissed ? 'details late' : 'details', stop.cutoff)}${paragraphHtml('details', stop.details)}</div></li>`;

const cardStyles = `
:root{color-scheme:light dark;--text:#1b1b1b;--muted:#5c5c5c;--line:#d4d4d4;--page:#fff;--alert:#fff3cd}
@media (prefers-color-scheme:dark){:root{--text:#f2f2f2;--muted:#a8a8a8;--line:#3a3a3a;--page:#111;--alert:#3b3000}}
body{margin:0;background:var(--page);color:var(--text);font:16px/1.45 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px;overflow-wrap:anywhere}
h1{margin:0;font-size:28px}
h2{margin:24px 0 4px;font-size:16px}
p{margin:4px 0}
.muted,.details,.stamp{color:var(--muted);font-size:14px}
.late{font-weight:700;text-decoration:underline}
.review{background:var(--alert);border:1px solid var(--line);padding:8px 12px;margin:16px 0}
.finish{font-size:44px;font-weight:650;line-height:1.1;margin:0}
.long-text{white-space:pre-wrap}
ol.stops{list-style:none;margin:16px 0 0;padding:0}
.stops li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;grid-template-areas:"marker title time" "marker body body";gap:4px 12px;padding:12px 0;border-top:1px solid var(--line);break-inside:avoid;overflow-wrap:anywhere}
.marker{grid-area:marker;font-weight:600}
.title{grid-area:title}
.time{grid-area:time;font-weight:600;white-space:nowrap}
.body{grid-area:body}
@media (max-width:760px){.stops li{grid-template-columns:24px minmax(0,1fr) auto}}
@media print{:root{color-scheme:light;--text:#000;--muted:#444;--page:#fff}main{padding:0}}
`;

export function raceCardFile({
  card,
  title,
  dateText,
  downloadedOn,
  needsReview,
}: {
  card: RaceCardContent;
  title: string;
  dateText: string;
  downloadedOn: string;
  needsReview: boolean;
}) {
  const cues = card.cues.length
    ? `<section><h2>During the race</h2><ul>${card.cues.map((cue) => `<li>${escapeHtml(cue.when)}: ${escapeHtml(cue.text)}</li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`Race card · ${title}`)}</title>
<style>${cardStyles}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${paragraphHtml('muted', dateText)}
${paragraphHtml('muted', `${card.writtenFor} · plan revision ${card.revision}`)}
${paragraphHtml('muted', card.effortAndWeather)}
${paragraphHtml('muted', card.effortAndWeather && card.weatherNote)}
${needsReview ? '<p class="review">This plan needed review when this copy was downloaded: the course or the target changed after it was written.</p>' : ''}
${card.expectedFinish ? `<p class="muted">Expected finish</p><p class="finish">${escapeHtml(card.expectedFinish)}</p>` : ''}
${paragraphHtml('muted', card.finishRange ? `Planning range ${card.finishRange}` : null)}
${paragraphHtml('muted', card.warning)}
${longTextSection('Keep in mind', card.briefing)}
${longTextSection('Breakfast', card.breakfast)}
${paragraphHtml('muted', card.timesFromStart ? 'Times are counted from the start.' : null)}
<ol class="stops">${card.stops.map(stopListItem).join('')}</ol>
${cues}
${card.food ? `<section><h2>Food</h2>${paragraphHtml('long-text', card.food)}</section>` : ''}
${longTextSection('Recovery', card.recovery)}
${paragraphHtml('stamp', `Saved copy downloaded on ${downloadedOn} from plan revision ${card.revision}. It does not update: if the plan changes, download it again.`)}
</main>
</body>
</html>
`;
}
