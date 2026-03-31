import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	setIcon,
} from 'obsidian';
import {
	type Board,
	type BoardContextState,
	type Chat,
	type ChatListResponse,
	type ChatMode,
	type CreatePickParams,
	type Message,
	type SendMessageResponse,
	YouMindAPI,
	extractAssistantContent,
	invalidateBoardCache,
} from './api';

const VIEW_TYPE_YOUMIND_CHAT = 'youmind-chat-view';
const DEFAULT_CHAT_TITLE = 'YouMind';
const HISTORY_PAGE_SIZE = 20;

interface YouMindSettings {
	apiKey: string;
	lastBoardId?: string;
	hiddenChatIds?: string[];
}

const DEFAULT_SETTINGS: YouMindSettings = {
	apiKey: '',
	lastBoardId: undefined,
	hiddenChatIds: [],
};

type BoardChangeListener = (board: Board | null) => void;

class BoardContext {
	private state: BoardContextState = {
		currentBoard: null,
		boards: [],
		isLoading: false,
		error: null,
	};

	private listeners = new Set<BoardChangeListener>();
	private initializePromise: Promise<void> | null = null;
	private destroyed = false;

	constructor(
		private api: YouMindAPI,
		private getApiKey: () => string,
		private persistBoardId: (boardId: string | null) => Promise<void>,
		private loadPersistedBoardId: () => string | null,
	) {}

	initialize(): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.initializeInternal().finally(() => {
				this.initializePromise = null;
			});
		}
		return this.initializePromise;
	}

	private async initializeInternal(): Promise<void> {
		if (this.destroyed) {
			return;
		}

		const apiKey = this.getApiKey().trim();
		if (!apiKey) {
			this.state = {
				currentBoard: null,
				boards: [],
				isLoading: false,
				error: 'Please set your YouMind API key in settings.',
			};
			this.emit();
			return;
		}

		this.state = { ...this.state, isLoading: true, error: null };
		this.emit();

		try {
			const boards = await this.api.listBoards(true);
			let currentBoard: Board | null = null;
			const persistedBoardId = this.loadPersistedBoardId();

			if (persistedBoardId) {
				currentBoard = boards.find((board) => board.id === persistedBoardId) ?? null;
			}

			if (!currentBoard) {
				const defaultBoard = await this.api.getDefaultBoard(true);
				if (defaultBoard) {
					currentBoard = boards.find((board) => board.id === defaultBoard.id) ?? defaultBoard;
				}
			}

			if (!currentBoard && boards.length > 0) {
				currentBoard = boards[0] ?? null;
			}

			this.state = {
				currentBoard,
				boards,
				isLoading: false,
				error: null,
			};

			await this.persistBoardId(currentBoard?.id ?? null);
		} catch (error) {
			this.state = {
				currentBoard: null,
				boards: [],
				isLoading: false,
				error: error instanceof Error ? error.message : 'Failed to load boards.',
			};
		}

		this.emit();
	}

	async refresh(): Promise<void> {
		invalidateBoardCache();
		const previousBoardId = this.state.currentBoard?.id ?? null;
		this.state = { ...this.state, isLoading: true, error: null };
		this.emit();

		try {
			const boards = await this.api.listBoards(true);
			let nextBoard =
				(previousBoardId ? boards.find((board) => board.id === previousBoardId) : null) ??
				null;

			if (!nextBoard) {
				const defaultBoard = await this.api.getDefaultBoard(true);
				if (defaultBoard) {
					nextBoard = boards.find((board) => board.id === defaultBoard.id) ?? defaultBoard;
				}
			}

			if (!nextBoard && boards.length > 0) {
				nextBoard = boards[0] ?? null;
			}

			this.state = {
				currentBoard: nextBoard,
				boards,
				isLoading: false,
				error: null,
			};
			await this.persistBoardId(nextBoard?.id ?? null);
		} catch (error) {
			this.state = {
				...this.state,
				isLoading: false,
				error: error instanceof Error ? error.message : 'Failed to refresh boards.',
			};
		}

		this.emit();
	}

	async setBoard(board: Board | null): Promise<void> {
		this.state = {
			...this.state,
			currentBoard: board,
			error: null,
		};
		await this.persistBoardId(board?.id ?? null);
		this.emit();
	}

	getBoard(): Board | null {
		return this.state.currentBoard;
	}

	getBoardId(): string | null {
		return this.state.currentBoard?.id ?? null;
	}

	getBoards(): Board[] {
		return this.state.boards;
	}

	getIsLoading(): boolean {
		return this.state.isLoading;
	}

	getError(): string | null {
		return this.state.error;
	}

	onChange(listener: BoardChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	destroy(): void {
		this.destroyed = true;
		this.listeners.clear();
	}

	private emit(): void {
		const currentBoard = this.state.currentBoard;
		for (const listener of this.listeners) {
			listener(currentBoard);
		}
	}
}

