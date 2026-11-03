// Currencies offered in pickers. Bank of Canada publishes rates against CAD for these.
export const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'HKD', 'CNY', 'INR', 'MXN'];

// Exchanges offered when adding a listed security, by ISO 10383 MIC.
export const EXCHANGES: { mic: string; label: string; currency: string }[] = [
  { mic: 'XTSE', label: 'Toronto Stock Exchange (TSX)', currency: 'CAD' },
  { mic: 'XTSX', label: 'TSX Venture', currency: 'CAD' },
  { mic: 'NEOE', label: 'Cboe Canada', currency: 'CAD' },
  { mic: 'XNYS', label: 'NYSE', currency: 'USD' },
  { mic: 'XNAS', label: 'Nasdaq', currency: 'USD' },
  { mic: 'ARCX', label: 'NYSE Arca', currency: 'USD' },
];
