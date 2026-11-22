import TOUR from "../../../config/tour.json" with { type: "json" };
import type { ProjectSnapshot, TourState } from "../../shared/api.ts";

export type TourCheck = "element" | "texture" | "scenario";
export const TOUR_STEPS = TOUR.steps as { id: string; check: TourCheck; point: string[] }[];

const subjects = (snapshot: ProjectSnapshot) => snapshot.project.elements[TOUR.subjectType] ?? [];

/**
 * Follows the project: a tour on another project starts over there, and the first element of the subject type that was
 * not in the project when the tour started becomes the subject (its texture then is the default the texture step must
 * leave). Returns the same object when nothing changed.
 */
export function syncTour(snapshot: ProjectSnapshot, tour: TourState): TourState {
  if (tour.status !== "active") return tour;
  if (tour.dir !== snapshot.dir) return { status: "active", dir: snapshot.dir, baseline: subjects(snapshot).map((e) => e.id) };
  const subject = tour.subject ? subjects(snapshot).find((e) => e.id === tour.subject) : subjects(snapshot).find((e) => !tour.baseline?.includes(e.id));
  if (!subject) return tour.subject ? { ...tour, subject: undefined, initial: undefined, tested: undefined } : tour;
  if (subject.id === tour.subject) return tour;
  return { ...tour, subject: subject.id, initial: String(subject.texture ?? ""), tested: undefined };
}

/** Whether the project is in the state a step asks for; nothing is remembered but the subject and its passed test. */
export function stepDone(snapshot: ProjectSnapshot, tour: TourState, check: TourCheck): boolean {
  const subject = subjects(snapshot).find((e) => e.id === tour.subject);
  if (!subject) return false;
  if (check === "element") return true;
  const texture = String(subject.texture ?? "");
  if (check === "texture") return !!texture && texture !== tour.initial && snapshot.textures.includes(texture);
  return tour.tested === subject.id;
}

/** The tour's scenario for the subject: the file name (no extension) and its JSON text. */
export function tourScenario(snapshot: ProjectSnapshot, id: string): { name: string; text: string } {
  const fill = (text: string) => text.replaceAll("{ref}", `${snapshot.project.mod.id}:${id}`).replaceAll("{id}", id);
  return { name: fill(TOUR.scenario.file), text: fill(JSON.stringify({ name: "first-mod tour", steps: TOUR.scenario.steps }, null, 2)) };
}
