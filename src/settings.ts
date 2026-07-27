import { App, PluginSettingTab, Setting } from "obsidian";
import type JpBooksPlugin from "./main";

export interface JpBooksSettings {
	/** ノートの保存先フォルダ */
	folderPath: string;
	/** ファイル名フォーマット */
	fileNameFormat: string;
	/** ノートのテンプレート */
	template: string;
	/** 検索結果の最大表示件数 */
	maxResults: number;
	/** 図書（mediatype=books）に絞り込む */
	booksOnly: boolean;
	/** openBDから内容紹介を補完する */
	fetchDescription: boolean;
	/** 作成後にノートを開く */
	openAfterCreate: boolean;
}

export const DEFAULT_TEMPLATE = `---
title: "{{title}}"
author: "{{author}}"
publisher: "{{publisher}}"
published: "{{published}}"
isbn: "{{isbn}}"
description: "{{description}}"
read_date:
rating:
tags:
  - 読書ノート
created: {{DATE}}
---

## メモ

`;

export const DEFAULT_SETTINGS: JpBooksSettings = {
	folderPath: "Books",
	fileNameFormat: "{{title}}",
	template: DEFAULT_TEMPLATE,
	maxResults: 20,
	booksOnly: true,
	fetchDescription: true,
	openAfterCreate: true,
};

export class JpBooksSettingTab extends PluginSettingTab {
	plugin: JpBooksPlugin;

	constructor(app: App, plugin: JpBooksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("保存先フォルダ")
			.setDesc("読書ノートを作成するフォルダ。空欄の場合はVaultのルートに作成します。")
			.addText((text) =>
				text
					.setPlaceholder("Books")
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("ファイル名フォーマット")
			.setDesc("例: {{title}} / {{title}} - {{author}} / {{DATE:YYYYMMDD}}_{{title}}")
			.addText((text) =>
				text
					.setPlaceholder("{{title}}")
					.setValue(this.plugin.settings.fileNameFormat)
					.onChange(async (value) => {
						this.plugin.settings.fileNameFormat = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("検索結果の最大件数")
			.setDesc("NDLサーチから取得する候補の件数（1〜50）。")
			.addSlider((slider) =>
				slider
					.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.maxResults)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxResults = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("図書のみを検索")
			.setDesc("雑誌記事や電子資料を除き、図書だけを候補に表示します。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.booksOnly).onChange(async (value) => {
					this.plugin.settings.booksOnly = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("内容紹介を取得する（openBD）")
			.setDesc(
				"選択した書籍のISBNでopenBDに問い合わせ、内容紹介を補完します。ISBNがない書籍やopenBDに登録がない書籍では空欄になります。"
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fetchDescription).onChange(async (value) => {
					this.plugin.settings.fetchDescription = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("作成後にノートを開く")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openAfterCreate).onChange(async (value) => {
					this.plugin.settings.openAfterCreate = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("テンプレート").setHeading();

		const desc = containerEl.createDiv({ cls: "setting-item-description jpbooks-template-help" });
		desc.createSpan({
			text: "使用可能な変数: {{title}} {{author}} {{authors}} {{publisher}} {{published}} {{year}} {{isbn}} {{description}} {{DATE}} {{DATE:YYYYMMDD}}",
		});
		desc.createEl("br");
		desc.createSpan({
			text: "frontmatter内（先頭の --- で囲まれた範囲）に挿入される値は、YAMLが壊れないよう自動でエスケープされます。",
		});

		new Setting(containerEl)
			.setClass("jpbooks-template-setting")
			.addTextArea((textarea) => {
				textarea
					.setValue(this.plugin.settings.template)
					.onChange(async (value) => {
						this.plugin.settings.template = value;
						await this.plugin.saveSettings();
					});
				textarea.inputEl.rows = 18;
				textarea.inputEl.addClass("jpbooks-template-input");
			});

		new Setting(containerEl)
			.setName("テンプレートを初期状態に戻す")
			.addButton((button) =>
				button.setButtonText("リセット").onClick(async () => {
					this.plugin.settings.template = DEFAULT_TEMPLATE;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(containerEl).setName("データソース").setHeading();
		const sources = containerEl.createDiv({ cls: "setting-item-description" });
		sources.createSpan({
			text: "検索: 国立国会図書館サーチ SRU API / 内容紹介: openBD。どちらも認証不要のため、APIキーの設定は必要ありません。",
		});
	}
}
