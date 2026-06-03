# Ziggo Next voor Homey

Bedien je **Ziggo Next** mediabox (en **Ziggo Next Mini**) vanuit Homey. Deze app is
een TypeScript-port naar de Homey Apps SDK v3 van de Home Assistant-integratie
[Sholofly/lghorizon](https://github.com/Sholofly/lghorizon) en de bijbehorende
`lghorizon` Python-library (Liberty Global "Horizon"-platform).

## Functionaliteit

- Aan/uit (standby), play/pause/stop
- Zappen (zender omhoog/omlaag, zender op naam of nummer)
- Afstandsbediening-toetsen (alle `MEDIA_KEYS`, via flow)
- Opnames afspelen, opnemen, terug-/vooruitspoelen, reclame overslaan
- Bericht tonen op de TV
- Live "nu te zien"-status via MQTT (zender, titel, bron, now-playing afbeelding)
- **EPG-flowkaart** "Haal huidig programma op [zender]" — geeft titel, beschrijving,
  zender en begin-/eindtijd terug als flow-tokens
- **Opnames-sensor** (apart apparaat per account): opnameruimte-gebruik (%) en aantal opnames
- Flow-kaarten: triggers (aan/uit, zender gewijzigd, pauze/hervat, nu-te-zien),
  condities (staat aan / speelt af / huidige zender) en bovenstaande acties
- **Dashboard-widget "Ziggo herverbinden"** — knop die de cloud/MQTT-verbinding
  ververst en de boxen opnieuw bindt, met een **diagnostisch overzicht** per box
  (verbonden / box_not_found / login mislukt) plus de boxen die Ziggo teruggeeft.
  Werkt vanaf het dashboard, óók als de apparaat-tegels onbereikbaar zijn.
- **Herverbinden** ook als tegel-knop én als flow-actie ("Herverbind met Ziggo")
- **Zelfherstellende login**: een verlopen refresh-token (bijv. na een stroomstoring
  van de box) wordt automatisch gewist en vervangen door een verse
  gebruikersnaam/wachtwoord-login

## Architectuur

```
app.ts                  AccountManager: één gedeelde LGHorizonApi + MQTT per Ziggo-account,
                        reference-counted over meerdere boxen.
lib/                    Getrouwe TS-port van de lghorizon Python-library:
  auth.ts               login (gebruikersnaam/wachtwoord), token-refresh, cookie-sessie
  api.ts                service-config, channels, customer, entitlements, recordings, EPG, replay
  mqtt-client.ts        MQTT over websockets (npm `mqtt`), reconnect + token-refresh
  box.ts                set-top-box commando's (CPE.KeyEvent / CPE.pushToTV / CPE.getUiStatus)
  state-processor.ts    inkomende status/uiStatus → LGHorizonDeviceState
  models.ts             channels, sources, recordings, EPG, device-state, ...
drivers/mediabox/       Homey driver + device (capability-mapping, flow, pairing)
drivers/recordings/     Account-niveau sensor: opnameruimte (%) en aantal opnames
widgets/reconnect/      Dashboard-widget: roept app.reconnectAllAccounts() aan en toont
                        het per-box rapport (widget.compose.json + api.js + public/index.html)
```

## Herverbinden (dashboard-widget)

Na een netwerkwijziging of stroomstoring kan de gedeelde cloud/MQTT-verbinding
wegvallen, waardoor de app de boxen niet meer ziet. De **"Ziggo herverbinden"**-
widget lost dat op:

1. Voeg op je **Dashboard** de widget **"Ziggo herverbinden"** toe.
2. Eén tik → de app verbreekt de gedeelde verbinding, logt vers in en **bindt alle
   boxen opnieuw** (`app.reconnectAllAccounts()`).
3. De widget toont per box de status en welke boxen Ziggo teruggeeft, zodat een
   verlopen sessie of een ID-mismatch direct zichtbaar is.

De herverbind zit ook op de mediabox-tegel (knop) en als flow-actie, zodat je 'm
kunt automatiseren (bijv. dagelijks of na een Homey-herstart).

## Ontwikkelen

```sh
npm install
npm run lint           # tsc --noEmit
npx homey app build    # compose + compileren naar .homeybuild
npx homey app validate -l publish
npx homey app run      # op een gekoppelde Homey Pro
```

> Bij de eerste build moet er een `app.json` bestaan; deze wordt door HomeyCompose
> volledig gegenereerd uit `.homeycompose/` + driver-/flow-bestanden.

## Koppelen

Voeg het apparaat **Mediabox** toe en log in met je **Ziggo-account**
(e-mail/gebruikersnaam + wachtwoord). De app haalt automatisch de boxen op je
account op.

## Credits

Gebaseerd op het werk van **@Sholofly** en bijdragers aan `lghorizon`.
