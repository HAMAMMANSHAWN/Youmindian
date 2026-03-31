import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { YouMindAPI } from './api';
import { BoardContext } from './board-context';
import { BrowserView } from './browser-view';
import { YouMindChatView } from './chat-view';
import { FrontmatterManager, type SyncStatus } from './frontmatter-manager';
import { isPushCanceledError, pushCurrentNoteToYouMind, pushFileToYouMind, showPushSuccessPanel } from './push-service';
import { YouMindSettingTab } from './settings-tab';
import {
	DEFAULT_SETTINGS,
	type YouMindSettings,
	VIEW_TYPE_YOUMIND_BROWSER,
	VIEW_TYPE_YOUMIND_CHAT,
} from './types';

export default class YouMindPlugin extends Plugin {
	settings!: YouMindSettings;
	api!: YouMindAPI;
	boardContext!: BoardContext;
	frontmatterManager!: FrontmatterManager;
	private currentPushActionEl: HTMLElement | null = null;
	private currentPushActionView: MarkdownView | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.api = new YouMindAPI(this.settings.apiKey);
		this.frontmatterManager = new FrontmatterManager(this.app);
		this.boardContext = new BoardContext(
			this.api,
			() => this.settings.apiKey,
			async (boardId) => {
				this.settings.lastBoardId = boardId ?? undefined;
				await this.saveSettings();
			},
			() => this.settings.lastBoardId ?? null,
		);

		this.registerView(VIEW_TYPE_YOUMIND_CHAT, (leaf) => new YouMindChatView(leaf, this));
		this.registerView(VIEW_TYPE_YOUMIND_BROWSER, (leaf) => new BrowserView(leaf, this));

		this.addRibbonIcon('message-circle', 'Open youmindian', () => {
			void this.activateView();
		});
		this.addRibbonIcon('library', 'Open Board Content Browser', () => {
			void this.activateBrowserView();
		});

		this.addCommand({
			id: 'open-youmind-chat',
			name: 'Open youmindian',
			callback: () => {
				void this.activateView();
			},
		});
		this.addCommand({
			id: 'open-youmind-browser',
			name: 'Open Board Content Browser',
			callback: () => {
				void this.activateBrowserView();
			},
		});

		this.addCommand({
			id: 'push-current-note-to-youmind',
			name: 'Push current note to YouMind',
			callback: () => {
				void pushCurrentNoteToYouMind(this);
			},
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle('Push to YouMind')
						.setIcon('cloud-upload')
						.onClick(() => {
							const boardId = this.frontmatterManager.read(file)?.youmind_board ?? this.boardContext.getBoardId();
							if (!boardId) {
								void pushCurrentNoteToYouMind(this);
								return;
							}
							void pushFileToYouMind(this, file, boardId)
								.then((result) => {
									return showPushSuccessPanel(this, file, result).finally(() => this.refreshPushAction());
								})
								.catch((error) => {
									if (isPushCanceledError(error)) {
										return;
									}
									new Notice(`Push failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
								});
						}),
				);
			}),
		);

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshPushAction()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.refreshPushAction()));
		this.registerEvent(this.app.workspace.on('editor-change', (_, info) => {
			if (info instanceof MarkdownView) {
				this.refreshPushAction(info);
			}
		}));

		this.addSettingTab(new YouMindSettingTab(this.app, this));
		this.frontmatterManager.scanLinkedFiles();
		void this.boardContext.initialize();
		this.app.workspace.onLayoutReady(() => this.refreshPushAction());
	}

	onunload(): void {
		this.removePushAction();
		this.boardContext?.destroy();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.hiddenChatIds = this.settings.hiddenChatIds ?? [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.api?.setApiKey(this.settings.apiKey);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_YOUMIND_CHAT);

			if (leaves.length > 0) {
				leaf = leaves[0] ?? null;
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: VIEW_TYPE_YOUMIND_CHAT,
				active: true,
			});
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateBrowserView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_YOUMIND_BROWSER)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: VIEW_TYPE_YOUMIND_BROWSER,
				active: true,
			});
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	getCurrentBoardId(): string | null {
		return this.boardContext.getBoardId();
	}

	getCurrentBoardName(): string | null {
		return this.boardContext.getBoard()?.name ?? null;
	}

	private refreshPushAction(view?: MarkdownView | null): void {
		const markdownView = view ?? this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.file) {
			this.removePushAction();
			return;
		}

		if (this.currentPushActionView !== markdownView) {
			this.removePushAction();
		}
		if (this.currentPushActionEl) {
			this.decoratePushAction(this.currentPushActionEl, markdownView.file);
			return;
		}

		const actionEl = markdownView.addAction('cloud', 'Push to YouMind', () => {
			void pushCurrentNoteToYouMind(this).finally(() => this.refreshPushAction(markdownView));
		});
		actionEl.addClass('youmind-note-sync-action');
		this.currentPushActionEl = actionEl;
		this.currentPushActionView = markdownView;
		this.decoratePushAction(actionEl, markdownView.file);
	}

	private removePushAction(): void {
		this.currentPushActionEl?.remove();
		this.currentPushActionEl = null;
		this.currentPushActionView = null;
	}

	private decoratePushAction(actionEl: HTMLElement, file: TFile): void {
		const status = this.frontmatterManager.getSyncStatus(file);
		const state = this.getPushActionState(status);
		setIcon(actionEl, state.icon);
		actionEl.setAttribute('aria-label', state.label);
		actionEl.setAttribute('title', state.label);
		actionEl.removeClass('is-unlinked', 'is-synced', 'is-modified');
		actionEl.addClass(state.className);
	}

	private getPushActionState(status: SyncStatus): { icon: string; label: string; className: string } {
		switch (status) {
			case 'synced':
				return {
					icon: 'check-check',
					label: 'Synced with YouMind',
					className: 'is-synced',
				};
			case 'modified':
				return {
					icon: 'refresh-cw',
					label: 'Push changes to YouMind',
					className: 'is-modified',
				};
			default:
				return {
					icon: 'cloud-upload',
					label: 'Push to YouMind',
					className: 'is-unlinked',
				};
		}
	}
}
