import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	TFile,
	type WorkspaceLeaf,
	setIcon,
} from 'obsidian';
import type { Board, CraftDto, MaterialDto, MaterialListItem } from './api';
import type YouMindPlugin from './plugin-class';
import { PullConfirmPanel } from './pull-confirm-panel';
import { PullService } from './pull-service';
import { VIEW_TYPE_YOUMIND_BROWSER, type TreeNode } from './types';

const DATA_CACHE_TTL = 5 * 60 * 1000;
const DETAIL_CACHE_TTL = 10 * 60 * 1000;

const PULLABLE_MATERIAL_TYPES = new Set([
	'article',
	'note',
	'image',
	'text-file',
	'voice',
	'video',
	'pdf',
	'office',
	'other-webpage',
	'unknown-webpage',
	'snippet',
]);
const PULLABLE_CRAFT_TYPES = new Set(['page', 'slides', 'webpage', 'audio-pod', 'canvas']);

const MATERIAL_ICON_MAP: Record<string, string> = {
	article: 'globe',
	note: 'sticky-note',
	image: 'image',
	voice: 'headphones',
	video: 'video',
	pdf: 'file-text',
	office: 'file-spreadsheet',
	'text-file': 'file-code',
	'other-webpage': 'globe',
	'unknown-webpage': 'globe',
	snippet: 'scissors',
};

const CRAFT_ICON_MAP: Record<string, string> = {
	page: 'file-pen-line',
	slides: 'presentation',
	webpage: 'layout-template',
	'audio-pod': 'podcast',
	canvas: 'frames',
};

type BrowserTab = 'materials' | 'crafts';

interface CachedList<T> {
	data: T[] | null;
	timestamp: number;
}

interface CachedPreview {
	content: string;
	timestamp: number;
}

interface BrowserState {
	materials: CachedList<MaterialListItem>;
	crafts: CachedList<CraftDto>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) {
			return value;
		}
	}
	return undefined;
}

function readContentText(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	return readString(value, 'plain', 'raw', 'text', 'content', 'data');
}

function trimPreview(value: string | undefined, maxLength: number): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return undefined;
	}
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function resolveImageUrl(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const file = isRecord(value.file) ? value.file : null;
	return (
		readString(file ?? {}, 'url') ??
		readString(value, 'url', 'albumUrl', 'album_url') ??
		readString(file ?? {}, 'storageUrl', 'storage_url') ??
		undefined
	);
}

function getMaterialIcon(type: string): string {
	return MATERIAL_ICON_MAP[type] ?? 'file';
}

function getCraftIcon(type: string): string {
	return CRAFT_ICON_MAP[type] ?? 'file';
}

function isMaterialPullable(type: string): boolean {
	return PULLABLE_MATERIAL_TYPES.has(type);
}

function isCraftPullable(type: string): boolean {
	return PULLABLE_CRAFT_TYPES.has(type);
}

function getBoardIconName(board: Board | null): string {
	if (!board?.icon) {
		return 'layout-dashboard';
	}
	if (typeof board.icon === 'string' && board.icon.trim()) {
		return board.icon;
	}
	if (isRecord(board.icon)) {
		return readString(board.icon, 'name') ?? 'layout-dashboard';
	}
	return 'layout-dashboard';
}

function getUpdatedAt(value: unknown): string {
	if (!isRecord(value)) {
		return '';
	}
	return readString(value, 'updatedAt', 'updated_at') ?? '';
}

function getNodeKey(node: TreeNode): string {
	return `${node.type}:${node.id}`;
}

export class BrowserView extends ItemView {
	private currentTab: BrowserTab = 'materials';
	private materialsTree: TreeNode[] = [];
	private craftsTree: TreeNode[] = [];
	private linkedFiles = new Map<string, TFile>();
	private cache: BrowserState = {
		materials: { data: null, timestamp: 0 },
		crafts: { data: null, timestamp: 0 },
	};
	private detailCache = new Map<string, CachedPreview>();
	private selectedNodeKey: string | null = null;
	private unsubscribeBoardChange: (() => void) | null = null;
	private pullService: PullService;
	private currentPreviewId: string | null = null;
	private rootEl!: HTMLDivElement;
	private boardIconEl!: HTMLSpanElement;
	private boardNameEl!: HTMLSpanElement;
	private refreshButtonEl!: HTMLButtonElement;
	private materialsTabEl!: HTMLButtonElement;
	private craftsTabEl!: HTMLButtonElement;
	private materialsCountEl!: HTMLSpanElement;
	private craftsCountEl!: HTMLSpanElement;
	private listContainer!: HTMLDivElement;
	private loadingEl!: HTMLDivElement;
	private emptyEl!: HTMLDivElement;
	private errorEl!: HTMLDivElement;
	private resizerEl!: HTMLDivElement;
	private previewContainer!: HTMLDivElement;
	private previewIconEl!: HTMLSpanElement;
	private previewTitleEl!: HTMLSpanElement;
	private previewBodyEl!: HTMLDivElement;
	private previewActionsEl!: HTMLDivElement;
	private previewHeight = 200;

	constructor(leaf: WorkspaceLeaf, private plugin: YouMindPlugin) {
		super(leaf);
		this.pullService = new PullService(this.app, plugin);
	}

	getViewType(): string {
		return VIEW_TYPE_YOUMIND_BROWSER;
	}

	getDisplayText(): string {
		return 'YouMind Browser';
	}

	getIcon(): string {
		return 'library';
	}

