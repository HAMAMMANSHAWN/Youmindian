import { App, normalizePath, requestUrl } from 'obsidian';

export interface DownloadedImage {
	localPath: string;
	relativePath: string;
}

export class ImageDownloader {
	constructor(private app: App) {}

	async download(
		imageUrl: string,
		fileName: string,
		mdFilePath: string,
	): Promise<DownloadedImage | null> {
		try {
			const attachmentDir = this.resolveAttachmentDir(mdFilePath);
			await this.ensureDirectory(attachmentDir);

			const safeName = this.sanitizeImageFileName(fileName, imageUrl);
			const finalPath = await this.deduplicateImagePath(
				normalizePath(attachmentDir ? `${attachmentDir}/${safeName}` : safeName),
			);

			const response = await requestUrl({
				url: imageUrl,
				method: 'GET',
			});

			if (response.status !== 200) {
				console.warn(`[YouMind ImageDownloader] HTTP ${response.status} for ${imageUrl}`);
				return null;
			}

			await this.app.vault.createBinary(finalPath, response.arrayBuffer);

			const lastSlash = mdFilePath.lastIndexOf('/');
			const mdDir = lastSlash >= 0 ? mdFilePath.substring(0, lastSlash) : '';
			const relativePath = this.getRelativePath(mdDir, finalPath);

			return { localPath: finalPath, relativePath };
		} catch (error) {
			console.warn('[YouMind ImageDownloader] Download failed:', error);
			return null;
		}
	}

	async downloadBatch(
		imageUrls: string[],
		mdFilePath: string,
	): Promise<Map<string, DownloadedImage>> {
		const results = new Map<string, DownloadedImage>();
		for (const url of imageUrls) {
			const fileName = this.extractFileNameFromUrl(url);
			const result = await this.download(url, fileName, mdFilePath);
			if (result) {
				results.set(url, result);
			}
		}
		return results;
	}

	extractFileNameFromUrl(url: string): string {
		try {
			const pathname = new URL(url).pathname;
			const segments = pathname.split('/');
			const lastSegment = segments[segments.length - 1];
			if (lastSegment && lastSegment.includes('.')) {
				return decodeURIComponent(lastSegment);
			}
		} catch {
			// ignore malformed URL and fall back below
		}
		return `image_${Date.now()}.png`;
	}

	private resolveAttachmentDir(mdFilePath: string): string {
		const lastSlash = mdFilePath.lastIndexOf('/');
		const mdDir = lastSlash >= 0 ? mdFilePath.substring(0, lastSlash) : '';
		const vaultConfig = (this.app.vault as { config?: { attachmentFolderPath?: string } }).config;
		const attachmentFolderPath = vaultConfig?.attachmentFolderPath;

		if (attachmentFolderPath) {
			if (attachmentFolderPath.startsWith('./')) {
				const subFolder = attachmentFolderPath.substring(2);
				return normalizePath(mdDir ? `${mdDir}/${subFolder}` : subFolder);
			}
			if (attachmentFolderPath === '/') {
				return '';
			}
			return normalizePath(attachmentFolderPath);
		}

		return normalizePath(mdDir ? `${mdDir}/attachments` : 'attachments');
	}

	private sanitizeImageFileName(fileName: string, imageUrl: string): string {
		let safe = fileName
			.replace(/[\\/:*?"<>|#^\[\]]/g, '')
			.replace(/\s+/g, '_')
			.trim();

		if (!safe || safe === '.' || safe === '..') {
			safe = `image_${Date.now()}`;
		}

		const ext = this.getImageExtension(safe, imageUrl);
		const nameWithoutExt = safe.replace(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)$/i, '');
		return `${nameWithoutExt}.${ext}`;
	}

	private getImageExtension(fileName: string, imageUrl: string): string {
		const fileMatch = fileName.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)$/i);
		if (fileMatch?.[1]) {
			return fileMatch[1].toLowerCase();
		}

		try {
			const urlPath = new URL(imageUrl).pathname;
			const urlMatch = urlPath.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)$/i);
			if (urlMatch?.[1]) {
				return urlMatch[1].toLowerCase();
			}
		} catch {
			// ignore malformed URL and fall back below
		}

		return 'png';
	}

	private async deduplicateImagePath(basePath: string): Promise<string> {
		if (!this.app.vault.getAbstractFileByPath(basePath)) {
			return basePath;
		}

		const dotIndex = basePath.lastIndexOf('.');
		const nameWithoutExt = dotIndex > 0 ? basePath.substring(0, dotIndex) : basePath;
		const ext = dotIndex > 0 ? basePath.substring(dotIndex) : '.png';

		let counter = 1;
		let nextPath = `${nameWithoutExt}_${counter}${ext}`;
		while (this.app.vault.getAbstractFileByPath(nextPath)) {
			counter += 1;
			nextPath = `${nameWithoutExt}_${counter}${ext}`;
		}
		return nextPath;
	}

	private getRelativePath(fromDir: string, toPath: string): string {
		if (fromDir && toPath.startsWith(`${fromDir}/`)) {
			return toPath.substring(fromDir.length + 1);
		}
		return toPath;
	}

	private async ensureDirectory(dirPath: string): Promise<void> {
		if (!dirPath) {
			return;
		}
		const parts = dirPath.split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
