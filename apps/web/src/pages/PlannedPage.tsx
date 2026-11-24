import { useParams } from 'react-router-dom';
import { NAV_ITEMS } from '../components/navigation';

export function PlannedPage() {
  const { section } = useParams();
  const item = NAV_ITEMS.find((nav) => nav.to === `/planned/${section}`);
  return (
    <section>
      <h1>
        {item?.label ?? 'Planned'} <span className="badge-planned">Planned</span>
      </h1>
      <p className="muted">
        This area is on the roadmap but not implemented yet. Track progress in backlog ticket{' '}
        <code>{item?.planned ?? 'n/a'}</code> (see docs/planning/backlog.md).
      </p>
    </section>
  );
}
