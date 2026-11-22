import { AlertTriangle, CheckCircle2, Clock, MinusCircle } from 'lucide-react';
import type { ChecklistStatus } from '../types/database';

const CONFIG: Record<
  ChecklistStatus,
  { label: string; colorClass: string; Icon: typeof CheckCircle2 }
> = {
  not_started: {
    label: 'Not Started',
    colorClass: 'text-zinc-400',
    Icon: MinusCircle,
  },
  pending: {
    label: 'Pending',
    colorClass: 'text-blue-400',
    Icon: Clock,
  },
  completed: {
    label: 'Completed',
    colorClass: 'text-emerald-400',
    Icon: CheckCircle2,
  },
  requires_attention: {
    label: 'Requires Attention',
    colorClass: 'text-amber-400',
    Icon: AlertTriangle,
  },
};

export function ChecklistStatusLabel({ status }: { status: ChecklistStatus }) {
  const { label, colorClass, Icon } = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${colorClass}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
