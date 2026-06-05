# Contributing

Thank you for your interest in contributing to this project.

This repository is an open-source project management system for third-party construction testing workflows. The project is still early-stage, so contributions that improve reliability, security, documentation, and maintainability are especially welcome.

## Good first areas

- Documentation improvements and screenshots
- Demo data that contains no private customer, contract, or staff information
- Tests for worklog import, contract parsing, item matching, and report generation
- Security improvements around authentication, uploaded files, API keys, and backups
- UI/UX improvements for review workflows and exception handling

## Development setup

The application code lives in the `src/` directory.

```powershell
cd src
npm install
npx prisma generate
npm run dev
```

Before opening a pull request, please run:

```powershell
cmd /c npm run lint
cmd /c npm run build
```

If PowerShell blocks `npm.ps1`, use `cmd /c` as shown above.

## Pull request guidelines

1. Keep pull requests focused and small when possible.
2. Explain the workflow or bug that the change addresses.
3. Do not include private contracts, real customer data, real staff data, local SQLite databases, backups, or `.env` files.
4. Do not commit real API keys or secrets.
5. Add or update documentation when behavior changes.
6. Add tests or fixtures when changing parsing, matching, or calculation logic.

## Issue guidelines

When opening an issue, please include:

- The workflow affected, such as worklog import, contract parsing, project review, staff management, reports, or model configuration.
- Steps to reproduce the problem.
- Expected behavior and actual behavior.
- Screenshots or anonymized sample data when helpful.
- Environment details, such as operating system, Node.js version, and database setup.

## Data and privacy rules

This project is intended for workflows that may involve contracts, prices, staff production values, and project records. Public contributions must use anonymized or synthetic data only.

Never upload:

- Real API keys
- `.env` files
- Local database files
- Database backups
- Customer contracts or scans
- Staff personal information
- Internal pricing data that is not meant to be public

## Maintainer focus

Current priorities are tracked in GitHub Issues. The main near-term goals are stronger open-source hygiene, safer self-hosting, better contract parsing review, automated tests, and CI.