	async onOpen(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('youmind-browser-view');

		this.rootEl = containerEl.createDiv({ cls: 'youmind-browser' });
		this.buildHeader();
		this.buildTabs();
		this.buildList();
		this.resizerEl = this.rootEl.createDiv({ cls: 'youmind-browser-resizer' });
		this.buildPreview();
		this.setupResizer();
		this.updateBoardInfo();

		this.unsubscribeBoardChange = this.plugin.boardContext.onChange(() => {
			void this.onBoardChanged();
		});

		await this.loadData();
	}

	async onClose(): Promise<void> {
		this.unsubscribeBoardChange?.();
		this.unsubscribeBoardChange = null;
	}

	async onBoardChanged(): Promise<void> {
		this.cache = {
			materials: { data: null, timestamp: 0 },
			crafts: { data: null, timestamp: 0 },
		};
		this.detailCache.clear();
		this.selectedNodeKey = null;
		this.materialsTree = [];
		this.craftsTree = [];
		this.hidePreview();
		this.updateBoardInfo();
		await this.loadData();
	}

	async loadData(forceRefresh = false): Promise<void> {
		const boardId = this.plugin.boardContext.getBoardId();
		if (!boardId) {
			this.materialsTree = [];
			this.craftsTree = [];
			this.updateTabCounts();
			this.showEmpty('No board selected');
			return;
		}

		this.showLoading();
		if (forceRefresh) {
			this.refreshButtonEl.addClass('is-spinning');
		}

		try {
			this.linkedFiles = this.plugin.frontmatterManager.scanLinkedFiles();
			const now = Date.now();
			if (forceRefresh || !this.cache.materials.data || now - this.cache.materials.timestamp > DATA_CACHE_TTL) {
				const materials = await this.plugin.api.listMaterials({ boardId });
				this.cache.materials = { data: materials, timestamp: now };
			}
			if (forceRefresh || !this.cache.crafts.data || now - this.cache.crafts.timestamp > DATA_CACHE_TTL) {
				const crafts = await this.plugin.api.listCrafts({ boardId });
				this.cache.crafts = { data: crafts, timestamp: now };
			}

			this.materialsTree = this.buildMaterialTree(this.cache.materials.data ?? []);
			this.craftsTree = this.buildCraftTree(this.cache.crafts.data ?? []);
			this.updateTabCounts();
			this.renderCurrentTab();
		} catch (error) {
			this.showError(error instanceof Error ? error.message : 'Failed to load board content');
		} finally {
			this.refreshButtonEl.removeClass('is-spinning');
		}
	}

	private buildHeader(): void {
		const headerEl = this.rootEl.createDiv({ cls: 'youmind-browser-header' });
		const boardInfoEl = headerEl.createDiv({ cls: 'youmind-browser-board-info' });
		this.boardIconEl = boardInfoEl.createSpan({ cls: 'youmind-browser-board-icon' });
		this.boardNameEl = boardInfoEl.createSpan({ cls: 'youmind-browser-board-name' });

		this.refreshButtonEl = headerEl.createEl('button', {
			cls: 'youmind-browser-refresh clickable-icon',
			attr: {
				type: 'button',
				'aria-label': 'Refresh board content',
			},
		});
		setIcon(this.refreshButtonEl, 'refresh-cw');
		this.refreshButtonEl.addEventListener('click', () => {
			void this.loadData(true);
		});
	}

	private buildTabs(): void {
		const tabsEl = this.rootEl.createDiv({ cls: 'youmind-browser-tabs' });
		this.materialsTabEl = this.createTabButton(tabsEl, 'materials', 'file-text', 'Materials');
		this.materialsCountEl = this.materialsTabEl.createSpan({ cls: 'youmind-browser-tab-count', text: '0' });
		this.craftsTabEl = this.createTabButton(tabsEl, 'crafts', 'pen-tool', 'Crafts');
		this.craftsCountEl = this.craftsTabEl.createSpan({ cls: 'youmind-browser-tab-count', text: '0' });
		this.updateActiveTab();
	}

	private createTabButton(
		parentEl: HTMLElement,
		tab: BrowserTab,
		icon: string,
		label: string,
	): HTMLButtonElement {
		const buttonEl = parentEl.createEl('button', {
			cls: 'youmind-browser-tab',
			attr: {
				type: 'button',
				'data-tab': tab,
			},
		});
		const iconEl = buttonEl.createSpan();
		setIcon(iconEl, icon);
		buttonEl.createSpan({ text: label });
		buttonEl.addEventListener('click', () => {
			if (this.currentTab === tab) {
				return;
			}
			this.currentTab = tab;
			this.updateActiveTab();
			this.renderCurrentTab();
		});
		return buttonEl;
	}

	private buildList(): void {
		this.listContainer = this.rootEl.createDiv({ cls: 'youmind-browser-list' });
		this.loadingEl = this.listContainer.createDiv({ cls: 'youmind-browser-loading' });
		const loadingIconEl = this.loadingEl.createSpan();
		setIcon(loadingIconEl, 'loader-2');
		this.loadingEl.createSpan({ text: 'Loading board content...' });

		this.emptyEl = this.listContainer.createDiv({ cls: 'youmind-browser-empty' });
		const emptyIconEl = this.emptyEl.createSpan();
		setIcon(emptyIconEl, 'inbox');
		this.emptyEl.createSpan({ text: 'No items in this board' });

		this.errorEl = this.listContainer.createDiv({ cls: 'youmind-browser-error youmind-hidden' });
		const errorIconEl = this.errorEl.createSpan();
		setIcon(errorIconEl, 'alert-circle');
		this.errorEl.createSpan({ text: 'Failed to load board content' });
	}

