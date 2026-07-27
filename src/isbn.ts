/** ISBN文字列からハイフン・空白を除去し、大文字に揃える */
export function normalizeIsbn(raw: string): string {
	return raw.replace(/[^0-9Xx]/g, "").toUpperCase();
}

/** ISBN-10 を ISBN-13 に変換する。変換できない場合は null */
export function isbn10To13(isbn10: string): string | null {
	if (isbn10.length !== 10) return null;
	const body = "978" + isbn10.slice(0, 9);
	if (!/^\d{12}$/.test(body)) return null;
	return body + calcIsbn13CheckDigit(body);
}

function calcIsbn13CheckDigit(body12: string): string {
	let sum = 0;
	for (let i = 0; i < 12; i++) {
		sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
	}
	return String((10 - (sum % 10)) % 10);
}

/**
 * 任意の表記のISBNを ISBN-13（ハイフンなし）に揃える。
 * 変換できない場合は空文字を返す（内容紹介なしでノート作成を継続するため例外は投げない）。
 */
export function toIsbn13(raw: string): string {
	const n = normalizeIsbn(raw);
	if (n.length === 13 && /^\d{13}$/.test(n)) return n;
	if (n.length === 10) return isbn10To13(n) ?? "";
	return "";
}
