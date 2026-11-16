/** A visually hidden live region: screen readers announce each change of its text. */
export function createStatus(): HTMLElement {
  const status = document.createElement('span');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  return status;
}
