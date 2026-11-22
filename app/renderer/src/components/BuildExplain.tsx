import { useEffect, useState } from "react";
import type { BuildExplained, ExperienceLevel } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t, type StringKey } from "../strings.ts";
import { Icon } from "./Icon.tsx";

/** At most this many explained errors show; the raw output below has the rest. */
const MAX = 12;

interface Card {
  id: string;
  params: Record<string, string>;
  /** The raw error, for the AI. */
  raw: string;
  where: string;
  element?: string;
  /** Top-level field of the element to show; none for a procedure block (the procedure opens). */
  field?: string;
}

/** What each recognised error of a failed build means, where it is, how to fix it (Q246, config/build-explanations.json). */
export function BuildExplain({ dir, engineId, lines, level, onOpen, onAsk }: {
  dir: string;
  engineId?: string;
  lines: string[];
  level?: ExperienceLevel;
  onOpen: (element: string, field?: string) => void;
  onAsk: (text: string) => void;
}) {
  const [explained, setExplained] = useState<BuildExplained>();
  useEffect(() => {
    let current = true;
    void api.explainBuild(dir, engineId, lines).then((result) => current && setExplained(result));
    return () => void (current = false);
  }, [dir, engineId, lines]);
  if (!explained) return null;

  const cards: Card[] = [
    ...explained.diagnostics.filter((d) => d.explain).map((d): Card => {
      const field = d.fields?.[0];
      // A block path ("stacks[0].blocks[2]...fields.code") belongs to the procedure editor: the procedure opens.
      const own = field && !/^stacks\[/.test(field) ? field.split(/[.[]/)[0] : undefined;
      const parts = d.element
        ? [d.element, ...(d.block ? [t("buildError.whereBlock", { block: d.block.block })] : []), ...(own ? [t("buildError.whereField", { field: own })] : [])]
        : [t("buildError.whereFile", { file: d.file.split("/").at(-1) ?? d.file, line: d.line })];
      return { id: d.explain!.id, params: d.explain!.params, raw: [d.message, ...d.detail.slice(0, 3)].join("\n"), where: parts.join(", "), element: d.element, field: own };
    }),
    ...explained.failures.map((f): Card => ({ id: f.explain.id, params: f.explain.params, raw: f.message, where: t("buildError.whereGradle") })),
  ];
  if (!cards.length) return null;

  const key = (id: string, part: "what" | "plain" | "fix") => `buildError.${id}.${part}` as StringKey;
  return (
    <section className="bexplain" data-testid="build-explain" aria-label={t("buildError.title")}>
      <p className="bxhead"><b>{t("buildError.title")}</b> <span className="dim">{t("buildError.rawBelow")}</span></p>
      {cards.slice(0, MAX).map((card, i) => (
        <article key={i} className="bcard" data-testid="build-explain-item" data-explain={card.id}>
          <dl>
            <dt>{t("buildError.label.what")}</dt>
            <dd data-testid="build-explain-what">{t(key(card.id, level === "new" ? "plain" : "what"), card.params)}</dd>
            <dt>{t("buildError.label.where")}</dt>
            <dd data-testid="build-explain-where">{card.where}</dd>
            <dt>{t("buildError.label.fix")}</dt>
            <dd data-testid="build-explain-fix">{t(key(card.id, "fix"), card.params)}</dd>
          </dl>
          <div className="bxactions">
            {card.element && (
              <button type="button" className="abtn" data-testid="build-explain-go" onClick={() => onOpen(card.element!, card.field)}>
                <Icon name="edit" size={14} />{card.field ? t("buildError.goField", { field: card.field }) : t("buildError.go", { element: card.element })}
              </button>
            )}
            <button type="button" className="abtn" data-testid="build-explain-ask"
              onClick={() => onAsk(t("buildError.askPrompt", { error: card.raw, where: card.where }))}>
              <Icon name="usages" size={14} />{t("buildError.ask")}
            </button>
          </div>
        </article>
      ))}
      {cards.length > MAX && <p className="dim">{t("buildError.more", { count: cards.length - MAX })}</p>}
    </section>
  );
}
