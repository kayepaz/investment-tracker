# Contributing

Thanks for your interest in Investment Tracker. This guide covers how to propose changes and what reviewers look for.

## Before you start

- Read [VISION.md](VISION.md) and [docs/decisions.md](docs/decisions.md). Changes that conflict with a recorded decision need a discussion first.
- For anything larger than a small fix, **open an issue** describing the problem and your proposed approach before writing code. The BDFL (Kaye Pasenau) has the final say on direction.

## Setting up

Requirements: Node.js 22 or later.

```sh
git clone https://github.com/kayepaz/investment-tracker.git
cd investment-tracker
npm install
npm run dev
```

## Making a change

1. Create a branch from `main`.
2. Keep each pull request focused on one change.
3. Add or update tests for any logic you change. Money, tax and rule-evaluation code must have tests.
4. Run the checks locally:

   ```sh
   npm run typecheck
   npm test
   npm run build
   npm run e2e   # browser tests; first time: npx playwright install chromium
   ```

5. Open a pull request that explains **what** changed and **why**. Link the issue it addresses.

## Rules that are not up for debate in a PR

These come from the project's core principles. Changing them needs an issue and BDFL approval first.

- **No backend and no telemetry.** Don't add network calls except to user-configured market data providers.
- **No floating-point money.** Monetary amounts are never stored or calculated as JavaScript `number`.
- **Schema changes go through migrations.** There are two databases (user data and market cache), each with its own migrations in `src/db/migrations/`. Never edit a released migration; add a new one. See [docs/data-model.md](docs/data-model.md).
- **The market cache never references user data.** Anything that can't be re-downloaded belongs in the user database.
- **User data never leaves the device** without an explicit user action (such as saving a backup).

## Plug-ins

Market data providers, brokerage importers and tax jurisdictions are designed as plug-ins. When adding one:

- Keep it self-contained in its own folder.
- Document its limits (API call quotas, history depth, supported exchanges or account types).
- Include tests using sample data, never real account data. Redact any example files.

## Commit messages

Use a short summary line in the imperative ("Add ACB pooling for non-registered accounts"), followed by details if needed.

## Licensing of contributions

By contributing, you agree that your contributions are licensed under the project's license, the GNU Affero General Public License v3.0.

## Conduct

Everyone participating is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
