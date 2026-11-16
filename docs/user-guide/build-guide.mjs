import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, value, size = 20, color = '#233c33', extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${esc(value)}</text>`;
const box = (x, y, w, h, fill = '#fff', stroke = '#d8e1dc', r = 10) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const badge = (x, y, n) => `<circle cx="${x}" cy="${y}" r="19" fill="#246248"/>${text(x, y + 7, String(n), 20, '#fff', 'text-anchor="middle" font-weight="700"')}`;
const wrap = (title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 340" role="img" aria-label="${title}"><title>${title}</title><rect width="880" height="340" rx="14" fill="#f1f5f2"/><g font-family="Segoe UI,Arial,sans-serif">${body}</g></svg>`;
const figures = [
  wrap('Das Windows-Paket unter Assets auswählen',
    box(28, 24, 824, 292) + text(52, 61, 'GitHub · Releases', 18, '#62766b') + text(52, 104, 'TicketMap – Portable Windows', 28) +
    text(52, 145, 'Assets', 21) + box(52, 164, 776, 52, '#e8f5ec', '#246248') + badge(81, 190, 1) +
    text(116, 198, 'TicketMap-<version>-windows-x64.zip', 22) + text(74, 252, 'SHA256SUMS', 19, '#62766b') +
    text(74, 290, 'Source code (zip)    ← nicht das startfertige Paket', 18, '#7a5550')),
  wrap('Das ganze ZIP entpacken und TicketMap.cmd starten',
    box(28, 25, 350, 289) + text(48, 62, 'Downloads', 22) + text(48, 108, 'TicketMap-<version>…zip', 19) +
    box(49, 135, 303, 52, '#e8f5ec', '#246248') + badge(76, 162, 2) + text(110, 170, 'Alle extrahieren …', 21) +
    text(412, 176, '→', 38) + box(474, 25, 378, 289) + text(496, 62, 'Entpackter Ordner', 22) +
    box(492, 83, 342, 43, '#e8f5ec', '#246248') + badge(517, 105, 3) + text(550, 112, 'TicketMap.cmd', 22) +
    text(497, 157, 'ConfigureTicketMap.cmd', 18) + text(497, 192, 'StopTicketMap.cmd', 18) +
    text(497, 232, 'app/        runtime/        licenses/', 17, '#62766b') + text(497, 274, 'Alle Dateien zusammen behalten.', 17, '#62766b')),
  wrap('GitLab-Projektadresse in Server und Projektpfad aufteilen',
    box(28, 24, 824, 78) + text(49, 57, 'Beispiel: Projekt im GitLab-Browser', 17, '#62766b') +
    text(49, 85, 'https://gitlab.example.com/example/team-project', 23) +
    box(28, 124, 824, 192, '#1d2c27', '#1d2c27') + text(49, 160, 'TicketMap einrichten', 22, '#d0f0da') +
    text(49, 200, 'GitLab-Server [https://gitlab.com]:', 18, '#fff') + text(49, 229, 'https://gitlab.example.com', 22, '#a9e5bd') +
    text(49, 267, 'Projekt (Gruppe/Projekt) []:', 18, '#fff') + text(49, 296, 'example/team-project', 22, '#a9e5bd')),
  wrap('Token mit api-Berechtigung anlegen und verborgen eingeben',
    box(28, 24, 430, 292) + text(49, 62, 'GitLab · Personal access tokens', 20) + text(49, 100, 'Name: TicketMap', 20) +
    text(49, 137, 'Ablaufdatum: selbst festlegen', 19) + box(49, 157, 386, 46, '#e8f5ec', '#246248') +
    text(67, 188, '☑ api', 23) + text(49, 240, 'Generate token', 20) + text(49, 281, 'Token einmalig kopieren.', 17, '#62766b') +
    text(478, 181, '→', 32) + box(532, 24, 320, 292, '#1d2c27', '#1d2c27') +
    text(551, 65, 'TicketMap-Startfenster', 19, '#d0f0da') + text(551, 113, 'GitLab-Token', 23, '#fff') +
    text(551, 148, '(Eingabe ist verborgen;', 17, '#fff') + text(551, 176, 'leer = abbrechen):', 17, '#fff') +
    text(551, 227, 'Einfügen → Enter', 22, '#a9e5bd') + text(551, 277, 'Kein echter Token abgebildet.', 16, '#c0cfc7')),
  wrap('TicketMap öffnet sich im Browser; Start und Stop bleiben getrennt',
    box(28, 24, 824, 292) + box(46, 41, 788, 35, '#f5f7f5') + text(62, 66, 'http://127.0.0.1:4310', 19) +
    box(47, 93, 158, 205, '#f5f7f5') + text(62, 124, 'Filter', 19) + text(62, 162, 'Ergebnisse', 17) +
    text(62, 199, '#3 Beispiel C', 15, '#62766b') + text(62, 231, '#2 Beispiel B', 15, '#62766b') +
    text(62, 263, '#1 Beispiel A', 15, '#62766b') +
    '<path d="M410 175 L565 150 M410 175 L565 250" stroke="#97afa3" stroke-width="3" fill="none"/>' +
    box(255, 128, 165, 91, '#e8f5ec', '#246248') + text(272, 157, '#1 · Open', 15) + text(272, 190, 'Beispiel A', 20) +
    box(565, 106, 198, 80) + text(583, 135, '#2 · Doing', 15) + text(583, 164, 'Beispiel B', 20) +
    box(565, 222, 198, 73) + text(583, 251, '#3 · Open', 15) + text(583, 280, 'Beispiel C', 20)),
  wrap('Bei einem manuellen Update nur den data-Ordner mitnehmen',
    box(28, 24, 330, 292) + text(49, 63, 'Bisheriger Ordner', 23) + text(49, 109, '1  StopTicketMap.cmd', 19) +
    box(49, 137, 286, 56, '#fff4da', '#c5a355') + text(68, 173, 'data/  behalten', 23) +
    text(49, 232, 'app/ und runtime/', 18, '#62766b') + text(49, 264, 'nicht mitkopieren', 18, '#62766b') +
    text(394, 174, '→', 38) + box(482, 24, 370, 292) + text(503, 63, 'Neu entpacktes Paket', 23) +
    text(503, 109, '2  data/ hineinkopieren', 19) + box(503, 137, 327, 56, '#e8f5ec', '#246248') +
    text(520, 173, '3  TicketMap.cmd', 23) + text(503, 232, 'Gleicher Browser, gleiche Adresse', 17, '#62766b') +
    text(503, 264, '→ Kartenpositionen bleiben erhalten.', 17, '#62766b')),
];

