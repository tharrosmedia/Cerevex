export const SETTINGS_SECTIONS = [
  { id: 'connects', label: 'Connects' },
  { id: 'approvals', label: 'Approvals & autonomy' },
  { id: 'modules', label: 'Modules & flags' },
  { id: 'store', label: 'Store' },
  { id: 'account', label: 'Account' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];
