// Shared job-status vocabulary for the pro-services flow. The status strings
// mirror the backend's HelpRequest.Status lifecycle exactly — the customer
// (MyJobs) and technician (TechJobs) screens must stay in lock-step with the
// owner console, so this is the single place the colors/order live.

export const JOB_STEPS = ['new', 'scheduled', 'on_the_way', 'in_progress', 'completed'] as const;

export const JOB_STATUS_COLOR: Record<string, string> = {
  new: '#0EA5E9',
  scheduled: '#8B5CF6',
  on_the_way: '#F59E0B',
  in_progress: '#F59E0B',
  completed: '#10B981',
  cancelled: '#9CA3AF',
};

export const JOB_STATUS_FALLBACK_COLOR = '#9CA3AF';

export const jobStatusColor = (status?: string | null): string =>
  (status && JOB_STATUS_COLOR[status]) || JOB_STATUS_FALLBACK_COLOR;
