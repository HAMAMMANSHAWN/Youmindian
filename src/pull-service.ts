import { App, Notice, TFile, normalizePath } from 'obsidian';
import { ContentConverter, type ConvertedContent } from './content-converter';
import { ImageDownloader } from './image-downloader';
import type YouMindPlugin from './plugin-class';

export interface PullOptions {
	entityId: string;
	entityType: 'material' | 'craft';
	boardId: string;
	boardName: string;
}

export interface PullResult {
	success: boolean;
	filePath?: string;
	error?: string;
	action?: 'created' | 'updated' | 'skipped';
	title?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readTitle(detail: unknown, fallback: string): string {
	if (isRecord(detail) && typeof detail.title === 'string' && detail.title.trim()) {
		return detail.title;
	}
	return fallback;
}

export class PullService {
	private converter = new ContentConverter();
	private imageDownloader: ImageDownloader;

	constructor(
		private app: App,
		private plugin: YouMindPlugin,
	) {
		this.imageDownloader = new ImageDownloader(app);
	}

	async pull(options: PullOptions): Promise<PullResult> {
		const { entityId, entityType, boardId, boardName } = options;

		try {
			const existingFile = this.plugin.frontmatterManager.findLocalFile(entityId);
			if (existingFile) {
				return await this.updateExisting(existingFile, entityId, entityType, boardId);
			}

			const detail = await this.fetchDetail(entityId, entityType);
			if (!detail || !isRecord(detail)) {
				return { success: false, error: 'Failed to fetch content from YouMind' };
			}

			const previewFileName = this.converter.sanitizeFileName(
				readTitle(detail, entityType === 'craft' ? 'Untitled Page' : 'Untitled'),
			);
			const subfolder = entityType === 'craft' ? 'crafts' : 'materials';
			const syncRoot = this.plugin.settings.syncRoot || 'youmind';
			const sanitizedBoardName = this.converter.sanitizeFileName(boardName);
			const estimatedMdPath = normalizePath(
				`${syncRoot}/${sanitizedBoardName}/${subfolder}/${previewFileName}.md`,
			);

			const converted =
				entityType === 'material'
					? await this.converter.materialToMarkdown(
							detail,
							boardId,
							this.imageDownloader,
							estimatedMdPath,
						)
					: this.converter.craftToMarkdown(detail, boardId);

			const filePath = await this.writeFile(converted, boardName);
			return {
				success: true,
				filePath,
				action: 'created',
				title: readTitle(detail, converted.suggestedFileName),
			};
		} catch (error) {
			console.error('[YouMind Pull]', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error during pull',
			};
		}
	}

	async pullBatch(
		items: PullOptions[],
		onProgress?: (completed: number, total: number, currentTitle: string) => void,
	): Promise<{ succeeded: number; failed: number; skipped: number; results: PullResult[] }> {
		let succeeded = 0;
		let failed = 0;
		let skipped = 0;
		const results: PullResult[] = [];

		for (let index = 0; index < items.length; index += 1) {
			const current = items[index];
			if (!current) {
				continue;
			}
			onProgress?.(index, items.length, current.entityId);
			const result = await this.pull(current);
			results.push(result);

			if (result.success) {
				if (result.action === 'skipped') {
					skipped += 1;
				} else {
					succeeded += 1;
				}
			} else {
				failed += 1;
			}

			if (index < items.length - 1) {
				await this.sleep(200);
			}
		}

		onProgress?.(items.length, items.length, '');
		return { succeeded, failed, skipped, results };
	}

