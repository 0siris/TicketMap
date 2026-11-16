import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes('--require-images');
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const releases = 'https://github.com/0siris/TicketMap/releases/latest';
const source = 'https://docs.gitlab.com/user/profile/personal_access_tokens/';

const steps = [
  {
    title: 'Das Windows-Paket herunterladen',
    image: 'release-download.png',
    alt: 'GitHub Releases mit dem startfertigen Windows-ZIP unter Assets',
    caption: 'Echte Aufnahme der öffentlichen TicketMap-Release-Seite.',
    body: '<p>Du brauchst Windows 64-Bit, einen Browser, Internetzugang und Zugriff auf dein GitLab-Projekt. Node.js und GitLab CLI sind enthalten. npm musst du nicht installieren.</p><ol><li>Öffne <a href="' + releases + '">TicketMap unter GitHub Releases</a>.</li><li>Lade unter <strong>Assets</strong> die Datei <code>TicketMap-&lt;version&gt;-windows-x64.zip</code> herunter.</li></ol><p class="note">Wähle nicht <strong>Source code (zip)</strong>. Das ist der Quellcode, nicht das startfertige Paket.</p>',
  },
  {
    title: 'Alle Dateien entpacken und starten',
    body: '<ol><li>Öffne deinen Download-Ordner.</li><li>Klicke die ZIP-Datei mit der rechten Maustaste an und wähle <strong>Alle extrahieren</strong>.</li><li>Entpacke das ganze ZIP in einen beschreibbaren Ordner.</li><li>Öffne den entpackten Ordner <code>TicketMap</code>. Doppelklicke <strong><code>TicketMap.cmd</code></strong>.</li></ol><p>Falls Windows die Dateiendungen ausblendet, suche <strong>TicketMap</strong> vom Typ <strong>Windows-Befehlsdatei</strong>. Die Dateien <code>ConfigureTicketMap.cmd</code> und <code>StopTicketMap.cmd</code> sind für andere Aufgaben.</p><p class="note">Starte nicht aus der ZIP-Vorschau. Behalte <code>app</code>, <code>runtime</code>, <code>licenses</code> und die Startdateien zusammen im entpackten Ordner.</p>',
  },
  {
    title: 'GitLab-Server und Projekt eingeben',
    image: 'console-setup.png',
    alt: 'Originales TicketMap-Startfenster mit Server- und Projektabfrage',
    caption: 'Originalaufnahme des Startprogramms. Die Eingaben sind Beispiele.',
    body: '<ol><li>Öffne dein Projekt im GitLab-Browser. Beispiel: <code>https://gitlab.example.com/example/team-project</code>.</li><li>Gib bei <strong>GitLab-Server</strong> nur den Server ein, im Beispiel <code>https://gitlab.example.com</code>. Drücke <strong>Enter</strong>. Bei GitLab.com kannst du den Vorschlag mit Enter übernehmen.</li><li>Gib bei <strong>Projekt (Gruppe/Projekt)</strong> nur den Projektpfad ein, im Beispiel <code>example/team-project</code>. Drücke Enter.</li></ol><p>Untergruppen gehören zum Pfad: <code>example/subgroup/team-project</code>. Zusätze wie <code>/-/issues</code>, eine Ticketnummer oder <code>.git</code> gehören nicht hinein.</p><p class="note">Wenn eine passende GitLab-CLI-Anmeldung vorhanden ist, öffnet sich TicketMap ohne Token-Abfrage. Gehe dann zu Schritt 10. Die folgenden Schritte brauchst du, wenn das Startfenster nach einem Token fragt.</p>',
  },
  {
    title: 'Die persönliche Token-Seite öffnen',
    image: 'gitlab-token-menu.png',
    alt: 'GitLab: Persönliche Zugriffstokens und Token erstellen',
    caption: 'Echte GitLab-Aufnahme. Profilbereiche und vorhandene Tokenlisten sind ausgeblendet.',
    body: '<ol><li>Lass das TicketMap-Startfenster geöffnet und wechsle zum Browser.</li><li>Melde dich auf <strong>demselben GitLab-Server</strong> an, den du in TicketMap eingetragen hast.</li><li>Öffne dein Profilbild → <strong>Profil bearbeiten / Edit profile</strong> → <strong>Zugriff / Access → Persönliche Zugriffstokens / Personal access tokens</strong>.</li></ol><p>Alternativ hängst du an deine GitLab-Serveradresse <code>/-/user_settings/personal_access_tokens</code> an. Beispiel: <code>https://gitlab.example.com/-/user_settings/personal_access_tokens</code>.</p><p class="note">Erzeuge den Token auf deiner eigenen Instanz. Ein Token von GitLab.com meldet dich nicht automatisch an einem anderen GitLab-Server an.</p>',
  },
  {
    title: 'Einen neuen persönlichen Token auswählen',
    image: 'gitlab-token-type.png',
    alt: 'GitLab: geöffnetes Erstellungsmenü für Zugriffstokens',
    caption: 'Echte GitLab-Browseraufnahme des geöffneten Erstellungsmenüs.',
    body: '<ol><li>Klicke <strong>Token erstellen</strong>, in einer englischen Oberfläche zum Beispiel <strong>Generate token</strong>.</li><li>Wenn du einen Typ auswählen sollst, wähle <strong>Legacy-Token</strong>. Danach öffnet sich das Formular <strong>Legacy-Token generieren</strong>.</li></ol><p>Bei älteren GitLab-Versionen gelangst du möglicherweise direkt in das Formular oder verwendest <strong>Add new token</strong>. Entscheidend ist ein persönlicher Zugriffstoken mit der Berechtigung <code>api</code>.</p><p>Menünamen können je nach Sprache und GitLab-Version abweichen. Die Bilder zeigen aufgenommene Oberflächen, keine nachgebauten Formulare.</p>',
  },
  {
    title: 'Tokenname und Ablaufdatum eintragen',
    image: 'gitlab-token-form.png',
    alt: 'GitLab-Formular mit Namen und Ablaufdatum eines neuen Tokens',
    caption: 'Echte Formularaufnahme: Token-Name TicketMap und Ablaufdatum 31.01.2027 sind Beispiele. Wähle dein eigenes gültiges Ablaufdatum; kein Tokenwert wird gezeigt.',
    body: '<ol><li>Gib im Feld <strong>Token-Name</strong> zum Beispiel <strong>TicketMap</strong> ein. Der Name hilft dir später, diesen Token wiederzufinden.</li><li>Wähle im Feld <strong>Ablaufdatum</strong> ein Datum in der Zukunft. Beachte die Vorgaben deiner Organisation.</li><li>Eine Beschreibung kannst du ergänzen, wenn GitLab dieses Feld anbietet. Sie ist für die Anmeldung nicht erforderlich.</li></ol><p class="note"><strong>Der Name ist noch kein Zugangsschlüssel.</strong> Kopiere später nicht den Namen „TicketMap“ oder eine Token-ID. Du benötigst den langen Tokenwert, den GitLab nach dem Erstellen einmalig anzeigt.</p>',
  },
  {
    title: 'api auswählen und den Token erstellen',
    image: 'gitlab-token-api.png',
    alt: 'GitLab: api-Berechtigung und Schaltfläche zum Erstellen des Tokens',
    caption: 'Echte GitLab-Aufnahme mit der ausgewählten Berechtigung api, ohne private Kontodaten.',
    body: '<ol><li>Suche die Liste der <strong>Berechtigungen / Scopes</strong>. Scrolle bei Bedarf nach unten.</li><li>Aktiviere das Kontrollkästchen <strong><code>api</code></strong>. Wähle für diese Anleitung keine zusätzlichen Berechtigungen aus.</li><li>Prüfe den Namen, das Ablaufdatum und das Häkchen bei <code>api</code>.</li><li>Klicke auf die Schaltfläche, die den neuen persönlichen Token erstellt, zum Beispiel <strong>Token erstellen</strong> oder <strong>Generate token</strong>.</li></ol><p>Die Berechtigung <code>api</code> ermöglicht TicketMap auch Änderungen über die GitLab-API. Dein Konto muss zusätzlich Zugriff auf das gewünschte Projekt haben. Der Token verleiht keine Projektberechtigungen, die dein Konto nicht besitzt.</p><p class="note">Der letzte Klick erzeugt einen neuen Zugangsschlüssel in deinem Konto. Gib diesen Schlüssel nicht weiter.</p>',
  },
  {
    title: 'Den neuen Tokenwert einmalig kopieren',
    body: '<ol><li>Nach dem Erstellen zeigt GitLab den <strong>neuen Tokenwert</strong> an.</li><li>Kopiere genau diesen Wert. Verwende die Kopierfunktion neben dem Wert, wenn deine Oberfläche sie anbietet. Falls der Wert verdeckt ist, kopiere nicht die dargestellten Sternchen, sondern benutze die Kopierschaltfläche.</li><li>Lass die GitLab-Seite geöffnet, bis TicketMap deine Anmeldung bestätigt hat.</li></ol><p class="note"><strong>Den Wert kannst du später nicht erneut anzeigen lassen.</strong> Wenn du ihn verloren hast, erstelle einen neuen Token. Kopiere nicht den Tokennamen, die Token-ID, einen Feed-Token oder einen Token für eingehende E-Mails.</p><p>Der geheime Tokenwert wird hier absichtlich nicht abgebildet. Die Anleitung zeigt weder einen echten Zugangsschlüssel noch einen nachgebauten Ergebnisbildschirm mit einem erfundenen Token.</p>',
  },
  {
    title: 'Den Token in TicketMap einfügen',
    image: 'console-token-masked.png',
    alt: 'Originales TicketMap-Startfenster an der verdeckten Token-Eingabe',
    caption: 'Originalaufnahme der Token-Abfrage mit verdecktem, ungültigem Beispieltext. Die Eingabe wurde nicht abgeschickt.',
    body: '<ol><li>Wechsle zurück zum <strong>TicketMap-Startfenster</strong>, das über <code>TicketMap.cmd</code> geöffnet wurde.</li><li>Klicke in dieses Konsolenfenster. Der Cursor muss hinter dieser Abfrage stehen:</li></ol><pre class="input-target"><code>GitLab-Token (Eingabe ist verborgen; leer = abbrechen):</code></pre><ol start="3"><li>Füge den zuvor kopierten Tokenwert mit der Einfügefunktion des Konsolenfensters ein, zum Beispiel <strong>Strg+V</strong> oder über das Kontextmenü <strong>Einfügen</strong>.</li><li>Drücke <strong>Enter</strong> genau einmal.</li><li>Warte, während TicketMap die Anmeldung und den Projektzugriff prüft. Wenn beides stimmt, öffnet sich der Browser automatisch.</li></ol><p class="note">Die Eingabe ist verdeckt. Je nach Konsole siehst du Sternchen oder keine Zeichen. Das ist normal. Eine leere Eingabe bricht die Einrichtung ab. Der Token gehört nicht in die Browseradresszeile, ein Suchfeld oder eine Konfigurationsdatei.</p><p>TicketMap speichert einen hier eingegebenen Token verschlüsselt für dein Windows-Konto und diesen Rechner. Es speichert nicht dein GitLab-Kontopasswort.</p>',
  },
  {
    title: 'Prüfen, ob TicketMap die Tickets lädt',
    image: 'ticketmap-ready.png',
    alt: 'Echte TicketMap-Oberfläche mit neutralen Beispieltickets',
    caption: 'Aufnahme der echten TicketMap-Anwendung mit Beispieldaten, ohne privates Projekt.',
    body: '<ol><li>Der Browser öffnet <strong><a href="http://127.0.0.1:4310">http://127.0.0.1:4310</a></strong>. Falls kein Browser aufgeht, öffne die Adresse selbst.</li><li>Prüfe, ob links deine Tickets erscheinen.</li><li>Klicke einen Eintrag links an. Die Map holt die Karte ins Bild und rechts öffnet sich die Ticketansicht.</li></ol><p class="note">Wenn GitLab den Zugriff ablehnt, prüfe Server, Projektpfad, Token und Projektberechtigung. Kopiere keine Fehlermeldung zusammen mit einem Token in einen Chat.</p>',
  },
  {
    title: 'Später starten, stoppen oder die Anmeldung ändern',
    body: '<ul><li><strong>Erneut starten:</strong> Doppelklicke <code>TicketMap.cmd</code>. Die gespeicherten Einstellungen werden verwendet.</li><li><strong>Beenden:</strong> Speichere oder verwirf offene Ticketänderungen. Starte dann <code>StopTicketMap.cmd</code>. Nur den Browser zu schließen beendet den Server nicht.</li><li><strong>Server, Projekt oder Token ändern:</strong> Starte <code>ConfigureTicketMap.cmd</code>. Sichere vorher ungespeicherte Änderungen. Für einen neuen Token behältst du Server und Projekt bei und bestätigst die Frage nach einer neuen Anmeldung.</li></ul><p>Ein abgelaufener Token funktioniert nicht mehr. Erstelle in GitLab einen neuen und gib ihn über <code>ConfigureTicketMap.cmd</code> ein.</p><p class="note">Teile den Ordner <code>data</code> nicht. Dort liegen Einstellungen und gegebenenfalls verschlüsselte Zugangsdaten. Auf einem anderen Rechner oder Windows-Konto musst du die Anmeldung neu einrichten.</p>',
  },
  {
    title: 'Manuell aktualisieren und Probleme lösen',
    body: '<ol><li>Speichere oder verwirf offene Ticketänderungen und starte <code>StopTicketMap.cmd</code>.</li><li>Lade das neue Windows-ZIP herunter und entpacke es in einen neuen Ordner.</li><li>Kopiere den bisherigen Ordner <strong><code>data</code></strong> in das neue Paket. Kopiere nicht die alten Ordner <code>app</code> oder <code>runtime</code>.</li><li>Starte dort <code>TicketMap.cmd</code>. Behalte Browser, Adresse, Port und GitLab-Projekt bei.</li></ol><p>Die Kartenpositionen liegen im Browser. Lösche dessen Website-Daten nicht, wenn du die Anordnung behalten willst. Neue Anwendungsversionen werden nur gemeldet und verlinkt, nicht automatisch installiert.</p><table><thead><tr><th>Problem</th><th>Nächster Schritt</th></tr></thead><tbody><tr><td>Anmeldung oder Projekt nicht bestätigt</td><td>Server, Projektpfad, eigenen Zugriff, Ablaufdatum und api-Berechtigung prüfen.</td></tr><tr><td>Tokenwert verloren</td><td>Neuen persönlichen Token erstellen. Der alte Wert kann nicht erneut angezeigt werden.</td></tr><tr><td>Port 4310 ist belegt</td><td>Eine bereits laufende TicketMap über ihr Stop-Skript beenden. Andere Anwendungen nicht ungeprüft schließen.</td></tr><tr><td>Browserseite nicht erreichbar</td><td>TicketMap.cmd starten und Meldung im Startfenster lesen. Bei Firmenrichtlinien die lokale IT einbeziehen.</td></tr></tbody></table>',
  },
];

