# Engineering Third-Party Testing Project Management System

Language: English | [中文](README.zh-CN.md)

This is an internal management system for engineering third-party testing teams. It connects daily work logs, contracts, projects, staff members, and production value reporting in one workflow.

It is not a generic project management template. The system is tailored to testing-agency operations: importing work logs, extracting contract price lists, allocating production value, reviewing exceptions, and exporting reports.

## Features

- **Work log management**: Paste WPS table text or upload Excel files. The system parses work content, projects, staff members, quantities, and units.
- **Contract management**: Upload PDF, Word, or image-based contracts. The system extracts basic contract information and price lists for confirmation and storage.
- **Project management**: Manage projects, contract links, subprojects, building-level work, project merging, and project cleanup.
- **Project review inbox**: Review duplicate project candidates, projects without expected contracts, work log exceptions, and batch allocation tasks.
- **Staff and price management**: Maintain staff records, internal guide prices, and contract price items.
- **Production value reporting**: Summarize production value by staff, project, and date, with Excel export support.
- **Model provider configuration**: Configure OpenAI-compatible providers and GLM-OCR for contract extraction and intelligent matching.
- **Local backup**: Create and download SQLite database snapshots.

## Tech Stack

- Next.js 16
- React 19
- Prisma 6
- SQLite
- Recharts
- Tesseract.js
- xlsx
- pdf-parse / pdf-to-img / mammoth / word-extractor

## Quick Start

Enter the application directory:

```powershell
cd src
```

Install dependencies:

```powershell
npm install
```

Generate the database client:

```powershell
npx prisma generate
```

Start the development server:

```powershell
npm run dev
```

If PowerShell blocks `npm.ps1`, use:

```powershell
cmd /c npm run dev
```

## Common Checks

After development, run at least:

```powershell
cmd /c npm run lint
cmd /c npm run build
```

## Environment Configuration

The example file is available at:

```text
src/.env.example
```

Common variables:

- `DATABASE_URL`: SQLite database URL. The default is `file:./dev.db`.
- `ZHIPU_API_KEY`: Optional model API key.
- `ZHIPU_API_URL`: Optional model API URL.
- `ZHIPU_MODEL`: Optional model name.
- `GLM_OCR_API_KEY`: Optional GLM-OCR API key.
- `GLM_OCR_API_URL`: Optional GLM-OCR API URL.
- `GLM_OCR_MODEL`: Optional GLM-OCR model name.

Do not push real API keys, real `.env` files, or local databases to GitHub.

## Workspace Layout

```text
.
├─ README.md                  # Language selector
├─ README.zh-CN.md            # Chinese README
├─ README.en.md               # English README
├─ docs/                      # Requirements, interaction, architecture, and API docs
├─ contracts/                 # Uploaded contract archive
├─ backups/                   # Database backup snapshots
├─ test file/                 # Sample files and experimental data
└─ src/                       # Runnable Next.js application
   ├─ README.md               # Application-level development guide
   ├─ package.json
   ├─ prisma/                 # Database schema and migrations
   ├─ config/                 # Model gateway configuration examples
   ├─ public/
   └─ src/                    # Pages, API routes, and business logic
```

## Pages

- `/`: Dashboard
- `/worklog`: Work log import, editing, and splitting
- `/contracts`: Contract upload, extraction, and price list storage
- `/reports`: Production value reports and exports
- `/master/inbox`: Project review and exception handling
- `/master/projects`: Project management
- `/master/staff`: Staff management
- `/master/prices`: Internal guide prices
- `/master/models`: Model provider configuration

## Documentation

- [Requirements](docs/requirements.md)
- [Interaction design](docs/interaction_design.md)
- [Architecture](docs/architecture.md)
- [API reference](docs/api_reference.md)
- [Application development guide](src/README.md)

Recommended reading order:

1. Start with this file to understand the system and how to run it.
2. Read `src/README.md` for application-level development details.
3. Read `docs/architecture.md` and `docs/api_reference.md`.
4. For product or UX changes, read `docs/requirements.md` and `docs/interaction_design.md`.

## Current Boundaries

- The system is designed for internal single-user use and does not include authentication.
- The default database is SQLite.
- Contract extraction and intelligent matching depend on file quality, model configuration, and input text quality.
- Local database files may contain business data and should not be committed.

## Security Notes

- Do not commit real API keys.
- Do not commit `.env`.
- Do not commit local databases, backup files, or original customer contracts unless they are explicitly approved for public sharing.
- Before committing, run a secret scan and review the list of files to be committed.
