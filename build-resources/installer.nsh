; Custom NSIS include picked up by electron-builder (build-resources/installer.nsh).
; The finish page offers "Run MCEdge" and an optional desktop shortcut; nsis.createDesktopShortcut is false, so the
; uninstaller removes the shortcut here, only when the installer made it.

!macro customFinishPage
  Var mcedgeShortcutText

  Function mcedgeFinishPre
    StrCpy $mcedgeShortcutText "Create a desktop shortcut"
    ${if} $LANGUAGE == 1055
      StrCpy $mcedgeShortcutText "Masaüstü kısayolu oluştur"
    ${endif}
  FunctionEnd

  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  ; A shortcut of the same name the user made (to a source checkout, say) is left alone.
  Function mcedgeDesktopShortcut
    ${ifNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcut "1"
    ${endIf}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE mcedgeFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$mcedgeShortcutText"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "mcedgeDesktopShortcut"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  ; Only the shortcut the finish page made is removed; an update runs the old uninstaller with --updated and keeps it.
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcut
  ${if} $R0 == "1"
  ${andIfNot} ${isUpdated}
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endIf}
!macroend
