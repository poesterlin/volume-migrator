# Project Spec: Coolify Volume Migration Tool

## 1. Ziel

Ein internes CLI-Tool auf Basis von Bun + TypeScript, mit dem persistente Daten eines Services von einem Coolify-Server auf einen anderen übertragen werden können, ohne dass Nutzer Doku lesen müssen.

Das Tool soll:
- den Nutzer durch den Prozess führen
- Server, Services und Volumes automatisch erkennen
- sichere Defaults setzen
- typische Fehler vorab erkennen
- Services bei Bedarf automatisch stoppen/starten
- Daten möglichst ohne temporäre Dateien streamen
- verständliche Statusmeldungen und Recovery-Hinweise ausgeben

Nicht-Ziel:
- komplette Coolify-Instanzen migrieren
- Coolify intern umbauen
- vollautomatisch jede Spezialdatenbank perfekt behandeln
- HA/Failover ersetzen

## 2. Hauptproblem, das gelöst werden soll

Aktuell können Services auf einen zweiten Coolify-Server verschoben werden, aber persistente Daten müssen separat übertragen werden.

Typische Probleme:
- Nutzer kennen die Docker-Volume-Namen nicht
- Source- und Target-Volumes heißen oft unterschiedlich
- laufende Container machen Daten inkonsistent
- Ziel-Volumes können alte Daten enthalten
- DB-Volumes sind riskant
- SSH/Docker-Fehler sind für normale Nutzer schwer zu interpretieren

Das Tool soll all das so weit wie möglich automatisch abfangen.

## 3. Produktvision

Der Nutzer soll idealerweise nur sagen:

- von welchem Server
- zu welchem Server
- welcher Service

Alles andere soll das Tool möglichst selbst tun:
- passende Container finden
- persistente Mounts erkennen
- Docker-Volumes/Binds unterscheiden
- Source-/Target-Mounts matchen
- Risiken anzeigen
- Service-Stop/Start durchführen
- Transfer ausführen
- Verify laufen lassen
- Ergebnis verständlich zusammenfassen

## 4. Zielgruppe

Interne Entwickler/Ops-Mitarbeiter mit SSH-Zugang auf die Coolify-Hosts, aber ohne tiefes Docker-/Coolify-Spezialwissen.

UX-Prinzip:
- kein Lesen von Doku nötig
- lieber Rückfragen und sinnvolle Defaults
- möglichst selbsterklärende Kommandos
- interaktive Nutzung als Standard
- nicht-interaktive Flags für Automatisierung zusätzlich

## 5. Produktform

CLI-Anwendung mit Bun + TypeScript.

Warum CLI zuerst:
- schnell umsetzbar
- stabil
- leicht über SSH/CI nutzbar
- später um API/Web-UI erweiterbar

## 6. Grundprinzipien

1. UX first
- Nutzer soll geführt werden
- keine internen Docker-Details nötig
- gute Fehlermeldungen statt roher Shell-Errors

2. Safe by default
- keine destruktiven Schritte ohne Bestätigung
- keine blinde Überschreibung
- Warnungen bei DBs/laufenden Services
- Dry-run möglich

3. Automatisch, aber nicht magisch
- Tool versucht Auto-Erkennung
- bei Unsicherheit fragt es nach
- manueller Override immer möglich

4. Pragmatismus
- bewährte Systemtools nutzen:
  - SSH
  - Docker CLI
  - rsync
  - tar
- keine unnötige Abhängigkeit von Coolify-Interna

## 7. Scope v1

### In Scope
- interaktive Migration eines einzelnen Services
- Erkennung von Source- und Target-Services
- Erkennung persistenter Mounts
- Unterstützung für:
  - Docker Volumes
  - Bind Mounts
- Stream-basierter Transfer für Docker-Volumes
- rsync-basierter Transfer für Bind Mounts
- Source/Target-Preflight-Checks
- optionales Stoppen/Starten der betroffenen Container
- Zielprüfung vor Restore
- grundlegende Verifikation nach Migration
- menschenlesbare Ausgabe
- JSON-Ausgabe optional

