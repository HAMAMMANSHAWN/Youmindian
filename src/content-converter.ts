import type { YouMindFrontmatter } from './types';
import { ImageDownloader } from './image-downloader';

export interface ConvertedContent {
	markdown: string;
	frontmatter: YouMindFrontmatter;
	suggestedFileName: string;
	subfolder: 'materials' | 'crafts';
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

function readContent(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (isRecord(value)) {
		return readString(value, 'plain', 'raw', 'text', 'content', 'data') ?? '';
	}
	return '';
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

export class ContentConverter {
	async materialToMarkdown(
		material: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		const type = readString(material, 'type') ?? 'unknown';

		switch (type) {
			case 'note':
				return this.convertNote(material, boardId);
			case 'article':
				return this.convertArticle(material, boardId, imageDownloader, mdFilePath);
			case 'image':
				return this.convertImage(material, boardId, imageDownloader, mdFilePath);
			case 'voice':
			case 'video':
				return this.convertMediaTranscript(material, boardId);
			case 'pdf':
				return this.convertPdf(material, boardId, imageDownloader, mdFilePath);
			case 'text-file':
				return this.convertTextFile(material, boardId);
			default:
				return this.convertFallback(material, boardId);
		}
	}

	craftToMarkdown(craft: Record<string, unknown>, boardId: string): ConvertedContent {
		const content = readContent(craft.content);
		return {
			markdown: content,
			frontmatter: this.buildFrontmatter(
				readString(craft, 'id') ?? '',
				boardId,
				'page',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(readString(craft, 'title') ?? 'Untitled Page'),
			subfolder: 'crafts',
		};
	}

	markdownToNote(rawContent: string): string {
		let content = rawContent;
		content = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
		content = content.replace(/\[\[([^\]]*?)\|([^\]]*?)\]\]/g, '$2');
		content = content.replace(/\[\[([^\]]*?)\]\]/g, '$1');
		content = content.replace(/!\[\[([^\]]*?)\]\]/g, '> Embedded: $1');
		content = content.replace(/%%[\s\S]*?%%/g, '');
		return content.trim();
	}

	sanitizeFileName(name: string): string {
		const cleaned = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
		return (cleaned || 'Untitled').slice(0, 200);
	}

	private convertNote(material: Record<string, unknown>, boardId: string): ConvertedContent {
		return {
			markdown: readContent(material.content),
			frontmatter: this.buildFrontmatter(
				readString(material, 'id') ?? '',
				boardId,
				'note',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(readString(material, 'title') ?? 'Untitled Note'),
			subfolder: 'materials',
		};
	}

	private async convertArticle(
		material: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		const parts: string[] = [];
		const url = readString(material, 'url');
		if (url) {
			parts.push(`> Source: ${url}`, '');
		}
		let body = readContent(material.content);
		if (body && imageDownloader && mdFilePath) {
			body = await this.downloadInlineImages(body, imageDownloader, mdFilePath);
		}
		if (body) {
			parts.push(body);
		}
		return {
			markdown: parts.join('\n'),
			frontmatter: this.buildFrontmatter(
				readString(material, 'id') ?? '',
				boardId,
				'article',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(
				readString(material, 'title') ?? 'Untitled Article',
			),
			subfolder: 'materials',
		};
	}

	private resolveImageFileName(material: Record<string, unknown>): string {
		if (isRecord(material.file)) {
			const fileName = readString(material.file, 'name');
			if (fileName) {
				return fileName;
			}
		}
		const title = readString(material, 'title');
		return title ? `${title}.png` : `image_${Date.now()}.png`;
	}

	private async convertImage(
		material: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		const parts: string[] = [];
		const imageUrl = resolveImageUrl(material);
		const title = readString(material, 'title') ?? 'image';
		if (imageUrl) {
			let imageRef = imageUrl;
			if (imageDownloader && mdFilePath) {
				const fileName = this.resolveImageFileName(material);
				const downloaded = await imageDownloader.download(imageUrl, fileName, mdFilePath);
				if (downloaded) {
					imageRef = downloaded.relativePath;
				}
			}
			parts.push(`![${title}](${imageRef})`, '');
		}
		const description = readContent(material.content);
		if (description) {
			parts.push(description);
		}
		return {
			markdown: parts.join('\n'),
			frontmatter: this.buildFrontmatter(
				readString(material, 'id') ?? '',
				boardId,
				'image',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(readString(material, 'title') ?? 'Untitled Image'),
			subfolder: 'materials',
		};
	}

	private convertMediaTranscript(
		material: Record<string, unknown>,
		boardId: string,
	): ConvertedContent {
		const parts: string[] = [];
		const url = readString(material, 'url');
		if (url) {
			parts.push(`> Source: ${url}`, '');
		}

		const blocks = Array.isArray(material.blocks) ? material.blocks : [];
		const overviewBlock = blocks.find(
			(block) => isRecord(block) && readString(block, 'type') === 'overview',
		);
		const transcriptBlock = blocks.find(
			(block) => isRecord(block) && readString(block, 'type') === 'transcript',
		);

		if (isRecord(overviewBlock)) {
			const overview = readContent(overviewBlock.content);
			if (overview) {
				parts.push('## Overview', '', overview, '');
			}
		}

		if (isRecord(transcriptBlock)) {
			const transcript = readContent(transcriptBlock.content);
			if (transcript) {
				parts.push('## Transcript', '', transcript);
			}
		}

		if (parts.length <= (url ? 2 : 0)) {
			const fallback = readContent(material.content);
			if (fallback) {
				parts.push(fallback);
			}
		}

		if (parts.length === 0) {
			parts.push(
				`> This ${readString(material, 'type') ?? 'media'} has no transcript yet. Open in YouMind to view.`,
			);
		}

		const materialType = readString(material, 'type') ?? 'voice';
		return {
			markdown: parts.join('\n'),
			frontmatter: this.buildFrontmatter(
				readString(material, 'id') ?? '',
				boardId,
				materialType,
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(
				readString(material, 'title') ?? `Untitled ${materialType}`,
			),
			subfolder: 'materials',
		};
	}

	private async convertPdf(
		material: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		const parts: string[] = [];
		const url = readString(material, 'url');
		if (url) {
			parts.push(`> Source: [PDF](${url})`, '');
		}

		const blocks = Array.isArray(material.blocks) ? material.blocks : [];
		const overviewBlock = blocks.find(
			(block) => isRecord(block) && readString(block, 'type') === 'overview',
		);
		if (isRecord(overviewBlock)) {
			const overview = readContent(overviewBlock.content);
			if (overview) {
				parts.push('## Overview', '', overview, '');
			}
		}

		let body = readContent(material.content);
		if (body && imageDownloader && mdFilePath) {
			body = await this.downloadInlineImages(body, imageDownloader, mdFilePath);
		}
		if (body) {
			parts.push(body);
		}

		if (parts.length === 0) {
			parts.push('> This PDF has no extracted content yet. Open in YouMind to view.');
		}

		return {
			markdown: parts.join('\n'),
			frontmatter: this.buildFrontmatter(
				readString(material, 'id') ?? '',
				boardId,
				'pdf',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(readString(material, 'title') ?? 'Untitled PDF'),
			subfolder: 'materials',
		};
	}

	private async downloadInlineImages(
		markdown: string,
		imageDownloader: ImageDownloader,
		mdFilePath: string,
	): Promise<string> {
		const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
		const matches: Array<{ full: string; alt: string; url: string }> = [];
		let match: RegExpExecArray | null;
		while ((match = imageRegex.exec(markdown)) !== null) {
			matches.push({
				full: match[0],
				alt: match[1] ?? '',
				url: match[2] ?? '',
			});
		}

		if (matches.length === 0) {
			return markdown;
		}

		let result = markdown;
		for (const item of matches) {
			const fileName = imageDownloader.extractFileNameFromUrl(item.url);
			const downloaded = await imageDownloader.download(item.url, fileName, mdFilePath);
			if (downloaded) {
				result = result.replace(item.full, `![${item.alt}](${downloaded.relativePath})`);
			}
		}
		return result;
	}

	private convertTextFile(material: Record<string, unknown>, boardId: string): ConvertedContent {
		return {
			markdown: readContent(material.content),
			frontmatter: this.buildFrontmatter(
				readString(material, 'id') ?? '',
				boardId,
				'text-file',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(readString(material, 'title') ?? 'Untitled Text'),
			subfolder: 'materials',
		};
	}

	private convertFallback(material: Record<string, unknown>, boardId: string): ConvertedContent {
		const id = readString(material, 'id') ?? '';
		return {
			markdown: `> This material is available in YouMind: [Open in YouMind](https://youmind.com/materials/${id})`,
			frontmatter: this.buildFrontmatter(
				id,
				boardId,
				readString(material, 'type') ?? 'unknown',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(readString(material, 'title') ?? 'Untitled'),
			subfolder: 'materials',
		};
	}

	private buildFrontmatter(
		entityId: string,
		boardId: string,
		type: string,
		source: 'push' | 'pull',
	): YouMindFrontmatter {
		return {
			youmind_id: entityId,
			youmind_board: boardId,
			youmind_type: type,
			youmind_synced_at: new Date().toISOString(),
			youmind_source: source,
		};
	}
}
