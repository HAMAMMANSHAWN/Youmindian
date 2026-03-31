import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type YouMindPlugin from './main';

export class YouMindSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: YouMindPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'YouMind settings' });

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Get your key from youmind.com/settings/api-keys')
			.addText((text) =>
				text
					.setPlaceholder('Enter your YouMind API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.boardContext.initialize();
					}),
			)
			.addButton((button) =>
				button.setButtonText('Validate API key').onClick(async () => {
					if (!this.plugin.settings.apiKey) {
						new Notice('Please enter your YouMind API key first.');
						return;
					}
					button.setButtonText('Validating...');
					button.setDisabled(true);
					try {
						const isValid = await this.plugin.api.validateApiKey();
						new Notice(isValid ? 'API key validated successfully.' : 'API key is invalid or unavailable.');
					} finally {
						button.setButtonText('Validate API key');
						button.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl)
			.setName('Sync root folder')
			.setDesc('Root folder used for local YouMind synced content')
			.addText((text) =>
				text
					.setPlaceholder('youmind')
					.setValue(this.plugin.settings.syncRoot ?? 'youmind')
					.onChange(async (value) => {
						this.plugin.settings.syncRoot = value.trim() || 'youmind';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Pull conflict strategy')
			.setDesc('How to handle local changes when pulling linked files from YouMind')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('ask', 'Ask every time')
					.addOption('skip', 'Skip local changes')
					.addOption('overwrite', 'Always overwrite')
					.setValue(this.plugin.settings.pullConflictStrategy ?? 'ask')
					.onChange(async (value) => {
						this.plugin.settings.pullConflictStrategy = value as 'ask' | 'skip' | 'overwrite';
						await this.plugin.saveSettings();
					}),
			);
	}
}
