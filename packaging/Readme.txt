TicketMap fuer Windows x64

1. Das gesamte ZIP in einen beschreibbaren Ordner entpacken.
2. TicketMap.cmd doppelklicken.
3. Beim ersten Start GitLab-Server und Projekt angeben. Eine vorhandene GitLab-Anmeldung
   wird verwendet. Falls notwendig, einen persoenlichen GitLab-Token mit API-Zugriff eingeben.
4. TicketMap oeffnet den Standardbrowser. Das Startfenster darf danach geschlossen werden.

ConfigureTicketMap.cmd aendert Server, Projekt oder Anmeldung.
StopTicketMap.cmd beendet ausschliesslich den Server dieser Paketkopie.

Node.js und GitLab CLI sind enthalten. Eine separate Installation ist nicht notwendig.
Der Server ist standardmaessig nur auf diesem Rechner unter http://127.0.0.1:4310 erreichbar.

Persoenliche Einstellungen liegen in data/.env. Gespeicherte Tokens sind in
data/credentials.dat mit Windows-DPAPI fuer dieses Windows-Konto und diesen Rechner
verschluesselt. Nach einem Wechsel von Konto oder Rechner ist eine neue Anmeldung notwendig.
Die Dateien im Ordner data nicht weitergeben. Kartenpositionen bleiben im verwendeten Browser.

Manuelle Updates: TicketMap beenden. Das neue Paket entpacken und app, runtime sowie
die Startdateien der bisherigen Paketkopie ersetzen. Den bestehenden Ordner data behalten.
Es wird kein Update automatisch heruntergeladen oder installiert.

Falls Port 4310 von einer anderen Anwendung belegt ist, diese nicht ungeprueft beenden.
Das Paket meldet den Konflikt. Fortgeschrittene Nutzer koennen TICKETMAP_PORT setzen.
