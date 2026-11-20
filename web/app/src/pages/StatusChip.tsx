import type { JobStatus } from '../api';
import { useT } from '../i18n';

export function StatusChip({ status }: { status: JobStatus }) {
  const { t } = useT();
  return <span className={`chip chip--${status}`}>{t(`status.${status}`)}</span>;
}
