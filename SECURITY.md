# Security Policy

## Supported versions

This project is currently early-stage. Security fixes are handled on the default branch until stable release branches are created.

## Reporting a vulnerability

If you find a security issue, please do not publish exploit details in a public issue before the maintainer has had a chance to review it.

Preferred reporting options:

1. Open a GitHub security advisory if available for this repository.
2. If advisories are not available, open a minimal public issue that says a security report is available, without including sensitive details.

Please include:

- A short description of the issue.
- Affected workflow or route.
- Steps to reproduce, if safe to share privately.
- Potential impact.
- Suggested mitigation, if known.

## Security-sensitive areas

The following areas should be treated carefully:

- Contract file upload and parsing
- PDF, Word, image, and Excel processing
- OpenAI-compatible model configuration
- API keys and `.env` files
- SQLite database files and backups
- Report exports
- Any future authentication or role-based access control

## Secrets and private data

Do not commit or upload:

- Real API keys
- `.env` files
- Local SQLite database files
- Backup files
- Customer contracts
- Staff personal information
- Internal pricing data that is not explicitly safe to publish

## Current limitations

The system is currently documented as an internal single-user deployment and does not yet include full authentication or role-based access control. Production or shared deployments should add authentication, route protection, secret management, and backup handling before use.