class BoardSelector {
	private containerEl: HTMLElement;
	private triggerEl: HTMLElement;
	private dropdownEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private isOpen = false;
	private filteredBoards: Board[] = [];
	private highlightIndex = -1;
	private unsubscribeBoardChange: (() => void) | null = null;
	private boundOnClickOutside: (event: MouseEvent) => void;
	private boundOnKeydown: (event: KeyboardEvent) => void;

	constructor(
		private parentEl: HTMLElement,
		private boardContext: BoardContext,
	) {
		this.boundOnClickOutside = this.onClickOutside.bind(this);
		this.boundOnKeydown = this.onKeydown.bind(this);

		this.containerEl = this.parentEl.createDiv({ cls: 'ym-board-selector' });
		this.triggerEl = this.containerEl.createDiv({
			cls: 'ym-board-selector-trigger',
		});
		this.triggerEl.addEventListener('click', () => this.toggle());
		this.renderTrigger();

		this.unsubscribeBoardChange = this.boardContext.onChange(() => {
			this.renderTrigger();
			if (this.isOpen) {
				this.filteredBoards = this.boardContext.getBoards();
				this.renderList();
			}
		});
	}

	private renderTrigger(): void {
		this.triggerEl.empty();

		const board = this.boardContext.getBoard();
		const isLoading = this.boardContext.getIsLoading();

		const iconEl = this.triggerEl.createSpan({
			cls: 'ym-board-selector-icon',
		});
		if (isLoading) {
			setIcon(iconEl, 'loader-2');
			iconEl.addClass('ym-spin');
		} else {
			setIcon(iconEl, 'layout-dashboard');
		}

		const nameEl = this.triggerEl.createSpan({
			cls: 'ym-board-selector-name',
		});
		if (isLoading) {
			nameEl.setText('Loading...');
		} else if (board) {
			nameEl.setText(board.name);
			nameEl.setAttribute('title', board.name);
		} else {
			nameEl.setText('No board');
			nameEl.addClass('ym-text-muted');
		}

		const chevronEl = this.triggerEl.createSpan({
			cls: 'ym-board-selector-chevron',
		});
		setIcon(chevronEl, this.isOpen ? 'chevron-up' : 'chevron-down');
	}

	toggle(): void {
		if (this.isOpen) {
			this.close();
			return;
		}
		this.open();
	}

	open(): void {
		if (this.isOpen) {
			return;
		}
		this.isOpen = true;
		this.renderTrigger();

		this.dropdownEl = this.containerEl.createDiv({
			cls: 'ym-board-dropdown ym-board-dropdown--upward',
		});

		this.listEl = this.dropdownEl.createDiv({
			cls: 'ym-board-dropdown-list',
		});

		const searchRow = this.dropdownEl.createDiv({
			cls: 'ym-board-dropdown-search',
		});
		const searchIconEl = searchRow.createSpan({
			cls: 'ym-board-dropdown-search-icon',
		});
		setIcon(searchIconEl, 'search');

		this.searchInputEl = searchRow.createEl('input', {
			cls: 'ym-board-dropdown-search-input',
			attr: {
				type: 'text',
				placeholder: 'Search boards...',
				spellcheck: 'false',
			},
		});
		this.searchInputEl.addEventListener('input', () => this.onSearchInput());

		const refreshBtn = searchRow.createDiv({
			cls: 'ym-board-dropdown-refresh clickable-icon',
			attr: { 'aria-label': 'Refresh board list' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', async (event) => {
			event.stopPropagation();
			await this.onRefresh(refreshBtn);
		});

		if (this.boardContext.getIsLoading()) {
			this.renderLoading();
		} else {
			this.filteredBoards = this.boardContext.getBoards();
			this.highlightIndex = -1;
			this.renderList();
		}

		window.setTimeout(() => this.searchInputEl?.focus(), 0);
		document.addEventListener('click', this.boundOnClickOutside, true);
		document.addEventListener('keydown', this.boundOnKeydown, true);
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this.isOpen = false;
		this.dropdownEl?.remove();
		this.dropdownEl = null;
		this.searchInputEl = null;
		this.listEl = null;
		this.renderTrigger();
		document.removeEventListener('click', this.boundOnClickOutside, true);
		document.removeEventListener('keydown', this.boundOnKeydown, true);
	}

	private renderLoading(): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();
		const loadingEl = this.listEl.createDiv({ cls: 'ym-board-dropdown-empty' });
		const spinnerEl = loadingEl.createSpan({ cls: 'ym-spin' });
		setIcon(spinnerEl, 'loader-2');
		loadingEl.createSpan().setText(' Loading boards...');
	}

	private renderList(): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();

		const currentBoardId = this.boardContext.getBoardId();
		const error = this.boardContext.getError();

		if (error && this.filteredBoards.length === 0) {
			this.listEl.createDiv({
				cls: 'ym-board-dropdown-error',
				text: error,
			});
			return;
		}

		if (this.filteredBoards.length === 0) {
			this.listEl.createDiv({
				cls: 'ym-board-dropdown-empty',
				text: this.searchInputEl?.value ? 'No boards match your search' : 'No boards found',
			});
			return;
		}

