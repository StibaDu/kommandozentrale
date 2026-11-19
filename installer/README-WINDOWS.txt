Kommandozentrale 0.1.0 – Windows
================================

Installation
------------
1. Kommandozentrale-Setup-0.1.0.exe starten.
2. Die Installation läuft ohne Administratorrechte in dein Benutzerprofil.
3. Nach der Installation startet die App über die Startmenü- oder Desktop-Verknüpfung.

Beim ersten Start legst du dein Profil an. Decks, Profile und Einstellungen liegen unter:

  %LOCALAPPDATA%\Kommandozentrale\data\kommandozentrale.db

Ein Deinstallieren entfernt das Programm, lässt deine Daten absichtlich stehen.

Enthalten
---------
- Kommandozentrale-Server, Web-Oberfläche und Kartendatenbank (39.288 Karten,
  Tags, Regeln und der bge-m3-Vektorindex).
- Gebündelte Bun-Runtime. Es muss kein Bun, Node.js oder Python installiert sein.
- Keine Profile, Decks, Chatverläufe oder privaten Daten aus der Entwicklung.

KI-Funktionen
-------------
Die KI-Funktionen (Deck-Build, Deck-Chat, Erklärungen, semantische Suche) sind optional.
Dafür müssen vorhanden sein:
- die opencode-CLI (https://opencode.ai) mit dem Agenten "commander",
- Ollama mit dem Modell bge-m3 für den Vektorindex.

Ohne diese Voraussetzungen baut die deterministische Engine weiter; Karten,
Deck-Editor, Import, Export, Simulation und Regelwerk funktionieren trotzdem.

Hinweis
-------
Das Setup ist nicht code-signiert. Windows SmartScreen kann deshalb beim ersten
Start "Weitere Informationen" -> "Trotzdem ausführen" verlangen.

Deinstallation
--------------
Windows-Einstellungen -> Apps -> Kommandozentrale -> Deinstallieren.
Die Datenbank unter %LOCALAPPDATA%\Kommandozentrale\data bleibt erhalten.