const missing = [...new Set(steps.filter(step => step.image && !existsSync(join(here, 'screenshots', step.image))).map(step => step.image))];
if (strict && missing.length) throw new Error('Missing approved screenshots: ' + missing.join(', '));

function figure(step, inline) {
  if (!step.image) return '';
  const file = join(here, 'screenshots', step.image);
  if (!existsSync(file)) return '<p class="pending-image">Redaktionsentwurf: Geprüfte Originalaufnahme wird noch ergänzt.</p>';
  if (!inline) return '![' + step.alt + '](user-guide/screenshots/' + step.image + ')\n\n*' + step.caption + '*';
  return '<figure><img src="data:image/png;base64,' + readFileSync(file).toString('base64') + '" alt="' + esc(step.alt) + '"><figcaption>' + step.caption + '</figcaption></figure>';
}

const css = [
  '*{box-sizing:border-box}',
  ':root{--guide-text:var(--foreground,#233c33);--guide-surface:var(--card,#fff);--guide-border:var(--border,#d8e1dc)}',
  'html{background:transparent;color:var(--guide-text);font-family:Segoe UI,Arial,sans-serif;line-height:1.5}body{max-width:980px;margin:0 auto;padding:0;background:transparent}',
  'header{padding:8px 0 20px}h1{font-size:34px;line-height:1.15;margin:0 0 12px}header p{margin:0;color:var(--muted-foreground,#597165)}',
  '.step{background:var(--guide-surface);margin:0 0 16px;padding:16px;border:1px solid var(--guide-border);border-radius:12px}',
  'h2{font-size:25px;line-height:1.25;margin:0 0 16px}h2 span{display:inline-flex;align-items:center;justify-content:center;background:#246248;color:#fff;border-radius:50%;min-width:35px;height:35px;margin-right:10px;font-size:21px}',
  'p{margin:12px 0}li{margin:8px 0}ol,ul{padding-left:25px}strong{font-weight:650}',
  'code{font-family:Consolas,monospace;background:var(--code-background,#f0f4f1);padding:1px 4px;border-radius:3px;font-size:.92em;overflow-wrap:anywhere}',
  '.input-target{margin:14px 0;padding:14px;border:2px solid #246248;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--code-background,#f0f4f1)}.input-target code{padding:0;background:none}',
  'figure{margin:16px 0 12px}figure img{display:block;width:100%;height:auto;border:1px solid var(--guide-border);border-radius:6px}figcaption{font-size:12px;color:var(--muted-foreground,#657b6f);margin-top:6px}',
  '.note{padding:10px 13px;background:var(--secondary,#f0f6f1);border-left:3px solid #638d70;border-radius:3px}a{color:var(--primary,#1c6548)}',
  'table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.35}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--guide-border);padding:8px 7px}th{background:var(--secondary,#f0f5f1)}td:first-child{width:31%}',
  '.pending-image{padding:20px;border:2px dashed #b86b25;background:#fff4df;color:#784212}footer{font-size:12px;color:var(--muted-foreground,#597165);padding:8px 0 20px}',
  '@page{size:A4;margin:14mm 16mm}',
  '@media print{html{background:#fff;color:#233c33;font-size:10pt;line-height:1.4}body{max-width:none;margin:0;padding:0}header{padding:0 0 12px}h1{font-size:23pt}header p{font-size:9.5pt}.step{margin:0;padding:0;border:0;border-radius:0;break-after:page}.step:last-of-type{break-after:auto}h2{font-size:16pt;margin:10px 0}h2 span{min-width:27px;height:27px;font-size:14pt}li{margin:5px 0}figure{margin:10px 0 8px;break-inside:avoid}figure img{max-height:108mm;object-fit:contain;border-radius:0}figcaption{font-size:8pt}.note{padding:8px 10px}.input-target{padding:10px;font-size:9pt}table{font-size:8.5pt}footer{font-size:8pt;padding:10px 0 0}a{color:inherit;text-decoration:underline}tr{break-inside:avoid}}',
].join('\n');

