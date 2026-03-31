import { App, Modal, setIcon } from 'obsidian';
import type { Chat, ChatListResponse } from './api';
import type { BoardContext } from './board-context';
import { HISTORY_PAGE_SIZE } from './types';

export interface HistoryPanelCallbacks {
	fetchChats: (boardId: string, page: number, pageSize: number) => Promise<ChatListResponse>;
	onSelectChat: (chatId: string) => Promise<void>;
	onNewChat: () => Promise<void>;
	onHideChat: (chat: Chat) => Promise<void>;
	onVisibilityChange?: (isOpen: boolean) => void;
}

interface TimeGroup {
	label: string;
	chats: Chat[];
}

export class HistoryPanel {
	private panelEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private isOpen = false;
	private allChats: Chat[] = [];
	private filteredChats: Chat[] = [];
	private currentPage = 0;
	private totalChats = 0;
	private isLoadingMore = false;
	private activeChatId: string | null = null;
	private unsubBoardChange: (() => void) | null = null;
	private boundOnKeydown: (event: KeyboardEvent) => void;
	private boundOnScroll: () => void;

	constructor(
		private containerEl: HTMLElement,
		private boardContext: BoardContext,
		private callbacks: HistoryPanelCallbacks,
	) {
		this.boundOnKeydown = this.onKeydown.bind(this);
		this.boundOnScroll = this.onScroll.bind(this);

		this.unsubBoardChange = this.boardContext.onChange(() => {
			if (this.isOpen) {
				void this.resetAndLoad();
			}
		});
	}

	getIsOpen(): boolean {
		return this.isOpen;
	}

	setActiveChatId(chatId: string | null): void {
		this.activeChatId = chatId;
		if (this.isOpen) {
			this.renderList();
		}
	}

	async open(): Promise<void> {
		if (this.isOpen) {
			return;
		}
		this.isOpen = true;
		this.callbacks.onVisibilityChange?.(true);

		this.panelEl = this.containerEl.createDiv({ cls: 'ym-history-panel' });
		const headerEl = this.panelEl.createDiv({ cls: 'ym-history-header' });
		headerEl.createSpan({ cls: 'ym-history-title', text: 'Conversations' });

		const closeBtn = headerEl.createDiv({
			cls: 'ym-history-close clickable-icon',
			attr: { 'aria-label': 'Close history' },
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const searchRow = this.panelEl.createDiv({ cls: 'ym-history-search' });
		const searchIcon = searchRow.createSpan({ cls: 'ym-history-search-icon' });
		setIcon(searchIcon, 'search');

		this.searchInputEl = searchRow.createEl('input', {
			cls: 'ym-history-search-input',
			attr: {
				type: 'text',
				placeholder: 'Search conversations...',
				spellcheck: 'false',
			},
		});
		this.searchInputEl.addEventListener('input', () => this.onSearchInput());

		const newChatBtn = searchRow.createDiv({
			cls: 'ym-history-new-chat clickable-icon',
			attr: { 'aria-label': 'New conversation' },
		});
		setIcon(newChatBtn, 'square-pen');
		newChatBtn.addEventListener('click', async (event) => {
			event.stopPropagation();
			await this.callbacks.onNewChat();
			this.close();
		});

		this.listEl = this.panelEl.createDiv({ cls: 'ym-history-list' });
		this.listEl.addEventListener('scroll', this.boundOnScroll);

		document.addEventListener('keydown', this.boundOnKeydown, true);

		await this.resetAndLoad();
		window.setTimeout(() => this.searchInputEl?.focus(), 0);
	}

	close(): void {
		if (!this.isOpen) {
			this.forceCleanupDom();
			return;
		}
		this.isOpen = false;
		this.callbacks.onVisibilityChange?.(false);
		document.removeEventListener('keydown', this.boundOnKeydown, true);
		this.forceCleanupDom();
	}

	toggle(): void {
		if (this.isOpen) {
			this.close();
			return;
		}
		void this.open();
	}

	async refresh(): Promise<void> {
		if (this.isOpen) {
			await this.resetAndLoad();
		}
	}

	private async resetAndLoad(): Promise<void> {
		this.allChats = [];
		this.filteredChats = [];
		this.currentPage = 0;
		this.totalChats = 0;
		this.isLoadingMore = false;
		if (this.searchInputEl) {
			this.searchInputEl.value = '';
		}
		await this.loadPage(0);
	}

	private async loadPage(page: number): Promise<void> {
		const boardId = this.boardContext.getBoardId();
		if (!boardId) {
			this.renderEmpty('Select a board to see conversations');
			return;
		}

		if (page === 0) {
			this.renderLoading();
		}

		this.isLoadingMore = true;
		try {
			const result = await this.callbacks.fetchChats(boardId, page, HISTORY_PAGE_SIZE);
			this.allChats = page === 0 ? result.data : [...this.allChats, ...result.data];
			this.totalChats = result.total;
			this.currentPage = page;
			this.applyFilter();
			this.renderList();
		} catch (error) {
			if (page === 0) {
				this.renderError(error instanceof Error ? error.message : 'Failed to load conversations');
			}
		} finally {
			this.isLoadingMore = false;
		}
	}

	private get hasMorePages(): boolean {
		return this.allChats.length < this.totalChats;
	}

	private onSearchInput(): void {
		this.applyFilter();
		this.renderList();
	}

	private applyFilter(): void {
		const query = this.searchInputEl?.value.toLowerCase().trim() ?? '';
		this.filteredChats = query
			? this.allChats.filter((chat) => chat.title.toLowerCase().includes(query))
			: this.allChats;
	}

	private renderLoading(): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();
		const loadingEl = this.listEl.createDiv({ cls: 'ym-history-empty' });
		const spinner = loadingEl.createSpan({ cls: 'ym-spin' });
		setIcon(spinner, 'loader-2');
		loadingEl.createSpan().setText(' Loading conversations...');
	}

	private renderEmpty(message: string): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();
		this.listEl.createDiv({ cls: 'ym-history-empty', text: message });
	}

