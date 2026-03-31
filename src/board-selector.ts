import { setIcon } from 'obsidian';
import type { Board } from './api';
import type { BoardContext } from './board-context';

export class BoardSelector {
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
