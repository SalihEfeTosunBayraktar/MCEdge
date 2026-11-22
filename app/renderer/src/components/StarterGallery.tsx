import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, StarterCard } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { spriteFor } from "../catalog.ts";
import { idTaken, type ElementRef } from "../model.ts";
import { t, type StringKey } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { Sprite } from "./Sprite.tsx";
import { FormGroup, FormRow, useDialogFocus } from "./ui.tsx";

/* Template gallery of verified starters (Q252): the cards, the parameters form, the dialog of the welcome screen and the step of the New element popup. */

const WORD = /^[a-z][a-z0-9_]{0,40}$/;
const text = (card: StarterCard, part: "name" | "desc") => t(`starter.${card.id}.${part}` as StringKey);

/** The ids a starter makes once its example value is replaced by the typed one ("tool/ruby_sword" -> "tool/gem_sword"). */
export function starterElements(card: StarterCard, params: Record<string, string>): { typeId: string; id: string }[] {
  return card.elements.map((e) => {
    let line = e;
    for (const [key, example] of Object.entries(card.params)) line = line.split(example).join(params[key] ?? example);
    const [typeId, ...rest] = line.split("/");
    return { typeId, id: rest.join("/") };
  });
}

/** Why the typed parameters cannot be used in the project (undefined: they can). */
export function starterProblem(card: StarterCard, params: Record<string, string>, snapshot?: ProjectSnapshot): string | undefined {
  if (Object.keys(card.params).some((key) => !WORD.test(params[key] ?? ""))) return t("starter.badName");
  const taken = snapshot && starterElements(card, params).find((e) => idTaken(snapshot, e.typeId, e.id));
  return taken ? t("starter.taken", { id: taken.id }) : undefined;
}

/** The cards; a click picks one. */
export function StarterCards({ cards, picked, onPick }: { cards: StarterCard[]; picked?: string; onPick: (card: StarterCard) => void }) {
  return (
    <div className="starter-cards" role="list">
      {cards.map((card) => (
        <button key={card.id} type="button" role="listitem" className={`starter-card ${picked === card.id ? "picked" : ""}`} data-starter={card.id} onClick={() => onPick(card)}>
          <span className="pslot"><Sprite name={spriteFor(card.type)} size={16} /></span>
          <span className="starter-text">
            <span className="starter-name">{text(card, "name")}</span>
            <span className="starter-desc">{text(card, "desc")}</span>
            <span className="starter-meta">{t("starter.makes", { count: card.elements.length })}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The parameters of a starter (its name word) with what it will make. */
export function StarterParams({ card, params, onChange, snapshot }: { card: StarterCard; params: Record<string, string>; onChange: (params: Record<string, string>) => void; snapshot?: ProjectSnapshot }) {
  const problem = starterProblem(card, params, snapshot);
  return (
    <>
      <FormGroup title={t("starter.params")}>
        {Object.keys(card.params).map((key, i) => (
          <FormRow key={key} label={t("starter.param.name")}>
            <input name={`starter-${key}`} className="mono" autoFocus={i === 0} value={params[key] ?? ""} spellCheck={false} onChange={(e) => onChange({ ...params, [key]: e.target.value })} />
          </FormRow>
        ))}
        <FormRow label={t("starter.creates")}>
          <div className="fval starter-ids"><code data-testid="starter-ids">{[...new Set(starterElements(card, params).map((e) => e.id))].join(", ")}</code></div>
        </FormRow>
      </FormGroup>
      <p className={problem ? "error-text" : "popdesc"} data-testid="starter-note">{problem ?? t("starter.paramHint")}</p>
    </>
  );
}

/** Loads the gallery; undefined while it loads. */
export function useStarters(): StarterCard[] | undefined {
  const [cards, setCards] = useState<StarterCard[]>();
  useEffect(() => void api.starters().then(setCards), []);
  return cards;
}

/** The welcome screen's gallery: pick a starter, then the New project dialog opens with it. */
export function StarterDialog({ onPick, onClose }: { onPick: (card: StarterCard) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const cards = useStarters();
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className="dialog starters" role="dialog" aria-label={t("starter.title")} data-testid="starter-gallery"
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ptitle">{t("starter.title")}</div>
        <p className="popdesc">{t("starter.hint")}</p>
        {cards && (cards.length ? <StarterCards cards={cards} onPick={onPick} /> : <p className="empty-note">{t("starter.none")}</p>)}
        <div className="dlg-buttons">
          <button type="button" className="abtn" onClick={onClose}><span>{t("dialog.cancel")}</span></button>
        </div>
      </div>
    </div>
  );
}

/** The step of the New element popup: pick a starter, name it, add it to the open project. */
export function StarterStep({ snapshot, onBack, onCreated }: { snapshot: ProjectSnapshot; onBack: () => void; onCreated: (snapshot: ProjectSnapshot, ref: ElementRef) => void }) {
  const cards = useStarters();
  const [card, setCard] = useState<StarterCard>();
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pick = (next: StarterCard) => (setCard(next), setParams(next.params), setError(undefined));
  const canAdd = card && !busy && !starterProblem(card, params, snapshot);
  const add = async () => {
    if (!card) return;
    setBusy(true);
    setError(undefined);
    try {
      const { snapshot: next, first } = await api.addStarter(snapshot.dir, card.id, params);
      onCreated(next, first);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="popform starterstep" data-testid="starter-step" onSubmit={(e) => (e.preventDefault(), canAdd && add())}>
      <div className="pophead">
        <span className="ptitle-inline">{card ? text(card, "name") : t("starter.title")}</span>
      </div>
      {!card && cards && (cards.length ? <StarterCards cards={cards} onPick={pick} /> : <p className="empty-note">{t("starter.none")}</p>)}
      {card && (
        <>
          <p className="popdesc">{text(card, "desc")}</p>
          <StarterParams card={card} params={params} onChange={setParams} snapshot={snapshot} />
        </>
      )}
      {error && <p className="error-text" data-testid="starter-error">{error}</p>}
      <div className="dlg-buttons">
        {card && <button type="submit" className="abtn primary" disabled={!canAdd}><Icon name="plus" /><span>{t("starter.add")}</span></button>}
        <button type="button" className="abtn" onClick={() => (card ? setCard(undefined) : onBack())}><Icon name="back" /><span>{t("new.back")}</span></button>
      </div>
    </form>
  );
}
