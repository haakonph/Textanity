# Textanity – GUI-skisser

Forslag til navigasjon: **app → side → visning**, med et eget **fellesområde** for delte tekstgrupper og oversettelser. Alt innhold er eksempeldata.

[Åpne PDF med alle sju skissene](textanity-skisser.pdf)

## Arbeidsområder

![Inngang til Nettbutikk, Kundeportal og Felles område](skisser/01-arbeidsomrader.png)

Alle undersider bruker tabeller: sidelister, visningsoversikt, sidens visninger, sideinformasjon, innstillinger og tekster. Startsiden beholder inngangene til apper og fellesområdet.

Teksttabellene har kolonnene **Nøkkel | Bokmål | Nynorsk | Engelsk**. Tekstene redigeres direkte i cellene.

## Appens sider

![Sider i Nettbutikk med sti, status og antall visninger](skisser/02-appens-sider.png)

## Side og visninger

![Forside med en ordnet liste over visninger](skisser/03-side-og-visninger.png)

## Visningseditor

![Visningens teksttabell med nøkkel og språk bortover](skisser/04-visningseditor.png)

## Felles område

![Felles teksttabell med nøkkel og språk bortover](skisser/05-fellesomrade.png)

## Appens tekster

![Appens tekster med nøkkel og språk i kolonner](skisser/06-appens-tekster.png)

## Visningsoversikt

![Tabell over appens gjenbrukbare visninger](skisser/07-visningsoversikt.png)


## Tekstversjoner og statuser

Velg **Godkjent**, **Utkast fra utvikling**, **Utkast fra fag** eller **Utkast fra oversettelse** over teksttabellen. Utkastene er separate. Oppslag skjer per nøkkel og språk: hvis valgt utkast ikke har en endring, vises den godkjente teksten. Et utkast arver aldri et annet utkast.

Cellene viser hvilken versjon verdien kommer fra. **Bruk godkjent** fjerner cellens utkastendring. Tom tekst kan være en eksplisitt endring. Godkjent-visningen er skrivebeskyttet.

**Godkjenn endringer** godkjenner bare endringene i den synlige tabellen og valgt utkast. Andre utkast beholdes. Apputkast gjelder den valgte appen; fellesutkast ligger i fellesområdet. Alt er eksempeldata og handlingene skjer bare i skissen.

## Klikkbar versjon

Den selvstendige, klikkbare prototypen ligger i `index.html`. `galleri.html` viser alle bildene, og `textanity-skisser.pdf` samler dem som PDF. Prototypen bruker bare eksempeldata; ingen endringer sendes til CMS-et.

[Åpne den klikkbare skissen på GitHub Pages](https://haakonph.github.io/Textanity/gui-skisser/).

Pages publiserer fra `gh-pages`. Filene er testet som en selvstendig nettside.
