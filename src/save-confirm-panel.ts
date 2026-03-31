import { setIcon } from 'obsidian';
import type { BoardInfo, SaveConfirmOptions } from './types';

const BOARD_ICON_MAP: Record<string, string> = {
	folder: 'folder',
	book: 'book-open',
	code: 'code',
	music: 'music',
	video: 'video',
	image: 'image',
	globe: 'globe',
	star: 'star',
	heart: 'heart',
	rocket: 'rocket',
	lightbulb: 'lightbulb',
	'graduation-cap': 'graduation-cap',
	briefcase: 'briefcase',
};

function mapBoardIcon(iconName?: string): string {
	if (!iconName) {
		return 'layout-dashboard';
	}
	return BOARD_ICON_MAP[iconName] ?? 'layout-dashboard';
}

export class SaveConfirmPanel {
	private static activePanel: SaveConfirmPanel | null = null;

	private rootEl: HTMLElement;
	private boardBtnEl: HTMLButtonElement;
	private boardNameEl: HTMLElement;
	private boardIconEl: HTMLElement;
	private dropdownEl: HTMLElement;
	private listEl: HTMLElement;
	private timerLabelEl: HTMLElement;
	private iconEl: HTMLElement;
	private labelEl: HTMLElement;
	private closeTimeout: number | null = null;
	private outsideHandler: (event: MouseEvent) => void;
	private currentBoardId: string;
	private currentBoardName: string;
	private isClosed = false;

