import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Decoder, Stream } from '@garmin/fitsdk';
import { raceFileLimit, racePointLimit } from '@athlete-panel/contracts';
import { AppError, assert } from '../../packages/host/src/errors';
import type { UploadedFile } from '../../packages/plugin-sdk/src';

export type SourcePoint = {
  latitude: number;
  longitude: number;
  elevation: number | null;
  time: number | null;
  segment: number;
};
export type ParsedTrack = {
  points: SourcePoint[];
  elapsedSeconds: number | null;
  format: 'gpx' | 'fit';
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
function numeric(value: unknown): number | null {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function timestamp(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function point(
  latitude: number | null,
  longitude: number | null,
  elevation: number | null,
  time: number | null,
  segment: number,
): SourcePoint {
  assert(
    latitude !== null &&
      longitude !== null &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180,
    'invalid_coordinates',
    'The file contains invalid coordinates. Export a fresh track and try again.',
  );
  assert(
    elevation === null || (elevation >= -500 && elevation <= 9000),
    'invalid_elevation',
    'The file contains an elevation outside the supported −500 to 9,000 m range.',
  );
  return { latitude, longitude, elevation, time, segment };
}
function elapsed(points: SourcePoint[]): number | null {
  if (
    points.some((p, i) => p.time === null || (i > 0 && p.time < (points[i - 1]?.time ?? Infinity)))
  )
    return null;
  const seconds = ((points.at(-1)?.time ?? 0) - (points[0]?.time ?? 0)) / 1000;
  return seconds > 0 && seconds <= 30 * 86400 ? seconds : null;
}
function checkXml(text: string) {
  assert(
    !/<!DOCTYPE|<!ENTITY/i.test(text),
    'unsupported_xml',
    'GPX files with document types or entity declarations are not supported.',
  );
  let depth = 0;
  // Bound nesting before the XML parser creates an object tree. Comments/CDATA are not elements.
  for (const match of text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g)) {
    const tag = match[0];
    if (/^<[!?]/.test(tag)) continue;
    if (tag.startsWith('</')) depth--;
    else if (!tag.endsWith('/>')) depth++;
    assert(
      depth <= 64,
      'xml_depth',
      'This GPX has too many nested elements. Export a simpler track.',
    );
  }
  assert(
    XMLValidator.validate(text) === true,
    'invalid_gpx',
    'This file is not valid GPX XML. Export it again and retry.',
  );
}
function parseGpx(bytes: Uint8Array): ParsedTrack {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('invalid_gpx', 'Choose a GPX file encoded as UTF-8.');
  }
  checkXml(text);
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: false,
    isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept'].includes(name),
  });
  const root = object(parser.parse(text));
  assert(
    root.gpx && typeof root.gpx === 'object',
    'invalid_gpx',
    'This XML file does not contain a GPX track.',
  );
  const gpx = object(root.gpx),
    tracks = array(gpx.trk),
    routes = array(gpx.rte);
  assert(
    tracks.length + routes.length === 1,
    'ambiguous_track',
    'Choose a GPX with one track or one route. Export the intended course separately.',
  );
  const segments = tracks.length
    ? array(object(tracks[0]).trkseg).map((s) => array(object(s).trkpt))
    : [array(object(routes[0]).rtept)];
  assert(
    segments.length <= 100,
    'too_many_segments',
    'Choose a track with no more than 100 segments.',
  );
  const points: SourcePoint[] = [];
  segments.forEach((values, segment) => {
    for (const value of values) {
      assert(
        points.length < racePointLimit,
        'too_many_points',
        `Choose a track with no more than ${racePointLimit.toLocaleString('en')} points.`,
      );
      const p = object(value);
      assert(
        p.ele === undefined || numeric(p.ele) !== null,
        'invalid_elevation',
        'An elevation value is invalid. Export the track again.',
      );
      points.push(
        point(numeric(p['@_lat']), numeric(p['@_lon']), numeric(p.ele), timestamp(p.time), segment),
      );
    }
  });
  return { points, elapsedSeconds: elapsed(points), format: 'gpx' };
}
function parseFit(bytes: Uint8Array): ParsedTrack {
  const decoder = new Decoder(Stream.fromBuffer(Buffer.from(bytes)));
  assert(
    decoder.isFIT() && decoder.checkIntegrity(),
    'invalid_fit',
    'This FIT file is incomplete or damaged. Export it again.',
  );
  let count = 0;
  const result = decoder.read({
    applyScaleAndOffset: true,
    convertDateTimesToDates: true,
    convertTypesToStrings: true,
    includeUnknownData: false,
    mergeHeartRates: false,
    mesgListener: () => {
      assert(
        ++count <= 300000,
        'too_many_records',
        'This FIT file has too many records. Export one effort separately.',
      );
    },
  });
  assert(
    result.errors.length === 0,
    'invalid_fit',
    'This FIT file could not be decoded completely. Export it again.',
  );
  assert(
    (result.messages.sessionMesgs?.length ?? 0) <= 1,
    'multiple_efforts',
    'Choose a FIT file containing one effort, not a multisport session.',
  );
  const records = result.messages.recordMesgs ?? [];
  assert(
    records.length <= racePointLimit,
    'too_many_points',
    `Choose a FIT with no more than ${racePointLimit.toLocaleString('en')} records.`,
  );
  const points: SourcePoint[] = [];
  for (const record of records) {
    const lat = numeric(record.positionLat),
      lon = numeric(record.positionLong);
    if (lat === null || lon === null) continue;
    points.push(
      point(
        (lat * 180) / 2 ** 31,
        (lon * 180) / 2 ** 31,
        numeric(record.enhancedAltitude) ?? numeric(record.altitude),
        timestamp(record.timestamp),
        0,
      ),
    );
  }
  assert(
    points.length >= 2,
    'fit_without_route',
    'This FIT has no usable outdoor GPS track. Choose a recorded outdoor effort or a GPX file.',
  );
  const sessionElapsed = numeric(result.messages.sessionMesgs?.[0]?.totalElapsedTime);
  return {
    points,
    elapsedSeconds:
      sessionElapsed !== null && sessionElapsed > 0 && sessionElapsed <= 30 * 86400
        ? sessionElapsed
        : elapsed(points),
    format: 'fit',
  };
}
export function parseTrack(file: UploadedFile, purpose: 'course' | 'reference'): ParsedTrack {
  assert(
    file.bytes.byteLength > 0 && file.bytes.byteLength <= raceFileLimit,
    'file_size',
    'Choose a non-empty file up to 10 MiB.',
  );
  const format = file.name.toLowerCase().split('.').at(-1);
  assert(
    format === 'gpx' || (format === 'fit' && purpose === 'reference'),
    'file_type',
    purpose === 'course' ? 'Choose a .gpx course file.' : 'Choose a .gpx or .fit reference effort.',
  );
  try {
    const result = format === 'fit' ? parseFit(file.bytes) : parseGpx(file.bytes);
    assert(result.points.length >= 2, 'empty_track', 'The file needs at least two GPS points.');
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'invalid_track',
      'The file could not be read. Export a fresh GPX or FIT and try again.',
    );
  }
}
