import type { YouMindFrontmatter } from './types';
import { ImageDownloader } from './image-downloader';

export interface ConvertedContent {
	markdown: string;
	frontmatter: YouMindFrontmatter;
	suggestedFileName: string;
	subfolder: 'materials' | 'crafts';
}

interface SlideSceneSummary {
	title?: string;
	imageUrl?: string;
	pptType?: string;
	keyContent?: string;
	narrativeGoal?: string;
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

	async craftToMarkdown(
		craft: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		const type = readString(craft, 'type') ?? 'page';
		switch (type) {
			case 'page':
				return this.convertPage(craft, boardId);
			case 'slides':
				return this.convertSlides(craft, boardId, imageDownloader, mdFilePath);
			case 'webpage':
				return this.convertWebpage(craft, boardId, imageDownloader, mdFilePath);
			case 'audio-pod':
				return this.convertAudioPod(craft, boardId);
			case 'canvas':
				return this.convertCanvas(craft, boardId);
			default:
				return this.convertCraftFallback(craft, boardId);
		}
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

	private convertPage(craft: Record<string, unknown>, boardId: string): ConvertedContent {
		return {
			markdown: readContent(craft.content),
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

	private async convertSlides(
		craft: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		try {
			const rawContent = isRecord(craft.content) ? craft.content.raw : craft.content;
			const parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
			const scenes = this.readSlidesScenes(parsed);
			if (scenes.length === 0) {
				return this.convertCraftFallback(craft, boardId);
			}

			const parts: string[] = [];
			const title = readString(craft, 'title') ?? 'Untitled Slides';
			parts.push(`# ${title}`, '');
			parts.push(`> Slides deck with ${scenes.length} scenes`);
			parts.push(`> [Open in YouMind](https://youmind.com/crafts/${readString(craft, 'id') ?? ''})`, '');

			for (const [index, scene] of scenes.entries()) {
				const sceneTitle = scene.title || `Scene ${index + 1}`;
				const pptType = scene.pptType ? ` (${scene.pptType})` : '';
				parts.push(`## ${index + 1}. ${sceneTitle}${pptType}`, '');

				if (scene.imageUrl) {
					let imageRef = scene.imageUrl;
					if (imageDownloader && mdFilePath) {
						const extMatch = scene.imageUrl.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
						const ext = extMatch?.[1]?.toLowerCase() ?? 'jpeg';
						const fileName = `slide_${index + 1}_${this.sanitizeFileName(sceneTitle)}.${ext}`;
						const downloaded = await imageDownloader.download(scene.imageUrl, fileName, mdFilePath);
						if (downloaded) {
							imageRef = downloaded.relativePath;
						}
					}
					parts.push(`![${sceneTitle}](${imageRef})`, '');
				}

				if (scene.keyContent) {
					parts.push(scene.keyContent, '');
				}
				if (scene.narrativeGoal) {
					parts.push(`> ${scene.narrativeGoal}`, '');
				}
			}

			return {
				markdown: parts.join('\n'),
				frontmatter: this.buildFrontmatter(
					readString(craft, 'id') ?? '',
					boardId,
					'slides',
					'pull',
				),
				suggestedFileName: this.sanitizeFileName(title),
				subfolder: 'crafts',
			};
		} catch {
			return this.convertCraftFallback(craft, boardId);
		}
	}

	private async convertWebpage(
		craft: Record<string, unknown>,
		boardId: string,
		imageDownloader?: ImageDownloader,
		mdFilePath?: string,
	): Promise<ConvertedContent> {
		const parts: string[] = [];
		const title = readString(craft, 'title') ?? 'Untitled Webpage';
		const screenshot = readString(craft, 'screenshot');
		const contentUrl = readString(craft, 'contentUrl') ?? readString(craft, 'content_url');
		const body = this.extractTextContent(craft.content);

		parts.push(`# ${title}`, '');
		parts.push('> Webpage craft');
		parts.push(`> [Open in YouMind](https://youmind.com/crafts/${readString(craft, 'id') ?? ''})`, '');

		if (screenshot) {
			let imageRef = screenshot;
			if (imageDownloader && mdFilePath) {
				const downloaded = await imageDownloader.download(
					screenshot,
					`${this.sanitizeFileName(title)}_screenshot.png`,
					mdFilePath,
				);
				if (downloaded) {
					imageRef = downloaded.relativePath;
				}
			}
			parts.push(`![${title}](${imageRef})`, '');
		}

		if (contentUrl) {
			parts.push(`**HTML Source:** [${contentUrl}](${contentUrl})`, '');
		}

		if (body) {
			parts.push('## Content', '', body, '');
		}

		if (!screenshot && !contentUrl && !body) {
			parts.push('This webpage has no extractable content. Open in YouMind to view.');
		}

		return {
			markdown: parts.join('\n'),
			frontmatter: this.buildFrontmatter(
				readString(craft, 'id') ?? '',
				boardId,
				'webpage',
				'pull',
			),
			suggestedFileName: this.sanitizeFileName(title),
			subfolder: 'crafts',
		};
	}

	private convertAudioPod(craft: Record<string, unknown>, boardId: string): ConvertedContent {
		try {
			const textContent = this.extractTextContent(craft.content);
			if (!textContent) {
				return this.convertCraftFallback(craft, boardId);
			}

			return {
				markdown: [
					`# ${readString(craft, 'title') ?? 'Untitled AudioPod'}`,
					'',
					'> AudioPod transcript',
					`> [Open in YouMind](https://youmind.com/crafts/${readString(craft, 'id') ?? ''})`,
					'',
					'---',
					'',
					textContent,
					'',
				].join('\n'),
				frontmatter: this.buildFrontmatter(
					readString(craft, 'id') ?? '',
					boardId,
					'audio-pod',
					'pull',
				),
				suggestedFileName: this.sanitizeFileName(
					readString(craft, 'title') ?? 'Untitled AudioPod',
				),
				subfolder: 'crafts',
			};
		} catch {
			return this.convertCraftFallback(craft, boardId);
		}
	}

	private convertCanvas(craft: Record<string, unknown>, boardId: string): ConvertedContent {
		try {
			const textContent = this.extractTextContent(craft.content);
			if (!textContent) {
				return this.convertCraftFallback(craft, boardId);
			}

			return {
				markdown: [
					`# ${readString(craft, 'title') ?? 'Untitled Canvas'}`,
					'',
					'> Canvas content',
					`> [Open in YouMind](https://youmind.com/crafts/${readString(craft, 'id') ?? ''})`,
					'',
					'---',
					'',
					textContent,
					'',
				].join('\n'),
				frontmatter: this.buildFrontmatter(
					readString(craft, 'id') ?? '',
					boardId,
					'canvas',
					'pull',
				),
				suggestedFileName: this.sanitizeFileName(readString(craft, 'title') ?? 'Untitled Canvas'),
				subfolder: 'crafts',
			};
		} catch {
			return this.convertCraftFallback(craft, boardId);
		}
	}

	private extractTextContent(content: unknown): string {
		if (!content) {
			return '';
		}

		if (typeof content === 'string') {
			return this.extractTextFromString(content);
		}

		if (isRecord(content)) {
			const plain = readString(content, 'plain');
			if (plain) {
				return plain;
			}

			const raw = readString(content, 'raw');
			if (raw) {
				return this.extractTextFromString(raw);
			}

			return this.extractTextFromObject(content);
		}

		return '';
	}

	private extractTextFromString(value: string): string {
		try {
			const parsed = JSON.parse(value);
			return this.extractTextFromObject(parsed) || value.trim();
		} catch {
			return value.trim();
		}
	}

	private extractTextFromObject(value: unknown): string {
		const texts: string[] = [];
		this.collectStringsFromObject(value, texts, 0);
		return texts.join('\n\n').trim();
	}

	private collectStringsFromObject(value: unknown, texts: string[], depth: number): void {
		if (depth > 10 || value == null) {
			return;
		}

		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (
				trimmed.length > 10 &&
				!trimmed.startsWith('http://') &&
				!trimmed.startsWith('https://') &&
				!/^[a-f0-9-]{20,}$/i.test(trimmed)
			) {
				texts.push(trimmed);
			}
			return;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				this.collectStringsFromObject(item, texts, depth + 1);
			}
			return;
		}

		if (typeof value === 'object') {
			for (const child of Object.values(value as Record<string, unknown>)) {
				this.collectStringsFromObject(child, texts, depth + 1);
			}
		}
	}

	private extractSlidesSection(content: string, sectionName: string): string | null {
		if (!content.trim()) {
			return null;
		}

		const markers = ['NARRATIVE GOAL:', 'KEY CONTENT:', 'VISUAL:', 'LAYOUT:'];
		const startMarker = `${sectionName}:`;
		const startIndex = content.indexOf(startMarker);
		if (startIndex === -1) {
			return null;
		}

		const afterStart = content.slice(startIndex + startMarker.length);
		let endIndex = afterStart.length;
		for (const marker of markers) {
			if (marker === startMarker) {
				continue;
			}
			const markerIndex = afterStart.indexOf(marker);
			if (markerIndex !== -1 && markerIndex < endIndex) {
				endIndex = markerIndex;
			}
		}

		const extracted = afterStart.slice(0, endIndex).replace(/\\n/g, '\n').trim();
		return extracted || null;
	}

	private readSlidesScenes(parsed: unknown): SlideSceneSummary[] {
		const scenes = isRecord(parsed) && isRecord(parsed.timeline) && Array.isArray(parsed.timeline.scenes)
			? parsed.timeline.scenes
			: [];

		const summaries: SlideSceneSummary[] = [];
		for (const scene of scenes) {
			if (!isRecord(scene)) {
				continue;
			}
			const mediaAssets = Array.isArray(scene.mediaAssets) ? scene.mediaAssets : [];
			const firstAsset = mediaAssets[0];
			const genMedia = isRecord(firstAsset) && isRecord(firstAsset.genMedia) ? firstAsset.genMedia : null;
			if (!genMedia) {
				continue;
			}

			const contentText = readString(genMedia, 'content') ?? '';
			summaries.push({
				title: readString(genMedia, 'title'),
				imageUrl: readString(genMedia, 'playUrl', 'play_url'),
				pptType: readString(genMedia, 'pptType', 'ppt_type'),
				keyContent: this.extractSlidesSection(contentText, 'KEY CONTENT') ?? undefined,
				narrativeGoal: this.extractSlidesSection(contentText, 'NARRATIVE GOAL') ?? undefined,
			});
		}

		return summaries;
	}

	private convertCraftFallback(craft: Record<string, unknown>, boardId: string): ConvertedContent {
		const type = readString(craft, 'type') ?? 'unknown';
		const title = readString(craft, 'title') ?? 'Untitled';
		const id = readString(craft, 'id') ?? '';
		return {
			markdown: [
				`# ${title}`,
				'',
				`> ${type} craft`,
				`> [Open in YouMind](https://youmind.com/crafts/${id})`,
				'',
				`This ${type} craft could not be fully converted. Open the link above to view it in YouMind.`,
				'',
			].join('\n'),
			frontmatter: this.buildFrontmatter(id, boardId, type, 'pull'),
			suggestedFileName: this.sanitizeFileName(title),
			subfolder: 'crafts',
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
