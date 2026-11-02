# Security Policy

Investment Tracker stores personal financial data, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately using GitHub's **"Report a vulnerability"** button on the repository's **Security** tab (private vulnerability reporting). Include:

- What the issue is and what an attacker could do with it.
- Steps to reproduce, or a proof of concept.
- Affected versions or commits, if known.

You should get an acknowledgement within a week. Please give us reasonable time to fix the issue before disclosing it publicly.

## Supported versions

Until version 1.0, only the latest release (or `main`) receives security fixes.

## Security model

Useful context for reporters and contributors:

- **No server.** All data is stored locally in the user's browser (SQLite). The project runs no backend that holds user data.
- **Network access** is limited to market data and exchange-rate providers the user configures, using API keys the user supplies.
- **Backups** are files the user saves themselves. They can be encrypted with a passphrase; API keys are only included in encrypted backups.
- In scope: anything that could leak user data off the device, corrupt or silently alter financial records, expose API keys, or weaken backup encryption.
- Out of scope: attacks that require an already-compromised device or browser.
