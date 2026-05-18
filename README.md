# Lønnsutvikling

Lokal webapp for å registrere, importere og visualisere lønnsutvikling over tid.

## Kjør lokalt med Docker

```bash
docker compose up --build
```

Åpne `http://localhost:8080`.

SQLite-databasen lagres i `./data/salary.sqlite` via mount til `/data/salary.sqlite` i containeren.

## Funksjoner

- Manuell registrering av lønnsrader med `Gyldig fra`, valgfri `Gyldig til` og årslønn.
- Import av tekst på formatet fra HR-systemet med `Årslønn (heltid)`.
- Lønnsår starter som standard i mai, og kan endres i UI.
- Flere lønnsøkninger i samme lønnsår vises som egne lønnstrinn.
- Årskort viser sluttlønn og prosentendring mot forrige lønnsår.
- Flagg knyttes til lønnsår, for eksempel forfremmelse, permisjon eller sykefravær.

## Utvikling uten Docker

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
DB_PATH=./data/salary.sqlite STATIC_DIR=./dist python3 -m server.app
```

For full lokal produksjonsflyt:

```bash
npm run build
DB_PATH=./data/salary.sqlite STATIC_DIR=./dist python3 -m server.app
```