	async moveFile(currentPath: string, targetFolder: string): Promise<string | null> {
		try {
			const file = this.app.vault.getAbstractFileByPath(currentPath);
			if (!(file instanceof TFile)) {
				return null;
			}

			const normalizedFolder = targetFolder.trim().replace(/^\/+|\/+$/g, '');
			if (normalizedFolder) {
				await this.ensureDirectory(normalizedFolder);
			}

			const newPath = normalizePath(normalizedFolder ? `${normalizedFolder}/${file.name}` : file.name);
			let finalPath = newPath;

			if (this.app.vault.getAbstractFileByPath(finalPath) && finalPath !== currentPath) {
				const ext = '.md';
				const nameWithoutExt = finalPath.endsWith(ext) ? finalPath.slice(0, -ext.length) : finalPath;
				let counter = 1;
				finalPath = `${nameWithoutExt} ${counter}${ext}`;
				while (this.app.vault.getAbstractFileByPath(finalPath)) {
					counter += 1;
					finalPath = `${nameWithoutExt} ${counter}${ext}`;
				}
			}

			await this.app.fileManager.renameFile(file, finalPath);
			this.plugin.frontmatterManager.scanLinkedFiles();
			return finalPath;
		} catch (error) {
			console.error('[YouMind Pull] moveFile error:', error);
			return null;
		}
	}

	private async fetchDetail(entityId: string, entityType: 'material' | 'craft'): Promise<unknown> {
		if (entityType === 'material') {
			return this.plugin.api.getMaterial({ id: entityId, includeBlocks: true });
		}
		return this.plugin.api.getCraft({ id: entityId, withChildren: false });
	}

	private async updateExisting(
		existingFile: TFile,
		entityId: string,
		entityType: 'material' | 'craft',
		boardId: string,
	): Promise<PullResult> {
		const detail = await this.fetchDetail(entityId, entityType);
		if (!detail || !isRecord(detail)) {
			return { success: false, error: 'Failed to fetch content from YouMind' };
		}

		const converted =
			entityType === 'material'
				? await this.converter.materialToMarkdown(
						detail,
						boardId,
						this.imageDownloader,
						existingFile.path,
					)
				: this.converter.craftToMarkdown(detail, boardId);

		await this.app.vault.modify(existingFile, stripFrontmatter(converted.markdown));
		await this.plugin.frontmatterManager.write(existingFile, converted.frontmatter);
		this.plugin.frontmatterManager.scanLinkedFiles();

		return {
			success: true,
			filePath: existingFile.path,
			action: 'updated',
			title: readTitle(detail, converted.suggestedFileName),
		};
	}

	private async writeFile(converted: ConvertedContent, boardName: string): Promise<string> {
		const syncRoot = this.plugin.settings.syncRoot || 'youmind';
		const sanitizedBoardName = this.converter.sanitizeFileName(boardName);
		const basePath = normalizePath(
			`${syncRoot}/${sanitizedBoardName}/${converted.subfolder}/${converted.suggestedFileName}.md`,
		);
		const finalPath = await this.deduplicatePath(basePath);
		const dirPath = finalPath.includes('/') ? finalPath.slice(0, finalPath.lastIndexOf('/')) : '';
		if (dirPath) {
			await this.ensureDirectory(dirPath);
		}

		const file = await this.app.vault.create(finalPath, converted.markdown);
		await this.plugin.frontmatterManager.write(file, converted.frontmatter);
		this.plugin.frontmatterManager.scanLinkedFiles();
		return finalPath;
	}

	private async deduplicatePath(basePath: string): Promise<string> {
		const existing = this.app.vault.getAbstractFileByPath(basePath);
		if (!existing) {
			return basePath;
		}

		if (existing instanceof TFile) {
			const fm = this.plugin.frontmatterManager.read(existing);
			if (fm?.youmind_id) {
				return basePath;
			}
		}

		const ext = '.md';
		const nameWithoutExt = basePath.endsWith(ext) ? basePath.slice(0, -ext.length) : basePath;
		let counter = 1;
		let nextPath = `${nameWithoutExt} ${counter}${ext}`;
		while (this.app.vault.getAbstractFileByPath(nextPath)) {
			counter += 1;
			nextPath = `${nameWithoutExt} ${counter}${ext}`;
		}
		return nextPath;
	}

	private async ensureDirectory(dirPath: string): Promise<void> {
		const parts = dirPath.split('/').filter(Boolean);
		let currentPath = '';
		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				await this.app.vault.createFolder(currentPath);
			}
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}
}