	private buildPreview(): void {
		this.previewContainer = this.rootEl.createDiv({ cls: 'youmind-browser-preview youmind-hidden' });
		const previewHeaderEl = this.previewContainer.createDiv({ cls: 'youmind-browser-preview-header' });
		this.previewIconEl = previewHeaderEl.createSpan({ cls: 'youmind-browser-preview-icon' });
		this.previewTitleEl = previewHeaderEl.createSpan({ cls: 'youmind-browser-preview-title' });
		const closeButtonEl = previewHeaderEl.createEl('button', {
			cls: 'youmind-browser-preview-close clickable-icon',
			attr: { type: 'button', 'aria-label': 'Close preview' },
		});
		setIcon(closeButtonEl, 'x');
		closeButtonEl.addEventListener('click', () => {
			this.selectedNodeKey = null;
			this.hidePreview();
			this.renderCurrentTab();
		});

		this.previewBodyEl = this.previewContainer.createDiv({ cls: 'youmind-browser-preview-body' });
		this.previewActionsEl = this.previewContainer.createDiv({ cls: 'youmind-browser-preview-actions' });
	}

	private setupResizer(): void {
		let startY = 0;
		let startHeight = 0;

		const onMouseMove = (event: MouseEvent) => {
			const delta = startY - event.clientY;
			const maxHeight = this.containerEl.clientHeight * 0.7;
			const nextHeight = Math.max(80, Math.min(startHeight + delta, maxHeight));
			this.previewHeight = nextHeight;
			this.previewContainer.style.height = `${nextHeight}px`;
			event.preventDefault();
		};

		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this.resizerEl.removeClass('is-dragging');
			document.body.removeClass('youmind-resizing');
		};

