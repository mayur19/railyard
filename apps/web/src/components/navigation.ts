export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly planned?: string;
}

/** Sections with `planned` render a "Planned" badge and a placeholder page naming the ticket. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/projects', label: 'Projects' },
  { to: '/editor', label: 'Pipeline editor' },
  { to: '/planned/secrets', label: 'Secrets', planned: 'RY-070' },
  { to: '/planned/environments', label: 'Environments', planned: 'RY-090' },
  { to: '/planned/schedules', label: 'Schedules', planned: 'RY-101' },
  { to: '/planned/runners', label: 'Runners', planned: 'RY-053' },
  { to: '/planned/artifacts', label: 'Artifacts', planned: 'RY-081' },
  { to: '/planned/metrics', label: 'Metrics', planned: 'RY-111' },
  { to: '/planned/settings', label: 'Settings', planned: 'RY-126' },
];
