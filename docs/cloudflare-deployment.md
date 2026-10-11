# Projekt auf Cloudflare bereitstellen

Diese Anleitung zeigt dir Schritt für Schritt, wie du ein Chromatis-Base-Projekt auf Cloudflare bereitstellst. Vorkenntnisse mit Cloudflare sind nicht erforderlich.

## 1. Projekt vorbereiten

Öffne ein Terminal und wechsle in den Ordner deines Projekts.

Installiere zuerst die benötigten Abhängigkeiten:

```bash
bun install
```

**Voraussetzung:** Bun muss auf deinem Computer installiert sein. Eine Installationsanleitung findest du unter [bun.sh](https://bun.sh/).

Öffne danach die Secrets-Verwaltung:

```bash
bun x chromatis secret
```

Dort hinterlegst du später zwei Zugangsdaten von Cloudflare:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

**Lasse das Terminal geöffnet.** So kannst du die Zugangsdaten gleich aus Cloudflare übernehmen.

## 2. Cloudflare-Konto einrichten

1. Öffne [Cloudflare](https://dash.cloudflare.com/).
2. Erstelle ein kostenloses Konto oder melde dich mit einem bestehenden Konto an.
3. Öffne im Dashboard **Account verwalten → API-Token des Kontos**.
4. Erstelle einen neuen Token.

## 3. API-Token erstellen

Verwende für den neuen Token folgende Einstellungen:

1. **Token-Name:** Name deines Projekts
2. **Berechtigungsrichtlinien:** `Edit Cloudflare Workers`
3. **Token-Ablauf:** `Kein Ablauf` (oder ein selbst gewähltes Ablaufdatum)
4. **Filterung der Client-IP-Adresse:** leer lassen

Bestätige die Einstellungen und erstelle anschließend den Token.

### Zugangsdaten ins Projekt übernehmen

Auf der folgenden Seite zeigt Cloudflare die beiden Werte an, die du für dein Projekt benötigst:

**Wichtig:** Behandle den API-Token wie ein Passwort. Speichere ihn nicht in einer Datei und gib ihn niemals an andere Personen weiter. Übertrage ihn direkt in die Secrets-Verwaltung.

| Cloudflare    | Secret im Projekt       |
| ------------- | ----------------------- |
| Konto-ID      | `CLOUDFLARE_ACCOUNT_ID` |
| Ihr API-Token | `CLOUDFLARE_API_TOKEN`  |

Übertrage die Werte direkt in das noch geöffnete Terminal:

1. Kopiere die **Konto-ID** und trage sie bei `CLOUDFLARE_ACCOUNT_ID` ein.
2. Kopiere **Ihr API-Token** und trage ihn bei `CLOUDFLARE_API_TOKEN` ein.
3. Speichere beide Werte in der Secrets-Verwaltung.
4. Klicke danach in Cloudflare auf **Done**.

Die ebenfalls angezeigten R2-Zugangsdaten brauchst du nicht.

## 4. Projekt bereitstellen

Nachdem beide Secrets gespeichert sind, kannst du das Projekt bereitstellen:

```bash
bun x chromatis deploy
```

Das Deployment-Skript übernimmt die Bereitstellung auf Cloudflare. Prüfe anschließend die Ausgabe im Terminal. Dort siehst du, ob das Deployment erfolgreich abgeschlossen wurde.

## 5. Weitere Deployments

Nach der ersten Einrichtung reicht für spätere Bereitstellungen normalerweise:

```bash
bun x chromatis deploy
```

Die Cloudflare-Zugangsdaten bleiben lokal gespeichert. Du musst sie erst wieder eintragen, wenn sie geändert wurden, abgelaufen sind oder nicht mehr verfügbar sind.
