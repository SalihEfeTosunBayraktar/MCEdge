import { useEffect, useRef, useState } from "react";
import { DEFAULT_CATEGORY, SOUND_CATEGORIES, subtitleKey } from "../../../../src/resources/soundEventTypes.ts";
import type { ProjectSnapshot, ResourceKind, SoundEvent } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { t, type StringKey } from "../strings.ts";
import { ActionBar, ActionButton, DataTable, FindBar, FormGroup, FormRow, PanelEmpty, Separator, SidePanel } from "./ui.tsx";
import { useRevealQuery } from "../hooks/reveal.ts";

const BASE_LANGUAGE = "en_us";

interface Props {
  snapshot: ProjectSnapshot;
  onChanged: (snapshot: ProjectSnapshot) => void;
  onImport: (kind: ResourceKind) => void;
  tabs?: React.ReactNode;
}

/**
 * Resources > Sounds (KUYRUK 132): the project's sound events. Every imported .ogg is an event of its name until it is
 * given a category, a subtitle or more files; an event with several files plays one of them at random. The subtitle
 * text is the base language's translation of the event's subtitle key, so the Localization section translates it.
 */
export function SoundsPane({ snapshot, onChanged, onImport, tabs }: Props) {
  const [query, setQuery] = useState("");
  useRevealQuery("sounds", setQuery);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const events = snapshot.soundEvents;
  const q = query.trim().toLowerCase();
  const rows = events.filter((e) => !q || e.name.includes(q) || e.files.some((f) => f.includes(q)));
  const current = selected && rows.some((e) => e.name === selected) ? events.find((e) => e.name === selected) : undefined;
  useEffect(() => {
    if (selected && !current && !creating) (setSelected(undefined), audio.current?.pause(), setPlaying(false));
  }, [selected, current, creating]);
  useEffect(() => () => audio.current?.pause(), []);
  const files = snapshot.sounds.map((p) => p.slice(p.lastIndexOf("/") + 1, -4));

  const play = async () => {
    const player = audio.current;
    if (!current || !player) return;
    if (playing) return (player.pause(), setPlaying(false));
    // The game picks one of the files at random.
    const file = current.files[Math.floor(Math.random() * current.files.length)];
    player.src = await api.readSound(snapshot.dir, `sounds/${file}.ogg`);
    await player.play();
    setPlaying(true);
  };
  const remove = async () => {
    if (!current) return;
    try {
      onChanged(current.defined ? await api.deleteSoundEvent(snapshot.dir, current.name) : await api.deleteResource(snapshot.dir, `sounds/${current.name}.ogg`));
      setSelected(undefined);
      setError(undefined);
    } catch {
      setError(t("files.inUse"));
    }
  };
  const fresh: SoundEvent = { name: freeName(events), category: DEFAULT_CATEGORY, files: current ? [...current.files] : files.slice(0, 1), subtitleKey: "", defined: false };

  return (
    <>
      <FindBar query={query} onQuery={setQuery} placeholder={t("sounds.search")} meta={t("sounds.count", { count: events.length })} />
      <ActionBar>
        <ActionButton icon="import" label={t("files.import.sound")} tone="primary" onClick={() => onImport("sound")} />
        <ActionButton icon="plus" label={t("sounds.new")} disabled={!files.length} onClick={() => (setCreating(true), setSelected(undefined), setError(undefined))} />
        <Separator />
        <ActionButton icon={playing ? "stop" : "play"} label={t(playing ? "files.stop" : "files.play")} disabled={!current} onClick={() => void play()} />
        <Separator />
        <ActionButton icon="trash" label={t("resources.delete")} tone="danger" disabled={!current} title={current?.defined ? t("sounds.deleteEventHint") : undefined} onClick={() => void remove()} />
      </ActionBar>
      {tabs}
      <audio ref={audio} onEnded={() => setPlaying(false)} hidden />
      <div className="split">
        <div className="scrollarea">
          <DataTable rows={rows} rowKey={(e) => e.name} selected={current?.name}
            onSelect={(name) => (setSelected(name), setCreating(false), setError(undefined), audio.current?.pause(), setPlaying(false))}
            empty={events.length ? t("list.noMatch") : t("files.empty.sound")} columns={[
              { label: t("sounds.col.event"), width: "26%", cell: (e) => <b>{e.name}</b> },
              { label: t("files.col.use"), width: "26%", cell: (e) => <code>{snapshot.project.mod.id}:{e.name}</code> },
              { label: t("sounds.col.files"), cell: (e) => <span className="dim">{e.files.join(", ")}</span> },
              { label: t("sounds.col.category"), width: "14%", cell: (e) => t(`sounds.category.${e.category}` as StringKey) },
            ]} />
        </div>
        <SidePanel title={t("files.details.sound")}>
          {creating ? (
            <EventForm key="new" snapshot={snapshot} event={fresh} files={files} isNew onSaved={(next, name) => (onChanged(next), setCreating(false), setSelected(name))} />
          ) : current ? (
            <>
              <EventForm key={current.name} snapshot={snapshot} event={current} files={files} onSaved={(next, name) => (onChanged(next), setSelected(name))} />
              {error && <p className="ferr">{error}</p>}
            </>
          ) : <PanelEmpty text={t("sounds.selectHint")} />}
        </SidePanel>
      </div>
    </>
  );
}