const intro = 'Diese Anleitung gilt für die portable Windows-x64-Version ab 0.2.0. Sie zeigt die Einrichtung und die Token-Eingabe in einzelnen Schritten. Die Originalaufnahmen enthalten keine privaten Kontoinformationen oder echten Tokenwerte.';
const html = [
  '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TicketMap – Schritt für Schritt mit Originalaufnahmen</title><style>' + css + '</style></head><body>',
  '<header><h1>TicketMap auf deinem Windows-PC einrichten</h1><p>' + intro + '</p></header>',
  ...steps.map((step, i) => '<section class="step" id="schritt-' + (i + 1) + '"><h2><span>' + (i + 1) + '</span>' + step.title + '</h2>' + figure(step, true) + step.body + '</section>'),
  '<footer>Die GitLab-Menüfolge wurde mit der <a href="' + source + '">offiziellen GitLab-Anleitung</a> abgeglichen. Sprache und GitLab-Version können die Bezeichnungen ändern. Die Aufnahmen zeigen Bedienorte, keinen tatsächlich erzeugten geheimen Tokenwert. Windows x64; keine macOS- oder Linux-Anleitung.</footer></body></html>',
].join('\n');
const md = [
  '# TicketMap: Schritt-für-Schritt-Anleitung mit Originalaufnahmen', '', intro, '',
  'Die [Offline-HTML-Anleitung](user-guide/guide.html) enthält die freigegebenen Bilder eingebettet. Öffne sie im Browser und wähle bei Bedarf **Drucken → Als PDF speichern**.', '',
  ...steps.flatMap((step, i) => ['## ' + (i + 1) + '. ' + step.title, '', figure(step, false), '', step.body, '']),
  '## Quellen und Bildhinweise', '',
  'Die Menüfolge wurde mit der [offiziellen GitLab-Dokumentation](' + source + ') abgeglichen. Die Aufnahmen stammen aus Browser und Anwendung. Private Profilbereiche und vorhandene Tokenlisten werden vor der Aufnahme ausgeblendet; Anwendungsdaten sind Beispiele. Kein tatsächlich erzeugter geheimer Tokenwert wird gezeigt.', '',
  'Die Bilder sind keine nachgebauten Formulare. Deine GitLab-Version kann andere Bezeichnungen zeigen. Die Anleitung ersetzt keinen Test deiner eigenen Anmeldung.', '',
].join('\n');
writeFileSync(join(here, 'guide.html'), html + '\n');
writeFileSync(join(here, '..', 'user-guide.md'), md);
console.log(JSON.stringify({ steps: steps.length, screenshotSlots: steps.filter(step => step.image).length, missingScreenshots: missing }));
