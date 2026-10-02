import { afterEach, describe, expect, it, vi } from 'vitest';

import { showWarningDialog } from '../warningDialog';

const { showAlert, dialogChunk } = vi.hoisted(() => ({
  showAlert: vi.fn(),
  dialogChunk: { fails: false },
}));

vi.mock('../appDialogs', () => ({
  get showAlert() {
    if (dialogChunk.fails) throw new Error('synthetic chunk load failure');
    return showAlert;
  },
}));

afterEach(() => {
  dialogChunk.fails = false;
  vi.restoreAllMocks();
  showAlert.mockReset();
});

describe('showWarningDialog', () => {
  it('shows the warning through the shared dialog', async () => {
    await showWarningDialog('Synthetic save failure');

    expect(showAlert).toHaveBeenCalledWith({ text: 'Synthetic save failure', tone: 'warning' });
  });

  it('still warns through the browser alert when the dialog chunk fails to load', async () => {
    dialogChunk.fails = true;
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    await expect(showWarningDialog('Synthetic save failure')).resolves.toBeUndefined();

    expect(alert).toHaveBeenCalledWith('Synthetic save failure');
    expect(showAlert).not.toHaveBeenCalled();
  });
});
