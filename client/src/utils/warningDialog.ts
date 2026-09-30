/**
 * Warning dialog for surfaces that reach a student on first load.
 *
 * The dialog library is about 12 KB gzip and only ever runs on a failure path,
 * so it is fetched at the call site rather than bundled into the entry chunk
 * (#3947). A surface already behind a lazy route may import it directly.
 */
export const showWarningDialog = async (text: string): Promise<void> => {
  const swal = await import('sweetalert').then((module) => module.default).catch(() => null);
  if (!swal) {
    window.alert(text);
    return;
  }
  await swal({ text, icon: 'warning' });
};