/** A free event name for a new event: new_sound, new_sound_2, ... */
function freeName(events: SoundEvent[]): string {
  const taken = new Set(events.map((e) => e.name));
  for (let i = 1; ; i++) if (!taken.has(i === 1 ? "new_sound" : `new_sound_${i}`)) return i === 1 ? "new_sound" : `new_sound_${i}`;
}

/** One event's name, category, subtitle and files, written together with Save. */
function EventForm({ snapshot, event, files, isNew, onSaved }: {
  snapshot: ProjectSnapshot;
  event: SoundEvent;
  files: string[];
  isNew?: boolean;
  onSaved: (snapshot: ProjectSnapshot, name: string) => void;
}) {
  const modId = snapshot.project.mod.id;
  const savedSubtitle = event.subtitleKey ? snapshot.project.localization[BASE_LANGUAGE]?.[event.subtitleKey] ?? "" : "";
  const [name, setName] = useState(event.name);
  const [category, setCategory] = useState(event.category);
  const [subtitle, setSubtitle] = useState(savedSubtitle);
  const [chosen, setChosen] = useState(event.files);
  const [error, setError] = useState<string>();
  const dirty = isNew || name !== event.name || category !== event.category || subtitle !== savedSubtitle || chosen.join() !== event.files.join();
  const save = async () => {
    try {
      const next = await api.saveSoundEvent(snapshot.dir, { name, category, subtitle, files: chosen }, isNew || !event.defined ? undefined : event.name);
      setError(undefined);
      onSaved(next, name);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };
  return (
    <div className="form soundform">
      <FormGroup title={t(isNew ? "sounds.newEvent" : "sounds.event")}>
        <FormRow label={t("sounds.name")}>
          <input value={name} spellCheck={false} aria-label={t("sounds.name")} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
        </FormRow>
        <FormRow label={t("files.useAs")}><div className="fval"><code>{modId}:{name}</code></div></FormRow>
        <FormRow label={t("sounds.category")}>
          <select value={category} aria-label={t("sounds.category")} onChange={(e) => setCategory(e.target.value)}>
            {SOUND_CATEGORIES.map((c) => <option key={c} value={c}>{t(`sounds.category.${c}` as StringKey)}</option>)}
          </select>
        </FormRow>
        <FormRow label={t("sounds.subtitle")}>
          <input value={subtitle} placeholder={t("sounds.noSubtitle")} aria-label={t("sounds.subtitle")} onChange={(e) => setSubtitle(e.target.value)} />
        </FormRow>
        <p className="hint">{t("sounds.subtitleHint", { key: subtitleKey(modId, name) })}</p>
        <FormRow label={t("sounds.files")} top>
          <div className="check-list soundfiles">
            {files.map((f) => (
              <label key={f} className="check">
                <input type="checkbox" checked={chosen.includes(f)} onChange={(e) => setChosen(e.target.checked ? [...chosen, f] : chosen.filter((x) => x !== f))} />
                <code>{f}.ogg</code>
              </label>
            ))}
          </div>
        </FormRow>
        <p className="hint">{t("sounds.filesHint")}</p>
        <button type="button" className="abtn primary soundsave" disabled={!dirty || !chosen.length || !name} onClick={() => void save()}>{t("sounds.save")}</button>
        {error && <p className="ferr">{error}</p>}
      </FormGroup>
    </div>
  );
}
