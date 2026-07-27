import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import { BookRecord } from "./types";
import { JpBooksSettings } from "./settings";

type Vars = Record<string, string>;

export function buildVars(book: BookRecord): Vars {
	return {
		title: book.title,
		author: book.author,
		authors: book.authors.join(", "),
		publisher: book.publisher,
		published: book.published,
		year: book.year,
		isbn: book.isbn,
		description: book.description,
	};
}

/**
 * {{変数}} 形式のテンプレートを展開する。
 * frontmatter（先頭の --- で囲まれた範囲）内ではYAML用のエスケープをかける。
 */
export function renderTemplate(template: string, vars: Vars): string {
	const boundary = findFrontmatterEnd(template);
	if (boundary === null) return replaceVars(template, vars, false);

	const front = template.slice(0, boundary);
	const body = template.slice(boundary);
	return replaceVars(front, vars, true) + replaceVars(body, vars, false);
}

/** frontmatterブロックの終端インデックス（閉じ --- の行末）を返す。無い場合は null */
function findFrontmatterEnd(template: string): number | null {
	const opening = /^---\r?\n/.exec(template);
	if (!opening) return null;
	const closing = /\r?\n---\r?\n/.exec(template.slice(opening[0].length));
	if (!closing) return null;
	return opening[0].length + closing.index + closing[0].length;
}

function replaceVars(text: string, vars: Vars, escapeYaml: boolean): string {
	return text
		.replace(/\{\{DATE:([^}]+)\}\}/g, (_m, format: string) => moment().format(format))
		.replace(/\{\{DATE\}\}/g, () => moment().format("YYYY-MM-DD"))
		.replace(/\{\{(\w+)\}\}/g, (whole: string, name: string) => {
			if (!(name in vars)) return whole; // 未知の変数は他プラグイン用に残す
			const value = vars[name] ?? "";
			return escapeYaml ? escapeYamlInline(value) : value;
		});
}

/**
 * ダブルクォート付きYAMLスカラーの中身として安全な文字列に変換する。
 * 内容紹介のように改行やクォートを含む値を frontmatter に入れても壊れないようにする。
 */
export function escapeYamlInline(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r\n?/g, "\n")
		.replace(/\n/g, "\\n")
		.trim();
}

/** ファイル名に使えない文字を除去する */
export function sanitizeFileName(name: string): string {
	const stripped = Array.from(name)
		.map((ch) => (ch.charCodeAt(0) < 0x20 ? " " : ch))
		.join("");
	const cleaned = stripped
		// OSで使えない文字と、Obsidianのリンク記法を壊す文字を除去する
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^\.+/, "")
		.trim();
	const limited = cleaned.slice(0, 120).trim();
	return limited || "無題";
}

/** フォルダを（必要なら階層ごと）作成する */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
	if (!folderPath) return;
	const segments = folderPath.split("/").filter((s) => s.length > 0);
	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFolder) continue;
		if (existing) throw new Error(`「${current}」は既にファイルとして存在します。`);
		await app.vault.createFolder(current);
	}
}

/** 同名ファイルがある場合は連番を付けて空きパスを返す */
function findAvailablePath(app: App, folderPath: string, baseName: string): string {
	const build = (n: number) => {
		const name = n === 0 ? baseName : `${baseName} ${n + 1}`;
		return normalizePath(folderPath ? `${folderPath}/${name}.md` : `${name}.md`);
	};
	let i = 0;
	while (app.vault.getAbstractFileByPath(build(i))) i++;
	return build(i);
}

/** 書誌情報から読書ノートを作成する */
export async function createBookNote(
	app: App,
	settings: JpBooksSettings,
	book: BookRecord
): Promise<TFile> {
	const vars = buildVars(book);
	const trimmed = settings.folderPath.replace(/^\/+|\/+$/g, "").trim();
	const folder = trimmed === "." ? "" : trimmed ? normalizePath(trimmed) : "";

	await ensureFolder(app, folder);

	const rawName = renderTemplate(settings.fileNameFormat || "{{title}}", vars);
	const path = findAvailablePath(app, folder, sanitizeFileName(rawName));
	const content = renderTemplate(settings.template, vars);

	return await app.vault.create(path, content);
}