		this.resizerEl.addEventListener('mousedown', (event: MouseEvent) => {
			startY = event.clientY;
			startHeight = this.previewContainer.clientHeight || this.previewHeight;
			this.resizerEl.addClass('is-dragging');
			document.body.addClass('youmind-resizing');
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			event.preventDefault();
		});
	}

	private updateBoardInfo(): void {
		const board = this.plugin.boardContext.getBoard();
		setIcon(this.boardIconEl, getBoardIconName(board));
		if (board) {
			this.boardNameEl.setText(board.name);
			this.boardNameEl.setAttribute('title', board.name);
		} else if (this.plugin.boardContext.getIsLoading()) {
			this.boardNameEl.setText('Loading boards...');
			this.boardNameEl.removeAttribute('title');
		} else {
			this.boardNameEl.setText('No board selected');
			this.boardNameEl.removeAttribute('title');
		}
	}

	private updateTabCounts(): void {
		this.materialsCountEl.setText(String(this.countRenderableNodes(this.materialsTree)));
		this.craftsCountEl.setText(String(this.countRenderableNodes(this.craftsTree)));
	}

	private updateActiveTab(): void {
		this.materialsTabEl.toggleClass('is-active', this.currentTab === 'materials');
		this.craftsTabEl.toggleClass('is-active', this.currentTab === 'crafts');
	}

	private countRenderableNodes(nodes: TreeNode[]): number {
		return nodes.reduce((count, node) => {
			if (node.type === 'group') {
				return count + this.countRenderableNodes(node.children ?? []);
			}
			return count + 1;
		}, 0);
	}

	private renderCurrentTab(): void {
		this.clearRenderedItems();
		const nodes = this.currentTab === 'materials' ? this.materialsTree : this.craftsTree;
		if (nodes.length === 0) {
			this.showEmpty(
				this.currentTab === 'materials' ? 'No materials in this board' : 'No crafts in this board',
			);
			return;
		}

		this.loadingEl.addClass('youmind-hidden');
		this.emptyEl.addClass('youmind-hidden');

		for (const node of nodes) {
			this.renderTreeNode(this.listContainer, node, 0);
		}
	}

	private clearRenderedItems(): void {
		for (const child of Array.from(this.listContainer.children)) {
			if (child !== this.loadingEl && child !== this.emptyEl && child !== this.errorEl) {
				child.remove();
			}
		}
	}

	private renderTreeNode(parentEl: HTMLElement, node: TreeNode, depth: number): void {
		if (node.type === 'group') {
			this.renderGroupNode(parentEl, node, depth);
			return;
		}

		const itemEl = parentEl.createDiv({ cls: 'youmind-browser-item' });
		itemEl.style.setProperty('--youmind-browser-depth', String(depth));
		const rowEl = itemEl.createDiv({ cls: 'youmind-browser-item-row' });
		if (this.selectedNodeKey === getNodeKey(node)) {
			rowEl.addClass('is-selected');
		}

		const iconEl = rowEl.createSpan({ cls: 'youmind-browser-item-icon' });
		setIcon(iconEl, node.icon);
		rowEl.createSpan({ cls: 'youmind-browser-item-title', text: node.title });

		if (node.isLinked) {
			const statusEl = rowEl.createSpan({ cls: 'youmind-browser-item-status' });
			statusEl.setAttribute('aria-label', 'Linked to local file');
			statusEl.setAttribute('title', 'Linked to local file');
			setIcon(statusEl, 'check');
		}

		const actionsEl = rowEl.createDiv({ cls: 'youmind-browser-item-actions' });
		if (node.isPullable && !node.isLinked) {
			const pullButtonEl = actionsEl.createEl('button', {
				attr: { type: 'button', 'aria-label': 'Pull to Vault' },
			});
			setIcon(pullButtonEl, 'download');
			pullButtonEl.addEventListener('click', (event) => {
				event.stopPropagation();
				void this.executePull(node);
			});
		}
		const openButtonEl = actionsEl.createEl('button', {
			attr: { type: 'button', 'aria-label': 'Open in YouMind' },
		});
		setIcon(openButtonEl, 'external-link');
		openButtonEl.addEventListener('click', (event) => {
			event.stopPropagation();
			this.openInYouMind(node);
		});

		rowEl.addEventListener('click', () => {
			this.selectedNodeKey = getNodeKey(node);
			this.renderCurrentTab();
			void this.showPreview(node);
		});
		rowEl.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			this.showContextMenu(event, node);
		});
	}

	private renderGroupNode(parentEl: HTMLElement, node: TreeNode, depth: number): void {
		const groupEl = parentEl.createDiv({ cls: 'youmind-browser-group' });
		groupEl.style.setProperty('--youmind-browser-depth', String(depth));
		const headerEl = groupEl.createDiv({ cls: 'youmind-browser-group-header' });
		const chevronEl = headerEl.createSpan({ cls: 'youmind-browser-group-chevron' });
		setIcon(chevronEl, node.expanded ? 'chevron-down' : 'chevron-right');
		const iconEl = headerEl.createSpan({ cls: 'youmind-browser-group-icon' });
		setIcon(iconEl, node.expanded ? 'folder-open' : 'folder');
		headerEl.createSpan({ cls: 'youmind-browser-group-title', text: node.title });
		headerEl.createSpan({
			cls: 'youmind-browser-group-count',
			text: String(node.children?.length ?? 0),
		});
		const pullableChildren = (node.children ?? []).filter((child) => child.isPullable && !child.isLinked);
		if (pullableChildren.length > 0) {
			const pullAllBtn = headerEl.createEl('button', {
				cls: 'youmind-browser-group-action',
				attr: {
					type: 'button',
					'aria-label': `Pull ${pullableChildren.length} items`,
				},
			});
			setIcon(pullAllBtn, 'download');
			pullAllBtn.addEventListener('click', (event) => {
				event.stopPropagation();
				void this.executePullBatch(node, pullableChildren);
			});
		}

		const childrenEl = groupEl.createDiv({ cls: 'youmind-browser-group-children' });
		childrenEl.toggleClass('youmind-hidden', !node.expanded);
		for (const child of node.children ?? []) {
			this.renderTreeNode(childrenEl, child, depth + 1);
		}

		headerEl.addEventListener('click', () => {
			node.expanded = !node.expanded;
			this.renderCurrentTab();
		});
	}

	private async showPreview(node: TreeNode): Promise<void> {
		this.previewContainer.removeClass('youmind-hidden');
		this.previewContainer.style.height = `${this.previewHeight}px`;
		this.resizerEl.style.display = 'block';
		setIcon(this.previewIconEl, node.icon);
		this.previewTitleEl.setText(node.title);
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		this.previewBodyEl.setText('Loading...');
		this.previewActionsEl.empty();
		void this.loadFullPreview(node);
		this.renderPreviewActions(node);
	}

	private async loadFullPreview(node: TreeNode): Promise<void> {
		this.currentPreviewId = node.id;
		try {
			if (node.type === 'craft') {
				const detail = await this.plugin.api.getCraft({ id: node.id, withChildren: false });
				if (this.currentPreviewId !== node.id) {
					return;
				}
				const detailRecord = isRecord(detail) ? detail : null;
				if (!detailRecord) {
					this.renderFallbackPreview(node);
					return;
				}
				const craftType = readString(detailRecord, 'type') ?? node.craftType ?? '';
				switch (craftType) {
					case 'webpage':
						this.renderCraftImagePreview(node, detailRecord, 'screenshot');
						break;
					case 'slides':
						this.renderSlidesPreview(node, detailRecord);
						break;
					case 'audio-pod':
					case 'canvas': {
						const content =
							trimPreview(this.extractCraftPreview(detail), 20000) ?? 'No content available';
						await this.renderMarkdownPreview(content);
						break;
					}
					default: {
						const content =
							trimPreview(this.extractCraftPreview(detail), 20000) ?? 'No content available';
						await this.renderMarkdownPreview(content);
						break;
					}
				}
				return;
			}

			const detail = await this.plugin.api.getMaterial({ id: node.id, includeBlocks: true });
			if (this.currentPreviewId !== node.id) {
				return;
			}
			if (!detail || !isRecord(detail)) {
				this.renderFallbackPreview(node);
				return;
			}

			const materialType = readString(detail, 'type') ?? node.entityType ?? '';
			switch (materialType) {
				case 'note':
				case 'article':
				case 'pdf':
				case 'text-file':
					await this.renderTextPreview(detail);
					break;
				case 'image':
					this.renderImagePreview(detail);
					break;
				case 'voice':
				case 'video':
					await this.renderMediaPreview(detail);
					break;
				default:
					this.renderFallbackPreview(node, detail);
					break;
			}
		} catch (error) {
			console.error('[YouMind Preview]', error);
			if (this.currentPreviewId === node.id) {
				this.resetPreviewBodyClasses();
				this.previewBodyEl.empty();
				this.previewBodyEl.setText('Failed to load preview');
			}
		}
	}

	private renderPreviewActions(node: TreeNode): void {
		if (node.isPullable && !node.isLinked) {
			this.createPreviewButton('download', 'Pull to Vault', () => {
				void this.executePull(node);
			});
		}

		if (node.isLinked && node.localPath) {
			this.createPreviewButton('file', 'Open Local File', () => {
				void this.openLocalFile(node.localPath ?? '');
			});
		}

		this.createPreviewButton('external-link', 'Open in YouMind', () => {
			this.openInYouMind(node);
		});
	}

	private createPreviewButton(icon: string, label: string, onClick: () => void): void {
		const buttonEl = this.previewActionsEl.createEl('button', {
			cls: 'youmind-browser-preview-btn',
			text: label,
			attr: { type: 'button' },
		});
		const iconEl = buttonEl.createSpan({ cls: 'youmind-browser-preview-btn-icon' });
		setIcon(iconEl, icon);
		buttonEl.prepend(iconEl);
		buttonEl.addEventListener('click', onClick);
	}

	private showContextMenu(event: MouseEvent, node: TreeNode): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('Open in YouMind').setIcon('external-link').onClick(() => this.openInYouMind(node)),
		);
		menu.addItem((item) =>
			item.setTitle('Copy YouMind Link').setIcon('link').onClick(() => {
				void this.copyYouMindLink(node);
			}),
		);
		if (node.isPullable && !node.isLinked) {
			menu.addItem((item) =>
				item.setTitle('Pull to Vault').setIcon('download').onClick(() => {
					void this.executePull(node);
				}),
			);
		}
		if (node.isLinked && node.localPath) {
			menu.addItem((item) =>
				item.setTitle('Update from YouMind').setIcon('refresh-cw').onClick(() => {
					void this.executePull(node);
				}),
			);
			menu.addItem((item) =>
				item.setTitle('Open Local File').setIcon('file').onClick(() => {
					void this.openLocalFile(node.localPath ?? '');
				}),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private async copyYouMindLink(node: TreeNode): Promise<void> {
		const url = this.buildYouMindUrl(node);
		if (!url) {
			new Notice('Unable to build YouMind link');
			return;
		}
		await navigator.clipboard.writeText(url);
		new Notice('YouMind link copied');
	}

	private async openLocalFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice('Linked local file no longer exists');
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private openInYouMind(node: TreeNode): void {
		const url = this.buildYouMindUrl(node);
		if (!url) {
			new Notice('Unable to build YouMind URL');
			return;
		}
		window.open(url, '_blank');
	}

	private buildYouMindUrl(node: TreeNode): string | null {
		const boardId = this.plugin.boardContext.getBoardId();
		if (!boardId) {
			return null;
		}
		const key = node.type === 'craft' ? 'craft-id' : 'material-id';
		return `https://youmind.com/boards/${encodeURIComponent(boardId)}?${key}=${encodeURIComponent(node.id)}`;
	}

	private hidePreview(): void {
		this.currentPreviewId = null;
		this.previewContainer.addClass('youmind-hidden');
		this.resizerEl.style.display = 'none';
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		this.previewActionsEl.empty();
	}

	private showLoading(): void {
		this.clearRenderedItems();
		this.loadingEl.removeClass('youmind-hidden');
		this.emptyEl.addClass('youmind-hidden');
		this.errorEl.addClass('youmind-hidden');
	}

	private showEmpty(message: string): void {
		this.clearRenderedItems();
		this.loadingEl.addClass('youmind-hidden');
		this.emptyEl.removeClass('youmind-hidden');
		this.errorEl.addClass('youmind-hidden');
		const textEl = this.emptyEl.querySelector('span:last-child');
		if (textEl) {
			textEl.textContent = message;
		}
	}

	private showError(message: string): void {
		this.clearRenderedItems();
		this.loadingEl.addClass('youmind-hidden');
		this.emptyEl.addClass('youmind-hidden');
		this.errorEl.removeClass('youmind-hidden');
		const textEl = this.errorEl.querySelector('span:last-child');
		if (textEl) {
			textEl.textContent = message;
		}
		new Notice(`Board content browser: ${message}`);
	}

	private async executePull(node: TreeNode): Promise<void> {
		const boardId = this.plugin.getCurrentBoardId();
		const boardName = this.plugin.getCurrentBoardName();
		if (!boardId || !boardName) {
			new Notice('No board selected');
			return;
		}

		new Notice(`Pulling "${node.title}"...`);
		const result = await this.pullService.pull({
			entityId: node.id,
			entityType: node.type === 'craft' ? 'craft' : 'material',
			boardId,
			boardName,
		});

		if (!result.success || !result.filePath) {
			new Notice(`Pull failed: ${result.error ?? 'Unknown error'}`);
			return;
		}

		node.isLinked = true;
		node.localPath = result.filePath;
		this.renderCurrentTab();

		new PullConfirmPanel({
			app: this.app,
			filePath: result.filePath,
			title: result.title || node.title,
			isUpdate: result.action === 'updated',
			onFolderChanged: async (newFolder) => {
				const sourcePath = node.localPath || result.filePath || '';
				const newPath = await this.pullService.moveFile(sourcePath, newFolder);
				if (newPath) {
					node.localPath = newPath;
					this.renderCurrentTab();
				}
				return newPath;
			},
			onOpenFile: () => {
				const filePath = node.localPath || result.filePath;
				if (!filePath) {
					return;
				}
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					void this.app.workspace.getLeaf(false).openFile(file);
				}
			},
		});
	}

	private async executePullBatch(groupNode: TreeNode, items: TreeNode[]): Promise<void> {
		const boardId = this.plugin.getCurrentBoardId();
		const boardName = this.plugin.getCurrentBoardName();
		if (!boardId || !boardName) {
			new Notice('No board selected');
			return;
		}

		const pullOptions = items.map((item) => ({
			entityId: item.id,
			entityType: (item.type === 'craft' ? 'craft' : 'material') as 'material' | 'craft',
			boardId,
			boardName,
		}));

		const progressNotice = new Notice(`Pulling 0/${items.length}...`, 0);
		const result = await this.pullService.pullBatch(pullOptions, (completed, total) => {
			progressNotice.setMessage(`Pulling ${completed}/${total}...`);
		});
		progressNotice.hide();

		for (const item of items) {
			const linkedFile = this.plugin.frontmatterManager.findLocalFile(item.id);
			if (linkedFile) {
				item.isLinked = true;
				item.localPath = linkedFile.path;
			}
		}

		this.renderCurrentTab();
		const parts: string[] = [];
		if (result.succeeded > 0) {
			parts.push(`${result.succeeded} pulled`);
		}
		if (result.skipped > 0) {
			parts.push(`${result.skipped} skipped`);
		}
		if (result.failed > 0) {
			parts.push(`${result.failed} failed`);
		}
		new Notice(
			parts.length > 0 ? `Pull complete: ${parts.join(', ')}` : `Pull complete for ${groupNode.title}`,
		);
	}

	private buildMaterialTree(items: MaterialListItem[]): TreeNode[] {
		const groups = new Map<string, TreeNode>();
		const rootItems: TreeNode[] = [];

		for (const item of items) {
			const entityRecord = isRecord(item.entity) ? item.entity : null;
			if (!entityRecord) {
				continue;
			}
			const entityType = item.entityType || readString(entityRecord, 'entityType', 'entity_type') || '';
			const materialType = readString(entityRecord, 'type') ?? '';
			if (entityType === 'board_group' || materialType === 'board-group') {
				const groupId = readString(entityRecord, 'id') ?? item.boardItemId;
				groups.set(groupId, {
					id: groupId,
					type: 'group',
					title: readString(entityRecord, 'name', 'title') ?? 'Untitled Group',
					icon: 'folder',
					children: [],
					isLinked: false,
					isPullable: false,
					updatedAt: getUpdatedAt(entityRecord),
					expanded: false,
				});
			}
		}

		for (const item of items) {
			const entityRecord = isRecord(item.entity) ? item.entity : null;
			if (!entityRecord) {
				continue;
			}
			const materialType = readString(entityRecord, 'type') ?? '';
			if (item.entityType === 'board_group' || materialType === 'board-group') {
				continue;
			}

			const entityId = readString(entityRecord, 'id') ?? item.boardItemId;
			const linkedFile = this.linkedFiles.get(entityId);
			const node: TreeNode = {
				id: entityId,
				type: 'material',
				title: readString(entityRecord, 'title') ?? 'Untitled',
				icon: getMaterialIcon(materialType),
				entityType: materialType,
				isLinked: Boolean(linkedFile),
				localPath: linkedFile?.path,
				isPullable: isMaterialPullable(materialType),
				updatedAt: getUpdatedAt(entityRecord),
				contentPreview: trimPreview(readContentText(entityRecord.content), 200),
				url: readString(entityRecord, 'url'),
			};

			if (item.parentBoardGroupId && groups.has(item.parentBoardGroupId)) {
				groups.get(item.parentBoardGroupId)?.children?.push(node);
			} else {
				rootItems.push(node);
			}
		}

		return [...Array.from(groups.values()).filter((group) => (group.children?.length ?? 0) > 0), ...rootItems];
	}

	private buildCraftTree(items: CraftDto[]): TreeNode[] {
		const groups = new Map<string, TreeNode>();
		const rootItems: TreeNode[] = [];

		for (const item of items) {
			const record = isRecord(item) ? item : null;
			if (!record) {
				continue;
			}
			const craftType = readString(record, 'type') ?? '';
			if (craftType === 'craft-group') {
				const groupId = readString(record, 'id') ?? '';
				if (!groupId) {
					continue;
				}
				groups.set(groupId, {
					id: groupId,
					type: 'group',
					title: readString(record, 'title') ?? 'Untitled Group',
					icon: 'folder',
					children: [],
					isLinked: false,
					isPullable: false,
					updatedAt: getUpdatedAt(record),
					expanded: false,
				});
			}
		}

		for (const item of items) {
			const record = isRecord(item) ? item : null;
			if (!record) {
				continue;
			}
			const craftType = readString(record, 'type') ?? '';
			if (craftType === 'craft-group') {
				continue;
			}
			const parentId = readString(record, 'parentId', 'parent_id');
			const rootId = readString(record, 'rootId', 'root_id');
			if (parentId && rootId && parentId !== rootId) {
				continue;
			}

			const id = readString(record, 'id') ?? '';
			if (!id) {
				continue;
			}
			const linkedFile = this.linkedFiles.get(id);
			const node: TreeNode = {
				id,
				type: 'craft',
				title: readString(record, 'title') ?? 'Untitled',
				icon: getCraftIcon(craftType),
				craftType,
				isLinked: Boolean(linkedFile),
				localPath: linkedFile?.path,
				isPullable: isCraftPullable(craftType),
				updatedAt: getUpdatedAt(record),
				contentPreview: trimPreview(this.extractCraftPreview(item), 200),
			};
			const parentCraftGroupId = readString(record, 'parentCraftGroupId', 'parent_craft_group_id');
			if (parentCraftGroupId && groups.has(parentCraftGroupId)) {
				groups.get(parentCraftGroupId)?.children?.push(node);
			} else {
				rootItems.push(node);
			}
		}

		return [...Array.from(groups.values()).filter((group) => (group.children?.length ?? 0) > 0), ...rootItems];
	}

	private extractMaterialPreview(detail: MaterialDto): string | undefined {
		const record = isRecord(detail) ? detail : null;
		if (!record) {
			return undefined;
		}
		const direct = readContentText(record.content);
		if (direct) {
			return direct;
		}
		const blocks = record.blocks;
		if (Array.isArray(blocks)) {
			const parts = blocks
				.map((block) => (isRecord(block) ? readContentText(block.data) : undefined))
				.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
			if (parts.length > 0) {
				return parts.join('\n\n');
			}
		}
		return readString(record, 'text');
	}

	private extractCraftPreview(detail: CraftDto): string | undefined {
		const record = isRecord(detail) ? detail : null;
		if (!record) {
			return undefined;
		}
		const craftType = readString(record, 'type') ?? '';
		if (craftType === 'slides') {
			return this.extractSlidesPreview(record);
		}
		if (craftType === 'webpage') {
			return (
				readContentText(record.content) ??
				readString(record, 'contentUrl', 'content_url') ??
				readString(record, 'description', 'text')
			);
		}
		const direct = readContentText(record.content);
		if (direct) {
			return direct;
		}
		return readString(record, 'description', 'text');
	}

	private extractSlidesPreview(record: Record<string, unknown>): string | undefined {
		const rawContent = isRecord(record.content) ? record.content.raw : record.content;
		if (typeof rawContent !== 'string') {
			return readString(record, 'description', 'text');
		}
		try {
			const parsed = JSON.parse(rawContent);
			if (!isRecord(parsed) || !isRecord(parsed.timeline) || !Array.isArray(parsed.timeline.scenes)) {
				return rawContent;
			}

			const sceneLines = parsed.timeline.scenes
				.map((scene, index) => {
					if (!isRecord(scene)) {
						return `Scene ${index + 1}`;
					}
					const mediaAssets = Array.isArray(scene.mediaAssets) ? scene.mediaAssets : [];
					const firstAsset = mediaAssets[0];
					const genMedia = isRecord(firstAsset) && isRecord(firstAsset.genMedia) ? firstAsset.genMedia : null;
					const title = genMedia ? readString(genMedia, 'title') : undefined;
					return `${index + 1}. ${title ?? `Scene ${index + 1}`}`;
				})
				.filter((line) => line.trim().length > 0);

			return sceneLines.length > 0 ? sceneLines.join('\n') : rawContent;
		} catch {
			return rawContent;
		}
	}

	private renderCraftImagePreview(
		node: TreeNode,
		craft: Record<string, unknown>,
		imageKey: string,
	): void {
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		this.previewBodyEl.addClass('is-image-preview');

		const imageUrl = readString(craft, imageKey);
		const description = this.extractCraftPreview(craft as unknown as CraftDto);
		if (imageUrl) {
			const imageContainer = this.previewBodyEl.createDiv({ cls: 'youmind-preview-image-container' });
			const imageEl = imageContainer.createEl('img', {
				attr: {
					src: imageUrl,
					alt: node.title || readString(craft, 'title') || 'Craft preview',
				},
			});
			imageEl.addEventListener('error', () => {
				imageContainer.empty();
				imageContainer.setText('Preview failed to load');
				imageContainer.addClass('is-error');
			});
		}

		if (description) {
			this.previewBodyEl.createDiv({
				cls: 'youmind-preview-image-desc',
				text: description,
			});
		}

		const contentUrl = readString(craft, 'contentUrl', 'content_url');
		if (contentUrl) {
			const linkEl = this.previewBodyEl.createEl('a', {
				cls: 'youmind-preview-source-btn',
				attr: {
					href: contentUrl,
					target: '_blank',
					rel: 'noopener noreferrer',
				},
			});
			const iconEl = linkEl.createSpan();
			setIcon(iconEl, 'external-link');
			linkEl.createSpan({ text: 'Open HTML Source' });
		}
	}

	private renderSlidesPreview(node: TreeNode, craft: Record<string, unknown>): void {
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		const rawContent = isRecord(craft.content) ? craft.content.raw : craft.content;
		if (typeof rawContent !== 'string') {
			this.previewBodyEl.setText('No slides preview available');
			return;
		}

		try {
			const parsed = JSON.parse(rawContent);
			if (!isRecord(parsed) || !isRecord(parsed.timeline) || !Array.isArray(parsed.timeline.scenes)) {
				this.previewBodyEl.setText('No slides preview available');
				return;
			}

			const firstScene = parsed.timeline.scenes[0];
			const mediaAssets = isRecord(firstScene) && Array.isArray(firstScene.mediaAssets) ? firstScene.mediaAssets : [];
			const firstAsset = mediaAssets[0];
			const genMedia = isRecord(firstAsset) && isRecord(firstAsset.genMedia) ? firstAsset.genMedia : null;
			const imageUrl = genMedia ? readString(genMedia, 'playUrl', 'play_url') : undefined;
			if (imageUrl) {
				this.renderCraftImagePreview(node, { ...craft, screenshot: imageUrl }, 'screenshot');
				return;
			}
		} catch {
			// fall back below
		}

		void this.renderMarkdownPreview(trimPreview(this.extractCraftPreview(craft as unknown as CraftDto), 20000) ?? 'No content available');
	}

	private resetPreviewBodyClasses(): void {
		this.previewBodyEl.removeClass('is-image-preview', 'is-fallback-preview');
	}

	private async renderTextPreview(material: Record<string, unknown>): Promise<void> {
		const parts: string[] = [];
		const materialType = readString(material, 'type') ?? '';
		const url = readString(material, 'url');
		if (url && materialType !== 'note') {
			parts.push(`> Source: [${url}](${url})`, '');
		}

		const blocks = Array.isArray(material.blocks) ? material.blocks : [];
		const overviewBlock = blocks.find(
			(block) => isRecord(block) && readString(block, 'type') === 'overview',
		);
		if (isRecord(overviewBlock)) {
			const overview = readContentText(overviewBlock.content);
			if (overview) {
				parts.push('## Overview', '', overview, '');
			}
		}

		const body = this.extractMaterialPreview(material as MaterialDto) ?? 'No content available';
		if (body) {
			parts.push(body);
		}

		await this.renderMarkdownPreview(parts.join('\n') || 'No content available');
	}

	private renderImagePreview(material: Record<string, unknown>): void {
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		this.previewBodyEl.addClass('is-image-preview');

		const imageUrl = resolveImageUrl(material) ?? '';
		const description = readContentText(material.content);
		if (imageUrl) {
			const imageContainer = this.previewBodyEl.createDiv({ cls: 'youmind-preview-image-container' });
			const imageEl = imageContainer.createEl('img', {
				attr: {
					src: imageUrl,
					alt: readString(material, 'title') ?? 'Image preview',
				},
			});
			imageEl.addEventListener('error', () => {
				imageContainer.empty();
				imageContainer.setText('Image failed to load');
				imageContainer.addClass('is-error');
			});
		}

		if (description) {
			this.previewBodyEl.createDiv({
				cls: 'youmind-preview-image-desc',
				text: description,
			});
		}

		if (!imageUrl && !description) {
			this.previewBodyEl.setText('No image available');
		}
	}

	private async renderMediaPreview(material: Record<string, unknown>): Promise<void> {
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();

		const url = readString(material, 'url');
		const materialType = readString(material, 'type') ?? 'media';
		if (url) {
			const sourceBar = this.previewBodyEl.createDiv({ cls: 'youmind-preview-source-bar' });
			const sourceBtn = sourceBar.createEl('a', {
				cls: 'youmind-preview-source-btn',
				attr: {
					href: url,
					target: '_blank',
					rel: 'noopener noreferrer',
				},
			});
			const iconEl = sourceBtn.createSpan();
			setIcon(iconEl, materialType === 'video' ? 'play-circle' : 'headphones');
			sourceBtn.createSpan({
				text: `Open ${materialType === 'video' ? 'Video' : 'Audio'} Source`,
			});
		}

		const parts: string[] = [];
		const blocks = Array.isArray(material.blocks) ? material.blocks : [];
		const overviewBlock = blocks.find(
			(block) => isRecord(block) && readString(block, 'type') === 'overview',
		);
		if (isRecord(overviewBlock)) {
			const overview = readContentText(overviewBlock.content);
			if (overview) {
				parts.push('## Overview', '', overview, '');
			}
		}

		const transcriptBlock = blocks.find(
			(block) => isRecord(block) && readString(block, 'type') === 'transcript',
		);
		if (isRecord(transcriptBlock)) {
			const transcript = readContentText(transcriptBlock.content);
			if (transcript) {
				parts.push('## Transcript', '', transcript);
			}
		}

		if (parts.length === 0) {
			const fallback = readContentText(material.content);
			if (fallback) {
				parts.push(fallback);
			}
		}

		if (parts.length > 0) {
			const contentEl = this.previewBodyEl.createDiv({ cls: 'youmind-preview-media-content' });
			await MarkdownRenderer.render(this.app, parts.join('\n'), contentEl, '', this);
			return;
		}

		this.previewBodyEl.createDiv({
			cls: 'youmind-preview-empty',
			text: `This ${materialType} has no transcript yet.`,
		});
	}

	private renderFallbackPreview(
		node: TreeNode,
		material?: Record<string, unknown>,
	): void {
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		this.previewBodyEl.addClass('is-fallback-preview');

		const wrapper = this.previewBodyEl.createDiv({ cls: 'youmind-preview-fallback' });
		const iconEl = wrapper.createDiv({ cls: 'youmind-preview-fallback-icon' });
		setIcon(iconEl, this.getTypeIcon(readString(material ?? {}, 'type') ?? node.entityType ?? node.craftType ?? ''));
		wrapper.createDiv({
			cls: 'youmind-preview-fallback-title',
			text: node.title || readString(material ?? {}, 'title') || 'Untitled',
		});
		wrapper.createDiv({
			cls: 'youmind-preview-fallback-type',
			text: (readString(material ?? {}, 'type') ?? node.entityType ?? node.craftType ?? 'unknown').toUpperCase(),
		});

		const url = readString(material ?? {}, 'url') ?? this.buildYouMindUrl(node);
		if (url) {
			const buttonEl = wrapper.createEl('a', {
				cls: 'youmind-preview-fallback-btn',
				attr: {
					href: url,
					target: '_blank',
					rel: 'noopener noreferrer',
				},
			});
			const buttonIconEl = buttonEl.createSpan();
			setIcon(buttonIconEl, 'external-link');
			buttonEl.createSpan({ text: readString(material ?? {}, 'url') ? 'Open in Browser' : 'Open in YouMind' });
		}
	}

	private getTypeIcon(type: string): string {
		const iconMap: Record<string, string> = {
			note: 'file-text',
			article: 'globe',
			image: 'image',
			voice: 'headphones',
			video: 'play-circle',
			pdf: 'file-text',
			'text-file': 'file-text',
			office: 'file-spreadsheet',
			slides: 'presentation',
			webpage: 'layout-template',
			canvas: 'layout-dashboard',
		};
		return iconMap[type] ?? 'file';
	}

	private async renderMarkdownPreview(markdown: string): Promise<void> {
		this.resetPreviewBodyClasses();
		this.previewBodyEl.empty();
		await MarkdownRenderer.render(this.app, markdown, this.previewBodyEl, '', this);
	}
}
