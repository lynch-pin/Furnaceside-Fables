/**
 * src/lib/story-parser.mjs
 * 아크나이츠 스토리 스크립트(.txt / .asc) 파서.
 *
 * 스크립트는 한 줄에 하나의 명령 또는 텍스트가 오는 단순한 형식이다.
 *
 *   [HEADER(key="title_test", is_skippable=true)] 제목            → header
 *   [name="세버린"]  대사 텍스트                                    → dialogue
 *   [name="쉐이", avatarId="avg_npc_2129_2", isAvatarRight="FALSE"] 대사 → dialogue (attrs 보존)
 *   [multiline(name="니엔")]이어지는 대사                            → dialogue (continued: true)
 *   나레이션 텍스트 (태그 없는 줄)                                   → narration
 *   ;나레이션 (일부 포맷)                                             → narration
 *   [Decision(options="A;B;C", values="1;2;3")]                      → decision
 *   [Predicate(references="1;2")]                                     → predicate (선택지 분기 표시)
 *   [Subtitle(text="…")] / [Sticker(text="…")]                        → subtitle / sticker
 *   [animtext(...)]<p=2>망일 이틀 전</>                                → caption
 *   [Background(image="bg_xxx")] / [Image(image="avg_9_2")]           → scene / image
 *   [Character(name="char_130_doberm_ex", name2="…")] / [charslot(...)] → (출연 캐릭터 추출용, 기본 출력 제외)
 *   그 외 연출 태그 ([Blocker], [playMusic], [CameraShake] …)         → keepDirectives 옵션일 때만 directive
 *
 * 출력: { type, speaker?, text, ... }[]
 *   type: 'dialogue' | 'narration' | 'decision' | 'predicate' | 'header' | 'subtitle' | 'sticker'
 *       | 'caption' | 'scene' | 'image' | 'tutorial' | 'directive'
 *   branch?: string[]  — 선택지 분기 안에 있는 줄이면 해당 선택지 value 목록
 */

// ---------------------------------------------------------------------------
// 태그 토크나이저
// ---------------------------------------------------------------------------

/**
 * `key=value, key2="quoted, value"` 형태의 속성 문자열을 객체로.
 * 따옴표 안의 콤마/세미콜론은 보존한다. 값의 따옴표는 제거.
 */
export function parseAttrs(src) {
  const attrs = {};
  if (!src) return attrs;
  let i = 0;
  const n = src.length;
  while (i < n) {
    // key
    while (i < n && /[\s,]/.test(src[i])) i++;
    let key = '';
    while (i < n && src[i] !== '=' && src[i] !== ',') key += src[i++];
    key = key.trim();
    if (!key) break;
    if (src[i] !== '=') {
      // 값 없는 플래그
      attrs[key] = true;
      continue;
    }
    i++; // '='
    while (i < n && src[i] === ' ') i++;
    let value = '';
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      while (i < n && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < n) {
          // \n → 줄바꿈, 그 외 이스케이프는 다음 문자 그대로
          const nx = src[i + 1];
          value += nx === 'n' ? '\n' : nx;
          i += 2;
          continue;
        }
        value += src[i++];
      }
      i++; // 닫는 따옴표
    } else {
      while (i < n && src[i] !== ',') value += src[i++];
      value = value.trim();
      if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
      else if (/^(true|false)$/i.test(value)) value = value.toLowerCase() === 'true';
    }
    attrs[key] = value;
  }
  return attrs;
}

/**
 * 한 줄을 `[tag(attrs)] rest` 로 분해. 태그가 없으면 null.
 * `[name="X"]` 처럼 태그명 없이 속성만 있는 형태는 tag='name' 으로 정규화.
 */
export function splitTag(line) {
  if (line[0] !== '[') return null;
  // 대괄호 짝 찾기 (속성값 안의 ']' 는 따옴표 안에서만 허용)
  let depth = 0;
  let inQuote = null;
  let end = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '\\') i++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const inner = line.slice(1, end).trim();
  const rest = line.slice(end + 1);

  // [Tag(attrs)] 또는 [Tag]
  const m = inner.match(/^([A-Za-z_][\w]*)\s*(?:\((.*)\))?$/s);
  if (m) {
    return { tag: m[1].toLowerCase(), attrs: parseAttrs(m[2] ?? ''), rest };
  }
  // [name="X", avatarId="…"] : 속성 나열형
  if (/^name\s*=/.test(inner)) {
    return { tag: 'name', attrs: parseAttrs(inner), rest };
  }
  return { tag: inner.toLowerCase(), attrs: {}, rest };
}