	constructor(private options: SaveConfirmOptions) {
		SaveConfirmPanel.activePanel?.close(true);
		SaveConfirmPanel.activePanel = this;
		this.currentBoardId = options.boardId;
		this.currentBoardName = options.boardName;
		this.outsideHandler = this.handleOutsideClick.bind(this);

		this.rootEl = document.body.createDiv({ cls: 'youmind-save-confirm' });
		this.rootEl.addEventListener('click', (event) => event.stopPropagation());

		const headerEl = this.rootEl.createDiv({ cls: 'youmind-save-confirm-header' });
		this.iconEl = headerEl.createSpan({ cls: 'youmind-save-confirm-icon' });
		setIcon(this.iconEl, 'check-circle');
		this.labelEl = headerEl.createSpan({
			cls: 'youmind-save-confirm-label',
			text: options.isUpdate ? '已保存到' : '已保存到',
		});
		const closeBtn = headerEl.createEl('button', {
			cls: 'youmind-save-confirm-close clickable-icon',
			attr: { 'aria-label': 'Close' },
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const boardRowEl = this.rootEl.createDiv({ cls: 'youmind-save-confirm-board-row' });
		this.boardBtnEl = boardRowEl.createEl('button', {
			cls: 'youmind-save-confirm-board-btn',
			attr: { type: 'button', 'aria-label': 'Select board' },
		});
		this.boardIconEl = this.boardBtnEl.createSpan({ cls: 'youmind-board-icon' });
		this.boardNameEl = this.boardBtnEl.createSpan({ cls: 'youmind-board-name' });
		const chevronEl = this.boardBtnEl.createSpan({ cls: 'youmind-board-chevron' });
		setIcon(chevronEl, 'chevron-down');
		this.boardBtnEl.addEventListener('click', () => this.toggleDropdown());

		const openBtn = boardRowEl.createEl('button', {
			cls: 'youmind-save-confirm-open-btn',
			attr: { type: 'button' },
		});
		const openIcon = openBtn.createSpan();
		setIcon(openIcon, 'external-link');
		openBtn.createSpan({ text: '去 YouMind 查看' });
		openBtn.addEventListener('click', () => {
			this.options.onOpenInYouMind?.();
			this.close();
		});

		this.dropdownEl = this.rootEl.createDiv({
			cls: 'youmind-save-confirm-dropdown youmind-hidden',
		});
		const searchRow = this.dropdownEl.createDiv({ cls: 'youmind-save-confirm-search' });
		const searchIcon = searchRow.createSpan();
		setIcon(searchIcon, 'search');
		const searchInput = searchRow.createEl('input', {
			attr: {
				type: 'text',
				placeholder: '搜索...',
			},
		});
		searchInput.addEventListener('input', () => {
			this.renderBoardList(searchInput.value);
		});
		this.listEl = this.dropdownEl.createDiv({ cls: 'youmind-save-confirm-board-list' });

		const timerEl = this.rootEl.createDiv({ cls: 'youmind-save-confirm-timer' });
		this.timerLabelEl = timerEl.createSpan({ text: '5 秒后自动关闭' });

		this.updateBoardDisplay();
		this.renderBoardList();
		document.addEventListener('click', this.outsideHandler, true);
		this.startAutoClose(5000);
	}

	private updateBoardDisplay(): void {
		const currentBoard = this.options.boards.find((board) => board.id === this.currentBoardId);
		setIcon(this.boardIconEl, mapBoardIcon(currentBoard?.iconName));
		this.boardIconEl.style.color = currentBoard?.iconColor ?? '';
		this.boardNameEl.setText(this.currentBoardName);
		this.boardNameEl.setAttribute('title', this.currentBoardName);
	}

	private renderBoardList(query = ''): void {
		this.listEl.empty();
		const normalizedQuery = query.trim().toLowerCase();
		const boards = this.options.boards.filter((board) =>
			board.name.toLowerCase().includes(normalizedQuery),
		);

		for (const board of boards) {
			const itemEl = this.listEl.createDiv({ cls: 'youmind-save-confirm-board-item' });
			if (board.id === this.currentBoardId) {
				itemEl.addClass('is-current');
			}
			const iconEl = itemEl.createSpan({ cls: 'youmind-board-icon' });
			setIcon(iconEl, mapBoardIcon(board.iconName));
			iconEl.style.color = board.iconColor ?? '';
			itemEl.createSpan({ cls: 'youmind-board-name', text: board.name });
			if (board.id === this.currentBoardId) {
				const checkEl = itemEl.createSpan({ cls: 'youmind-board-check' });
				setIcon(checkEl, 'check');
			}
			itemEl.addEventListener('click', () => {
				void this.changeBoard(board);
			});
		}
	}

	private toggleDropdown(): void {
		const isHidden = this.dropdownEl.hasClass('youmind-hidden');
		if (isHidden) {
			this.cancelAutoClose();
			this.dropdownEl.removeClass('youmind-hidden');
			this.boardBtnEl.addClass('is-open');
			return;
		}
		this.dropdownEl.addClass('youmind-hidden');
		this.boardBtnEl.removeClass('is-open');
		this.startAutoClose(5000);
	}

	private async changeBoard(board: BoardInfo): Promise<void> {
		if (board.id === this.currentBoardId) {
			this.dropdownEl.addClass('youmind-hidden');
			this.boardBtnEl.removeClass('is-open');
			this.startAutoClose(5000);
			return;
		}

		this.cancelAutoClose();
		this.rootEl.addClass('youmind-save-confirm-loading');
		setIcon(this.boardIconEl, 'loader');
		this.labelEl.setText('正在移动…');
		this.boardNameEl.setText(board.name);
		this.boardNameEl.setAttribute('title', board.name);
		this.dropdownEl.addClass('youmind-hidden');
		this.boardBtnEl.removeClass('is-open');

		try {
			await this.options.onBoardChanged?.(board.id, board.name);
			this.rootEl.removeClass('youmind-save-confirm-loading', 'youmind-save-confirm-error');
			setIcon(this.iconEl, 'check-circle');
			this.labelEl.setText(`已移动到 ${board.name}`);
			this.currentBoardId = board.id;
			this.currentBoardName = board.name;
			this.updateBoardDisplay();
			this.renderBoardList();
			this.timerLabelEl.setText('3 秒后自动关闭');
			this.startAutoClose(3000);
		} catch (error) {
			this.rootEl.removeClass('youmind-save-confirm-loading');
			this.rootEl.addClass('youmind-save-confirm-error');
			setIcon(this.iconEl, 'alert-circle');
			this.labelEl.setText(`移动失败：${error instanceof Error ? error.message : 'Unknown error'}`);
			this.timerLabelEl.setText('请重试或手动关闭');
			this.updateBoardDisplay();
		}
	}

	private startAutoClose(delay: number): void {
		this.cancelAutoClose();
		this.closeTimeout = window.setTimeout(() => this.close(), delay);
	}

	private cancelAutoClose(): void {
		if (this.closeTimeout !== null) {
			window.clearTimeout(this.closeTimeout);
			this.closeTimeout = null;
		}
	}

	private handleOutsideClick(event: MouseEvent): void {
		if (!this.rootEl.contains(event.target as Node)) {
			this.close();
		}
	}

	close(immediate = false): void {
		if (this.isClosed) {
			return;
		}
		this.isClosed = true;
		this.cancelAutoClose();
		document.removeEventListener('click', this.outsideHandler, true);
		if (SaveConfirmPanel.activePanel === this) {
			SaveConfirmPanel.activePanel = null;
		}
		if (immediate) {
			this.rootEl.remove();
			return;
		}
		this.rootEl.addClass('is-closing');
		window.setTimeout(() => this.rootEl.remove(), 200);
	}
}
