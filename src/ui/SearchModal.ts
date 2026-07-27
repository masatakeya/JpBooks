import { App, Modal, Notice, Setting } from "obsidian";
import { BookRecord } from "../types";
import { NdlError, searchNdl } from "../api/ndl";
import { fetchDescription } from "../api/openbd";
import { JpBooksSettings } from "../settings";

type OnSelect = (book: BookRecord) => Promise<void>;

/**
 * 書名・著者名を入力してNDLサーチで検索し、候補から1件選ぶモーダル。
 * 選択後にopenBDで内容紹介を補完してから onSelect を呼ぶ。
 */
export class SearchModal extends Modal {
	private settings: JpBooksSettings;
	private onSelect: OnSelect;

	private titleQuery = "";
	private creatorQuery = "";
	private results: BookRecord[] = [];
	private busy = false;

	private resultsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private searchButton!: HTMLButtonElement;

	constructor(app: App, settings: JpBooksSettings, onSelect: OnSelect) {
		super(app);
		this.settings = settings;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("jpbooks-modal");
		contentEl.empty();

		contentEl.createEl("h2", { text: "書籍を検索" });

		let titleInput: HTMLInputElement | null = null;

		new Setting(contentEl).setName("書名").addText((text) => {
			titleInput = text.inputEl;
			text.setPlaceholder("例: リーダブルコード").onChange((v) => (this.titleQuery = v));
			text.inputEl.addEventListener("keydown", (e) => this.onInputKeydown(e));
		});

		new Setting(contentEl).setName("著者名").addText((text) => {
			text.setPlaceholder("例: 村上春樹").onChange((v) => (this.creatorQuery = v));
			text.inputEl.addEventListener("keydown", (e) => this.onInputKeydown(e));
		});

		new Setting(contentEl).addButton((button) => {
			this.searchButton = button.buttonEl;
			button
				.setButtonText("検索")
				.setCta()
				.onClick(() => void this.runSearch());
		});

		this.statusEl = contentEl.createDiv({ cls: "jpbooks-status" });
		this.statusEl.setText("書名・著者名のどちらか一方だけでも検索できます。");

		this.resultsEl = contentEl.createDiv({ cls: "jpbooks-results" });

		window.setTimeout(() => titleInput?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private onInputKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			void this.runSearch();
			return;
		}
		if (event.key === "ArrowDown" && this.results.length > 0) {
			event.preventDefault();
			this.moveActive(0);
		}
	}

	private setStatus(message: string, kind: "info" | "error" = "info"): void {
		this.statusEl.setText(message);
		this.statusEl.toggleClass("jpbooks-status-error", kind === "error");
	}

	/** NDLサーチへの同時リクエストを避けるため、1件ずつ実行する */
	private async runSearch(): Promise<void> {
		if (this.busy) return;
		if (!this.titleQuery.trim() && !this.creatorQuery.trim()) {
			this.setStatus("書名または著者名を入力してください。", "error");
			return;
		}

		this.setBusy(true);
		this.setStatus("NDLサーチで検索しています…");
		this.resultsEl.empty();
		this.results = [];

		try {
			this.results = await searchNdl({
				title: this.titleQuery,
				creator: this.creatorQuery,
				maxRecords: this.settings.maxResults,
				booksOnly: this.settings.booksOnly,
			});

			if (this.results.length === 0) {
				this.setStatus("該当する書籍が見つかりませんでした。条件を変えて検索してください。");
				return;
			}
			this.setStatus(`${this.results.length}件の候補（↑↓で移動、Enterで選択）`);
			this.renderResults();
		} catch (e) {
			const message =
				e instanceof NdlError ? e.message : `検索に失敗しました: ${String(e)}`;
			this.setStatus(message, "error");
			console.error("JpBooks: NDLサーチの検索に失敗", e);
		} finally {
			this.setBusy(false);
		}
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.searchButton.disabled = busy;
		this.searchButton.setText(busy ? "検索中…" : "検索");
	}

	private renderResults(): void {
		this.resultsEl.empty();

		this.results.forEach((book, index) => {
			const item = this.resultsEl.createDiv({ cls: "jpbooks-result" });
			item.tabIndex = 0;

			item.createDiv({ cls: "jpbooks-result-title", text: book.title });

			const meta = [book.author, book.publisher, book.published].filter((s) => s).join(" / ");
			item.createDiv({ cls: "jpbooks-result-meta", text: meta || "書誌情報なし" });

			if (!book.isbn) {
				item.createDiv({
					cls: "jpbooks-result-note",
					text: "ISBNなし（内容紹介は取得されません）",
				});
			}

			item.addEventListener("click", () => void this.choose(index));
			item.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.choose(index);
				} else if (e.key === "ArrowDown") {
					e.preventDefault();
					this.moveActive(index + 1);
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					this.moveActive(index - 1);
				}
			});
		});
	}

	private moveActive(index: number): void {
		if (this.results.length === 0) return;
		const next = Math.max(0, Math.min(index, this.results.length - 1));
		const el = this.resultsEl.children[next] as HTMLElement | undefined;
		el?.focus();
		el?.scrollIntoView({ block: "nearest" });
	}

	/** 候補を選択し、内容紹介を補完してノート作成へ渡す */
	private async choose(index: number): Promise<void> {
		if (this.busy) return;
		const book = this.results[index];
		if (!book) return;

		this.busy = true;
		this.setStatus(
			this.settings.fetchDescription && book.isbn
				? "openBDから内容紹介を取得しています…"
				: "ノートを作成しています…"
		);

		try {
			if (this.settings.fetchDescription && book.isbn) {
				// 取得できなくても空欄のまま処理を続ける
				book.description = await fetchDescription(book.isbn);
			}
			await this.onSelect(book);
			this.close();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.setStatus(`ノートの作成に失敗しました: ${message}`, "error");
			new Notice(`JpBooks: ノートの作成に失敗しました\n${message}`);
			console.error("JpBooks: ノート作成に失敗", e);
		} finally {
			this.busy = false;
		}
	}
}