// ---------------------------------------------------------------------------
// 인게임 리치 텍스트
// ---------------------------------------------------------------------------

/** `<@ba.kw>…</>`, `<i>…</i>`, `<color=#fff>…</color>`, `<p=2>` 등 태그를 제거한 평문 */
export function stripRichText(text) {
  return String(text ?? '')
    .replace(/<\/?[@a-zA-Z][^<>]*>/g, '')
    .replace(/<\/>/g, '')
    .replace(/\\n/g, '\n');
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 리치 텍스트 → 안전한 HTML.
 *   <@ba.kw>…</>   → <span class="rt rt-ba-kw">…</span>
 *   <i>…</i>       → <em>
 *   <b>…</b>       → <strong>
 *   <color=#hex>…</color> → <span style="color:#hex">
 *   그 외 태그(<p=2>, <size=..>)는 제거, 줄바꿈은 <br>
 */
export function richTextToHtml(text) {
  const src = String(text ?? '').replace(/\\n/g, '\n');
  const re = /<(\/?)([@a-zA-Z][^<>]*)?>/g;
  let out = '';
  let last = 0;
  const stack = [];
  let m;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === '/';
    const body = (m[2] ?? '').trim();
    if (closing) {
      const open = stack.pop();
      out += open ?? '';
      continue;
    }
    if (body.startsWith('@')) {
      const cls = body.slice(1).replace(/[^\w.-]/g, '').replace(/\./g, '-');
      out += `<span class="rt rt-${cls}">`;
      stack.push('</span>');
    } else if (/^i$/i.test(body)) {
      out += '<em>';
      stack.push('</em>');
    } else if (/^b$/i.test(body)) {
      out += '<strong>';
      stack.push('</strong>');
    } else if (/^color=/i.test(body)) {
      const hex = body.slice(6).replace(/[^#0-9a-fA-F]/g, '');
      out += `<span style="color:${hex}">`;
      stack.push('</span>');
    } else {
      // 알 수 없는 태그: 무시하되 닫힘 짝은 맞춘다
      stack.push('');
    }
  }
  out += escapeHtml(src.slice(last));
  while (stack.length) out += stack.pop();
  return out.replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// 파서 본체
// ---------------------------------------------------------------------------

const SPLIT_LIST = (s) =>
  String(s ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/**
 * 스토리 스크립트를 파싱해 { lines, cast } 를 반환.
 *
 * @param {string} source
 * @param {{ keepDirectives?: boolean }} [opts]
 *   keepDirectives: 연출 태그를 { type:'directive', tag, attrs } 로 출력에 포함
 * @returns {{
 *   lines: Array<Record<string, any>>,
 *   cast: { speakers: Record<string, number>, sprites: string[] },
 *   header: string | null,
 * }}
 */
export function parseStoryWithMeta(source, opts = {}) {
  const keepDirectives = Boolean(opts.keepDirectives);
  const lines = [];
  const speakers = {};
  const sprites = new Set();
  let header = null;

  // 선택지 분기 추적
  let decisionValues = null; // 현재 Decision 의 values
  let activeBranch = null; // 현재 Predicate 로 열린 분기

  const addSprite = (v) => {
    if (typeof v === 'string' && v) sprites.add(v);
  };
  const push = (entry) => {
    if (activeBranch && entry.type !== 'decision' && entry.type !== 'predicate') {
      entry.branch = activeBranch;
    }
    lines.push(entry);
  };
  const pushDialogue = (speaker, text, extra = {}) => {
    const name = String(speaker ?? '').trim();
    speakers[name] = (speakers[name] ?? 0) + 1;
    push({ type: 'dialogue', speaker: name, text: text.trim(), ...extra });
  };

  const raw = String(source ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/);

  for (const rawLine of raw) {
    const line = rawLine.trim();
    if (!line) continue;

    const t = splitTag(line);

    // ---- 태그 없는 줄: 나레이션 -------------------------------------------
    if (!t) {
      push({ type: 'narration', text: line.replace(/^;\s*/, '') });
      continue;
    }

    const { tag, attrs, rest } = t;
    const restText = rest.trim();

    switch (tag) {
      case 'header':
        header = restText || null;
        push({ type: 'header', text: restText, attrs });
        break;

      case 'name':
        if (attrs.avatarId) addSprite(attrs.avatarId);
        pushDialogue(attrs.name, restText, attrs.avatarId ? { avatarId: attrs.avatarId } : {});
        break;

      case 'multiline':
        pushDialogue(attrs.name, restText, { continued: true });
        break;

      case 'decision': {
        const options = SPLIT_LIST(attrs.options);
        const values = SPLIT_LIST(attrs.values);
        decisionValues = values.length ? values : options.map((_, i) => String(i + 1));
        activeBranch = null;
        push({
          type: 'decision',
          text: options.join(' / '),
          options: options.map((text, i) => ({ value: decisionValues[i] ?? String(i + 1), text })),
        });
        break;
      }

      case 'predicate': {
        const refs = SPLIT_LIST(attrs.references);
        // 모든 선택지를 참조하면 분기 합류(merge) 지점
        const merged = decisionValues && refs.length >= decisionValues.length && decisionValues.every((v) => refs.includes(v));
        activeBranch = merged ? null : refs;
        push({ type: 'predicate', references: refs, merged: Boolean(merged) });
        break;
      }

      case 'subtitle':
        if (attrs.text) push({ type: 'subtitle', text: String(attrs.text) });
        break;

      case 'sticker':
        if (attrs.text) push({ type: 'sticker', text: String(attrs.text), id: attrs.id ?? null });
        break;

      case 'animtext':
        if (restText) push({ type: 'caption', text: stripRichText(restText).trim() });
        break;

      case 'background':
      case 'largebg':
      case 'gridbg':
        push({ type: 'scene', image: attrs.image ?? attrs.imagegroup ?? null });
        break;

      case 'image':
        if (attrs.image) push({ type: 'image', image: attrs.image });
        break;

      case 'tutorial':
        if (restText) push({ type: 'tutorial', text: restText });
        break;

      case 'character':
      case 'charslot':
      case 'charactercutin':
        addSprite(attrs.name);
        addSprite(attrs.name2);
        addSprite(attrs.name3);
        if (keepDirectives) push({ type: 'directive', tag, attrs });
        break;

      default:
        // 연출 태그: [Blocker], [Dialog], [playMusic], [CameraShake], [delay] …
        if (keepDirectives) push({ type: 'directive', tag, attrs });
        // 태그 뒤에 텍스트가 붙어 있으면 (드물게) 나레이션으로 살린다
        else if (restText && !/^[\s\p{P}]*$/u.test(restText) && tag !== 'dialog') {
          push({ type: 'narration', text: restText });
        }
    }
  }

  return {
    lines,
    header,
    cast: { speakers, sprites: [...sprites] },
  };
}

/**
 * 스토리 스크립트 → 라인 배열. (요구 사양의 기본 API)
 * @returns {{ type: string, speaker?: string, text?: string }[]}
 */
export function parseStory(source, opts) {
  return parseStoryWithMeta(source, opts).lines;
}

// ---------------------------------------------------------------------------
// 출연 캐릭터 추출 보조
// ---------------------------------------------------------------------------

/**
 * 스프라이트/아바타 ID 에서 캐릭터 식별 키를 뽑는다.
 *   "char_130_doberm_ex"      → { num: '130',  slug: 'doberm' }
 *   "avg_1050_chen3_1#5$1"    → { num: '1050', slug: 'chen3' }
 *   "avgnew_2014_nian_1"      → { num: '2014', slug: 'nian' }
 *   "avg_npc_068#5"           → null (NPC 는 오퍼레이터 매칭 대상이 아님)
 * process-data 에서 `${num}_${slug}` 로 character_table 키(char_<num>_<slug>)와 매칭한다.
 */
export function spriteToCharKey(spriteId) {
  if (typeof spriteId !== 'string') return null;
  const clean = spriteId.split('#')[0].split('$')[0];
  const m = clean.match(/^(?:char|avg|avgnew|avg_new)_(\d+)_([a-z0-9]+)/i);
  if (!m) return null;
  return { num: m[1], slug: m[2].toLowerCase(), key: `${m[1]}_${m[2].toLowerCase()}` };
}
