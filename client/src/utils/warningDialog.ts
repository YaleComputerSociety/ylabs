/**
 * Warning dialog for surfaces that reach a student on first load.
 *
 * The dialog module is only ever needed on a failure path, so it is fetched at
 * the call site rather than bundled into the entry chunk (#3947). A surface
 * already behind a lazy route may import `utils/appDialogs` directly.
 */
export const showWarningDialog = async (text: string): Promise<void> => {
  const showAlert = await import('./appDialogs')
    .then((module) => module.showAlert)
    .catch(() => null);
  if (!showAlert) {
    window.alert(text);
    return;
  }
  await showAlert({ text, tone: 'warning' });
};
