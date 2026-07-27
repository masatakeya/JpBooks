import { requestUrl } from "obsidian";

const OPENBD_ENDPOINT = "https://api.openbd.jp/v1/get";

/** ONIXのTextType。03=内容紹介, 02=リード文, 01=概要 の順で採用する */
const TEXT_TYPE_PRIORITY = ["03", "02", "01"];

interface OpenBdTextContent {
	TextType?: string;
	ContentAudience?: string;
	Text?: string;
}

interface OpenBdResponseItem {
	onix?: {
		CollateralDetail?: {
			TextContent?: OpenBdTextContent[];
		};
	};
}

/**
 * ISBNから内容紹介（あらすじ）を取得する。
 * 取得できない場合は空文字を返し、例外は投げない（ノート作成を止めないため）。
 */
export async function fetchDescription(isbn13: string): Promise<string> {
	if (!isbn13) return "";

	try {
		const res = await requestUrl({
			url: `${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn13)}`,
			method: "GET",
		});
		const items = res.json as (OpenBdResponseItem | null)[] | null;
		if (!Array.isArray(items) || !items[0]) return "";
		return pickDescription(items[0]);
	} catch (e) {
		console.warn("JpBooks: openBDの取得に失敗しました", e);
		return "";
	}
}

export function pickDescription(item: OpenBdResponseItem): string {
	const contents = item.onix?.CollateralDetail?.TextContent;
	if (!Array.isArray(contents) || contents.length === 0) return "";

	for (const type of TEXT_TYPE_PRIORITY) {
		const hit = contents.find((c) => c.TextType === type && (c.Text || "").trim());
		if (hit) return normalizeText(hit.Text || "");
	}
	return "";
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
