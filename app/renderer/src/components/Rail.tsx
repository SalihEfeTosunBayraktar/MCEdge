import { useStoredFlag } from "../hooks/useStoredFlag.ts";
import { t } from "../strings.ts";
import { Icon, type IconName } from "./Icon.tsx";

export const SECTIONS = ["elements", "resources", "tags", "variables", "localization", "git", "settings"] as const;
/** Sections of code project mode. */
export const CODE_SECTIONS = ["code", "git"] as const;
export type Section = (typeof SECTIONS)[number] | (typeof CODE_SECTIONS)[number];

const ICONS: Record<Section, IconName> = {
  elements: "tiles", resources: "image", tags: "tag", variables: "vars", localization: "globe", git: "branch", settings: "gear",
  code: "code",
};
/** Sections that exist in the catalog but are not built yet. */
const DISABLED: Section[] = [];

/** Sections kept apart at the bottom of the rail: version control and the settings. */
const SECONDARY: Section[] = ["git", "settings"];

/** Section rail: icons only, or icons with their names (the toggle on top); the settings sections sit apart at the bottom. */
export function Rail({ active, onSelect, sections = SECTIONS }: { active: Section; onSelect: (section: Section) => void; sections?: readonly Section[] }) {
  const [wide, setWide] = useStoredFlag("rail.wide", false);
  const tab = (section: Section) => {
    const disabled = DISABLED.includes(section);
    return (
      <button key={section} className={`rtab ${section === active ? "on" : ""}`} disabled={disabled}
        title={disabled ? t("rail.soon") : t(`section.${section}`)} onClick={() => onSelect(section)}>
        <Icon name={ICONS[section]} />
        <span className="rlabel">{t(`section.${section}`)}</span>
      </button>
    );
  };
  const rest = sections.filter((section) => SECONDARY.includes(section));
  return (
    <nav className={`rail ${wide ? "wide" : ""}`} aria-label={t("rail.label")}>
      <button className="rtoggle" title={t(wide ? "rail.collapse" : "rail.expand")} aria-expanded={wide} onClick={() => setWide(!wide)}>
        <Icon name="chev" size={14} />
      </button>
      {sections.filter((section) => !SECONDARY.includes(section)).map(tab)}
      {rest.length > 0 && <i className="rgap" />}
      {rest.map(tab)}
    </nav>
  );
}
