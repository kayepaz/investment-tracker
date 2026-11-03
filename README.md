# Investment Tracker

A private, local-first app for tracking your investments against the plan you made for them.

You group your money into **buckets**, attach **strategies** made of **goals** ("stop loss at 7% below purchase price", "stay above the 200-day moving average", "I believe in this company long term"), and set portfolio **rules** ("no single holding over 20%"). The app watches your holdings and tells you when something drifts from your plan, and prompts you to revisit the reasons you invested in the first place.

> **Status:** early development. Nothing here is ready to hold real financial data yet.

## Principles

- **Your data stays with you.** Everything lives in a SQLite database on your own device. There is no server, no account and no cloud sync. You back it up yourself.
- **One codebase, every device.** A Progressive Web App (PWA) that runs in any modern browser and installs on iOS, Android and desktop.
- **Plans, not predictions.** The app checks your holdings against goals *you* wrote. It does not give investment advice.
- **Canada first, built to grow.** Canadian tax rules (ACB, TFSA/RRSP contribution room) come first, behind a plug-in model so other countries can be added.

## Key concepts

| Concept | What it is |
| --- | --- |
| Account | A real brokerage account (e.g. "Questrade TFSA"). Holds the transaction history. |
| Bucket | A grouping of holdings from one or more accounts. Buckets can nest. |
| Strategy | A versioned set of goals applied to a bucket. |
| Goal | A measurable condition (auto-checked) or a written thesis (reviewed periodically). |
| Rule | A limit across the portfolio or a bucket, such as concentration or cash floor. |

See [docs/decisions.md](docs/decisions.md) for the full set of product decisions, and [VISION.md](VISION.md) for where the project is headed.

## Try it

The latest version from `main` is published at **<https://kayepaz.github.io/investment-tracker/>**. Your data never leaves your device; the site only serves the app's files.

## Development

Requirements: Node.js 22 or later.

```sh
npm install
npm run dev        # start the dev server
npm test           # run tests
npm run typecheck  # TypeScript checks
npm run build      # production build
npm run e2e        # browser tests against the build (first: npx playwright install chromium)
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first. To report a security issue, see [SECURITY.md](SECURITY.md).

## Governance

The project is led by **Kaye Pasenau** as BDFL (benevolent dictator for life), who has the final say on direction and on what is merged.

## License

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). If you run a modified version of this app for others, including as a hosted web app, you must make your source code available to them under the same license. See [LICENSE](LICENSE).

## Disclaimer

This software is not financial, investment or tax advice. Calculations such as cost basis, capital gains and contribution room are estimates to help you keep records; confirm anything that matters with your brokerage, the CRA or a qualified professional.
