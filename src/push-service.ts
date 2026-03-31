import { App, MarkdownView, Modal, Notice, TFile } from 'obsidian';
import type YouMindPlugin from './main';
import { SaveConfirmPanel } from './save-confirm-panel';
import type { BoardInfo } from './types';

export interface PushResult {
	status: 'created' | 'updated';
	id: string;
	title: string;
	boardId: string;
	boardName: string;
}

type PushDecision = 'update' | 'create' | 'cancel';

export class PushCanceledError extends Error {
	constructor() {
		super('Push canceled');
		this.name = 'PushCanceledError';
	}
}

export function isPushCanceledError(error: unknown): error is PushCanceledError {
	return error instanceof PushCanceledError;
}

function stripFrontmatter(content: string): string {
	if (!content.startsWith('---\n')) {
		return content;
	}
	const endIndex = content.indexOf('\n---\n', 4);
	if (endIndex === -1) {
		return content;
	}
	return content.slice(endIndex + 5);
}

export async function pushCurrentNoteToYouMind(plugin: YouMindPlugin): Promise<void> {
	const markdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const file = markdownView?.file;
	if (!file) {
		new Notice('Please open a Markdown note first');
		return;
	}

	const board = plugin.boardContext.getBoard();
	if (!board?.id) {
		new Notice('Please select a board first');
		return;
	}

	try {
		const result = await pushFileToYouMind(plugin, file, board.id);
		await showPushSuccessPanel(plugin, file, result);
	} catch (error) {
		if (isPushCanceledError(error)) {
			return;
		}
		new Notice(`Push failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

export async function pushFileToYouMind(plugin: YouMindPlugin, file: TFile, boardId: string): Promise<PushResult> {
	const rawContent = await plugin.app.vault.read(file);
	const content = stripFrontmatter(rawContent).trim();
	if (!content) {
		throw new Error('The current note is empty');
	}

	const linked = plugin.frontmatterManager.read(file);
	const title = file.basename;
	const syncedAt = new Date().toISOString();

	const createNote = async (): Promise<PushResult> => {
		const created = await plugin.api.createNote({
			content,
			title,
			boardId,
			genTitle: false,
		});
		await plugin.frontmatterManager.write(file, {
			youmind_id: created.id,
			youmind_board: created.boardId ?? boardId,
			youmind_type: 'note',
			youmind_synced_at: syncedAt,
			youmind_source: 'push',
		});
		plugin.frontmatterManager.scanLinkedFiles();
		return {
			status: 'created',
			id: created.id,
			title: created.title,
			boardId: created.boardId ?? boardId,
			boardName: plugin.boardContext.getBoard()?.name ?? created.boardId ?? boardId,
		};
	};

	const updateNote = async (source: 'push' | 'pull' | 'local' = linked?.youmind_source ?? 'push'): Promise<PushResult> => {
		if (!linked?.youmind_id) {
			return createNote();
		}
		const updated = await plugin.api.updateNote({
			id: linked.youmind_id,
			title,
			content,
			titleType: 'manual',
		});
		await plugin.frontmatterManager.write(file, {
			youmind_id: updated.id,
			youmind_board: boardId,
			youmind_type: 'note',
			youmind_synced_at: syncedAt,
			youmind_source: source,
		});
		plugin.frontmatterManager.scanLinkedFiles();
		return {
			status: 'updated',
			id: updated.id,
			title: updated.title,
			boardId,
			boardName: plugin.boardContext.getBoard()?.name ?? boardId,
		};
	};

	if (linked?.youmind_id && linked.youmind_type === 'note' && linked.youmind_source === 'push') {
		try {
			return updateNote(linked.youmind_source || 'push');
		} catch (error) {
			console.warn('[YouMind Push] updateNote failed, falling back to createNote', error);
			return createNote();
		}
	}

	if (linked?.youmind_id && linked.youmind_type === 'note' && linked.youmind_source === 'pull') {
		const decision = await new PullNotePushModal(plugin.app, title).openAndWait();
		if (decision === 'cancel') {
			throw new PushCanceledError();
		}
		if (decision === 'update') {
			try {
				return updateNote('push');
			} catch (error) {
				console.warn('[YouMind Push] explicit overwrite failed, falling back to createNote', error);
				return createNote();
			}
		}
	}

	return createNote();
}

class PullNotePushModal extends Modal {
	private resolver: ((value: PushDecision) => void) | null = null;

	constructor(
		app: App,
		private noteTitle: string,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('youmind-confirm-modal');
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Push pulled note?' });
		contentEl.createEl('p', {
			text: `“${this.noteTitle || 'Untitled note'}” 是从 YouMind 拉取下来的 Note。你可以覆盖原来的云端 Note，或者新建一条新的 YouMind Note。`,
		});

		const actions = contentEl.createDiv({ cls: 'youmind-confirm-actions' });
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		const createBtn = actions.createEl('button', { text: 'Create new note' });
		const overwriteBtn = actions.createEl('button', {
			text: 'Overwrite original',
			cls: 'mod-cta',
		});

		cancelBtn.addEventListener('click', () => {
			this.resolve('cancel');
			this.close();
		});
		createBtn.addEventListener('click', () => {
			this.resolve('create');
			this.close();
		});
		overwriteBtn.addEventListener('click', () => {
			this.resolve('update');
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolver) {
			const resolver = this.resolver;
			this.resolver = null;
			resolver('cancel');
		}
	}

	openAndWait(): Promise<PushDecision> {
		return new Promise<PushDecision>((resolve) => {
			this.resolver = (value) => {
				if (this.resolver) {
					this.resolver = null;
					resolve(value);
				}
			};
			this.open();
		});
	}

	private resolve(value: PushDecision): void {
		if (!this.resolver) {
			return;
		}
		const resolver = this.resolver;
		this.resolver = null;
		resolver(value);
	}
}

async function fetchBoardInfos(plugin: YouMindPlugin): Promise<BoardInfo[]> {
	const boards = await plugin.api.listBoards();
	return boards.map((board) => ({
		id: board.id,
		name: board.name,
		iconName: typeof board.icon === 'string' ? board.icon : board.icon?.name,
		iconColor: typeof board.icon === 'string' ? undefined : board.icon?.color,
	}));
}

export async function showPushSuccessPanel(
	plugin: YouMindPlugin,
	file: TFile,
	result: PushResult,
): Promise<void> {
	const boardInfos = await fetchBoardInfos(plugin);
	new SaveConfirmPanel({
		app: plugin.app,
		noteId: result.id,
		boardId: result.boardId,
		boardName: result.boardName,
		boards: boardInfos,
		isUpdate: result.status === 'updated',
		onBoardChanged: async (newBoardId, newBoardName) => {
			await plugin.api.moveMaterials({
				items: [{ id: result.id, boardId: newBoardId }],
			});
			await plugin.frontmatterManager.updateBoard(
				file,
				newBoardId,
				newBoardName,
				plugin.settings.syncRoot || 'youmind',
			);
		},
		onOpenInYouMind: () => {
			window.open(`https://youmind.com/boards/${result.boardId}?material-id=${result.id}`);
		},
	});
}
