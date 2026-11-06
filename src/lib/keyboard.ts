/**
 * 단축키를 무시할 대상: 글자를 입력하는 칸.
 * 체크박스·라디오는 제외한다 — 썸네일 카드(SelectableCard)를 누르면 숨은 체크박스에 포커스가 간다
 */
export const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target.closest(
    'input:not([type=checkbox]):not([type=radio]), select, textarea, [contenteditable=true]',
  ) !== null
