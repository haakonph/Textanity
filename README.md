# Textanity

Grunnlag for et CMS med JavaScript i frontend og backend, PostgreSQL og Nx.

| Del | Valg | Plassering |
| --- | --- | --- |
| Frontend | React 19 + Vite | `apps/web` |
| Backend | Node.js 24 + Fastify | `apps/api` |
| Database | PostgreSQL 17 + pg + Knex-migreringer | `packages/database` |
| Bygg og oppgaver | Nx + npm workspaces | `nx.json` |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

Nx koordinerer bygg, lint og tester og cacher resultater lokalt. Vite bygger frontend og esbuild bygger backend. Ingen Nx Cloud-konto eller token er nødvendig. Prosjektet bruker JavaScript/ESM, uten TypeScript.

## Lokal oppstart

Krever Node.js 24, npm 11 og Docker med Compose v2.

```bash
cp .env.example .env
npm ci
npm run db:up
npm run db:migrate
npm run dev
```

Sett `EDITOR_API_TOKEN` til en tilfeldig nøkkel på minst 32 tegn i `.env` (kan genereres med `openssl rand -hex 32`). Åpne http://localhost:5173 og oppgi redaktørnøkkelen. Vite videresender `/api` til backend på http://127.0.0.1:3000. PostgreSQL eksponeres bare på lokal maskin; data lagres i et Docker-volum.

`npm run db:down` stopper databasen og beholder data. `.env` ignoreres av Git. Compose-verdiene er kun for lokal utvikling.

## Kommandoer

```bash
npm run lint               # ESLint for alle prosjekter
npm test                   # API-tester uten database
npm run test:integration   # API mot ekte, migrert PostgreSQL fra DATABASE_URL
npm run build              # dist/apps/web og dist/apps/api
npm start                  # bygget API; bruker .env hvis filen finnes
npm run db:migrate         # kjør ventende migreringer
npm run db:rollback        # reverser siste batch; kan slette data
npm run graph             # vis Nx-prosjektgraf
```

Migreringer og integrasjonstester caches aldri. `npm test` krever ingen database; integrasjonstesten feiler hvis `DATABASE_URL` eller skjemaet mangler. Bruk en separat testdatabase ved behov; testen lager egne sider og rydder dem etterpå.

## API og datamodell

- `GET /api/health/live`: prosessen svarer.
- `GET /api/health/ready`: API-et får lest app-, side-, visnings- og tekstskjemaet; ellers HTTP 503.
- `GET /api/apps/:app/pages?path=/`: hent én publisert side med ordnede visningsplasseringer.
- `GET /api/apps/:app/texts/:group?locale=en-GB`: hent effektive ICU-meldinger med språkfallback og appens overstyringer.
- `POST /api/apps/:app/texts/:group/:key/format?locale=nb`: formater én melding med variabler, uten å endre data.
- `GET /api/pages/:slug`: kompatibilitetsendepunkt, begrenset til standardappen `default`.

Datamodellen støtter flere apper, sider, gjenbrukbare visninger, delte tekstgrupper, oversettelser og overstyringer per app og språk. ICU MessageFormat følger CLDR-reglene for entall/flertall. Se [databaseskjema og API-eksempler](docs/database.md).

Migrering 002 bevarer eksisterende sider og tekstinnhold i appen `default`, med `slug` omgjort til `/path`. Nye sider er utkast som standard. `updated_at` oppdateres automatisk av PostgreSQL. Databasen får en tom standardapp, uten eksempelinnhold.

Redaktørgrensesnittet har app- og fellesinngang, tabeller for sider og visninger, og teksttabeller med nøkkel og språk bortover. Tekstene har separate utkast fra utvikling, fag og oversettelse, med tilbakefall til godkjent tekst per celle. Lagring, godkjenning og revisjonshistorikk ligger bak redaktørnøkkelen på `/api/editor`. Se [redaktørverktøy, tekstversjoner og API](docs/editor.md).

De opprinnelige leseendepunktene er fortsatt offentlige og leverer bare godkjent tekst og publiserte sider. Individuelle brukere, tilgangsroller og mediebibliotek er videre arbeid.

## GitHub Actions

CI kjører på push til `main`, pull requests og manuelt: ren installasjon fra lockfil, lint, enhetstester, migrering mot PostgreSQL-tjeneste, integrasjonstest og produksjonsbygg. Ingen secrets kreves for CI. Dependabot følger npm-pakker og GitHub Actions.

## Produksjon

Hosting er ikke valgt. Lever `dist/apps/web` som statiske filer og videresend `/api` på samme domene til Node-prosessen (`npm start`). API-et bruker workspace-pakken `@textanity/database`: behold `packages/database` og workspace-manifestene sammen med API-bygget, og installer runtime-avhengigheter med `npm ci --omit=dev` i et separat produksjonsmiljø.

Sett `DATABASE_URL` gjennom hostingens secret-håndtering, bruk separat databasebruker og TLS etter databaseleverandørens krav. Sett `HOST=0.0.0.0` når plattformen krever ekstern binding, og `PORT` etter plattformens behov. Kjør `npm run db:migrate` én gang fra et release-miljø med dev-avhengigheter installert før utrulling av API-et. Readiness sjekker databasen; liveness fungerer under databaseavbrudd. Deploy-workflow legges til når hosting er valgt.
