import { TFolder, setIcon, type App } from 'obsidian';

export interface PullConfirmOptions {
	app: App;
	filePath: string;
	title: string;
	isUpdate: boolean;
	onFolderChanged?: (newFolder: string) => Promise<string | null>;
	onOpenFile?: () => void;
}

export class PullConfirmPanel {
	private static activePanel: PullConfirmPanel | null = null;

	private rootEl: HTMLElement;
	private timerLabelEl: HTMLElement;
	private dropdownEl: HTMLElement;
	private folderListEl: HTMLElement;
	private pathBtnEl: HTMLButtonElement;
	private pathTextEl: HTMLElement;
	private labelEl: HTMLElement;
	private countdown = 5;
	private countdownInterval: number | null = null;
	private dropdownOpen = false;
	private currentPath: string;
	private outsideHandler: (event: MouseEvent) => void;
	private isClosed = false;

	constructor(private options: PullConfirmOptions) {
		PullConfirmPanel.activePanel?.close(true);
		PullConfirmPanel.activePanel = this;
		this.currentPath = options.filePath;
		this.outsideHandler = this.handleOutsideClick.bind(this);
		this.rootEl = this.render();
		document.body.appendChild(this.rootEl);
		document.addEventListener('click', this.outsideHandler, true);
		this.startAutoClose();
	}

