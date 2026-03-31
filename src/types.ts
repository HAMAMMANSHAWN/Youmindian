import type { App } from 'obsidian';
import type { Board } from './api';

export const VIEW_TYPE_YOUMIND_CHAT = 'youmind-chat-view';
export const VIEW_TYPE_YOUMIND_BROWSER = 'youmind-browser-view';
export const DEFAULT_CHAT_TITLE = 'youmindian';
export const HISTORY_PAGE_SIZE = 20;
export const DEFAULT_SYNC_ROOT = 'youmind';

export type PullConflictStrategy = 'ask' | 'skip' | 'overwrite';

export interface YouMindSettings {
	apiKey: string;
	lastBoardId?: string;
	hiddenChatIds?: string[];
	syncRoot?: string;
	pullConflictStrategy?: PullConflictStrategy;
}

export const DEFAULT_SETTINGS: YouMindSettings = {
	apiKey: '',
	lastBoardId: undefined,
	hiddenChatIds: [],
	syncRoot: DEFAULT_SYNC_ROOT,
	pullConflictStrategy: 'ask',
};

export interface YouMindFrontmatter {
	youmind_id: string;
	youmind_board: string;
	youmind_type: string;
	youmind_synced_at: string;
	youmind_source: 'push' | 'pull' | 'local';
}

export interface BoardInfo {
	id: string;
	name: string;
	iconName?: string;
	iconColor?: string;
}

export interface TreeNode {
	id: string;
	type: 'group' | 'material' | 'craft';
	title: string;
	icon: string;
	entityType?: string;
	craftType?: string;
	children?: TreeNode[];
	isLinked: boolean;
	localPath?: string;
	isPullable: boolean;
	updatedAt: string;
	contentPreview?: string;
	url?: string;
	expanded?: boolean;
}

export interface SaveConfirmOptions {
	app: App;
	noteId: string;
	boardId: string;
	boardName: string;
	boards: BoardInfo[];
	isUpdate: boolean;
	onBoardChanged?: (newBoardId: string, newBoardName: string) => Promise<void>;
	onOpenInYouMind?: () => void;
}

export type BoardChangeListener = (board: Board | null) => void;
