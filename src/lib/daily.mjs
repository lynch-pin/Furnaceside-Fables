/**
 * src/lib/daily.mjs — 날짜 기반 결정적 추천 뽑기.
 *
 * 정적 사이트라서 서버에서 매일 새로 만들 수 없다. 대신 "날짜 문자열"만 있으면
 * 언제 어디서 계산해도 같은 결과가 나오는 순수 함수를 두고,
 *   - 빌드 시: 빌드 날짜 기준으로 미리 렌더 (JS 없이도 보이게)
 *   - 브라우저: 오늘(KST) 날짜로 다시 계산해 교체
 * 하는 식으로 매일 바뀌게 한다. 이 파일은 브라우저에도 번들되므로 node API 를 쓰지 않는다.
 */

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKst(now = new Date()) {
  // 'sv-SE' 로케일이 YYYY-MM-DD 형식을 준다
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** FNV-1a 32bit 해시 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 난수 생성기 (seed → 0~1) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 날짜를 시드로 배열에서 n개를 중복 없이 고른다. 같은 날짜면 항상 같은 결과.
 * @param {any[]} pool
 * @param {number} n
 * @param {string} dateStr YYYY-MM-DD
 */
export function pickDaily(pool, n, dateStr) {
  const items = [...pool];
  const next = rng(hash32(`furnaceside:${dateStr}`));
  const out = [];
  for (let i = 0; i < n && items.length; i++) {
    out.push(items.splice(Math.floor(next() * items.length), 1)[0]);
  }
  return out;
}