		this.filteredBoards.forEach((board, index) => {
			const itemEl = this.listEl!.createDiv({ cls: 'ym-board-dropdown-item' });
			const isActive = board.id === currentBoardId;
			if (isActive) {
				itemEl.addClass('is-active');
			}
			if (index === this.highlightIndex) {
				itemEl.addClass('is-highlighted');
			}

			const indicatorEl = itemEl.createSpan({
				cls: 'ym-board-dropdown-item-indicator',
			});
			if (isActive) {
				setIcon(indicatorEl, 'check');
			}

			const iconEl = itemEl.createSpan({ cls: 'ym-board-dropdown-item-icon' });
			setIcon(iconEl, 'layout-dashboard');

			const nameEl = itemEl.createSpan({ cls: 'ym-board-dropdown-item-name' });
			nameEl.setText(board.name);

			if (board.isDefault) {
				const badgeEl = itemEl.createSpan({
					cls: 'ym-board-dropdown-item-badge',
				});
				badgeEl.setText('Default');
			}

			itemEl.addEventListener('click', (event) => {
				event.stopPropagation();
				void this.selectBoard(board);
			});

			itemEl.addEventListener('mouseenter', () => {
				this.highlightIndex = index;
				this.updateHighlight();
			});
		});
	}

	private updateHighlight(): void {
		if (!this.listEl) {
			return;
		}
		const items = this.listEl.querySelectorAll('.ym-board-dropdown-item');
		items.forEach((item, index) => {
			item.classList.toggle('is-highlighted', index === this.highlightIndex);
		});
	}

	private scrollHighlightIntoView(): void {
		if (!this.listEl) {
			return;
		}
		const items = this.listEl.querySelectorAll<HTMLElement>('.ym-board-dropdown-item');
		if (this.highlightIndex >= 0 && this.highlightIndex < items.length) {
			const item = items[this.highlightIndex];
			item?.scrollIntoView({ block: 'nearest' });
		}
	}

	private async selectBoard(board: Board): Promise<void> {
		await this.boardContext.setBoard(board);
		this.close();
	}

	private onSearchInput(): void {
		const query = this.searchInputEl?.value.toLowerCase().trim() ?? '';
		const boards = this.boardContext.getBoards();
		this.filteredBoards = query
			? boards.filter((board) => {
					const description = board.description?.toLowerCase() ?? '';
					return board.name.toLowerCase().includes(query) || description.includes(query);
				})
			: boards;
		this.highlightIndex = -1;
		this.renderList();
	}

	private async onRefresh(buttonEl: HTMLElement): Promise<void> {
		buttonEl.addClass('ym-spin');
		try {
			await this.boardContext.refresh();
			if (this.searchInputEl?.value) {
				this.onSearchInput();
			} else {
				this.filteredBoards = this.boardContext.getBoards();
				this.renderList();
			}
		} finally {
			buttonEl.removeClass('ym-spin');
		}
	}

	private onClickOutside(event: MouseEvent): void {
		if (!this.containerEl.contains(event.target as Node)) {
			this.close();
		}
	}

	private onKeydown(event: KeyboardEvent): void {
		if (!this.isOpen) {
			return;
		}

		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				this.close();
				break;
			case 'ArrowDown':
				event.preventDefault();
				event.stopPropagation();
				this.highlightIndex = Math.min(this.highlightIndex + 1, this.filteredBoards.length - 1);
				this.updateHighlight();
				this.scrollHighlightIntoView();
				break;
			case 'ArrowUp':
				event.preventDefault();
				event.stopPropagation();
				this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
				this.updateHighlight();
				this.scrollHighlightIntoView();
				break;
			case 'Enter':
				event.preventDefault();
				event.stopPropagation();
					if (this.highlightIndex >= 0 && this.highlightIndex < this.filteredBoards.length) {
						const board = this.filteredBoards[this.highlightIndex];
						if (board) {
							void this.selectBoard(board);
						}
				}
				break;
		}
	}

	destroy(): void {
		this.close();
		this.unsubscribeBoardChange?.();
		this.containerEl.remove();
	}
}

interface HistoryPanelCallbacks {
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

class HistoryPanel {
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

class ConfirmHideModal extends Modal {
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

class YouMindChatView extends ItemView {
	private messagesEl!: HTMLElement;
	private textInput!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private titleEl!: HTMLElement;
	private lastActiveMarkdownView: MarkdownView | null = null;
	private selectionToolbarEl: HTMLElement | null = null;
	private historyPanel: HistoryPanel | null = null;
	private boardSelector: BoardSelector | null = null;
	private currentChatId: string | null = null;
	private currentMode: 'ask' | 'agent' = 'ask';
	private modelSelect!: HTMLSelectElement;
	private contentWrapper!: HTMLElement;
	private inputWrapper!: HTMLElement;
	private unsubscribeBoardChange: (() => void) | null = null;
	private lastObservedBoardId: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: YouMindPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_YOUMIND_CHAT;
	}

