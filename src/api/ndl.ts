import { requestUrl, RequestUrlResponse } from "obsidian";
import { BookRecord } from "../types";
import { toIsbn13 } from "../isbn";

const SRU_ENDPOINT = "https://ndlsearch.ndl.go.jp/api/sru";

/** NDLサーチはAPI利用者の識別のためUser-Agentの明示を求めている */
const USER_AGENT = "JpBooks (Obsidian plugin; +https://github.com/masatakeya/JpBooks)";

/** 429/503のときの再試行回数と、1回あたりの待ち時間の上限 */
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10_000;

/** 連続した検索でアクセス制限にかからないよう、リクエスト間隔を空ける */
const MIN_REQUEST_INTERVAL_MS = 1_000;
let lastRequestAt = 0;

const NS = {
	srw: "http://www.loc.gov/zing/srw/",
	rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
	rdfs: "http://www.w3.org/2000/01/rdf-schema#",
	dc: "http://purl.org/dc/elements/1.1/",
	dcterms: "http://purl.org/dc/terms/",
	dcndl: "http://ndl.go.jp/dcndl/terms/",
	foaf: "http://xmlns.com/foaf/0.1/",
};

export interface NdlSearchParams {
	title: string;
	creator: string;
	maxRecords: number;
	/** mediatype=books で図書に絞り込む */
	booksOnly: boolean;
}

export class NdlError extends Error {}

/**
 * NDLサーチ SRU API で書誌を検索する。
 * レスポンスはSRU/XMLのため DOMParser で解析する。
 */
export async function searchNdl(
	params: NdlSearchParams,
	onRetry?: (waitSeconds: number) => void
): Promise<BookRecord[]> {
	const cql = buildCqlQuery(params);
	if (!cql) return [];

	const url =
		`${SRU_ENDPOINT}?operation=searchRetrieve` +
		`&query=${encodeURIComponent(cql)}` +
		`&recordSchema=dcndl` +
		`&recordPacking=xml` +
		`&maximumRecords=${Math.min(Math.max(params.maxRecords, 1), 50)}`;

	const xml = await fetchSru(url, onRetry);
	return parseSruResponse(xml);
}

/**
 * SRUリクエストを送る。429（アクセス集中）・503は Retry-After に従って再試行する。
 */
async function fetchSru(
	url: string,
	onRetry?: (waitSeconds: number) => void
): Promise<string> {
	for (let attempt = 0; ; attempt++) {
		await waitForInterval();

		let res: RequestUrlResponse;
		try {
			res = await requestUrl({
				url,
				method: "GET",
				headers: { "User-Agent": USER_AGENT },
				throw: false,
			});
		} catch (e) {
			throw new NdlError(
				`NDLサーチへの接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`
			);
		} finally {
			lastRequestAt = Date.now();
		}

		if (res.status < 400) return res.text;

		const retryable = res.status === 429 || res.status === 503;
		if (retryable && attempt < MAX_RETRIES) {
			const waitMs = retryWaitMs(res.headers, attempt);
			onRetry?.(Math.ceil(waitMs / 1000));
			await sleep(waitMs);
			continue;
		}

		if (res.status === 429) {
			throw new NdlError(
				"NDLサーチへのアクセスが集中しているため、一時的に検索が制限されています（429）。" +
					"数分ほど時間をおいてから、もう一度検索してください。"
			);
		}
		if (res.status === 503) {
			throw new NdlError(
				"NDLサーチが一時的に利用できません（503）。メンテナンス中の可能性があります。" +
					"時間をおいてから、もう一度検索してください。"
			);
		}
		throw new NdlError(`NDLサーチへのリクエストが失敗しました（ステータス ${res.status}）。`);
	}
}

/** Retry-After（秒数またはHTTP日付）を優先し、なければ指数バックオフで待つ */
function retryWaitMs(headers: Record<string, string>, attempt: number): number {
	const fallback = 2_000 * 2 ** attempt;
	const key = Object.keys(headers).find((k) => k.toLowerCase() === "retry-after");
	const value = key ? headers[key].trim() : "";

	let waitMs = fallback;
	if (/^\d+$/.test(value)) {
		waitMs = Number(value) * 1000;
	} else if (value) {
		const date = Date.parse(value);
		if (!Number.isNaN(date)) waitMs = date - Date.now();
	}
	return Math.min(Math.max(waitMs, 1_000), MAX_RETRY_WAIT_MS);
}

