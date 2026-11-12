import {
  raceAssetSchema,
  trackAnalysisSchema,
  terrainLevelSchema,
  type RaceAsset,
  type ReferenceEffort,
} from '@athlete-panel/contracts';
import { z } from 'zod';
import type { Transaction } from '../../packages/host/src/db';

export async function readCourse(raceId: string, tx: Transaction) {
  const rows =
    await tx`select revision,asset_id,terrain,section_terrain from race_analysis.courses where race_id=${raceId}`;
  const row = rows[0];
  return row
    ? {
        revision: Number(row.revision),
        assetId: row.asset_id as string | null,
        terrain: terrainLevelSchema.parse(row.terrain),
        sectionTerrain: z.record(z.string(), terrainLevelSchema).parse(row.section_terrain),
      }
    : { revision: 0, assetId: null, terrain: 3, sectionTerrain: {} };
}
export async function readAsset(id: string, tx: Transaction): Promise<RaceAsset | null> {
  const [row] =
    await tx`select id,filename,format,octet_length(source) as bytes,analysis,imported_at from race_analysis.assets where id=${id}`;
  return row
    ? raceAssetSchema.parse({
        id: row.id,
        filename: row.filename,
        format: row.format,
        bytes: row.bytes,
        analysis: row.analysis,
        importedAt: new Date(row.imported_at).toISOString(),
      })
    : null;
}
export async function readReferences(raceId: string, tx: Transaction): Promise<ReferenceEffort[]> {
  const rows =
    await tx`select r.id,r.asset_id,r.title,r.duration_seconds,r.duration_source,r.terrain,a.filename,a.analysis
    from race_analysis.reference_efforts r join race_analysis.assets a on a.id=r.asset_id where r.race_id=${raceId} order by r.title,r.id`;
  return rows.map((row) => {
    const analysis = trackAnalysisSchema.parse(row.analysis);
    return {
      id: row.id as string,
      assetId: row.asset_id as string,
      title: row.title as string,
      filename: row.filename as string,
      distanceMeters: analysis.distanceMeters,
      ascentMeters: analysis.ascentMeters,
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      durationSource: row.duration_source as ReferenceEffort['durationSource'],
      terrain: Number(row.terrain),
      hasGaps: analysis.hasGaps,
      predictedSeconds: null,
      comparison: 'unavailable' as const,
    };
  });
}
