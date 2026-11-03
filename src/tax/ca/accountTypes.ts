// Canadian account types. Part of the Canadian tax jurisdiction plug-in; other jurisdictions
// will provide their own lists.

export type AccountTypeInfo = {
  id: string;
  label: string;
  /** Registered (tax-sheltered) accounts are excluded from the pooled ACB calculation. */
  registered: boolean;
};

export const CA_ACCOUNT_TYPES: AccountTypeInfo[] = [
  { id: 'tfsa', label: 'TFSA', registered: true },
  { id: 'rrsp', label: 'RRSP', registered: true },
  { id: 'fhsa', label: 'FHSA', registered: true },
  { id: 'resp', label: 'RESP', registered: true },
  { id: 'rrif', label: 'RRIF', registered: true },
  { id: 'lira', label: 'LIRA', registered: true },
  { id: 'non_registered', label: 'Non-registered', registered: false },
  { id: 'other', label: 'Other', registered: false },
];

export function accountTypeLabel(id: string): string {
  return CA_ACCOUNT_TYPES.find((type) => type.id === id)?.label ?? id;
}

/** The currency tax figures are calculated in. */
export const CA_TAX_CURRENCY = 'CAD';
