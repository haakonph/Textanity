# Redaktørverktøy og tekstversjoner

Frontend er redaktørverktøyet. Startsiden har innganger til hver app og til fellesområdet. Undersidene bruker tabeller: sider, visninger, plasseringer, sideinformasjon, tekster og historikk. Teksttabellen har én nøkkel per rad og ett språk per kolonne.

## Oppstart og tilgang

Kjør migreringene før API-et startes. Sett `EDITOR_API_TOKEN` til en tilfeldig hemmelighet på minst 32 tegn i `.env` eller hostingens hemmelighetshåndtering. `openssl rand -hex 32` kan generere en nøkkel. Åpne frontend og oppgi denne redaktørnøkkelen. Den sendes som Bearer-header og beholdes bare i minnet til nettleserfanen; en sideoppdatering krever ny innlogging. Ikke legg nøkkelen i kildekode, URL-er eller Vite-variabler.

Uten nøkkel er hele `/api/editor` deaktivert med HTTP 503. Manglende eller feil nøkkel gir 401, også for lesing av utkast og historikk. Svarene har `Cache-Control: no-store`. De opprinnelige offentlige leseendepunktene viser fortsatt bare godkjente tekster og publiserte sider. Bruk HTTPS ved ekstern hosting.

Dette er en felles redaktørnøkkel med tilgang til både redigering og godkjenning. Statusene er arbeidsversjoner, ikke tilgangsroller. Individuelle brukere og rollebaserte rettigheter er ikke innført.

## Første innhold

Databasen får ingen eksempeltekster. Bruk **Ny tekstgruppe** og **Ny tekst** i fellesområdet. Velg et utkast, fyll ut språkcellene, lagre og godkjenn. Under en app kan gruppen kobles til med **Koble tekstgruppe**. Appens egne utkast og godkjente overstyringer gjelder bare den appen.

Opprett sider og gjenbrukbare visninger fra de respektive tabellene. Legg visninger til en side, og koble eksisterende tekstnøkler til visningen. Koblingen lagres i `views.config.textKeys`; eksisterende konfigurasjon beholdes. Nøkler som allerede er referert i visnings- eller plasseringskonfigurasjonen, blir også funnet. Når samme visning forekommer flere ganger på en side, henter redaktøren tekstnøklene fra den valgte plasseringen.

## Versjoner

| API-verdi | Visning |
| --- | --- |
| `approved` | Godkjent |
| `development` | Utkast fra utvikling |
| `subject` | Utkast fra fag |
| `translation` | Utkast fra oversettelse |

Utkastene er separate. For hver nøkkel og hvert ønsket språk brukes den valgte arbeidsversjonens endring i det aktive arbeidsområdet. Hvis den mangler, vises gjeldende godkjent tekst. Et utkast arver aldri et annet utkast. Fellesutkast ligger i fellesområdet; apputkast ligger i den valgte appen. Godkjente fellesendringer blir tilgjengelige i tilknyttede apper uten å erstatte appenes godkjente overstyringer.

Godkjente tekster beholder språkfallbacken fra det offentlige API-et: for eksempel `en-GB → en → appens standardspråk`. API-et oppgir både faktisk språk og `sourceStatus`, slik at språkfallback og tilbakefall til godkjent tekst kan skilles. Et utkast på bokmål brukes ikke som erstatning for en manglende nynorsk utkastcelle.

Tom streng er en eksplisitt endring. `null` i en lagreoperasjon fjerner utkastet og bruker godkjent tekst igjen. Lagring av samme melding som gjeldende godkjente tekst fjerner også den overflødige utkastendringen. Godkjent-visningen er skrivebeskyttet; oppdatering skjer med godkjenning av et lagret utkast.

## Lagring, godkjenning og historikk

`text_translations` og `app_text_overrides` inneholder fortsatt godkjent innhold. Migrering 003 legger til `text_drafts` for gjeldende utkast og `text_revisions` for revisjonshistorikk. Eksisterende godkjente oversettelser og appoverstyringer bevares og registreres som utgangspunkt i historikken.

Lagring, tilbakestilling og godkjenning føres i historikken. **Historikk** på nøkkelraden viser de siste 100 revisjonene i arbeidsområdet. En godkjenning kopierer bare de innsendte cellene fra valgt utkast til godkjent innhold og fjerner disse utkastcellene. Andre tekster, språk, apper og arbeidsversjoner beholdes. I grensesnittet godkjennes bare endringene i den åpne tabellen.

En batch er én databasetransaksjon. Tekstene låses i stabil rekkefølge. Hver celle sendes med utkastets `revision` og godkjent tekst sin `approvedRevision`. Utdaterte verdier gir HTTP 409 i stedet for å overskrive nyere tekst. Hvis godkjent tekst har endret seg siden et utkast ble lagret, må utkastet kontrolleres og lagres igjen før godkjenning. ICU-syntaks og variabelnavn på tvers av oversettelser valideres før noen del av batchen skrives. Endring av parameterkontrakt for en allerede godkjent nøkkel krever en ny nøkkel.

Migreringen avviser rollback hvis utkast eller ny revisjonshistorikk ellers ville bli slettet. Endringer utenom redaktør-API-et blir ikke automatisk registrert i revisjonshistorikken.

## API

Alle endepunktene under krever `Authorization: Bearer <redaktørnøkkel>`.

| Metode og sti under `/api/editor` | Funksjon |
| --- | --- |
| `GET /catalog` | Apper og tekstgrupper |
| `GET /apps/:app` | Appens sider, visninger og plasseringer, inkludert sideutkast |
| `GET /texts?app=shop&status=subject&locales=nb,en-GB` | Teksttabell; utelat `app` for fellesområdet |
| `GET /texts?app=shop&view=<uuid>&page=<uuid>&placement=<uuid>&status=development` | Nøkler i en visning og valgfri plassering |
| `POST /texts/batch` | Lagre eller tilbakestill utkastceller |
| `POST /texts/approve` | Godkjenn innsendte utkastceller atomisk |
| `GET /texts/:id/history?app=shop` | Revisjoner i arbeidsområdet |
| `POST /apps`, `POST /groups`, `POST /keys` | Opprett app, tekstgruppe eller tekstnøkkel |
| `POST /apps/:app/groups` | Koble en tekstgruppe til en app |
| `POST /apps/:app/pages`, `PUT /apps/:app/pages/:id` | Opprett eller oppdater en side |
| `POST /apps/:app/views` | Opprett en gjenbrukbar visning |
| `POST /apps/:app/pages/:id/views` | Legg en visning til en side |
| `PUT /apps/:app/views/:id/texts` | Angi visningens eksplisitte tekstnøkler |

Lagreforespørsel, med versjonsverdier fra siste tabelloppslag:

```json
{
  "app": "shop",
  "status": "subject",
  "changes": [{
    "textId": "00000000-0000-4000-8000-000000000001",
    "locale": "nb",
    "message": "Ny tekst",
    "revision": null,
    "approvedRevision": "<64 tegn fra tabelloppslaget>"
  }]
}
```

For godkjenning brukes samme konvolutt, men `message` utelates og `revision` må peke på et lagret utkast. Hver batch kan inneholde opptil 1000 celler; Fastifys vanlige kroppsgrense gjelder også. Språkkoder normaliseres til kanonisk BCP 47 før lagring, og duplikater etter normalisering avvises.