async function waitForInterval(): Promise<void> {
	const elapsed = Date.now() - lastRequestAt;
	if (elapsed < MIN_REQUEST_INTERVAL_MS) await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * CQLクエリを組み立てる。書名・著者名のどちらか一方だけでも検索できる。
 * 値のダブルクォートはCQLを壊すため除去する。
 */
export function buildCqlQuery(params: NdlSearchParams): string {
	const clauses: string[] = [];
	const title = sanitizeTerm(params.title);
	const creator = sanitizeTerm(params.creator);

	if (title) clauses.push(`title="${title}"`);
	if (creator) clauses.push(`creator="${creator}"`);
	if (clauses.length === 0) return "";
	if (params.booksOnly) clauses.push(`mediatype=books`);

	return clauses.join(" AND ");
}

function sanitizeTerm(term: string): string {
	return term.replace(/["\\]/g, " ").trim().replace(/\s+/g, " ");
}

/** SRUレスポンスXMLを BookRecord[] に変換する */
export function parseSruResponse(xml: string): BookRecord[] {
	const doc = new DOMParser().parseFromString(xml, "text/xml");

	if (doc.getElementsByTagName("parsererror").length > 0) {
		throw new NdlError("NDLサーチのレスポンス（XML）を解析できませんでした。");
	}

	// 0件の場合もdiagnosticsで返ってくる（message: "Record does not exist"）
	const diagnostics = doc.getElementsByTagNameNS(
		"http://www.loc.gov/zing/srw/diagnostic/",
		"diagnostic"
	);
	if (diagnostics.length > 0) {
		const message = textOfChild(diagnostics[0], "message") || "";
		if (/record does not exist/i.test(message)) return [];
		throw new NdlError(`NDLサーチがエラーを返しました: ${message || "詳細不明"}`);
	}

	const records = Array.from(doc.getElementsByTagNameNS(NS.srw, "record"));
	const books: BookRecord[] = [];
	const seen = new Set<string>();

	for (const record of records) {
		const book = parseRecord(record);
		if (!book || !book.title) continue;

		// 同一書誌が複数の提供館から返るためISBN等で重複を除く
		const key = book.isbn || `${book.title}|${book.author}|${book.published}`;
		if (seen.has(key)) continue;
		seen.add(key);
		books.push(book);
	}

	return books;
}

function parseRecord(record: Element): BookRecord | null {
	// 1レコード内に複数のBibResourceが含まれる。書名を持つ最初のものが本体。
	const resources = Array.from(record.getElementsByTagNameNS(NS.dcndl, "BibResource"));
	const resource = resources.find(
		(r) => directChildren(r, NS.dcterms, "title").length > 0
	);
	if (!resource) return null;

	const title = buildTitle(resource);
	const authors = extractAuthors(resource);
	const published = extractPublished(resource);
	const isbn = extractIsbn(resource);

	return {
		title,
		authors,
		author: authors.join(", "),
		publisher: extractPublisher(resource),
		published,
		year: published.slice(0, 4),
		isbn,
		description: "",
		sourceUrl: (resource.getAttributeNS(NS.rdf, "about") || "").replace(/#material$/, ""),
	};
}

function buildTitle(resource: Element): string {
	const main = firstText(resource, NS.dcterms, "title");
	const volume = firstText(resource, NS.dcndl, "volume");
	// 書名に巻次が含まれている場合があるため、重複して連結しない
	if (!volume || main.endsWith(volume)) return main;
	return `${main} ${volume}`.trim();
}

function extractAuthors(resource: Element): string[] {
	// dcterms:creator > foaf:Agent > foaf:name（典拠形）を優先
	const agents = directChildren(resource, NS.dcterms, "creator")
		.map((el) => {
			const agent = el.getElementsByTagNameNS(NS.foaf, "name")[0];
			return agent ? cleanPersonName(agent.textContent || "") : "";
		})
		.filter((s) => s.length > 0);
	if (agents.length > 0) return dedupe(agents);

	// フォールバック: dc:creator（「著者A, 著者B 著」形式）
	const statements = directChildren(resource, NS.dc, "creator")
		.map((el) => (el.textContent || "").trim())
		.filter((s) => s.length > 0);
	if (statements.length === 0) return [];

	return dedupe(
		statements
			.join(", ")
			.replace(/\s*(著|編|編著|訳|監修|共著|著者)\s*$/g, "")
			.split(/,\s*/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0)
	);
}

/**
 * 典拠形の氏名を整形する。
 * 例: "篠原, 稔和, 1964-" -> "篠原稔和" / "Boswell, Dustin" -> "Boswell, Dustin"
 */
function cleanPersonName(raw: string): string {
	let name = raw.trim().replace(/,\s*\d{3,4}(-\d{0,4})?\s*$/, "").trim();
	// 全体がCJKの場合のみ「姓, 名」の区切りを詰める（欧文名の区切りは残す）
	if (/^[^\x00-\x7F\s]+,\s*[^\x00-\x7F\s]+$/.test(name)) {
		name = name.replace(/,\s*/, "");
	}
	return name.replace(/\s+/g, " ").trim();
}

function extractPublisher(resource: Element): string {
	const publishers = directChildren(resource, NS.dcterms, "publisher");
	for (const el of publishers) {
		const name = el.getElementsByTagNameNS(NS.foaf, "name")[0];
		const value = (name?.textContent || el.textContent || "").trim();
		if (value) return value;
	}
	return "";
}

/**
 * 出版年を YYYY / YYYY-MM / YYYY-MM-DD に正規化する。
 * dcterms:issued（W3CDTF）を優先し、なければ dcterms:date（"2015.12" 等）を使う。
 */
function extractPublished(resource: Element): string {
	const issued = firstText(resource, NS.dcterms, "issued");
	const date = firstText(resource, NS.dcterms, "date");
	const source = issued || date;
	if (!source) return "";

	const parts = source.replace(/[.\/年月]/g, "-").replace(/日/g, "").split("-");
	const [y, m, d] = parts.map((p) => p.replace(/\D/g, ""));
	if (!y || y.length !== 4) {
		const fallback = source.match(/\d{4}/);
		return fallback ? fallback[0] : "";
	}
	if (!m) return y;
	if (!d) return `${y}-${m.padStart(2, "0")}`;
	return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** dcterms:identifier のうち rdf:datatype が ISBN のものを取り出す */
function extractIsbn(resource: Element): string {
	const identifiers = directChildren(resource, NS.dcterms, "identifier");
	for (const el of identifiers) {
		const datatype = el.getAttributeNS(NS.rdf, "datatype") || "";
		if (!/ISBN$/i.test(datatype)) continue;
		const isbn13 = toIsbn13(el.textContent || "");
		if (isbn13) return isbn13;
	}
	return "";
}

/** 直下の子要素だけを返す（入れ子のBibResource等を拾わないため） */
function directChildren(parent: Element, ns: string, localName: string): Element[] {
	return Array.from(parent.children).filter(
		(el) => el.namespaceURI === ns && el.localName === localName
	);
}

/**
 * 要素のテキストを取り出す。値が rdf:Description/rdf:value に入っている場合も拾う。
 */
function firstText(parent: Element, ns: string, localName: string): string {
	for (const el of directChildren(parent, ns, localName)) {
		const value = el.getElementsByTagNameNS(NS.rdf, "value")[0];
		const text = (value?.textContent ?? el.textContent ?? "").trim();
		if (text) return text;
	}
	return "";
}

function textOfChild(parent: Element, localName: string): string {
	const el = Array.from(parent.children).find((c) => c.localName === localName);
	return (el?.textContent || "").trim();
}

function dedupe(values: string[]): string[] {
	return Array.from(new Set(values));
}