### Out of Scope für v1
- vollständige Coolify-API-Integration als Pflicht
- automatische Erstellung von Services in Coolify
- inkrementelle Synchronisation von Docker-Volumes
- echtes HA / Replikation
- vollautomatisches DB-native Backup/Restore für alle Engines
- Web UI

## 8. Core User Flows

### Flow A: interaktive Standardmigration
User startet:
```bash
bun run src/cli.ts migrate
```

Tool fragt:
1. Quellserver?
2. Zielserver?
3. Welcher Service auf dem Quellserver?
4. Welcher passende Zielservice?
5. Soll Source gestoppt werden?
6. Soll Ziel vor Restore geleert werden?
7. Soll Zielservice nachher gestartet werden?

Dann:
- Prüfen
- Plan anzeigen
- Risiken anzeigen
- Bestätigung abfragen
- Migration ausführen
- Ergebnis zusammenfassen

### Flow B: semi-automatisch über Flags
```bash
bun run src/cli.ts migrate \
  --source root@server-a \
  --target root@server-b \
  --source-service n8n \
  --target-service n8n
```

Falls etwas unklar ist, wird interaktiv nachgefragt.

### Flow C: vollständig nicht-interaktiv
```bash
bun run src/cli.ts migrate \
  --source root@server-a \
  --target root@server-b \
  --source-service n8n \
  --target-service n8n \
  --stop-source \
  --clear-target \
  --start-target \
  --yes
```

## 9. CLI Commands

### `migrate`
Hauptbefehl für komplette Migration.

### `inspect`
Zeigt:
- gefundene Container
- persistente Mounts
- potenzielle Risiken
- erkannte Matchings

### `list-services`
Listet auf einem Host die erkennbaren Services/Container auf.

### `verify`
Prüft nach einer Migration:
- Zielcontainer läuft?
- Mounts vorhanden?
- Volume-Inhalte plausibel?
- optional Größenvergleich

### `doctor`
Systemdiagnose:
- SSH erreichbar?
- Docker vorhanden?
- rsync vorhanden?
- benötigte Images pullbar?
- Rechte ausreichend?

## 10. UX-Anforderungen

### 10.1 Kein Doku-Zwang
Das Tool muss:
- jeden Schritt erklären
- verständliche Fragen stellen
- sinnvolle Defaults vorschlagen
- Klartextfehler liefern

Beispiel:
Nicht:
```text
docker: Error response from daemon
```

Sondern:
```text
Das Ziel-Volume existiert nicht oder ist für Docker nicht erreichbar.
Host: root@server-b
Volume: coolify_n8n_data_7f3b
Vorschlag: Zielservice einmal deployen oder Volume manuell prüfen.
```

### 10.2 Interaktiver Wizard
Wenn Pflichtinfos fehlen, fragt das Tool nach.
Wenn mehrere Services matchen, bietet es Auswahl an.
Wenn Risiken erkannt werden, erklärt es die Folgen.

### 10.3 Klarer Migrationsplan vor Ausführung
Vor Start wird immer ein Plan gezeigt:

```text
Migrationsplan
- Quelle: root@server-a
- Ziel: root@server-b
- Source-Service: n8n
- Target-Service: n8n
- Quelle wird gestoppt: ja
- Ziel wird vor Restore geleert: ja
- Ziel wird danach gestartet: ja

Zu übertragende Persistenz:
1. Docker Volume
   coolify_n8n_data_a1b2 -> coolify_n8n_data_x9y8
   Mount: /home/node/.n8n

2. Bind Mount
   /data/app/config -> /data/app/config
   Mount: /app/config
```

### 10.4 Fortschritts- und Statusmeldungen
Beispiel:
- Verbinde mit Source-Server...
- Docker auf Source verfügbar
- Suche Service...
- 2 persistente Mounts gefunden
- Stoppe Source-Container...
- Übertrage Volume 1/2...
- Verifiziere Ziel...
- Migration erfolgreich

