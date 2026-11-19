#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef StageDir
  #define StageDir "..\build\release\stage"
#endif

#define AppName "Kommandozentrale"
#define AppPublisher "StibaDu"
#define AppURL "https://github.com/StibaDu/kommandozentrale"

[Setup]
AppId={{B7F3D1A2-6C5E-4A8A-9E2B-1D4C8F6A7B90}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={localappdata}\Kommandozentrale
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\build\release
OutputBaseFilename=Kommandozentrale-Setup-{#AppVersion}
SetupIconFile=..\public\icon.ico
UninstallDisplayIcon={app}\public\icon.ico
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
CloseApplications=no
RestartApplications=no
VersionInfoVersion=0.1.0.0
VersionInfoDescription=Kommandozentrale Windows Setup
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoOriginalFileName=Kommandozentrale-Setup-{#AppVersion}.exe

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Desktopverknüpfung erstellen"; GroupDescription: "Zusätzliche Verknüpfungen:"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Excludes: "data\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\Kommandozentrale.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\public\icon.ico"; Comment: "Kommandozentrale starten"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Kommandozentrale.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\public\icon.ico"; Tasks: desktopicon; Comment: "Kommandozentrale starten"

[Run]
Filename: "{app}\Kommandozentrale.cmd"; Description: "Kommandozentrale jetzt starten"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\src"
Type: filesandordirs; Name: "{app}\public"
Type: filesandordirs; Name: "{app}\node_modules"
