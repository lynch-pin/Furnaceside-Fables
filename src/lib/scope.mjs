/**
 * src/lib/scope.mjs — 클라이언트에서 만든 노드에 Astro 스코프 스타일을 입힌다.
 *
 * Astro 의 <style> 은 `.rec__thumb[data-astro-cid-xxxx]` 처럼 속성 선택자로 스코프된다.
 * 서버가 그린 노드에는 이 속성이 붙어 있지만 JS 로 새로 만든 노드에는 없어서
 * 스타일이 통째로 빠진다(카드 레이아웃이 깨지고 썸네일이 원본 크기로 나온다).
 * 그래서 같은 페이지의 기존 노드에서 속성 이름을 읽어 새 노드에 그대로 찍어 준다.
 */
export function stampScope(source, ...roots) {
  const names = Array.from(source.attributes)
    .map((a) => a.name)
    .filter((n) => n.startsWith('data-astro-cid-'));
  if (!names.length) return;
  for (const root of roots) {
    const targets = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
    for (const el of targets) for (const n of names) el.setAttribute(n, '');
  }
}
