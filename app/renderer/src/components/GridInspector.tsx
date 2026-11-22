import { useEffect, useState } from "react";
import type { ProjectSnapshot, ReferenceReport } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { spriteFor } from "../catalog.ts";
import type { DockSection } from "../dock/Dock.tsx";
import { elementName, elementTexture, findElement, issuePrefix, issuesFor, type ElementRef } from "../model.ts";
import { issueText, t } from "../strings.ts";
import { typeOf } from "../types.ts";
import { Icon } from "./Icon.tsx";
import { Sprite } from "./Sprite.tsx";
import { Texture } from "./Texture.tsx";

/** Rows of "Used by" shown before the rest is left to Find usages. */
const SHOWN = 8;

function Details({ snapshot, target }: { snapshot: ProjectSnapshot; target: ElementRef }) {
  const element = findElement(snapshot, target);
  if (!element) return <p className="hint">{t("dock.noSelection")}</p>;
  const texture = elementTexture(snapshot, target.typeId, element);
  const type = typeOf(target.typeId);
  return (
    <>
      <div className="gi-head">
        <span className="slot">{texture ? <Texture dir={snapshot.dir} path={texture} size={32} /> : <Sprite name={spriteFor(target.typeId)} size={32} />}</span>
        <span><b>{elementName(target.typeId, element)}</b><small>{type?.name ?? target.typeId}</small></span>
      </div>
      <dl className="gi-kv">
        <dt>{t("dock.id")}</dt><dd><code>{snapshot.project.mod.id}:{element.id}</code></dd>
        <dt>{t("dock.type")}</dt><dd>{type?.name ?? target.typeId}</dd>
      </dl>
      {type?.description && <p className="hint">{type.description}</p>}
    </>
  );
}

/** Computed only while the section is open and for the one selected element. */
function UsedBy({ snapshot, target }: { snapshot: ProjectSnapshot; target: ElementRef }) {
  const [report, setReport] = useState<ReferenceReport>();
  useEffect(() => {
    let live = true;
    setReport(undefined);
    void api.findReferences(snapshot.dir, target.typeId, target.id).then((r) => live && setReport(r), () => undefined);
    return () => void (live = false);
  }, [snapshot, target.typeId, target.id]);
  if (!report) return <p className="hint">…</p>;
  const names = [...new Set(report.usedBy.map((r) => {
    if (r.from.kind !== "element") return r.from.id;
    const el = findElement(snapshot, { typeId: r.from.type, id: r.from.id });
    return `${typeOf(r.from.type)?.name ?? r.from.type}: ${el ? elementName(r.from.type, el) : r.from.id}`;
  }))];
  if (!names.length) return <p className="hint">{t("dock.noUsages")}</p>;
  return (
    <ul className="gi-list">
      {names.slice(0, SHOWN).map((n) => <li key={n}>{n}</li>)}
      {names.length > SHOWN && <li className="dim">{t("refs.more", { count: names.length - SHOWN })}</li>}
    </ul>
  );
}

function Problems({ snapshot, target }: { snapshot: ProjectSnapshot; target: ElementRef }) {
  const issues = issuesFor(snapshot, target);
  if (!issues.length) return <p className="hint">{t("dock.noProblemsHere")}</p>;
  return (
    <ul className="gi-list probs">
      {issues.slice(0, SHOWN).map((issue, i) => (
        <li key={i}><Icon name="warn" size={12} /><span title={issue.path.slice(issuePrefix(target).length + 1)}>{issueText(issue)}</span></li>
      ))}
    </ul>
  );
}

/** Inspector sections of the element grid (Q279): Details, Used by and Problems of the single selected element. */
export function gridSections(snapshot: ProjectSnapshot, target: ElementRef | undefined, count: number): DockSection[] {
  const body = (Body: typeof Details) => (target && count === 1 ? <Body snapshot={snapshot} target={target} /> : <p className="hint">{count > 1 ? t("dock.many", { count }) : t("dock.noSelection")}</p>);
  const problems = target && count === 1 ? issuesFor(snapshot, target).length : 0;
  return [
    { id: "grid.details", icon: "info", title: t("dock.details"), body: body(Details) },
    { id: "grid.usedBy", icon: "usages", title: t("refs.usedBy"), body: body(UsedBy), defaultOpen: false },
    { id: "grid.problems", icon: "warn", title: t("dock.problems"), badge: problems ? String(problems) : undefined, body: body(Problems), defaultOpen: problems > 0 },
  ];
}
