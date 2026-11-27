// @ts-check
/**
 * Whose name is this: the decision half of ADu's adudir-mosaic, re-implemented. What is found in a
 * screenshot of a post is someone's privacy or no one's: an @name, a nickname before a colon the
 * Chinese way (「何瑞成：…」), one cut off with an ellipsis. Counts and labels are no one's.
 *
 * Faces are not here: ADu reads them with macOS Vision (faceprints matched to the person's own),
 * which does not exist off macOS — craft's audit covers what text exposes, faces stay a redesign.
 * ADu's OWN_UI list is dropped too: those are their app's own interface phrases, meaningless here.
 */

/* CJK ideographs (and kana, hangul): a nickname written in Chinese has at least one */
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;
/* words that come before a colon and are not someone's name (a label) */
const LABELS = /^(时间|日期|地点|地址|来源|备注|注|答|问|提示|标题|主题|作者|编辑|摄影|出品|导演|字幕|配音|音乐|文案|剪辑|主持|电话|微信|邮箱|价格|原价|现价|数量|状态|评分|总计|合计|结果|原因|步骤\s*\d*|第.{1,4}[步章节集期])$/;
const ELLIPSIS = /(?:[⋯…]+|\.{2,}|。{2,})$/;

/** An @name in a line of text (not @38.3万, a count): { name, at } or null. */
export function atName(s) {
  const m = /[@＠](?![\d.,]+[万千kKmMwW]?(?:\s|$))[^\s@＠]{2,24}/.exec(s);
  return m ? { name: m[0], at: m.index } : null;
}

/**
 * A nickname written the Chinese way at the start of a line: a short name right before a colon
 * (「何瑞成：说得好」), or a name the app cut off with an ellipsis (「闪机侠二手机电脑…」). Not a time
 * (02:23), a label (时间：), or words without a Chinese character.
 * @returns {{ name: string, at: number, end: number } | null}
 */
export function commentName(s) {
  const line = String(s ?? '').trim();
  const offset = String(s ?? '').indexOf(line);
  const colon = /^(.{1,20}?)\s*[：:]/.exec(line);
  if (colon) {
    const raw = colon[1], name = raw.replace(ELLIPSIS, '').trim();
    const after = line[colon[0].length] ?? '';
    if (/\d$/.test(raw) && /^\d/.test(after)) return null;
    if (name.length >= 2 && CJK.test(name) && !LABELS.test(name) && name.split(/\s+/).length <= 3 && !/[，。,!！?？、；;]/.test(name)) return { name, at: offset, end: offset + colon[0].length };
    return null;
  }
  if (ELLIPSIS.test(line)) {
    const name = line.replace(ELLIPSIS, '').trim();
    if (name.length >= 3 && name.length <= 20 && (name.match(new RegExp(CJK.source, 'g')) ?? []).length >= 2 && !/\s/.test(name) && !/[，。,!！?？、；;]/.test(name)) return { name, at: offset, end: offset + line.length };
  }
  return null;
}

const plain = (s) => String(s).toLowerCase().replace(/[\s·・._\-—@＠:：]+/g, '');
function apart(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

/**
 * Whether a name read off a picture is one of ours (the person making the film — their own names,
 * brands, handles): it holds one of our names or is held in one, or is one with a letter misread.
 * @returns the name of ours it is, or null
 * @param {string} name @param {string[]} own
 */
export function ownName(name, own) {
  const n = plain(name);
  if (n.length < 2) return null;
  for (const o of own) {
    const p = plain(o);
    if (p.length < 2) continue;
    if (n.includes(p) || p.includes(n) || (Math.min(n.length, p.length) >= 4 && apart(n, p) <= 1)) return o;
  }
  return null;
}

/**
 * The privacy a text block exposes: the names in it that are no one's own.
 * @param {string} text @param {string[]} own the person's own names/brands/handles
 * @returns {{ kind: string, name: string }[]}
 */
export function exposedNames(text, own = []) {
  const out = [];
  const at = atName(text);
  if (at && !ownName(at.name, own)) out.push({ kind: 'at', name: at.name });
  const comment = commentName(text);
  if (comment && !ownName(comment.name, own)) out.push({ kind: 'comment', name: comment.name });
  return out;
}
