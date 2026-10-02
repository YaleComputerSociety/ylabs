import { ThemeProvider } from '@mui/material/styles';
import { useCallback, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import AppDialog, {
  type AppDialogRequest,
  type AppDialogTone,
} from '../components/shared/AppDialog';
import theme from './muiTheme';

export type { AppDialogTone };

type ActiveDialog = {
  id: number;
  request: AppDialogRequest;
  open: boolean;
  resolve: (confirmed: boolean) => void;
};

let active: ActiveDialog | null = null;
let mounted = false;
let nextId = 0;
const listeners = new Set<() => void>();

const publish = (next: ActiveDialog | null) => {
  active = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const DialogHost = () => {
  const current = useSyncExternalStore(subscribe, () => active);

  const handleResolve = useCallback(
    (confirmed: boolean) => {
      if (!current?.open) return;
      current.resolve(confirmed);
      publish({ ...current, open: false });
    },
    [current],
  );

  const handleExited = useCallback(() => {
    if (active && !active.open) publish(null);
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <AppDialog
        request={current?.request ?? null}
        requestId={current?.id ?? 0}
        open={current?.open ?? false}
        onResolve={handleResolve}
        onExited={handleExited}
      />
    </ThemeProvider>
  );
};

const ensureHost = () => {
  if (mounted) return;
  mounted = true;
  const container = document.createElement('div');
  container.dataset.appDialogHost = '';
  document.body.appendChild(container);
  createRoot(container).render(<DialogHost />);
};

// A newer dialog replaces the one on screen, the way the previous library did, so a
// superseded confirm settles as cancelled rather than leaving its caller waiting.
const present = (request: AppDialogRequest) =>
  new Promise<boolean>((resolve) => {
    ensureHost();
    if (active?.open) active.resolve(false);
    nextId += 1;
    publish({ id: nextId, request, open: true, resolve });
  });

export interface AlertOptions {
  text: string;
  tone: AppDialogTone;
  autoCloseMs?: number;
}

export const showAlert = async ({ text, tone, autoCloseMs }: AlertOptions): Promise<void> => {
  await present({ kind: 'alert', text, tone, autoCloseMs });
};

export interface ConfirmOptions {
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
  destructive?: boolean;
}

export const confirmAction = ({
  title,
  text,
  confirmLabel,
  cancelLabel,
  tone = 'warning',
  destructive = false,
}: ConfirmOptions): Promise<boolean> =>
  present({ kind: 'confirm', title, text, confirmLabel, cancelLabel, tone, destructive });
