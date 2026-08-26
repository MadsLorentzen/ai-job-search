; Inno Setup script for the agency console.
;
; Installs per user under LocalAppData so no administrator rights are needed -
; a consultant should be able to install this on their own laptop without
; raising a ticket. PrivilegesRequired=lowest keeps it that way.
;
; The installer carries no API key and no client data. Credentials are stored
; per user at first run by `agency key set`, and client workspaces live
; wherever the console is pointed - never inside Program Files, which would
; put other people's personal data somewhere backups and other accounts reach.

#define AppName "Job Search Agency Console"
#define AppShortName "agency"
#define AppVersion "0.1.0"
#define AppPublisher "Job Search Agency"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\JobSearchAgency
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=packaging\output
OutputBaseFilename=agency-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "addtopath"; Description: "Add the console to my PATH (recommended)"; \
  GroupDescription: "Convenience"

[Files]
Source: "..\dist\agency.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{cmd}"; \
  Parameters: "/K ""{app}\{#AppShortName}.exe"" doctor"; \
  WorkingDir: "{app}"; Comment: "Check this machine can run the workflow"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

; Per-user PATH, so the install still needs no elevation. Inno expands this
; against HKCU\Environment; Windows broadcasts the change, but an already-open
; terminal keeps its stale copy until reopened.
[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
  ValueData: "{olddata};{app}"; Tasks: addtopath; \
  Check: NeedsAddPath(ExpandConstant('{app}'))

[Run]
Filename: "{cmd}"; Parameters: "/K ""{app}\{#AppShortName}.exe"" doctor"; \
  Description: "Check the toolchain now"; Flags: postinstall skipifsilent

[Code]
// Re-running the installer must not append the same directory to PATH again;
// a few upgrades of that would leave an unreadable Path variable behind.
function NeedsAddPath(DirToAdd: string): Boolean;
var
  ExistingPath: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', ExistingPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(DirToAdd) + ';',
                ';' + Uppercase(ExistingPath) + ';') = 0;
end;