const steps = [
  { title: 'Das richtige Paket herunterladen', body: `<p>Du brauchst <strong>Windows 64-Bit</strong>, einen Browser, Internetzugang und Zugriff auf dein GitLab-Projekt. Node.js und GitLab CLI sind bereits enthalten. npm brauchst du für das Paket nicht.</p><ol><li>Öffne die <a href="https://github.com/0siris/TicketMap/releases/latest">GitHub-Releases von TicketMap</a>.</li><li>Öffne die gewünschte Version. Lade unter <strong>Assets</strong> die Datei <code>TicketMap-&lt;version&gt;-windows-x64.zip</code> herunter.</li></ol><p class="note">Wähle nicht „Source code (zip)“: Das ist der Quellcode, nicht das startfertige Windows-Paket.</p>` },
  { title: 'Entpacken und starten', body: `<ol><li>Öffne den Download-Ordner. Klicke mit der rechten Maustaste auf die ZIP-Datei und wähle <strong>Alle extrahieren</strong>.</li><li>Entpacke alle Dateien in einen Ordner, in dem du Dateien speichern darfst.</li><li>Öffne den entpackten Ordner <code>TicketMap</code> und doppelklicke <strong><code>TicketMap.cmd</code></strong>.</li></ol><p>Ein Konsolenfenster für die Einrichtung öffnet sich. Starte die Datei aus dem entpackten Ordner, nicht direkt aus der ZIP-Vorschau. Behalte die Unterordner <code>app</code>, <code>runtime</code> und <code>licenses</code> zusammen mit den Startdateien.</p>` },
  { title: 'GitLab-Server und Projekt eintragen', body: `<p>Öffne dein Projekt in GitLab. Die Projektadresse zeigt dir beide benötigten Werte. Die Abbildung verwendet ausschließlich Beispieldaten.</p><ol><li>Bei <strong>GitLab-Server</strong> gib nur die HTTPS-Serveradresse ein, z. B. <code>https://gitlab.example.com</code>. Bestätige mit <strong>Enter</strong>. Wenn dein Projekt auf GitLab.com liegt, kannst du den vorgeschlagenen Server mit Enter übernehmen.</li><li>Bei <strong>Projekt (Gruppe/Projekt)</strong> gib den Pfad ein, z. B. <code>example/team-project</code>, und drücke Enter. Untergruppen gehören dazu: <code>example/subgroup/team-project</code>.</li></ol><p class="note">Nicht die komplette Browseradresse als Projektpfad einfügen. Zusätze wie <code>/-/issues</code>, eine Ticketnummer oder <code>.git</code> gehören nicht in diese Eingabe.</p>` },
  { title: 'Anmelden – falls TicketMap nach einem Token fragt', body: `<p>Eine passende vorhandene GitLab-CLI-Anmeldung wird automatisch verwendet. Dann erscheint keine Token-Abfrage.</p><ol><li>Melde dich im Browser an <strong>deinem GitLab-Server</strong> an. Öffne dein Profilbild → <strong>Edit profile</strong> → <strong>Access → Personal access tokens</strong>. Die Bezeichnungen können je nach GitLab-Version abweichen.</li><li>Wähle bei <strong>Generate token</strong> gegebenenfalls <strong>Legacy token</strong>. Vergib einen Namen, z. B. <code>TicketMap</code>, lege ein Ablaufdatum fest und aktiviere <strong><code>api</code></strong>.</li><li>Erzeuge den Token und kopiere ihn sofort. GitLab zeigt den Wert nur einmal an.</li><li>Wechsle zum TicketMap-Startfenster, füge den Token an der Abfrage ein und drücke <strong>Enter</strong>.</li></ol><p class="note">Die Eingabe ist verdeckt. Je nach Konsole siehst du Sternchen oder keine Zeichen. Das ist normal. Eine leere Eingabe bricht die Einrichtung ab.</p><p class="small">Die <code>api</code>-Berechtigung ist weitreichend. Der Token ist nicht dein GitLab-Kontopasswort. Verwende deinen eigenen Token und gib ihn nicht in Chats, URLs oder Konfigurationsdateien weiter. Dein Konto benötigt zusätzlich Zugriff auf das Projekt. <a href="https://docs.gitlab.com/user/profile/personal_access_tokens/">Offizielle GitLab-Anleitung</a>.</p>` },
  { title: 'Im Browser arbeiten und später erneut starten', body: `<p>Nach erfolgreicher Einrichtung öffnet sich dein Standardbrowser mit <strong><a href="http://127.0.0.1:4310">http://127.0.0.1:4310</a></strong>. Die Tickets werden aus dem konfigurierten Projekt geladen. Falls sich kein Browser öffnet, rufe diese Adresse selbst auf.</p><ul><li><strong>Ergebnis links anklicken:</strong> Das Ticket wird auf der Map sichtbar und rechts geöffnet.</li><li><strong>Später starten:</strong> Erneut <code>TicketMap.cmd</code> doppelklicken. Die gespeicherten Einstellungen werden verwendet.</li><li><strong>Beenden:</strong> Erst Ticketänderungen speichern oder verwerfen, dann <code>StopTicketMap.cmd</code> starten. Nur den Browser zu schließen beendet den Server nicht.</li><li><strong>Server, Projekt oder Anmeldung ändern:</strong> <code>ConfigureTicketMap.cmd</code> starten. Vorher ungespeicherte Änderungen sichern.</li></ul><p class="note">Teile den Ordner <code>data</code> nicht mit anderen. Dort liegen deine Einstellungen und gegebenenfalls verschlüsselte Zugangsdaten. Auf einem anderen Rechner oder Windows-Konto musst du die Anmeldung neu einrichten.</p>` },
  { title: 'Manuell aktualisieren und Probleme lösen', body: `<p>Neue Anwendungsversionen werden nur gemeldet und verlinkt. TicketMap lädt und installiert sie nicht automatisch. Die Aktualisierung der Tickets aus GitLab läuft davon getrennt.</p><ol><li>Speichere oder verwirf offene Ticketänderungen und starte <code>StopTicketMap.cmd</code>.</li><li>Lade das neue Windows-ZIP aus GitHub Releases herunter und entpacke es in einen neuen Ordner.</li><li>Kopiere den bisherigen Ordner <strong><code>data</code></strong> in das neu entpackte Paket. Kopiere nicht die alten Ordner <code>app</code> oder <code>runtime</code>.</li><li>Starte dort <code>TicketMap.cmd</code>. Verwende weiterhin denselben Browser, dieselbe Adresse und dasselbe GitLab-Projekt.</li></ol><p class="small">Die Kartenpositionen liegen im Browser. Lösche dessen Website-Daten nicht, wenn du die Anordnung behalten willst.</p><table><thead><tr><th>Problem</th><th>Was du tun kannst</th></tr></thead><tbody><tr><td>Projekt oder Anmeldung nicht bestätigt</td><td>Server und Projektpfad im GitLab-Browser prüfen; Zugriff und <code>api</code>-Berechtigung des Tokens kontrollieren.</td></tr><tr><td>Token abgelaufen oder anderer Rechner</td><td>Neuen Token anlegen und über <code>ConfigureTicketMap.cmd</code> anmelden.</td></tr><tr><td>Port 4310 bereits belegt</td><td>Eine bereits laufende TicketMap über ihr Stop-Skript beenden. Andere Anwendungen nicht ungeprüft schließen.</td></tr><tr><td>Browserseite nicht erreichbar</td><td><code>TicketMap.cmd</code> starten und Meldung im Startfenster lesen. Bei Firmenrichtlinien die lokale IT einbeziehen.</td></tr></tbody></table>` },
];

