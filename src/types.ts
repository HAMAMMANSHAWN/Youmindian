import type { App } from 'obsidian';
import type { Board } from './api';

export const VIEW_TYPE_YOUMIND_CHAT = 'youmind-chat-view';
export const DEFAULT_CHAT_TITLE = 'YouMind';
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
