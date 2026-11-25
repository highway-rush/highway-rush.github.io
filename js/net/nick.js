// Ник игрока: до 12 символов, буквы/цифры/пробел/._- и простой фильтр грубых слов (ru / kk / en).
// Ник хранится только в этом браузере (localStorage). Никаких личных данных не собираем.

const BAD = [
  // русский
  'хуй', 'хуе', 'хуё', 'хуя', 'пизд', 'ебат', 'ебан', 'ебал', 'ебло', 'бля', 'сука', 'суки', 'мудак', 'мудил',
  'пидор', 'пидар', 'пидр', 'шлюх', 'залуп', 'гандон', 'гондон', 'дерьм', 'говн', 'жопа', 'жопу', 'нахуй', 'уебок', 'уёбок', 'долбоеб', 'долбоёб',
  // қазақша
  'сігей', 'сігіл', 'сікті', 'сіктір', 'сиктир', 'қотақ', 'котак', 'амыңа', 'аминды', 'шешеңді', 'шешенди', 'жалап',
  // english
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'nigg', 'fagg', 'asshole', 'bastard', 'porn', 'nazi', 'hitler',
];

// Латинские буквы, похожие на кириллические, и «цифры вместо букв»
const LOOK = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', u: 'и', '3': 'з', '0': 'о', '6': 'б' };
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function variants(s) {
  const low = s.toLowerCase().replace(/ё/g, 'е');
  const leet = [...low].map((ch) => LEET[ch] || ch).join('').replace(/[^\p{L}]/gu, '');
  const cyr = [...low].map((ch) => LOOK[ch] || ch).join('').replace(/[^\p{L}]/gu, '');
  return [low.replace(/[^\p{L}]/gu, ''), leet, cyr];
}

export function isBadNick(s) {
  const vs = variants(s);
  return BAD.some((w) => { const ww = w.replace(/ё/g, 'е'); return vs.some((v) => v.includes(ww)); });
}

// Возвращает { nick } или { err: ключ перевода }
export function checkNick(raw) {
  const nick = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!nick) return { err: 'nickEmpty' };
  if ([...nick].length > 12) return { err: 'nickLong' };
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(nick)) return { err: 'nickChars' };
  if (isBadNick(nick)) return { err: 'nickBad' };
  return { nick };
}
