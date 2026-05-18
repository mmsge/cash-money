# Lønnsutvikling

Lokal webapp for å registrere, importere og visualisere lønnsutvikling over tid.

## Kjør fra GitHub Container Registry

Kjør siste publiserte image med Podman:

```bash
mkdir -p data
podman run --rm -p 8080:8080 -v ./data:/data ghcr.io/mmsge/cash-money:latest
```

Åpne `http://localhost:8080`.

Dette oppretter eller gjenbruker `./data/salary.sqlite` på maskinen din. Selve container-imaget er rent og inneholder ikke lokale SQLite-data, men dataene dine huskes mellom kjøringer så lenge du beholder `./data`.

Docker fungerer også med samme image:

```bash
mkdir -p data
docker run --rm -p 8080:8080 -v ./data:/data ghcr.io/mmsge/cash-money:latest
```

Hvis pakken i GitHub Container Registry er privat, må du først logge inn med `podman login ghcr.io` eller `docker login ghcr.io`. Offentlige pakker kan hentes uten innlogging.

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