figures.forEach((svg, i) => writeFileSync(join(here, `step-${i + 1}.svg`), svg + '\n'));
const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TicketMap – Bebilderte Windows-Anleitung</title><style>
*{box-sizing:border-box}:root{--guide-text:var(--foreground,#233c33);--guide-surface:var(--card,#fff);--guide-border:var(--border,#d8e1dc)}html{background:transparent;color:var(--guide-text);font-family:Segoe UI,Arial,sans-serif;line-height:1.55}body{max-width:980px;margin:0 auto;padding:0;background:transparent}header{padding:10px 14px 22px}h1{font-size:36px;line-height:1.15;margin:0 0 12px}header p{margin:0;color:var(--muted-foreground,#597165)}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}nav a{padding:5px 10px;border:1px solid #bed0c3;border-radius:6px;color:var(--primary,#245f45);text-decoration:none;font-size:14px}.step{background:var(--guide-surface);margin:0 0 16px;padding:16px;border:1px solid var(--guide-border);border-radius:12px}h2{font-size:25px;line-height:1.25;margin:0 0 18px}h2 span{display:inline-flex;align-items:center;justify-content:center;background:#246248;color:#fff;border-radius:50%;width:35px;height:35px;margin-right:10px;font-size:21px}p{margin:12px 0}li{margin:7px 0}ul,ol{padding-left:24px}code{font-family:Consolas,monospace;background:var(--code-background,#f0f4f1);padding:1px 4px;border-radius:3px;font-size:.92em;overflow-wrap:anywhere}strong{font-weight:650}figure{margin:20px 0 12px}figure svg{width:100%;height:auto;display:block}figcaption{font-size:12px;color:var(--muted-foreground,#657b6f);margin-top:6px}.note{padding:10px 13px;background:var(--secondary,#f0f6f1);border-left:3px solid #638d70;border-radius:3px}.small{font-size:13px;color:var(--muted-foreground,#52695c)}a{color:var(--primary,#1c6548)}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.4}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dce5df;padding:9px 8px}th{background:var(--secondary,#f0f5f1)}td:first-child{width:31%}footer{font-size:12px;color:var(--muted-foreground,#597165);padding:4px 14px 20px}.step,figure,table,tr{break-inside:avoid}
@page{size:A4;margin:14mm 16mm} @media print{html{background:#fff;font-size:10pt;line-height:1.45}body{max-width:none;margin:0;padding:0}header{padding:0 0 10px}h1{font-size:24pt;margin-bottom:8px}header p{font-size:10pt}nav{display:none}.step{margin:0;padding:0;border:0;border-radius:0;break-after:page}.step:last-of-type{break-after:auto}h2{font-size:17pt;margin:12px 0}h2 span{width:27px;height:27px;font-size:15pt}li{margin:5px 0}figure{margin:12px 0 8px}figcaption{font-size:8pt}.small,table{font-size:8.5pt}.note{padding:8px 10px}footer{padding:12px 0 0;font-size:8pt}a{color:inherit;text-decoration:underline}th,td{padding:6px} }
</style></head><body><header><h1>TicketMap auf deinem Windows-PC einrichten</h1><p>Portable Windows-x64-Version · herunterladen, entpacken, starten.<br>Die Bilder zeigen ausschließlich fiktive Beispiele und keine echten Zugangsdaten.</p><nav>${steps.map((s, i) => `<a href="#schritt-${i + 1}">${i + 1}. ${['Download', 'Starten', 'Projekt', 'Anmeldung', 'Arbeiten', 'Updates'][i]}</a>`).join('')}</nav></header>${steps.map((s, i) => `<section class="step" id="schritt-${i + 1}"><h2><span>${i + 1}</span>${s.title}</h2><figure>${figures[i]}<figcaption>Beispielabbildung ${i + 1} · schematische Darstellung; Bezeichnungen können je nach Windows- oder GitLab-Version abweichen.</figcaption></figure>${s.body}</section>`).join('')}<footer>TicketMap · Anleitung für neue Nutzer · Gilt für die portable Windows-x64-Version ab 0.2.0. Keine macOS- oder Linux-Anleitung.</footer></body></html>`;
writeFileSync(join(here, 'guide.html'), html + '\n');

const markdown = `# TicketMap: bebilderter Userguide für Windows

Diese Anleitung ist für neue Nutzer der portablen Windows-x64-Version ab 0.2.0. Die Bilder sind schematische Beispiele
mit fiktiven Daten. Du brauchst Windows 64-Bit, einen Browser, Internetzugang und Zugriff auf dein GitLab-Projekt.
Node.js und GitLab CLI sind bereits enthalten. npm brauchst du für das Paket nicht.

Die [HTML-Anleitung](user-guide/guide.html) enthält alle Bilder eingebettet und kann lokal im Browser geöffnet und
über **Drucken → Als PDF speichern** ausgegeben werden.

${steps.map((s, i) => `## ${i + 1}. ${s.title}\n\n![Beispielabbildung ${i + 1}: ${s.title}](user-guide/step-${i + 1}.svg)\n\n${s.body.replaceAll('<p class="note">', '<p>').replaceAll('<p class="small">', '<p>')}\n`).join('\n')}

## Quellen und Grenzen

Die Token-Schritte wurden mit der [offiziellen GitLab-Dokumentation](https://docs.gitlab.com/user/profile/personal_access_tokens/)
abgeglichen. Die Einrichtung und Startdateien entsprechen dem veröffentlichten TicketMap-Paket 0.2.0.
Die Bilder sind keine Aufnahmen einer echten Anmeldung. Die Anleitung ersetzt keinen Test auf deinem eigenen Rechner.
`;
writeFileSync(join(here, '..', 'user-guide.md'), markdown);
