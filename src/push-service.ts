import { MarkdownView, Notice, TFile } from 'obsidian';
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

	if (linked?.youmind_id && linked.youmind_type === 'note') {
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
			youmind_synced_at: new Date().toISOString(),
			youmind_source: 'push',
		});
		plugin.frontmatterManager.scanLinkedFiles();
		return {
			status: 'updated',
			id: updated.id,
			title: updated.title,
			boardId,
			boardName: plugin.boardContext.getBoard()?.name ?? boardId,
		};
	}

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
		youmind_synced_at: new Date().toISOString(),
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