	private renderError(message: string): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();
		this.listEl.createDiv({ cls: 'ym-history-error', text: message });
	}

	private renderList(): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();

		if (this.filteredChats.length === 0) {
			this.renderEmpty(this.searchInputEl?.value ? 'No conversations match your search' : 'No conversations yet');
			return;
		}

		for (const group of this.groupByTime(this.filteredChats)) {
			this.listEl.createDiv({
				cls: 'ym-history-group-header',
				text: group.label,
			});
			for (const chat of group.chats) {
				this.renderChatItem(chat);
			}
		}

		if (this.hasMorePages && !this.searchInputEl?.value) {
			const loadMoreEl = this.listEl.createDiv({ cls: 'ym-history-load-more' });
			const spinner = loadMoreEl.createSpan({ cls: 'ym-spin' });
			setIcon(spinner, 'loader-2');
			loadMoreEl.createSpan().setText(' Loading more...');
		}
	}

	private renderChatItem(chat: Chat): void {
		if (!this.listEl) {
			return;
		}
		const isActive = chat.id === this.activeChatId;
		const itemEl = this.listEl.createDiv({
			cls: `ym-history-item${isActive ? ' is-active' : ' is-clickable'}`,
		});

		const iconEl = itemEl.createDiv({ cls: 'ym-history-item-icon' });
		setIcon(iconEl, isActive ? 'message-square-dot' : 'message-square');

		const contentEl = itemEl.createDiv({ cls: 'ym-history-item-content' });
		const titleEl = contentEl.createDiv({ cls: 'ym-history-item-title' });
		titleEl.setText(chat.title || 'Untitled');
		titleEl.setAttribute('title', chat.title || 'Untitled');

		const metaEl = contentEl.createDiv({ cls: 'ym-history-item-meta' });
		metaEl.createSpan({
			cls: 'ym-history-item-time',
			text: isActive ? 'Current' : this.formatDate(chat.updatedAt),
		});

		if (chat.status === 'answering' || chat.status === 'thinking') {
			const statusEl = metaEl.createSpan({ cls: 'ym-history-item-status' });
			const spinnerEl = statusEl.createSpan({ cls: 'ym-spin' });
			setIcon(spinnerEl, 'loader-2');
		}

		if (chat.hasUnread && !isActive) {
			metaEl.createSpan({ cls: 'ym-history-item-unread' });
		}

		const actionsEl = itemEl.createDiv({ cls: 'ym-history-item-actions' });
		const hideBtn = actionsEl.createDiv({
			cls: 'ym-history-item-delete clickable-icon',
			attr: { 'aria-label': 'Hide conversation' },
		});
		setIcon(hideBtn, 'trash-2');
		hideBtn.addEventListener('click', async (event) => {
			event.stopPropagation();
			await this.callbacks.onHideChat(chat);
		});

		if (!isActive) {
			itemEl.addEventListener('click', async () => {
				this.close();
				await this.callbacks.onSelectChat(chat.id);
			});
		}
	}

	private groupByTime(chats: Chat[]): TimeGroup[] {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
		const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
		const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
		const buckets: TimeGroup[] = [
			{ label: 'Today', chats: [] },
			{ label: 'Yesterday', chats: [] },
			{ label: 'This week', chats: [] },
			{ label: 'This month', chats: [] },
			{ label: 'Older', chats: [] },
		];

		for (const chat of chats) {
			const date = new Date(chat.updatedAt);
				if (date >= today) {
					buckets[0]?.chats.push(chat);
				} else if (date >= yesterday) {
					buckets[1]?.chats.push(chat);
				} else if (date >= lastWeek) {
					buckets[2]?.chats.push(chat);
				} else if (date >= lastMonth) {
					buckets[3]?.chats.push(chat);
				} else {
					buckets[4]?.chats.push(chat);
			}
		}

		return buckets.filter((group) => group.chats.length > 0);
	}

	private formatDate(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const sameDay = date.toDateString() === now.toDateString();
		if (sameDay) {
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	private onKeydown(event: KeyboardEvent): void {
		if (!this.isOpen) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.close();
		}
	}

	private onScroll(): void {
		if (!this.listEl || this.isLoadingMore || !this.hasMorePages || this.searchInputEl?.value) {
			return;
		}
		const threshold = 96;
		if (this.listEl.scrollTop + this.listEl.clientHeight >= this.listEl.scrollHeight - threshold) {
			void this.loadPage(this.currentPage + 1);
		}
	}

	private forceCleanupDom(): void {
		this.listEl?.removeEventListener('scroll', this.boundOnScroll);
		this.panelEl?.remove();
		this.containerEl.querySelectorAll('.ym-history-panel, .ym-history-backdrop').forEach((element) => {
			element.remove();
		});
		this.panelEl = null;
		this.listEl = null;
		this.searchInputEl = null;
	}

	destroy(): void {
		this.close();
		this.unsubBoardChange?.();
	}
}

export class ConfirmHideModal extends Modal {
	private resolver: ((value: boolean) => void) | null = null;

	constructor(
		app: App,
		private chatTitle: string,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('youmind-confirm-modal');
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Hide conversation?' });
		contentEl.createEl('p', {
			text: `This only hides "${this.chatTitle || 'Untitled conversation'}" inside Obsidian. The chat will remain in YouMind cloud history, and true cloud deletion can be added later.`,
		});

		const actions = contentEl.createDiv({ cls: 'youmind-confirm-actions' });
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		const confirmBtn = actions.createEl('button', {
			text: 'Hide conversation',
			cls: 'mod-cta',
		});

		cancelBtn.addEventListener('click', () => {
			this.resolver?.(false);
			this.close();
		});
		confirmBtn.addEventListener('click', () => {
			this.resolver?.(true);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolver) {
			const resolver = this.resolver;
			this.resolver = null;
			resolver(false);
		}
	}

	openAndWait(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.resolver = (value) => {
				if (this.resolver) {
					this.resolver = null;
					resolve(value);
				}
			};
			this.open();
		});
	}
}