### 10.5 Gute Fehlermeldungen
Jeder Fehler soll enthalten:
- was schiefging
- wo es schiefging
- warum wahrscheinlich
- wie man es beheben kann

## 11. Funktionale Anforderungen

### 11.1 Host-Verbindung
Tool muss per SSH mit Source und Target kommunizieren.

Anforderungen:
- Nutzung vorhandener SSH-Config/Keys
- Host-String z. B. `root@server-a`
- Zeitüberschreitungen erkennen
- hilfreiche Fehlermeldungen bei Auth-Problemen

### 11.2 Docker-Erkennung
Tool muss prüfen:
- Docker installiert?
- Docker erreichbar?
- User darf Docker-Kommandos ausführen?

### 11.3 Service-Erkennung
Tool soll Services primär über Docker erkennen, nicht über harte Coolify-Interna.

Mögliche Erkennung:
- Containername
- Compose-Labels
- Docker-Labels
- Image/Name-Match
- optional interaktive Auswahl

### 11.4 Mount-Erkennung
Für alle zum Service gehörenden Container müssen Mounts erkannt werden:
- `Type = volume`
- `Type = bind`

Mount-Infos:
- Typ
- Source
- Target
- Readonly
- Volume-Name falls vorhanden

### 11.5 Matching Source ↔ Target
Tool soll automatisch Source- und Target-Mounts matchen anhand von:
- identischem Mount-Path
- ähnlichem Service-Kontext
- ggf. identischem Basenamen

Wenn Matching nicht eindeutig:
- interaktive Auswahl
- oder Abbruch mit klarer Erklärung

### 11.6 Transfer-Strategien
#### Docker Volumes
Standard:
- Stream über SSH mit `tar`
- optional komprimiert

#### Bind Mounts
Standard:
- `rsync -aHAX --numeric-ids`

### 11.7 Stop/Start-Verhalten
Tool soll erkennen, welche Container betroffen sind.

Optionen:
- Source-Container stoppen
- Target-Container stoppen
- Target-Container nach Migration starten

Default für interaktiven Flow:
- Source stoppen: empfohlen
- Target stoppen: empfohlen
- Start Ziel: empfohlen

### 11.8 Zielschutz
Vor Restore muss Ziel geprüft werden:
- existiert das Volume/der Pfad?
- ist es leer?
- wenn nicht leer:
  - Warnung
  - Vorschlag `clear target`
  - ohne Bestätigung kein Überschreiben

### 11.9 Verifikation
Nach Transfer:
- Ziel-Mount vorhanden?
- Zielcontainer startbar?
- grober Größenvergleich Source/Target
- optional Dateianzahlvergleich
- Healthcheck sofern verfügbar

## 12. Sicherheits- und Schutzmechanismen

### Muss
- kein Löschen ohne explizite Bestätigung oder `--yes`
- kein Restore in nicht-leeres Ziel ohne Bestätigung
- klare Warnung bei DB-Volumes
- Abbruch bei mehrdeutigem Matching ohne Userentscheidung
- Pipeline muss mit `pipefail` laufen

### Soll
- Source-Volume read-only mounten beim Export
- klare Trennung von Source- und Target-Volume-Namen
- dry-run vor echter Ausführung möglich

## 13. Datenbank-Sonderbehandlung

Das Tool muss Datenbank-Workloads erkennen, zumindest heuristisch über:
- Container-Image
- Container-Name
- Mount-Path

Beispiele:
- postgres
- mysql
- mariadb
- redis

Verhalten:
- deutliche Warnung
- Empfehlung, Source sauber zu stoppen
- optional Blockade ohne `--allow-live-db-copy`

v1:
- keine vollständigen nativen DB-Backups erzwingen
- aber explizite Schutzwarnungen

## 14. Automatisierung vs. Interaktivität

### Interaktiv als Standard
Wenn Angaben fehlen oder unsicher sind:
- User fragen

