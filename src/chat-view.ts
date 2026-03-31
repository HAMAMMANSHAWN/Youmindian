import { ItemView, MarkdownRenderer, MarkdownView, Menu, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type { CreatePickParams, Message, SendMessageResponse } from './api';
import { extractAssistantContent } from './api';
import type YouMindPlugin from './main';
import { BoardSelector } from './board-selector';
import { HistoryPanel, ConfirmHideModal } from './history-panel';
import { SaveConfirmPanel } from './save-confirm-panel';
import type { BoardInfo } from './types';
import { DEFAULT_CHAT_TITLE, VIEW_TYPE_YOUMIND_CHAT } from './types';

export class YouMindChatView extends ItemView {
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
			attr: { 'aria-label': 'Save options' },
		});
		setIcon(saveBtn, 'file-plus');
		saveBtn.addEventListener('click', (event) => {
			this.openSaveMenu(event, rawText, plainText);
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

	private openSaveMenu(event: MouseEvent, rawText: string, plainText: string): void {
		event.preventDefault();
		event.stopPropagation();

		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Save to Vault')
				.setIcon('hard-drive')
				.onClick(async () => {
					await this.saveMessageToVault(rawText, plainText);
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Save as YouMind Note')
				.setIcon('cloud')
				.onClick(async () => {
					await this.saveMessageAsYouMindNote(rawText, plainText);
				}),
		);
		menu.showAtMouseEvent(event);
	}

	private async saveMessageToVault(rawText: string, plainText: string): Promise<void> {
		const board = this.plugin.boardContext.getBoard();
		const noteTitle = this.resolveNoteBaseName(rawText, plainText);

		try {
			const file = await this.createLocalMessageNote(rawText, noteTitle, board?.name ?? null);
			if (board?.id) {
				await this.plugin.frontmatterManager.writeLocal(file, {
					youmind_board: board.id,
					youmind_source: 'local',
				});
			}
			new Notice(`Saved to Vault: ${file.path}`);
		} catch {
			new Notice('Failed to save note to Vault');
		}
	}

	private async saveMessageAsYouMindNote(rawText: string, plainText: string): Promise<void> {
		const board = this.plugin.boardContext.getBoard();
		if (!board?.id) {
			new Notice('Please select a board first');
			return;
		}
		const noteTitle = this.resolveNoteBaseName(rawText, plainText);
		let remoteNoteId: string | null = null;
		let remoteBoardId: string | null = board.id;
		let effectiveTitle = noteTitle;
		let createdNoteTitle = noteTitle;

		if (this.plugin.settings.apiKey) {
			try {
				const note = await this.plugin.api.createNote({
					content: rawText,
					title: noteTitle,
					boardId: board.id,
					genTitle: false,
				});
				remoteNoteId = note.id;
				remoteBoardId = note.boardId ?? board.id;
				createdNoteTitle = note.title?.trim() || noteTitle;
				if (note.title?.trim()) {
					effectiveTitle = note.title.trim();
				}
			} catch (error) {
				new Notice(`Failed to create YouMind note: ${error instanceof Error ? error.message : 'Unknown error'}`);
				return;
			}
		}

		try {
			const file = await this.createLocalMessageNote(rawText, effectiveTitle, board?.name ?? null);
			if (remoteNoteId && remoteBoardId) {
				await this.plugin.frontmatterManager.write(file, {
					youmind_id: remoteNoteId,
					youmind_board: remoteBoardId,
					youmind_type: 'note',
					youmind_synced_at: new Date().toISOString(),
					youmind_source: 'push',
				});
				this.plugin.frontmatterManager.scanLinkedFiles();
				const boardInfos = await this.fetchBoardInfos();
				new SaveConfirmPanel({
					app: this.app,
					noteId: remoteNoteId,
					boardId: remoteBoardId,
					boardName: board.name,
					boards: boardInfos,
					isUpdate: false,
					onBoardChanged: async (newBoardId, newBoardName) => {
						await this.plugin.api.moveMaterials({
							items: [{ id: remoteNoteId as string, boardId: newBoardId }],
						});
						await this.plugin.frontmatterManager.updateBoard(
							file,
							newBoardId,
							newBoardName,
							this.getSyncRootPath(),
						);
					},
					onOpenInYouMind: () => {
						window.open(`https://youmind.com/boards/${remoteBoardId}?material-id=${remoteNoteId}`);
					},
				});
				return;
			}
			new Notice(`Saved as YouMind Note: ${createdNoteTitle}`);
		} catch {
			new Notice('Failed to save YouMind note');
		}
	}

	private async fetchBoardInfos(): Promise<BoardInfo[]> {
		const boards = await this.plugin.api.listBoards();
		return boards.map((board) => ({
			id: board.id,
			name: board.name,
			iconName: typeof board.icon === 'string' ? board.icon : board.icon?.name,
			iconColor: typeof board.icon === 'string' ? undefined : board.icon?.color,
		}));
	}

	private async createLocalMessageNote(rawText: string, title: string, boardName: string | null) {
		const boardFolderName = boardName ? this.sanitizeFileName(boardName) : null;
		const folderPath = boardFolderName
			? `${this.getSyncRootPath()}/${boardFolderName}/materials`
			: `${this.getSyncRootPath()}/materials`;
		await this.ensureFolderPath(folderPath);
		const filePath = this.getAvailableNotePath(`${folderPath}/${this.sanitizeFileName(title)}`);
		return this.app.vault.create(filePath, rawText);
	}

	private getSyncRootPath(): string {
		return this.sanitizeFileName(this.plugin.settings.syncRoot || 'youmind');
	}

	private async ensureFolderPath(folderPath: string): Promise<void> {
		const parts = folderPath.split('/').filter(Boolean);
		let currentPath = '';
		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				await this.app.vault.createFolder(currentPath);
			}
		}
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
