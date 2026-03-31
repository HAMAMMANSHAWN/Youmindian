import { App, TFile } from 'obsidian';
import type { YouMindFrontmatter } from './types';

export type SyncStatus = 'unlinked' | 'synced' | 'modified';

export class FrontmatterManager {
	private linkedFiles = new Map<string, TFile>();

	constructor(private app: App) {}

	read(file: TFile): YouMindFrontmatter | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter || typeof frontmatter.youmind_id !== 'string') {
			return null;
		}

		return {
			youmind_id: frontmatter.youmind_id,
			youmind_board: typeof frontmatter.youmind_board === 'string' ? frontmatter.youmind_board : '',
			youmind_type: typeof frontmatter.youmind_type === 'string' ? frontmatter.youmind_type : '',
			youmind_synced_at:
				typeof frontmatter.youmind_synced_at === 'string' ? frontmatter.youmind_synced_at : '',
			youmind_source:
				frontmatter.youmind_source === 'pull' ||
				frontmatter.youmind_source === 'push' ||
				frontmatter.youmind_source === 'local'
					? frontmatter.youmind_source
					: 'push',
		};
	}

	async writeLocal(file: TFile, meta: { youmind_board: string; youmind_source: 'local' }): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.youmind_board = meta.youmind_board;
			frontmatter.youmind_source = meta.youmind_source;
			delete frontmatter.youmind_id;
			delete frontmatter.youmind_type;
			delete frontmatter.youmind_synced_at;
		});
	}

	async write(file: TFile, meta: YouMindFrontmatter): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.youmind_id = meta.youmind_id;
			frontmatter.youmind_board = meta.youmind_board;
			frontmatter.youmind_type = meta.youmind_type;
			frontmatter.youmind_synced_at = meta.youmind_synced_at;
			frontmatter.youmind_source = meta.youmind_source;
		});
		this.linkedFiles.set(meta.youmind_id, file);
	}

	async remove(file: TFile): Promise<void> {
		const existing = this.read(file);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			delete frontmatter.youmind_id;
			delete frontmatter.youmind_board;
			delete frontmatter.youmind_type;
			delete frontmatter.youmind_synced_at;
			delete frontmatter.youmind_source;
		});
		if (existing?.youmind_id) {
			this.linkedFiles.delete(existing.youmind_id);
		}
	}

	scanLinkedFiles(): Map<string, TFile> {
		const next = new Map<string, TFile>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const meta = this.read(file);
			if (meta?.youmind_id) {
				next.set(meta.youmind_id, file);
			}
		}
		this.linkedFiles = next;
		return new Map(next);
	}

	findLocalFile(youmindId: string): TFile | null {
		if (!this.linkedFiles.size) {
			this.scanLinkedFiles();
		}
		return this.linkedFiles.get(youmindId) ?? null;
	}

	async updateBoard(file: TFile, newBoardId: string, newBoardName: string, syncRoot: string): Promise<TFile> {
		const meta = this.read(file);
		if (meta) {
			await this.write(file, {
				...meta,
				youmind_board: newBoardId,
			});
		} else {
			await this.writeLocal(file, {
				youmind_board: newBoardId,
				youmind_source: 'local',
			});
		}

		const normalizedRoot = syncRoot.replace(/^\/+|\/+$/g, '');
		const safeBoardName = newBoardName.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Untitled board';
		const subDir = file.path.includes('/crafts/') ? 'crafts' : 'materials';
		const newDir = `${normalizedRoot}/${safeBoardName}/${subDir}`;
		await this.ensureFolderPath(newDir);

		const newPath = `${newDir}/${file.name}`;
		if (newPath !== file.path) {
			await this.app.fileManager.renameFile(file, newPath);
		}

		const movedFile = this.app.vault.getAbstractFileByPath(newPath);
		if (!(movedFile instanceof TFile)) {
			throw new Error('Failed to locate moved file');
		}
		this.scanLinkedFiles();
		return movedFile;
	}

	getSyncStatus(file: TFile): SyncStatus {
		const meta = this.read(file);
		if (!meta?.youmind_id) {
			return 'unlinked';
		}

		const syncedAt = Date.parse(meta.youmind_synced_at);
		if (Number.isNaN(syncedAt)) {
			return 'modified';
		}

		return file.stat.mtime > syncedAt ? 'modified' : 'synced';
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
}
