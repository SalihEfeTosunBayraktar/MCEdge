import { useEffect, useMemo, useState } from "react";
import type { AppInfo } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { BUILD_TAIL, issueLink, mask, reportBody } from "../bugReport.ts";
import { t } from "../strings.ts";
import { Icon } from "./Icon.tsx";
import { Modal } from "./HelpDialogs.tsx";
import { FormGroup, FormRow } from "./ui.tsx";

/**
 * Help > Report a bug (Q208). The report is prepared here and GitHub's new-issue page opens with it filled in; the user
 * signs in and presses Submit there, so no token ships in the app and nothing is sent unseen. The preview is the exact
 * text that goes into the link, personal data already masked. Issue text stays English whatever the app language.
 */
export function ReportBugDialog({ engineName, buildLines, onClose }: { engineName: string; buildLines: string[]; onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo>();
  const [who, setWho] = useState({ home: "", user: "" });
  const [title, setTitle] = useState("");
  const [happened, setHappened] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [withEngine, setWithEngine] = useState(true);
  const [withBuild, setWithBuild] = useState(buildLines.length > 0);
  useEffect(() => void api.appInfo().then(setInfo), []);
  useEffect(() => void api.bugContext().then(setWho), []);

  const tail = buildLines.slice(-BUILD_TAIL);
  const full = useMemo(() => {
    const environment = [
      `- MCEdge: ${info?.version ?? "?"}`,
      `- OS: ${info?.platform ?? "?"}`,
      `- Electron: ${info?.electron ?? "?"} (Chromium ${info?.chrome ?? "?"}, Node.js ${info?.node ?? "?"})`,
      ...(withEngine && engineName ? [`- Engine: ${engineName}`] : []),
    ].join("\n");
    const sections = [
      { heading: "What happened", text: happened },
      { heading: "Steps to reproduce", text: steps },
      { heading: "Expected behavior", text: expected },
      { heading: "Environment", text: environment },
      { heading: `Build output (last ${tail.length} lines)`, text: withBuild && tail.length ? `\`\`\`\n${tail.join("\n")}\n\`\`\`` : "" },
    ];
    return mask(reportBody(sections), who.home, who.user);
  }, [info, who, happened, steps, expected, withEngine, withBuild, engineName, tail.join("\n")]);
  const maskedTitle = mask(title.trim(), who.home, who.user);
  const link = useMemo(
    () => issueLink(maskedTitle, full, "_The report was too long for a link and is cut here. The full text is on the reporter's clipboard and is pasted below._"),
    [maskedTitle, full],
  );

  const send = async () => {
    if (link.trimmed) await navigator.clipboard.writeText(full).catch(() => {});
    await api.openIssue(link.url);
    onClose();
  };
  return (
    <Modal title={t("bug.title")} className="bugdlg" onClose={onClose} buttons={
      <button type="button" className="abtn primary" data-testid="bug-send" disabled={!maskedTitle} onClick={() => void send()}>
        <Icon name="globe" /><span>{t("bug.send")}</span>
      </button>
    }>
      <div className="bugbody" data-testid="report-bug">
        <p className="hint">{t("bug.intro")}</p>
        <FormGroup title={t("bug.report")}>
          <FormRow label={t("bug.summary")}><input type="text" data-testid="bug-title" value={title} placeholder={t("bug.summaryHint")} onChange={(e) => setTitle(e.target.value)} autoFocus /></FormRow>
          <FormRow label={t("bug.happened")} top><textarea rows={3} data-testid="bug-happened" value={happened} onChange={(e) => setHappened(e.target.value)} /></FormRow>
          <FormRow label={t("bug.steps")} top><textarea rows={3} data-testid="bug-steps" value={steps} onChange={(e) => setSteps(e.target.value)} /></FormRow>
          <FormRow label={t("bug.expected")} top><textarea rows={2} data-testid="bug-expected" value={expected} onChange={(e) => setExpected(e.target.value)} /></FormRow>
        </FormGroup>
        <FormGroup title={t("bug.attach")}>
          <label className="check"><input type="checkbox" checked disabled /><span>{t("bug.attachApp")}</span></label>
          <label className="check"><input type="checkbox" data-testid="bug-engine" checked={withEngine} disabled={!engineName} onChange={(e) => setWithEngine(e.target.checked)} /><span>{t("bug.attachEngine", { engine: engineName || "-" })}</span></label>
          <label className="check"><input type="checkbox" data-testid="bug-build" checked={withBuild} disabled={!tail.length} onChange={(e) => setWithBuild(e.target.checked)} />
            <span>{tail.length ? t("bug.attachBuild", { count: tail.length }) : t("bug.attachBuildNone")}</span></label>
        </FormGroup>
        <FormGroup title={t("bug.preview")}>
          <pre className="javapre bugpreview" data-testid="bug-preview">{`${maskedTitle}\n\n${link.body}`}</pre>
          <p className="hint">{t("bug.privacy")}</p>
          {link.trimmed && <p className="notice" data-testid="bug-trimmed">{t("bug.trimmed")}</p>}
        </FormGroup>
      </div>
    </Modal>
  );
}
