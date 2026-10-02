import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../../testUtils/axe';
import { confirmAction, showAlert } from '../appDialogs';

vi.unmock('../appDialogs');

const waitForNoDialog = () => waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

afterEach(async () => {
  if (screen.queryByRole('alertdialog')) {
    await userEvent.keyboard('{Escape}');
  }
  await waitForNoDialog();
});

const openTrigger = () => {
  const trigger = document.createElement('button');
  trigger.textContent = 'Synthetic trigger';
  document.body.appendChild(trigger);
  trigger.focus();
  return trigger;
};

describe('confirmAction', () => {
  it('names the dialog by its title, starts a destructive confirm on Cancel, and resolves true on confirm', async () => {
    const trigger = openTrigger();
    let settled: boolean | undefined;
    act(() => {
      void confirmAction({
        title: 'Delete Synthetic Item',
        text: 'Delete the synthetic item? This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      }).then((value) => {
        settled = value;
      });
    });

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Synthetic Item' });
    expect(dialog).toHaveAccessibleDescription('Delete the synthetic item? This cannot be undone.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await expectNoAxeViolations(document.body);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(settled).toBe(true));
    await waitForNoDialog();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('starts a non-destructive confirm on the confirm button and keeps Tab inside the dialog', async () => {
    act(() => {
      void confirmAction({
        title: 'Save Changes',
        text: 'Save the synthetic changes?',
        confirmLabel: 'Save',
        tone: 'info',
      });
    });

    await screen.findByRole('alertdialog', { name: 'Save Changes' });
    const save = screen.getByRole('button', { name: 'Save' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(save).toHaveFocus());

    await userEvent.tab();
    expect(document.activeElement === cancel || document.activeElement === save).toBe(true);
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true);
  });

  it('resolves false when dismissed with Escape or Cancel', async () => {
    let settled: boolean | undefined;
    act(() => {
      void confirmAction({ title: 'First', text: 'First body', confirmLabel: 'Go' }).then(
        (value) => {
          settled = value;
        },
      );
    });
    await screen.findByRole('alertdialog', { name: 'First' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(settled).toBe(false));
    await waitForNoDialog();

    settled = undefined;
    act(() => {
      void confirmAction({ title: 'Second', text: 'Second body', confirmLabel: 'Go' }).then(
        (value) => {
          settled = value;
        },
      );
    });
    await screen.findByRole('alertdialog', { name: 'Second' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(settled).toBe(false));
  });

  it('settles a superseded confirm as cancelled when a newer dialog replaces it', async () => {
    let first: boolean | undefined;
    act(() => {
      void confirmAction({ title: 'Older', text: 'Older body', confirmLabel: 'Go' }).then(
        (value) => {
          first = value;
        },
      );
    });
    await screen.findByRole('alertdialog', { name: 'Older' });

    act(() => {
      void showAlert({ text: 'Newer synthetic notice', tone: 'error' });
    });

    await waitFor(() => expect(first).toBe(false));
    expect(await screen.findByRole('alertdialog', { name: 'Newer synthetic notice' })).toBeTruthy();
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });
});

describe('showAlert', () => {
  it('names the dialog by its message, focuses OK, and resolves when acknowledged', async () => {
    let settled = false;
    act(() => {
      void showAlert({ text: 'Synthetic load failure', tone: 'error' }).then(() => {
        settled = true;
      });
    });

    await screen.findByRole('alertdialog', { name: 'Synthetic load failure' });
    const ok = screen.getByRole('button', { name: 'OK' });
    await waitFor(() => expect(ok).toHaveFocus());
    await expectNoAxeViolations(document.body);

    await userEvent.click(ok);
    await waitFor(() => expect(settled).toBe(true));
  });

  it('closes itself after autoCloseMs', async () => {
    let settled = false;
    act(() => {
      void showAlert({ text: 'Synthetic item saved', tone: 'success', autoCloseMs: 50 }).then(
        () => {
          settled = true;
        },
      );
    });

    await screen.findByRole('alertdialog', { name: 'Synthetic item saved' });
    await waitFor(() => expect(settled).toBe(true));
    await waitForNoDialog();
  });
});
