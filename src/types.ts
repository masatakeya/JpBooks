/** NDLサーチとopenBDから組み立てる書誌情報 */
export interface BookRecord {
	/** 書名（巻次があれば連結） */
	title: string;
	/** 著者名の配列 */
	authors: string[];
	/** 著者名のカンマ区切り文字列 */
	author: string;
	/** 出版社 */
	publisher: string;
	/** 出版年（YYYY / YYYY-MM / YYYY-MM-DD のいずれか） */
	published: string;
	/** 出版年（YYYY のみ） */
	year: string;
	/** ISBN-13（ハイフンなし）。取得できない場合は空文字 */
	isbn: string;
	/** 内容紹介。openBDから補完する。取得できない場合は空文字 */
	description: string;
	/** NDLサーチの書誌ページURL */
	sourceUrl: string;
}
