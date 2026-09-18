import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, parseStoryWithMeta, parseAttrs, splitTag, richTextToHtml, stripRichText, spriteToCharKey } from '../src/lib/story-parser.mjs';

const SAMPLE = `[HEADER(key="title_test", is_skippable=true, fit_mode="BLACK_MASK")] 九尾狐活动 1上
[stopmusic]
[Dialog]
[Background(image="bg_ltstreet1",screenadapt="coverall")]
2:10 P.M. 날씨/맑음
라이타니엔의 이동도시 월루몽드.
[Character(name="avg_npc_068")]
[name="주민 대표"]  세버린 호손 장관님, 어딜 다녀오시는 겁니까?
[Character(name="char_130_doberm_ex", name2="char_013_riop", focus=2)]
[name="도베르만"]  …정말로 착각이었으면 좋겠군.
[name="???"]난……
[name="쉐이", avatarId="avg_npc_2129_2", isAvatarRight="FALSE"]안녕
[multiline(name="니엔")]앗, 슈 언니, 왜 꼬집어!
[charslot(slot="m",name="avgnew_2014_nian_1#5$1")]
[Decision(options="맡겨만 줘!;……;간단하다, 금방 끝내지.", values="1;2;3")]
[Predicate(references="1")]
[name="아미야"]  고마워요.
[Predicate(references="2;3")]
[name="아미야"]  ……
[Predicate(references="1;2;3")]
나레이션 합류.
[Subtitle(text="“훼이지에…… 네 이름은 첸 훼이지에야.”", x=530, y=310, alignment="left", size=24, delay=0.04,  width=700)]
[Sticker(id="st1", multi = true, text="\\n\\n쉐이는 보았다.", x=300,y=300, block = false)]
[animtext(id = "at1", name = "group_location_stamp", block = false)]<p=2>망일 이틀 전, 해시</>
;세미콜론 나레이션
`;

test('parseAttrs handles quoted commas, numbers, booleans and spaces', () => {
  const a = parseAttrs('options="a, b;c", values="1;2", focus=2, block = true, slot = "L"');
  assert.deepEqual(a, { options: 'a, b;c', values: '1;2', focus: 2, block: true, slot: 'L' });
});

test('splitTag normalizes [name="X"] and keeps trailing text', () => {
  assert.deepEqual(splitTag('[name="주민 대표"]  안녕'), { tag: 'name', attrs: { name: '주민 대표' }, rest: '  안녕' });
  assert.equal(splitTag('[Dialog]').tag, 'dialog');
  assert.equal(splitTag('평문 줄'), null);
});

test('parseStory produces expected line types', () => {
  const lines = parseStory(SAMPLE);
  const types = lines.map((l) => l.type);
  assert.deepEqual(types, [
    'header', 'scene', 'narration', 'narration', 'dialogue', 'dialogue', 'dialogue', 'dialogue', 'dialogue',
    'decision', 'predicate', 'dialogue', 'predicate', 'dialogue', 'predicate', 'narration',
    'subtitle', 'sticker', 'caption', 'narration',
  ]);
  assert.equal(lines[4].speaker, '주민 대표');
  assert.equal(lines[4].text, '세버린 호손 장관님, 어딜 다녀오시는 겁니까?');
  assert.equal(lines[6].speaker, '???');
  assert.equal(lines[7].avatarId, 'avg_npc_2129_2');
  assert.equal(lines[8].continued, true);
  assert.deepEqual(lines[9].options, [
    { value: '1', text: '맡겨만 줘!' },
    { value: '2', text: '……' },
    { value: '3', text: '간단하다, 금방 끝내지.' },
  ]);
  assert.deepEqual(lines[11].branch, ['1']);
  assert.deepEqual(lines[13].branch, ['2', '3']);
  assert.equal(lines[14].merged, true);
  assert.equal(lines[15].branch, undefined);
  assert.equal(lines[17].text, '\n\n쉐이는 보았다.');
  assert.equal(lines[18].text, '망일 이틀 전, 해시');
  assert.equal(lines[19].text, '세미콜론 나레이션');
});

test('cast extraction collects speakers and sprites', () => {
  const { cast, header } = parseStoryWithMeta(SAMPLE);
  assert.equal(header, '九尾狐活动 1上');
  assert.equal(cast.speakers['아미야'], 2);
  assert.ok(cast.sprites.includes('char_130_doberm_ex'));
  assert.ok(cast.sprites.includes('char_013_riop'));
  assert.ok(cast.sprites.includes('avgnew_2014_nian_1#5$1'));
  assert.ok(cast.sprites.includes('avg_npc_2129_2'));
});

test('keepDirectives emits directive entries', () => {
  const lines = parseStory('[stopmusic]\n[Blocker(a=1, fadetime=1)]', { keepDirectives: true });
  assert.deepEqual(lines.map((l) => l.tag), ['stopmusic', 'blocker']);
});

test('rich text helpers', () => {
  assert.equal(stripRichText('공격 시 <@ba.kw>마법 대미지</>를 입힘'), '공격 시 마법 대미지를 입힘');
  assert.equal(richTextToHtml('<@ba.kw>마법</> & <i>x</i>'), '<span class="rt rt-ba-kw">마법</span> &amp; <em>x</em>');
  assert.equal(richTextToHtml('a\\nb'), 'a<br>b');
});

test('spriteToCharKey', () => {
  assert.equal(spriteToCharKey('char_130_doberm_ex').key, '130_doberm');
  assert.equal(spriteToCharKey('avg_1050_chen3_1#5$1').key, '1050_chen3');
  assert.equal(spriteToCharKey('avgnew_2014_nian_1').key, '2014_nian');
  assert.equal(spriteToCharKey('avg_npc_068#5'), null);
});
