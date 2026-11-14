import { useEffect, useState } from "react";
import type { RecentProject } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { language, t } from "../strings.ts";
import { LogoMark, Wordmark } from "./Brand.tsx";
import { Icon } from "./Icon.tsx";
import { ActionBar, ActionButton, DataTable, Separator } from "./ui.tsx";

interface Props {
  error: boolean;
  /** Opens the Preferences dialog. */
  onPreferences: () => void;
  onOpen: () => void;
  /** Opens the New project dialog (KUYRUK 126). */
  onNew: () => void;
  onOpenExample: () => void;
  onOpenRecent: (dir: string) => void;
}

/** Start screen: open a project (folder, example or a recent one); Preferences opens the dialog. */
export function Welcome({ error, onPreferences, onOpen, onNew, onOpenExample, onOpenRecent }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [selected, setSelected] = useState<string>();
  useEffect(() => void api.recentProjects().then(setRecent), []);

  const current = recent.find((r) => r.dir === selected);
  const open = (dir: string) => {
    const entry = recent.find((r) => r.dir === dir);
    if (entry && !entry.missing) onOpenRecent(dir);
  };
  const remove = async () => {
    if (!current) return;
    setRecent(await api.removeRecentProject(current.dir));
    setSelected(undefined);
  };
  const when = new Intl.DateTimeFormat(language(), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="welcome">
      <div className="welcome-cols">
        <div className="welcome-card">
          <div className="welcome-brand"><LogoMark px={5} /><Wordmark px={7} /></div>
          <p className="welcome-sub">{t("welcome.subtitle")}</p>
          <button className="welcome-main" onClick={onOpen}>
            <Icon name="folder" size={24} />
            <span>{t("welcome.open")}</span>
          </button>
          <button className="welcome-link" data-testid="welcome-new" onClick={onNew}>
            <Icon name="plus" />
            <span>{t("menu.newProject")}</span>
          </button>
          <button className="welcome-link" onClick={onOpenExample}>
            <Icon name="tiles" />
            <span>{t("welcome.example")}</span>
          </button>
          <button className="welcome-link" onClick={onPreferences}>
            <Icon name="gear" />
            <span>{t("menu.preferences")}</span>
          </button>
          {error && <p className="error-text">{t("welcome.notProject")}</p>}
          <div className="recent">
            <div className="gtitle">{t("welcome.recent")}</div>
            <ActionBar>
              <ActionButton icon="folder" label={t("welcome.openSelected")} tone="primary" disabled={!current || current.missing}
                onClick={() => current && open(current.dir)} />
              <Separator />
              <ActionButton icon="trash" label={t("welcome.removeRecent")} tone="danger" disabled={!current} onClick={remove} />
            </ActionBar>
            <DataTable rows={recent} rowKey={(r) => r.dir} selected={selected} onSelect={setSelected} onActivate={open}
              empty={t("welcome.noRecent")} columns={[
                {
                  label: t("welcome.col.name"), width: "34%",
                  cell: (r) => (
                    <span className={r.missing ? "missingrow" : ""} title={r.missing ? t("welcome.missingHint") : undefined}>
                      {r.name}{r.missing && <span className="tagmiss">{t("welcome.missing")}</span>}
                    </span>
                  ),
                },
                { label: t("welcome.col.path"), cell: (r) => <code title={r.dir}>{r.dir}</code> },
                { label: t("welcome.col.opened"), width: "30%", cell: (r) => when.format(new Date(r.openedAt)) },
              ]} />
          </div>
        </div>
      </div>
    </div>
  );
}
