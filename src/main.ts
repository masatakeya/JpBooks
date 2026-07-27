import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, JpBooksSettings, JpBooksSettingTab } from "./settings";
import { SearchModal } from "./ui/SearchModal";
import { createBookNote } from "./note";
import { BookRecord } from "./types";

export default class JpBooksPlugin extends Plugin {
	settings: JpBooksSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("book-open", "JpBooks: 書籍を検索して読書ノートを作成", () =>
			this.openSearchModal()
		);

		this.addCommand({
			id: "search-and-create-note",
			name: "書籍を検索して読書ノートを作成",
			callback: () => this.openSearchModal(),
		});

		this.addSettingTab(new JpBooksSettingTab(this.app, this));
	}

	openSearchModal(): void {
		new SearchModal(this.app, this.settings, (book) => this.createNote(book)).open();
	}

	private async createNote(book: BookRecord): Promise<void> {
		const file = await createBookNote(this.app, this.settings, book);
		new Notice(`JpBooks: 「${file.basename}」を作成しました`);

		if (this.settings.openAfterCreate) {
			await this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