	getDisplayText(): string {
		return 'YouMind Chat';
	}

	getIcon(): string {
		return 'message-circle';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('youmind-chat-container');
		this.trackMarkdownView(this.app.workspace.getActiveViewOfType(MarkdownView));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				this.trackMarkdownView(leaf?.view instanceof MarkdownView ? leaf.view : null);
			}),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.trackMarkdownView(this.app.workspace.getActiveViewOfType(MarkdownView));
			}),
		);

		const header = container.createEl('div', { cls: 'youmind-header' });
		this.buildHeader(header);

		this.contentWrapper = container.createEl('div', { cls: 'youmind-content-wrapper' });
		this.messagesEl = this.contentWrapper.createEl('div', { cls: 'youmind-messages' });
		this.showEmptyState();
		this.registerDomEvent(this.messagesEl, 'mouseup', () => {
			window.setTimeout(() => this.updateSelectionToolbar(), 0);
		});
		this.registerDomEvent(this.messagesEl, 'keyup', () => {
			window.setTimeout(() => this.updateSelectionToolbar(), 0);
		});
		this.registerDomEvent(this.messagesEl, 'mousedown', () => {
			this.hideSelectionToolbar();
		});
		this.registerDomEvent(document, 'selectionchange', () => {
			this.handleSelectionChange();
		});

		const contextBar = container.createEl('div', { cls: 'ym-context-bar' });
		this.boardSelector = new BoardSelector(contextBar, this.plugin.boardContext);

		this.inputWrapper = container.createEl('div', { cls: 'youmind-input-wrapper' });
		this.buildInputArea(this.inputWrapper);

		this.historyPanel = new HistoryPanel(this.contentWrapper, this.plugin.boardContext, {
			fetchChats: async (boardId, page, pageSize) => {
				const result = await this.plugin.api.listChats({ boardId, page, pageSize });
				const hiddenIds = new Set(this.plugin.settings.hiddenChatIds ?? []);
				return {
					...result,
					data: result.data.filter((chat) => !hiddenIds.has(chat.id)),
				};
			},
			onSelectChat: async (chatId) => {
				await this.resumeChat(chatId);
			},
			onNewChat: async () => {
				this.resetChat();
			},
			onHideChat: async (chat) => {
				const confirmed = await new ConfirmHideModal(this.app, chat.title || 'Untitled').openAndWait();
				if (!confirmed) {
					return;
				}
				const hiddenIds = new Set(this.plugin.settings.hiddenChatIds ?? []);
				hiddenIds.add(chat.id);
				this.plugin.settings.hiddenChatIds = [...hiddenIds];
				await this.plugin.saveSettings();
				if (this.historyPanel && chat.id === this.currentChatId) {
					this.historyPanel.setActiveChatId(null);
				}
				await this.historyPanel?.refresh();
			},
			onVisibilityChange: (isOpen) => {
				container.classList.toggle('youmind-history-open', isOpen);
				this.messagesEl.toggleClass('youmind-hidden', isOpen);
			},
		});

		this.lastObservedBoardId = this.plugin.boardContext.getBoardId();
		this.unsubscribeBoardChange = this.plugin.boardContext.onChange((board) => {
			const nextBoardId = board?.id ?? null;
			if (nextBoardId === this.lastObservedBoardId) {
				return;
			}
			this.lastObservedBoardId = nextBoardId;
			this.resetChat(false);
			this.addSystemMessage(`Switched to ${board?.name ?? 'No board'}`, 'folder');
			this.historyPanel?.setActiveChatId(null);
			void this.historyPanel?.refresh();
		});

		if (!this.plugin.settings.apiKey) {
			this.addSystemMessage('Please set your YouMind API key in settings.', 'alert-circle');
		}
	}

	private buildHeader(header: HTMLElement): void {
		const headerLeft = header.createEl('div', { cls: 'youmind-header-left' });
		const titleIcon = headerLeft.createEl('span', { cls: 'youmind-header-icon' });
		setIcon(titleIcon, 'sparkles');

		const headerCenter = header.createEl('div', { cls: 'youmind-header-center' });
		this.titleEl = headerCenter.createEl('span', {
			text: DEFAULT_CHAT_TITLE,
			cls: 'youmind-header-title',
		});
		const titleChevron = headerCenter.createEl('span', { cls: 'youmind-title-chevron' });
		setIcon(titleChevron, 'chevron-down');
		headerCenter.addEventListener('click', () => this.toggleHistoryPanel());

		const headerRight = header.createEl('div', { cls: 'youmind-header-actions' });
		const newChatBtn = headerRight.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'New conversation' },
		});
		setIcon(newChatBtn, 'pencil');
		newChatBtn.addEventListener('click', () => this.startNewChat());

		const historyBtn = headerRight.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Conversation history' },
		});
		setIcon(historyBtn, 'history');
		historyBtn.addEventListener('click', () => this.toggleHistoryPanel());
	}

	private buildInputArea(inputWrapper: HTMLElement): void {
		const controlBar = inputWrapper.createEl('div', { cls: 'youmind-control-bar' });

		const modelSelector = controlBar.createEl('div', { cls: 'youmind-model-selector' });
		const modelIcon = modelSelector.createEl('span', { cls: 'youmind-selector-icon' });
		setIcon(modelIcon, 'chevron-down');
		this.modelSelect = modelSelector.createEl('select', { cls: 'youmind-select' });
		const models = [
			{ value: 'claude-4-6-sonnet', label: 'Sonnet' },
			{ value: 'claude-4-6-opus', label: 'Opus' },
			{ value: 'gpt-5', label: 'GPT-5' },
			{ value: 'gemini-3.1-pro-preview', label: 'Gemini Pro' },
			{ value: 'deepseek-chat', label: 'DeepSeek' },
		];
		for (const model of models) {
			this.modelSelect.createEl('option', { value: model.value, text: model.label });
		}

		const modeToggle = controlBar.createEl('div', { cls: 'youmind-mode-toggle' });
		const chatModeBtn = modeToggle.createEl('button', {
			cls: 'youmind-mode-btn youmind-mode-active clickable-icon',
			attr: { 'aria-label': 'Chat mode' },
		});
		setIcon(chatModeBtn, 'message-circle');
		const agentModeBtn = modeToggle.createEl('button', {
			cls: 'youmind-mode-btn clickable-icon',
			attr: { 'aria-label': 'Agent mode' },
		});
		setIcon(agentModeBtn, 'bot');

		chatModeBtn.addEventListener('click', () => {
			this.currentMode = 'ask';
			chatModeBtn.addClass('youmind-mode-active');
			agentModeBtn.removeClass('youmind-mode-active');
		});
		agentModeBtn.addEventListener('click', () => {
			this.currentMode = 'agent';
			agentModeBtn.addClass('youmind-mode-active');
			chatModeBtn.removeClass('youmind-mode-active');
		});

		const inputContainer = inputWrapper.createEl('div', { cls: 'youmind-input-container' });
		this.textInput = inputContainer.createEl('textarea', {
			cls: 'youmind-input',
			attr: { placeholder: 'Describe a task or ask a question...', rows: '1' },
		});
		this.textInput.addEventListener('input', () => {
			this.textInput.style.height = 'auto';
			this.textInput.style.height = `${Math.min(this.textInput.scrollHeight, 150)}px`;
		});

		const toolbar = inputContainer.createEl('div', { cls: 'youmind-input-toolbar' });
		const attachBtn = toolbar.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Attach' },
		});
		setIcon(attachBtn, 'paperclip');

		const toolbarRight = toolbar.createEl('div', { cls: 'youmind-toolbar-right' });
		this.sendBtn = toolbarRight.createEl('button', {
			cls: 'youmind-send-btn clickable-icon',
			attr: { 'aria-label': 'Send' },
		}) as HTMLButtonElement;
		setIcon(this.sendBtn, 'arrow-up');

		this.sendBtn.addEventListener('click', () => void this.handleSend());
		this.textInput.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.handleSend();
			}
		});
	}

	private toggleHistoryPanel(): void {
		this.historyPanel?.toggle();
	}

	private startNewChat(): void {
		this.resetChat();
	}

	private resetChat(focusInput = true): void {
		this.currentChatId = null;
		this.updateTitle(DEFAULT_CHAT_TITLE);
		this.historyPanel?.close();
		this.messagesEl.empty();
		this.showEmptyState();
		this.historyPanel?.setActiveChatId(null);
		if (focusInput) {
			this.textInput.focus();
		}
	}

	private showEmptyState(): void {
		const emptyState = this.messagesEl.createEl('div', { cls: 'youmind-empty-state' });
		const emptyIcon = emptyState.createEl('div', { cls: 'youmind-empty-icon' });
		setIcon(emptyIcon, 'message-circle');
		emptyState.createEl('div', {
			text: 'Start a new conversation',
			cls: 'youmind-empty-text',
		});
	}

	private async handleSend(): Promise<void> {
		const content = this.textInput.value.trim();
		if (!content) {
			return;
		}

		if (!this.plugin.settings.apiKey) {
			new Notice('Please set your YouMind API key first.');
			return;
		}

		const emptyState = this.messagesEl.querySelector('.youmind-empty-state');
		emptyState?.remove();

		this.addUserMessage(content);
		this.textInput.value = '';
		this.textInput.style.height = 'auto';
		this.setInputEnabled(false);

		const loadingEl = this.createLoadingEl();
		this.messagesEl.appendChild(loadingEl);
		this.scrollToBottom();

		try {
			let response: SendMessageResponse;
			if (this.currentChatId) {
				response = await this.plugin.api.sendMessage({
					chatId: this.currentChatId,
					content,
					chatModel: this.modelSelect.value,
					messageMode: this.currentMode,
				});
			} else {
				response = await this.plugin.api.createChat(content, {
					boardId: this.plugin.boardContext.getBoardId() ?? undefined,
					chatModel: this.modelSelect.value,
					messageMode: this.currentMode,
				});
				this.currentChatId = response.id;
				this.historyPanel?.setActiveChatId(response.id);
			}

			loadingEl.remove();

			const assistantMessage = this.findLatestAssistantMessage(response.messages);
			if (assistantMessage) {
				await this.addAssistantMessage(extractAssistantContent(assistantMessage), assistantMessage.id);
			} else {
				this.addSystemMessage('No assistant reply received.', 'alert-circle');
			}

			this.updateTitle(response.title || content.slice(0, 20));
			await this.historyPanel?.refresh();
		} catch (error) {
			loadingEl.remove();
			const message = error instanceof Error ? error.message : 'Unknown error';
			this.addSystemMessage(`Request failed: ${message}`, 'x-circle');
		} finally {
			this.setInputEnabled(true);
			this.textInput.focus();
		}
	}

		private findLatestAssistantMessage(messages: Message[]): Message | null {
			for (let index = messages.length - 1; index >= 0; index--) {
				const message = messages[index];
				if (message?.role === 'assistant') {
					return message;
				}
			}
		return null;
	}

	private async resumeChat(chatId: string): Promise<void> {
		this.historyPanel?.close();
		this.currentChatId = chatId;
		this.historyPanel?.setActiveChatId(chatId);
		this.messagesEl.empty();
		const loadingEl = this.createLoadingEl('Loading conversation...');
		this.messagesEl.appendChild(loadingEl);
		this.scrollToBottom();

		try {
			const [messagesResponse, chat] = await Promise.all([
				this.plugin.api.listMessages(chatId),
				this.plugin.api.getChat(chatId),
			]);
			loadingEl.remove();
			this.messagesEl.empty();

			const sortedMessages = [...messagesResponse.messages].sort((left, right) => {
				const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
				const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
				return leftTime - rightTime;
			});

			if (sortedMessages.length === 0) {
				this.showEmptyState();
			} else {
				for (const message of sortedMessages) {
					await this.renderMessage(message);
				}
			}

			this.updateTitle(chat.title || DEFAULT_CHAT_TITLE);
			this.scrollToBottom();
			this.textInput.focus();
		} catch (error) {
			loadingEl.remove();
			this.messagesEl.empty();
			this.addSystemMessage(
				`Failed to load conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'alert-circle',
			);
		}
	}

	private async renderMessage(message: Message): Promise<void> {
		if (message.role === 'assistant') {
			const content = extractAssistantContent(message);
			if (content) {
				await this.addAssistantMessage(content, message.id);
			}
			return;
		}
		this.addUserMessage(message.content, message.id);
	}

	private addUserMessage(text: string, messageId?: string): void {
		const messageEl = this.messagesEl.createEl('div', {
			cls: 'youmind-message youmind-message-user',
		});
		if (messageId) {
			messageEl.dataset.messageId = messageId;
		}
		const contentEl = messageEl.createEl('div', {
			cls: 'youmind-message-content',
			text,
		});
		this.addMessageActions(messageEl, text, contentEl.textContent ?? text, messageId);
		this.scrollToBottom();
	}

	private async addAssistantMessage(markdown: string, messageId?: string): Promise<void> {
		const messageEl = this.messagesEl.createEl('div', {
			cls: 'youmind-message youmind-message-assistant',
		});
		if (messageId) {
			messageEl.dataset.messageId = messageId;
		}
		const contentEl = messageEl.createEl('div', { cls: 'youmind-message-content' });
		await MarkdownRenderer.render(this.app, markdown, contentEl, '', this);
		this.addMessageActions(messageEl, markdown, contentEl.textContent ?? markdown, messageId);

		this.scrollToBottom();
	}

	private addMessageActions(messageEl: HTMLElement, rawText: string, plainText: string, messageId?: string): void {
		const actions = messageEl.createEl('div', { cls: 'youmind-message-actions' });

		const copyMarkdownBtn = actions.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Copy as Markdown' },
		});
		setIcon(copyMarkdownBtn, 'copy');
		copyMarkdownBtn.addEventListener('click', async () => {
			await navigator.clipboard.writeText(rawText);
			new Notice('Copied as Markdown');
		});

		const copyTextBtn = actions.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Copy as text' },
		});
		setIcon(copyTextBtn, 'file-text');
		copyTextBtn.addEventListener('click', async () => {
			await navigator.clipboard.writeText(plainText);
			new Notice('Copied as text');
		});

		const insertBtn = actions.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Insert into active note' },
		});
		setIcon(insertBtn, 'file-input');
		insertBtn.addEventListener('click', () => {
			const markdownView = this.resolveInsertTargetView();
			const editor = markdownView?.editor;
			if (!editor) {
				new Notice('No note available to insert into');
				return;
			}
			editor.replaceSelection(rawText);
			new Notice(`Inserted into ${markdownView.file?.basename ?? 'note'}`);
		});

		const saveBtn = actions.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Save as note' },
		});
		setIcon(saveBtn, 'file-plus');
		saveBtn.addEventListener('click', async () => {
			const filePath = this.getAvailableNotePath(this.resolveNoteBaseName(rawText, plainText));
			try {
				await this.app.vault.create(filePath, rawText);
				new Notice(`Saved as ${filePath}`);
			} catch {
				new Notice('Failed to save note');
			}
		});

		const pickBtn = actions.createEl('button', {
			cls: 'youmind-icon-btn clickable-icon',
			attr: { 'aria-label': 'Save as Pick' },
		});
		setIcon(pickBtn, 'highlighter');
		pickBtn.addEventListener('click', async () => {
			await this.createPickForText({
				raw: rawText,
				plain: plainText,
				messageId,
				matchText: rawText,
			});
		});
	}

	private sanitizeFileName(value: string): string {
		return value.replace(/[\\/:*?"<>|]/g, ' ').trim() || DEFAULT_CHAT_TITLE;
	}

	private trackMarkdownView(view: MarkdownView | null): void {
		if (view?.editor && view.file) {
			this.lastActiveMarkdownView = view;
		}
	}

	private resolveInsertTargetView(): MarkdownView | null {
		if (this.lastActiveMarkdownView?.editor && this.lastActiveMarkdownView.file) {
			return this.lastActiveMarkdownView;
		}
		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeMarkdownView?.editor && activeMarkdownView.file) {
			return activeMarkdownView;
		}
		return null;
	}

	private resolveNoteBaseName(rawText: string, plainText: string): string {
		const currentTitle = this.titleEl.getAttribute('title')?.trim();
		if (currentTitle && currentTitle !== DEFAULT_CHAT_TITLE) {
			return this.sanitizeFileName(currentTitle);
		}

		const headingMatch = rawText.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m);
		if (headingMatch?.[1]) {
			return this.sanitizeFileName(headingMatch[1]);
		}

		const firstMeaningfulLine = plainText
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0);
		if (firstMeaningfulLine) {
			return this.sanitizeFileName(firstMeaningfulLine.slice(0, 80));
		}

		return DEFAULT_CHAT_TITLE;
	}

	private async createPickForText(args: {
		raw: string;
		plain: string;
		matchText: string;
		messageId?: string;
	}): Promise<void> {
		const boardId = this.plugin.boardContext.getBoardId();
		if (!boardId) {
			new Notice('Please select a board first');
			return;
		}
		if (!this.currentChatId) {
			new Notice('Pick is only available for saved chat messages');
			return;
		}

		const params: CreatePickParams = {
			boardId,
			content: {
				raw: args.raw,
				plain: args.plain,
			},
			source: {
				entityType: 'chat',
				entityId: this.currentChatId,
				selection: {
					matchText: args.matchText,
					selectedBy: 'USER',
					pickSelectionMessageId: args.messageId,
				},
				quote: {
					raw: args.raw,
					plain: args.plain,
				},
			},
		};

		try {
			await this.plugin.api.createPick(params);
			new Notice('Saved as Pick');
		} catch (error) {
			new Notice(`Failed to save Pick: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private handleSelectionChange(): void {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || !selection.toString().trim()) {
			this.hideSelectionToolbar();
			return;
		}

		const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		if (!range) {
			this.hideSelectionToolbar();
			return;
		}

		const commonNode =
			range.commonAncestorContainer.nodeType === Node.TEXT_NODE
				? range.commonAncestorContainer.parentElement
				: (range.commonAncestorContainer as HTMLElement | null);
		if (!commonNode || !this.messagesEl.contains(commonNode)) {
			this.hideSelectionToolbar();
		}
	}

	private updateSelectionToolbar(): void {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			this.hideSelectionToolbar();
			return;
		}

		const selectedText = selection.toString().trim();
		if (!selectedText) {
			this.hideSelectionToolbar();
			return;
		}

		const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		if (!range) {
			this.hideSelectionToolbar();
			return;
		}

		const commonNode =
			range.commonAncestorContainer.nodeType === Node.TEXT_NODE
				? range.commonAncestorContainer.parentElement
				: (range.commonAncestorContainer as HTMLElement | null);
		if (!commonNode || !this.messagesEl.contains(commonNode)) {
			this.hideSelectionToolbar();
			return;
		}

		const messageEl = commonNode.closest('.youmind-message') as HTMLElement | null;
		const messageId = messageEl?.dataset.messageId;
		const rect = range.getBoundingClientRect();
		if (!rect.width && !rect.height) {
			this.hideSelectionToolbar();
			return;
		}

		const hostRect = this.contentWrapper.getBoundingClientRect();
		const toolbar = this.ensureSelectionToolbar();
		const top = Math.max(8, rect.top - hostRect.top - 40);
		const left = Math.max(8, Math.min(rect.left - hostRect.left + rect.width / 2, hostRect.width - 8));
		toolbar.style.top = `${top}px`;
		toolbar.style.left = `${left}px`;
		toolbar.dataset.messageId = messageId ?? '';
		toolbar.dataset.selectionText = selectedText;
		toolbar.removeClass('youmind-hidden');
	}

	private ensureSelectionToolbar(): HTMLElement {
		if (this.selectionToolbarEl) {
			return this.selectionToolbarEl;
		}

		const toolbar = this.contentWrapper.createEl('div', {
			cls: 'youmind-selection-toolbar youmind-hidden',
		});

		const pickBtn = toolbar.createEl('button', {
			cls: 'youmind-selection-toolbar-btn clickable-icon',
			attr: { 'aria-label': '摘录' },
		});
		setIcon(pickBtn, 'highlighter');
		pickBtn.createSpan({ text: '摘录' });
		pickBtn.addEventListener('mousedown', (event) => event.preventDefault());
		pickBtn.addEventListener('click', async (event) => {
			event.preventDefault();
			const selectedText = toolbar.dataset.selectionText ?? '';
			const messageId = toolbar.dataset.messageId || undefined;
			if (!selectedText) {
				return;
			}
			await this.createPickForText({
				raw: selectedText,
				plain: selectedText,
				matchText: selectedText,
				messageId,
			});
			this.hideSelectionToolbar();
			window.getSelection()?.removeAllRanges();
		});

		const copyBtn = toolbar.createEl('button', {
			cls: 'youmind-selection-toolbar-btn clickable-icon',
			attr: { 'aria-label': '复制' },
		});
		setIcon(copyBtn, 'copy');
		copyBtn.createSpan({ text: '复制' });
		copyBtn.addEventListener('mousedown', (event) => event.preventDefault());
		copyBtn.addEventListener('click', async (event) => {
			event.preventDefault();
			const selectedText = toolbar.dataset.selectionText ?? '';
			if (!selectedText) {
				return;
			}
			await navigator.clipboard.writeText(selectedText);
			new Notice('Copied selection');
			this.hideSelectionToolbar();
		});

		this.selectionToolbarEl = toolbar;
		return toolbar;
	}

	private hideSelectionToolbar(): void {
		if (this.selectionToolbarEl) {
			this.selectionToolbarEl.addClass('youmind-hidden');
			delete this.selectionToolbarEl.dataset.selectionText;
			delete this.selectionToolbarEl.dataset.messageId;
		}
	}

	private getAvailableNotePath(baseName: string): string {
		let candidate = `${baseName}.md`;
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${baseName} ${counter}.md`;
			counter += 1;
		}
		return candidate;
	}

	private addSystemMessage(text: string, iconName: string): void {
		const messageEl = this.messagesEl.createEl('div', {
			cls: 'youmind-message youmind-message-system',
		});
		const contentEl = messageEl.createEl('div', { cls: 'youmind-message-content' });
		const iconEl = contentEl.createEl('span', { cls: 'youmind-status-icon' });
		setIcon(iconEl, iconName);
		contentEl.createEl('span', { text: ` ${text}` });
		this.scrollToBottom();
	}

	private createLoadingEl(label = 'YouMind is thinking...'): HTMLElement {
		const loadingEl = document.createElement('div');
		loadingEl.addClass('youmind-loading');
		const dots = document.createElement('div');
		dots.addClass('youmind-loading-dots');
		dots.appendChild(document.createElement('span'));
		dots.appendChild(document.createElement('span'));
		dots.appendChild(document.createElement('span'));
		loadingEl.appendChild(dots);
		const textEl = document.createElement('span');
		textEl.textContent = label;
		loadingEl.appendChild(textEl);
		return loadingEl;
	}

	private updateTitle(title: string): void {
		const normalizedTitle = title || DEFAULT_CHAT_TITLE;
		const displayTitle = normalizedTitle.length > 20 ? `${normalizedTitle.slice(0, 20)}...` : normalizedTitle;
		this.titleEl.setText(displayTitle);
		this.titleEl.setAttribute('title', normalizedTitle);
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private setInputEnabled(enabled: boolean): void {
		this.textInput.disabled = !enabled;
		this.sendBtn.disabled = !enabled;
	}

	async onClose(): Promise<void> {
		this.selectionToolbarEl?.remove();
		this.selectionToolbarEl = null;
		this.historyPanel?.destroy();
		this.boardSelector?.destroy();
		this.unsubscribeBoardChange?.();
	}
}

class YouMindSettingTab extends PluginSettingTab {
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
	}
}

export default class YouMindPlugin extends Plugin {
	settings!: YouMindSettings;
	api!: YouMindAPI;
	boardContext!: BoardContext;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.api = new YouMindAPI(this.settings.apiKey);
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

		this.addRibbonIcon('message-circle', 'Open YouMind Chat', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-youmind-chat',
			name: 'Open YouMind Chat',
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new YouMindSettingTab(this.app, this));
		void this.boardContext.initialize();
	}

	onunload(): void {
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
}