### Scriptbar als Option
Alle Entscheidungen müssen auch per Flags steuerbar sein:
- `--source`
- `--target`
- `--source-service`
- `--target-service`
- `--stop-source`
- `--stop-target`
- `--start-target`
- `--clear-target`
- `--yes`
- `--dry-run`
- `--json`

## 15. Nicht-funktionale Anforderungen

### Performance
- Streaming statt temporärer lokaler Dateien, wo möglich
- keine unnötigen Vollkopien auf dem Runner
- optional Kompression

### Zuverlässigkeit
- deterministische Fehlercodes
- klare Logs
- Teilfehler pro Mount sichtbar

### Wartbarkeit
- modulare Architektur
- SSH/Docker/Transfer getrennt
- Transfer-Engine austauschbar

### Portabilität
- primär Linux-Hosts mit Docker
- Runner lokal oder auf Admin-Host

## 16. Technische Architektur

## Runtime
- Bun
- TypeScript

## Externe Systemtools
- `ssh`
- `docker`
- `rsync`
- `bash`

## Architekturmodule

```text
src/
  cli.ts
  commands/
    migrate.ts
    inspect.ts
    verify.ts
    doctor.ts
    list-services.ts
  core/
    preflight.ts
    service-discovery.ts
    mount-discovery.ts
    matching.ts
    migration-plan.ts
    migrate-execution.ts
    verification.ts
  infra/
    ssh.ts
    docker.ts
    rsync.ts
    shell.ts
  prompts/
    select.ts
    confirm.ts
    summary.ts
  domain/
    types.ts
    errors.ts
  utils/
    log.ts
    format.ts
```

## 17. Domänenmodell

### Host
```ts
type HostRef = {
  sshTarget: string;
};
```

### Service
```ts
type ServiceRef = {
  name: string;
  containers: ContainerRef[];
};
```

### Container
```ts
type ContainerRef = {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
};
```

### Mount
```ts
type MountInfo = {
  type: "volume" | "bind";
  source: string;
  target: string;
  name?: string;
  readOnly: boolean;
};
```

### Mapping
```ts
type MountMapping = {
  source: MountInfo;
  target: MountInfo;
  strategy: "volume-stream" | "bind-rsync";
};
```

### Plan
```ts
type MigrationPlan = {
  sourceHost: string;
  targetHost: string;
  sourceService: string;
  targetService: string;
  stopSource: boolean;
  stopTarget: boolean;
  clearTarget: boolean;
  startTarget: boolean;
  mappings: MountMapping[];
  warnings: string[];
};
```

## 18. Erkennungslogik

### Service Discovery
Priorität:
1. exakter Containername
2. Label-Match
3. Compose-Service-Match
4. Fuzzy Match
5. User-Auswahl

### Mount Matching
Priorität:
1. gleicher Mount-Target-Pfad
2. gleicher Typ
3. ähnliche Namen
4. User-Auswahl

Wenn kein sauberes Matching:
- interaktive Klärung
- oder Abbruch

## 19. Transfer-Engine

### Volume → Volume
Remote Source:
```bash
docker run --rm -v <sourceVolume>:/data:ro alpine tar -czf - -C /data .
```

Remote Target:
```bash
docker run --rm -i -v <targetVolume>:/data alpine tar -xzf - -C /data
```

Optional ohne gzip:
```bash
tar -cf - / tar -xf -
```

### Bind → Bind
```bash
rsync -aHAX --numeric-ids -e ssh <source>/ <target>/
```

## 20. Preflight Checks

Vor echter Migration:
- SSH Source erreichbar
- SSH Target erreichbar
- Docker auf beiden Hosts verfügbar
- Source-Service gefunden
- Target-Service gefunden
- persistente Mounts erkannt
- Mapping eindeutig
- Source/Target-Mounts zugänglich
- rsync vorhanden falls Bind Mount
- Ziel nicht unerwartet befüllt
- Containerstatus ermittelt
- DB-Warnungen berechnet

