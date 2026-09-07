export function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = '0';
  element.style.height = `${element.scrollHeight}px`;
}