	private render(): HTMLElement {
		const el = document.body.createDiv({ cls: 'youmind-pull-confirm' });
		el.addEventListener('click', (event) => event.stopPropagation());

		const header = el.createDiv({ cls: 'youmind-pull-confirm-header' });
		const iconEl = header.createSpan({ cls: 'youmind-pull-confirm-icon' });
		setIcon(iconEl, 'check-circle');
		this.labelEl = header.createSpan({
			cls: 'youmind-pull-confirm-label',
			text: this.options.isUpdate ? '已更新' : '已拉取到',
		});
		const closeBtn = header.createEl('button', {
			cls: 'youmind-pull-confirm-close clickable-icon',
			attr: { type: 'button', 'aria-label': 'Close' },
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const pathRow = el.createDiv({ cls: 'youmind-pull-confirm-path-row' });
		this.pathBtnEl = pathRow.createEl('button', {
			cls: 'youmind-pull-confirm-path-btn',
			attr: { type: 'button' },
		});
		const folderIcon = this.pathBtnEl.createSpan({ cls: 'youmind-pull-confirm-folder-icon' });
		setIcon(folderIcon, 'folder');
		this.pathTextEl = this.pathBtnEl.createSpan({
			cls: 'youmind-pull-confirm-path-text',
			text: this.getDisplayPath(this.currentPath),
		});
		const chevron = this.pathBtnEl.createSpan({ cls: 'youmind-pull-confirm-chevron' });
		setIcon(chevron, 'chevron-down');
		this.pathBtnEl.addEventListener('click', () => this.toggleDropdown());

		const openBtn = pathRow.createEl('button', {
			cls: 'youmind-pull-confirm-open-btn',
			attr: { type: 'button' },
		});
		const openIcon = openBtn.createSpan();
		setIcon(openIcon, 'file');
		openBtn.createSpan({ text: '打开文件' });
		openBtn.addEventListener('click', () => {
			this.options.onOpenFile?.();
			this.close();
		});

		this.dropdownEl = el.createDiv({ cls: 'youmind-pull-confirm-dropdown youmind-hidden' });
		const searchRow = this.dropdownEl.createDiv({ cls: 'youmind-pull-confirm-search' });
		const searchIcon = searchRow.createSpan();
		setIcon(searchIcon, 'search');
		const searchInput = searchRow.createEl('input', {
			attr: {
				type: 'text',
				placeholder: '搜索文件夹...',
			},
		});
		searchInput.addEventListener('input', () => this.renderFolderList(searchInput.value));
		this.folderListEl = this.dropdownEl.createDiv({ cls: 'youmind-pull-confirm-folder-list' });
		this.renderFolderList('');

		const timerEl = el.createDiv({ cls: 'youmind-pull-confirm-timer' });
		this.timerLabelEl = timerEl.createSpan({ text: '5 秒后自动关闭' });

		return el;
	}

	private handleOutsideClick(event: MouseEvent): void {
		if (!this.rootEl.contains(event.target as Node)) {
			this.close();
		}
	}

	private getDisplayPath(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '/';
	}

	private toggleDropdown(): void {
		this.dropdownOpen = !this.dropdownOpen;
		this.dropdownEl.toggleClass('youmind-hidden', !this.dropdownOpen);
		this.pathBtnEl.toggleClass('is-open', this.dropdownOpen);
		if (this.dropdownOpen) {
			this.cancelAutoClose();
			const input = this.dropdownEl.querySelector('input');
			if (input instanceof HTMLInputElement) {
				input.focus();
			}
			return;
		}
		this.startAutoClose();
	}

	private renderFolderList(filter: string): void {
		this.folderListEl.empty();
		const currentFolder = this.getDisplayPath(this.currentPath);
		const folders = ['/', ...this.getAllFolders()];
		const normalizedFilter = filter.trim().toLowerCase();
		const filtered = normalizedFilter
			? folders.filter((folder) => folder.toLowerCase().includes(normalizedFilter))
			: folders;

		for (const folder of filtered) {
			const itemEl = this.folderListEl.createDiv({ cls: 'youmind-pull-confirm-folder-item' });
			if (folder === currentFolder) {
				itemEl.addClass('is-current');
			}
			const itemIcon = itemEl.createSpan({ cls: 'youmind-pull-confirm-folder-item-icon' });
			setIcon(itemIcon, 'folder');
			itemEl.createSpan({
				cls: 'youmind-pull-confirm-folder-item-name',
				text: folder === '/' ? 'Vault 根目录' : folder,
			});
			if (folder === currentFolder) {
				const checkEl = itemEl.createSpan({ cls: 'youmind-pull-confirm-folder-check' });
				setIcon(checkEl, 'check');
			}

			itemEl.addEventListener('click', () => {
				void this.moveToFolder(folder, itemEl, itemIcon);
			});
		}
	}

	private async moveToFolder(
		folder: string,
		itemEl: HTMLElement,
		itemIcon: HTMLElement,
	): Promise<void> {
		const currentFolder = this.getDisplayPath(this.currentPath);
		if (folder === currentFolder) {
			return;
		}

		itemEl.addClass('is-loading');
		setIcon(itemIcon, 'loader');
		const targetFolder = folder === '/' ? '' : folder;
		const newPath = await this.options.onFolderChanged?.(targetFolder);
		if (!newPath) {
			itemEl.removeClass('is-loading');
			setIcon(itemIcon, 'alert-circle');
			window.setTimeout(() => setIcon(itemIcon, 'folder'), 2000);
			return;
		}

		this.currentPath = newPath;
		this.pathTextEl.setText(this.getDisplayPath(newPath));
		this.labelEl.setText('已移动到');
		this.dropdownOpen = false;
		this.dropdownEl.addClass('youmind-hidden');
		this.pathBtnEl.removeClass('is-open');
		this.renderFolderList('');
		this.startAutoClose();
	}

	private getAllFolders(): string[] {
		const folders: string[] = [];
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					folders.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.options.app.vault.getRoot());
		return folders.sort((a, b) => a.localeCompare(b));
	}

	private startAutoClose(): void {
		this.cancelAutoClose();
		this.countdown = 5;
		this.updateTimerText();
		this.countdownInterval = window.setInterval(() => {
			this.countdown -= 1;
			this.updateTimerText();
			if (this.countdown <= 0) {
				this.close();
			}
		}, 1000);
	}

	private cancelAutoClose(): void {
		if (this.countdownInterval !== null) {
			window.clearInterval(this.countdownInterval);
			this.countdownInterval = null;
		}
	}

	private updateTimerText(): void {
		this.timerLabelEl.setText(`${this.countdown} 秒后自动关闭`);
	}

	close(immediate = false): void {
		if (this.isClosed) {
			return;
		}
		this.isClosed = true;
		this.cancelAutoClose();
		document.removeEventListener('click', this.outsideHandler, true);
		if (PullConfirmPanel.activePanel === this) {
			PullConfirmPanel.activePanel = null;
		}
		if (immediate) {
			this.rootEl.remove();
			return;
		}
		this.rootEl.addClass('is-closing');
		window.setTimeout(() => this.rootEl.remove(), 200);
	}
}