## 21. Fehlerklassen

```ts
PreflightError
DiscoveryError
MatchingError
TransferError
VerificationError
UserAbortError
```

Jeder Fehler enthält:
- code
- humanMessage
- technicalDetails
- remediationHint

## 22. Logging

Zwei Modi:
- human-readable default
- `--json` für Maschinen

Human-readable:
- Emojis optional
- klare Schrittblöcke
- am Ende Summary

Beispiel:
```text
[1/7] Verbinde mit root@server-a
[2/7] Suche Service "n8n"
[3/7] Finde persistente Mounts
[4/7] Stoppe Source-Container
[5/7] Übertrage Daten
[6/7] Starte Ziel-Container
[7/7] Verifiziere Migration
```

## 23. Exit Codes

- `0` Erfolg
- `1` allgemeiner Fehler
- `2` User-Abbruch
- `3` Preflight fehlgeschlagen
- `4` Matching fehlgeschlagen
- `5` Transfer fehlgeschlagen
- `6` Verifikation fehlgeschlagen

## 24. CLI-Optionen

### `migrate`
- `--source <host>`
- `--target <host>`
- `--source-service <name>`
- `--target-service <name>`
- `--stop-source`
- `--stop-target`
- `--start-target`
- `--clear-target`
- `--dry-run`
- `--yes`
- `--json`
- `--allow-live-db-copy`
- `--no-compress`

### `inspect`
- `--host <host>`
- `--service <name>`
- `--json`

### `doctor`
- `--host <host>`
- `--json`

## 25. Erfolgsdefinition

Das Tool ist erfolgreich, wenn ein interner Nutzer ohne zusätzliche Doku:

1. das Tool startet
2. Source- und Target-Server auswählt
3. den Service auswählt
4. einen klaren Migrationsplan sieht
5. die Migration sicher ausführt
6. am Ende ein verständliches Ergebnis bekommt

## 26. MVP-Milestones

### Milestone 1: Discovery
- `doctor`
- `list-services`
- `inspect`

### Milestone 2: Dry Run
- `migrate --dry-run`
- Service-/Mount-Matching
- Risikoerkennung

### Milestone 3: Real Migration
- Volume-Streaming
- Bind-rsync
- Stop/Start
- Zielschutz

### Milestone 4: Verify + Polish
- Verifikation
- bessere Fehlermeldungen
- JSON-Output
- UX-Verbesserungen

## 27. Offene Entscheidungen

Diese Punkte sollten zu Projektbeginn entschieden werden:
- Soll interaktiv mit Prompts gearbeitet werden?
- Sollen Ziel-Volumes automatisch erstellt werden dürfen?
- Soll `alpine` als Standard-Helferimage genutzt werden?
- Soll gzip standardmäßig aktiv sein?
- Sollen DB-Volumes standardmäßig blockiert oder nur gewarnt werden?
- Soll das Tool direkt Service-Container stoppen oder nur Kommandos vorschlagen?

## 28. Empfehlung

Meine Empfehlung für euren Fall:

- interaktive CLI als Standard
- SSH + Docker CLI als Basis
- Volumes per `tar`-Stream
- Bind Mounts per `rsync`
- klare DB-Warnungen
- Stop/Start automatisiert
- Dry-run standardmäßig vor echter Migration anzeigen
- erst später Coolify-spezifische API-Integration

## 29. Kurzfassung in einem Satz

Ein Bun-basiertes internes CLI-Tool, das Coolify-Service-Daten zwischen zwei Hosts sicher, geführt und weitgehend automatisch migriert, sodass Nutzer ohne Doku per interaktivem Wizard oder wenigen Flags arbeiten können.

Wenn du willst, kann ich dir als Nächstes direkt aus dieser Spec ein umsetzbares Paket machen, z. B.:
- `README` in internem Produktstil
- Datei-/Ordnerstruktur
- konkrete CLI-Syntax
- oder direkt das Bun-Projektgerüst mit den ersten Commands.