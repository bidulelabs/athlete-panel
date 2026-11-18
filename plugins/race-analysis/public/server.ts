import type { Transaction } from '../../../packages/host/src/db';
import { findRaceEvent } from '../../training/public/server';
import { estimateCourse } from '../estimate';
import { readAsset, readCourse, readReferences } from '../repository';

export async function readRaceCourseSummary(raceId: string, tx: Transaction) {
  if (!(await findRaceEvent(raceId, tx))) return null;
  const saved = await readCourse(raceId, tx);
  const course = saved.assetId ? await readAsset(saved.assetId, tx) : null;
  if (!course) return null;
  const { estimate, estimateReasons, references } = estimateCourse(
    course.analysis,
    saved.terrain,
    saved.sectionTerrain,
    await readReferences(raceId, tx),
  );
  const { distanceMeters, ascentMeters, descentMeters, sections } = course.analysis;
  return {
    courseId: course.id,
    distanceMeters,
    ascentMeters,
    descentMeters,
    terrain: saved.terrain,
    sections: sections.map((section) => ({
      ...section,
      terrain: saved.sectionTerrain[String(section.index)] ?? saved.terrain,
    })),
    estimate,
    estimateReasons,
    references: references.map((reference) => ({
      distanceMeters: reference.distanceMeters,
      ascentMeters: reference.ascentMeters,
      durationSeconds: reference.durationSeconds,
      terrain: reference.terrain,
      hasGaps: reference.hasGaps,
      predictedSeconds: reference.predictedSeconds,
    })),
  };
}
