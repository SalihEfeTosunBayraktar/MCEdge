/** Sound event names and shapes shared by the app (no file system) and src/resources/soundEvents.ts (KUYRUK 132). */

export const SOUND_EVENTS_FILE = "sound_events.json";
/** Sound categories of the game's volume sliders (SoundSource). */
export const SOUND_CATEGORIES = ["master", "music", "record", "weather", "block", "hostile", "neutral", "player", "ambient", "voice"] as const;
export const DEFAULT_CATEGORY = "neutral";

export interface SoundEvent {
  name: string;
  category: string;
  /** Sound files (names under sounds/, without .ogg) the game picks from. */
  files: string[];
  /** The subtitle's lang key, or "" without a subtitle. */
  subtitleKey: string;
  /** Listed in sound_events.json (not just a file of that name). */
  defined: boolean;
}

export const subtitleKey = (modId: string, event: string) => `subtitles.${modId}.${event}`;
